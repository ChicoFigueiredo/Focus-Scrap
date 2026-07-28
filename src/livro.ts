/**
 * Captura do "Livro Digital" — o formato que resistia ao pipeline normal.
 *
 * Ele não é arquivo: é uma página HTML interativa. Abre numa capa com índice e
 * um botão "Começar", e os capítulos são `<section>` que o JS mostra e esconde.
 * Baixar a URL crua dá 4,8 MB de HTML — o conteúdo está lá, mas oculto — e não
 * existe variante de `saida=` que devolva PDF: testei `arquivo`, `pdf`,
 * `download` e todas retornam a mesma página.
 *
 * O método que funciona: renderizar no Chromium, **forçar todas as seções
 * visíveis** e usar o print-to-PDF do próprio navegador. A página passa de
 * 1.108px para 53.129px de altura e sai um PDF de 38 páginas com o texto
 * selecionável — não é captura de tela, é o documento.
 *
 * Duas armadilhas conhecidas, ambas já resolvidas aqui:
 *   - `networkidle` nunca resolve nesta página; espera-se `load` e um intervalo.
 *   - o modal de boas-vindas cobre o conteúdo no PDF se não for removido.
 */
import type { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { chromium, type Browser } from "playwright";

import { REPOSITORY } from "./config.ts";
import { log } from "./db.ts";

/** CSS que revela o livro inteiro de uma vez. */
const REVELAR = `
  section, .blcConteudo, [class*=capitulo], [class*=conteudo] {
    display: block !important; visibility: visible !important;
    opacity: 1 !important; height: auto !important; max-height: none !important;
    overflow: visible !important; position: static !important;
  }
  .blcModalMain, [class*=modal], [class*=overlay] { display: none !important; }
  * { animation: none !important; transition: none !important; }
`;

export interface Capturado {
  bytes: number;
  alturaAntes: number;
  alturaDepois: number;
}

export async function capturarLivro(
  url: string,
  destinoAbsoluto: string,
  browser?: Browser,
): Promise<Capturado> {
  const proprio = !browser;
  const b = browser ?? (await chromium.launch({ headless: true }));
  try {
    const page = await (await b.newContext()).newPage();
    page.setDefaultTimeout(60_000);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForLoadState("load", { timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(5_000);

    const alturaAntes = await page.evaluate(() => document.body.scrollHeight);

    await page.addStyleTag({ content: REVELAR });
    await page.evaluate(() => {
      document.querySelectorAll("section").forEach((s) => {
        (s as HTMLElement).style.setProperty("display", "block", "important");
        s.removeAttribute("hidden");
      });
    });
    await page.waitForTimeout(3_000);

    const alturaDepois = await page.evaluate(() => document.body.scrollHeight);
    // Se não cresceu, o truque não pegou: melhor falhar do que salvar só a capa.
    if (alturaDepois <= alturaAntes * 1.5)
      throw new Error(`conteúdo não expandiu (${alturaAntes}px → ${alturaDepois}px) — layout mudou?`);

    await mkdir(dirname(destinoAbsoluto), { recursive: true });
    await page.pdf({
      path: destinoAbsoluto, format: "A4", printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
    });
    await page.close();

    const bytes = (await Bun.file(destinoAbsoluto).stat()).size;
    if (bytes < 50_000) throw new Error(`PDF saiu com ${bytes} bytes — provavelmente só a capa`);
    return { bytes, alturaAntes, alturaDepois };
  } finally {
    if (proprio) await b.close();
  }
}

export interface ResumoLivros {
  tentados: number;
  ok: number;
  falhas: string[];
}

/** Processa todos os "Livro Digital" que ainda não foram capturados. */
export async function capturarLivros(
  db: Database,
  opts: { aoProgredir?: (m: string) => void } = {},
): Promise<ResumoLivros> {
  const diga = opts.aoProgredir ?? console.log;
  const itens = db.query<{ id: number; source_url: string; rel_path: string | null; title: string }, []>(`
    SELECT id, source_url, rel_path, title FROM items
     WHERE kind = 'livro' AND download_status IN ('pending', 'skipped', 'error')
     ORDER BY id
  `).all();

  if (!itens.length) {
    diga("nenhum Livro Digital pendente.");
    return { tentados: 0, ok: 0, falhas: [] };
  }

  const falhas: string[] = [];
  let ok = 0;
  let browser: Browser | undefined;

  try {
    // Um navegador para todos: abrir um por livro custa ~2s e memória à toa.
    browser = await chromium.launch({ headless: true });
    for (const it of itens) {
      if (!it.rel_path) { falhas.push(`item ${it.id}: sem destino definido`); continue; }
      const destino = join(REPOSITORY, it.rel_path);
      try {
        db.run(`UPDATE items SET download_status='running' WHERE id=?`, [it.id]);
        const r = await capturarLivro(it.source_url, destino, browser);
        db.run(
          `UPDATE items SET download_status='done', download_error=NULL, bytes=?,
                  transcribe_status='skipped', updated_at=datetime('now') WHERE id=?`,
          [r.bytes, it.id]);
        log(db, "info", "livro",
          `${it.rel_path.split("/").pop()} — ${(r.bytes / 1e6).toFixed(1)} MB (${r.alturaAntes}→${r.alturaDepois}px)`);
        diga(`   ✓ ${it.rel_path.split("/").pop()} — ${(r.bytes / 1e6).toFixed(1)} MB`);
        ok++;
      } catch (e) {
        const msg = (e as Error).message.slice(0, 200);
        db.run(
          `UPDATE items SET download_status='error', download_error=?, updated_at=datetime('now') WHERE id=?`,
          [msg, it.id]);
        log(db, "error", "livro", `item ${it.id}: ${msg}`);
        falhas.push(`item ${it.id}: ${msg}`);
        diga(`   ✗ item ${it.id}: ${msg}`);
      }
    }
  } finally {
    await browser?.close();
  }

  log(db, "info", "livro", `capturou ${ok}/${itens.length} livro(s) digital(is)`);
  return { tentados: itens.length, ok, falhas };
}

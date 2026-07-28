/**
 * Navegação assistida — último recurso quando o automático não resolve.
 *
 * Abre o navegador **visível** na disciplina que tem item pendente e fica
 * escutando a rede. Você navega como aluno: clica a aula, abre o material,
 * resolve o que precisar (sessão caída, verificação, um clique que só existe
 * na interface). Cada URL de mídia que passar é capturada e casada com o item
 * correspondente do banco.
 *
 * Por que isto existe, em vez de mais retentativas: há coisas que nenhum regex
 * alcança — assinatura que só é emitida depois de um clique, conteúdo servido
 * por um caminho que ainda não mapeamos. Em vez de fingir que o item não tem
 * mídia, o projeto pede ajuda e aproveita a sessão que você já tem aberta.
 *
 * Nada é baixado aqui: a captura só atualiza `source_url` e devolve o item para
 * a fila. Quem baixa continua sendo o worker.
 */
import type { Database } from "bun:sqlite";
import { chromium, type Browser, type Frame, type Page } from "playwright";

import { PORTAL_URL, STORAGE_STATE, USER_AGENT } from "./config.ts";
import { definirCaminho, log } from "./db.ts";
import { alunoSlug, PROIBIDO } from "./lesson.ts";

/** O que conta como mídia capturável, nas duas famílias de conteúdo. */
const MIDIA = /\.(mp4|m3u8|pdf)(\?|$)|videoiesde|componente\.php|cloudfront\.net/i;
const SEGMENTO = /\.ts(\?|$)|_\d{5}\.(vtt|ts)|^blob:|LEGENDA/i;

export interface Pendente {
  id: number;
  kind: string;
  title: string;
  rel_path: string | null;
  disc_id: number;
  disc_pos: number;
  disc_nome: string;
  mod_pos: number;
  pos: number;
}

export function pendentes(db: Database): Pendente[] {
  return db.query<Pendente, []>(`
    SELECT i.id, i.kind, i.title, i.rel_path, i.position AS pos,
           m.position AS mod_pos, d.id AS disc_id, d.position AS disc_pos, d.name AS disc_nome
      FROM items i
      JOIN modules m ON m.id = i.module_id
      JOIN disciplines d ON d.id = m.discipline_id
     WHERE i.download_status IN ('pending', 'error')
     ORDER BY d.position, m.position, i.position
  `).all();
}

/** Casa uma URL observada com o tipo de item que estamos procurando. */
export function combina(kind: string, url: string): boolean {
  if (SEGMENTO.test(url)) return false;
  if (kind === "video") return /\.(mp4|m3u8)(\?|$)|videoiesde.*\.mp4/i.test(url);
  return /\.pdf(\?|$)|componente\.php\?.*saida=arquivo/i.test(url);
}

function todosOsFrames(page: Page): string[] {
  const urls: string[] = [];
  const anda = (f: Frame) => { urls.push(f.url()); f.childFrames().forEach(anda); };
  anda(page.mainFrame());
  return urls;
}

export interface ResultadoAssistido {
  capturadas: number;
  atualizados: number;
  urls: { url: string; item?: number }[];
}

/**
 * Abre a disciplina e coleta mídia enquanto você navega.
 * Encerra quando você apertar Enter no terminal (ou no timeout).
 */
export async function assistir(
  db: Database,
  enrollmentId: number,
  disciplinaId: number,
  opts: { minutos?: number; aoProgredir?: (m: string) => void } = {},
): Promise<ResultadoAssistido> {
  const diga = opts.aoProgredir ?? console.log;
  const alvos = pendentes(db).filter((p) => p.disc_id === disciplinaId);
  if (!alvos.length) {
    diga(`disciplina ${disciplinaId} não tem item pendente.`);
    return { capturadas: 0, atualizados: 0, urls: [] };
  }

  diga(`${alvos.length} item(ns) faltando nesta disciplina:`);
  for (const a of alvos) diga(`   ${a.mod_pos}.${a.pos} [${a.kind}] ${a.title.slice(0, 50)}`);

  let browser: Browser | undefined;
  const vistas = new Map<string, number>();   // url → quantas vezes
  const atualizados = new Set<number>();

  try {
    browser = await chromium.launch({ headless: false });   // visível: é o ponto
    const ctx = await browser.newContext({
      storageState: STORAGE_STATE.portal, userAgent: USER_AGENT, locale: "pt-BR",
      viewport: null,
    });
    const page = await ctx.newPage();

    const anotar = (url: string) => {
      if (!MIDIA.test(url) || SEGMENTO.test(url)) return;
      const limpa = url.split("#")[0]!;
      vistas.set(limpa, (vistas.get(limpa) ?? 0) + 1);
      if (vistas.get(limpa) === 1) diga(`   ↳ ${limpa.slice(0, 110)}`);
    };
    page.on("request", (r) => anotar(r.url()));
    ctx.on("page", async (np) => {
      await np.waitForLoadState("domcontentloaded").catch(() => undefined);
      anotar(np.url());
      todosOsFrames(np).forEach(anotar);
    });

    const slug = await alunoSlug(page);
    const url = `${PORTAL_URL}/aluno/${slug}/meus-cursos/${enrollmentId}/aulas/${disciplinaId}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

    diga("");
    diga("Navegador aberto. Abra as aulas e materiais que faltam — eu capturo as URLs.");
    diga("NÃO abra provas. Quando terminar, aperte Enter aqui.");
    diga("");

    // Espera o Enter do terminal, com teto para não ficar preso para sempre.
    const teto = (opts.minutos ?? 20) * 60_000;
    await Promise.race([
      new Promise<void>((r) => process.stdin.once("data", () => r())),
      new Promise<void>((r) => setTimeout(r, teto)),
      page.waitForEvent("close").catch(() => undefined),
    ]);
    todosOsFrames(page).forEach(anotar);
  } finally {
    await browser?.close();
  }

  // Casa o que foi visto com os itens que faltam, na ordem em que apareceram.
  const urls = [...vistas.keys()];
  const saida: { url: string; item?: number }[] = [];
  for (const alvo of alvos) {
    if (PROIBIDO.test(alvo.title)) continue;
    const achada = urls.find((u) => combina(alvo.kind, u) && !saida.some((s) => s.url === u));
    if (!achada) continue;
    db.run(
      `UPDATE items SET source_url=?, download_status='pending', download_error=NULL,
              updated_at=datetime('now') WHERE id=?`, [achada, alvo.id]);
    if (alvo.rel_path) definirCaminho(db, alvo.id, alvo.rel_path);
    atualizados.add(alvo.id);
    saida.push({ url: achada, item: alvo.id });
    diga(`   ✓ item ${alvo.id} (${alvo.kind}) ← ${achada.slice(0, 80)}`);
  }
  for (const u of urls) if (!saida.some((s) => s.url === u)) saida.push({ url: u });

  log(db, "info", "assistir",
    `navegação assistida na disciplina ${disciplinaId}: ${vistas.size} URL(s) vista(s), ${atualizados.size} item(ns) atualizado(s)`);
  return { capturadas: vistas.size, atualizados: atualizados.size, urls: saida };
}

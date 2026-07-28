/**
 * Reconciliação entre o banco e o acervo que já existe no disco.
 *
 * Há 202 arquivos capturados antes deste projeto existir. Rebaixá-los para a
 * fila significaria rebaixar dezenas de GB — então, antes de qualquer download,
 * o `scan` varre `repository/` e marca como `done` o que já está lá.
 *
 * O casamento é por **posição**, não por nome. Os nomes antigos divergem do que
 * geraríamos hoje (o acervo tem `…Produtos.e.Servicos` numa pasta e
 * `…Produtos.e.Serviços` num arquivo dentro dela), e a API às vezes usa
 * singular onde o disco usa plural ("Ambiente de Negócio" × "Ambiente
 * Negócios"). O prefixo `MM.VV` é estável e é a âncora confiável.
 *
 * Nada é renomeado nem apagado. O que existe fica como está.
 */
import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { REPOSITORY } from "./config.ts";
import { log, marcarBaixado } from "./db.ts";
import { chave, prefixo } from "./naming.ts";

export interface ResumoScan {
  varridos: number;
  casados: number;
  semArquivo: number;
  orfaos: string[];
}

/** Extensões que contam como "o item foi capturado". */
const ESPERADO: Record<string, RegExp> = {
  video: /\.(mp4|mkv|webm)$/i,
  pdf: /\.pdf$/i,
  livro: /\.pdf$/i,
};

/**
 * Resolve um caminho relativo tolerando divergência de grafia nas pastas.
 *
 * O acervo foi organizado à mão e não é consistente: a disciplina 01 usa pontos
 * (`01-Marketing.e.o.Ambiente.Negócios`) e a 02 usa espaços
 * (`01-Premissas e perspectivas a respeito do consumidor`); há `:` virando `_`,
 * e `Servicos` sem cedilha ao lado de `Serviços` com. Exigir nome exato faria o
 * scan não achar nada e o worker rebaixar dezenas de GB já capturados.
 *
 * Casa segmento a segmento por `chave()`, que ignora acento, caixa, pontuação e
 * o prefixo numérico.
 */
function resolverDir(rel: string): string | null {
  let atual = REPOSITORY;
  for (const segmento of rel.split("/").filter(Boolean)) {
    const exato = join(atual, segmento);
    if (existsSync(exato)) { atual = exato; continue; }

    let pastas: string[];
    try {
      pastas = readdirSync(atual, { withFileTypes: true })
        .filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return null;
    }
    const k = chave(segmento);
    const achada = pastas.find((p) => chave(p) === k);
    if (!achada) return null;
    atual = join(atual, achada);
  }
  return atual;
}

function listarArquivos(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

export function scan(db: Database, opts: { aoProgredir?: (m: string) => void } = {}): ResumoScan {
  const diga = opts.aoProgredir ?? (() => undefined);
  const orfaos: string[] = [];
  let varridos = 0, casados = 0, semArquivo = 0;

  const itens = db.query<{
    id: number; kind: string; position: number; mod_pos: number;
    rel_path: string | null; download_status: string;
  }, []>(`
    SELECT i.id, i.kind, i.position, m.position AS mod_pos, i.rel_path, i.download_status
      FROM items i
      JOIN modules m ON m.id = i.module_id
      JOIN disciplines d ON d.id = m.discipline_id
     ORDER BY d.position, m.position, i.position
  `).all();

  for (const it of itens) {
    varridos++;
    if (!it.rel_path) { semArquivo++; continue; }

    const dir = resolverDir(dirname(it.rel_path));
    if (!dir) { semArquivo++; continue; }

    const alvo = prefixo(it.mod_pos, it.position);
    const re = ESPERADO[it.kind] ?? /.^/;
    const achado = listarArquivos(dir).find((f) => f.startsWith(`${alvo}-`) && re.test(f));

    if (!achado) { semArquivo++; continue; }

    const caminho = join(dir, achado);
    const bytes = statSync(caminho).size;
    if (bytes === 0) {
      orfaos.push(`${achado} tem 0 bytes — fica na fila`);
      continue;
    }
    if (it.download_status !== "done") {
      marcarBaixado(db, it.id, bytes);
      diga(`   ✓ ${achado} (${(bytes / 1e6).toFixed(1)} MB)`);
    }
    casados++;
  }

  log(db, "info", "scan",
    `reconciliou ${casados}/${varridos} item(ns) com o disco; ${semArquivo} ainda sem arquivo`);
  return { varridos, casados, semArquivo, orfaos };
}

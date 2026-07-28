/**
 * `00-Materiais Escritos` — a versão lida do acervo.
 *
 * Vídeo é ótimo para assistir e péssimo para consultar. Este módulo produz o
 * complemento escrito, em duas peças dentro de uma pasta que abre primeiro na
 * listagem (daí o `00-`):
 *
 *   Transcrição.Geral.md   tudo o que é falado em todos os vídeos, hierarquizado
 *                          por disciplina (H1) → módulo (H2) → aula (H3)
 *   00-Materiais.Escritos.md  índice com link para cada PDF, ebook e para a
 *                          transcrição geral
 *
 * **A transcrição não é a legenda.** A legenda é fatiada em trechos de poucos
 * segundos, com tempo, feita para ler enquanto se assiste. Aqui as falas são
 * costuradas em parágrafos corridos, sem carimbo de tempo — texto para ler,
 * buscar e citar. O tempo continua disponível no painel, que usa a legenda.
 *
 * Os caminhos no índice são relativos, então o arquivo funciona em qualquer
 * leitor de markdown, não só no painel.
 */
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { CURSO_PASTA, REPOSITORY } from "./config.ts";
import { log } from "./db.ts";
import { lerTrechos } from "./legenda.ts";

export const PASTA = "00-Materiais.Escritos";
export const ARQ_TRANSCRICAO = "Transcrição.Geral.md";
export const ARQ_INDICE = "00-Materiais.Escritos.md";

/** Quantos caracteres, no máximo, antes de quebrar parágrafo. */
const PARAGRAFO = 900;

interface Linha {
  disc_pos: number; disc_nome: string;
  mod_pos: number; mod_nome: string;
  pos: number; title: string; kind: string;
  rel_path: string | null; duration: number | null;
}

function linhas(db: Database): Linha[] {
  return db.query<Linha, []>(`
    SELECT d.position AS disc_pos, d.name AS disc_nome,
           m.position AS mod_pos, m.name AS mod_nome,
           i.position AS pos, i.title, i.kind, i.rel_path, i.duration
      FROM items i
      JOIN modules m ON m.id = i.module_id
      JOIN disciplines d ON d.id = m.discipline_id
     WHERE i.download_status = 'done'
     ORDER BY d.position, m.position, i.position
  `).all();
}

/**
 * Texto corrido de uma aula.
 *
 * Prefere o `.txt` que o Whisper escreve; na falta dele, costura os trechos da
 * legenda. Os dois existem no acervo por razões históricas — vídeo com legenda
 * oficial nunca passou pelo Whisper e só tem `.srt`.
 */
export function textoDaAula(relPath: string): string {
  const semExt = relPath.replace(/\.[^./]+$/, "");
  const txt = join(REPOSITORY, `${semExt}.txt`);
  if (existsSync(txt)) return readFileSync(txt, "utf-8").trim();

  for (const ext of [".srt", ".vtt"]) {
    const p = join(REPOSITORY, semExt + ext);
    if (!existsSync(p)) continue;
    return emParagrafos(lerTrechos(readFileSync(p, "utf-8")).map((t) => t.texto));
  }
  return "";
}

/**
 * Junta as falas em parágrafos legíveis.
 *
 * Uma linha por trecho de legenda deixaria o markdown picotado em centenas de
 * frases soltas; um parágrafo único de 40 mil caracteres é igualmente ilegível.
 * Quebra-se ao passar de ~900 caracteres, preferindo o fim de frase.
 */
export function emParagrafos(falas: string[], limite = PARAGRAFO): string {
  const saida: string[] = [];
  let atual = "";
  for (const fala of falas) {
    const f = fala.replace(/\s+/g, " ").trim();
    if (!f) continue;
    atual = atual ? `${atual} ${f}` : f;
    if (atual.length >= limite && /[.!?…]$/.test(atual)) {
      saida.push(atual);
      atual = "";
    }
  }
  if (atual) saida.push(atual);
  return saida.join("\n\n");
}

function hhmm(segundos: number): string {
  const h = Math.floor(segundos / 3600);
  const m = Math.round((segundos % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
}

const dd = (n: number) => String(n).padStart(2, "0");

export interface ResumoEscritos {
  aulas: number;
  semTranscricao: number;
  materiais: number;
  caracteres: number;
  arquivos: string[];
}

export function gerarTranscricaoGeral(db: Database): { md: string; r: Omit<ResumoEscritos, "arquivos"> } {
  const todas = linhas(db);
  const videos = todas.filter((l) => l.kind === "video");
  const materiais = todas.filter((l) => l.kind !== "video");

  const partes: string[] = [
    "# Transcrição Geral",
    "",
    "Tudo o que é falado em todos os vídeos do curso, em texto corrido. Gerado pelo focus-scrap a partir das legendas e transcrições do acervo.",
    "",
    `Cobertura: ${videos.length} aulas · ` +
      `${hhmm(videos.reduce((s, v) => s + (v.duration ?? 0), 0))} de vídeo.`,
    "",
    `[⇦ Voltar ao índice](${ARQ_INDICE})`,
    "",
    "---",
    "",
  ];

  let disc = -1, mod = -1, caracteres = 0, semTranscricao = 0;

  for (const l of videos) {
    if (l.disc_pos !== disc) {
      disc = l.disc_pos; mod = -1;
      partes.push("", `# ${dd(l.disc_pos)}. ${l.disc_nome}`, "");
    }
    if (l.mod_pos !== mod) {
      mod = l.mod_pos;
      partes.push("", `## ${dd(l.mod_pos)}. ${l.mod_nome}`, "");
    }

    const texto = l.rel_path ? textoDaAula(l.rel_path) : "";
    partes.push(`### ${dd(l.mod_pos)}.${dd(l.pos)} ${l.title}`, "");
    if (texto) {
      caracteres += texto.length;
      partes.push(texto, "");
    } else {
      semTranscricao++;
      partes.push("_(sem transcrição disponível)_", "");
    }
  }

  return {
    md: partes.join("\n").replace(/\n{4,}/g, "\n\n\n") + "\n",
    r: { aulas: videos.length, semTranscricao, materiais: materiais.length, caracteres },
  };
}

export function gerarIndice(db: Database): string {
  const todas = linhas(db);
  const materiais = todas.filter((l) => l.kind !== "video" && l.rel_path);
  const videos = todas.filter((l) => l.kind === "video");

  const partes: string[] = [
    "# 00 — Materiais Escritos",
    "",
    // Uma linha só: quebrar aqui vira dois parágrafos no markdown renderizado.
    "Tudo do curso que se lê, num lugar só: os PDFs e ebooks de cada módulo, e a transcrição de todas as videoaulas em texto corrido.",
    "",
    `- **[📄 Transcrição Geral](${ARQ_TRANSCRICAO})** — ${videos.length} aulas, ` +
      `${hhmm(videos.reduce((s, v) => s + (v.duration ?? 0), 0))} de vídeo em texto`,
    `- **${materiais.length} materiais** em PDF, listados abaixo por disciplina`,
    "",
    "---",
    "",
  ];

  let disc = -1;
  for (const l of materiais) {
    if (l.disc_pos !== disc) {
      disc = l.disc_pos;
      partes.push("", `## ${dd(l.disc_pos)}. ${l.disc_nome}`, "");
    }
    // Relativo à pasta 00-…, para o arquivo servir em qualquer leitor.
    const alvo = `../${l.rel_path!.split("/").slice(1).join("/")}`;
    const rotulo = l.kind === "livro" ? "Livro Digital" : "Material em PDF";
    partes.push(`- ${dd(l.mod_pos)}.${dd(l.pos)} · [${l.mod_nome} — ${rotulo}](${encodeURI(alvo)})`);
  }

  partes.push("", "---", "",
    "_Gerado pelo focus-scrap. Refaça com `bun run escritos` ou pelo botão do painel._", "");
  return partes.join("\n");
}

export async function gerarEscritos(
  db: Database,
  opts: { aoProgredir?: (m: string) => void } = {},
): Promise<ResumoEscritos> {
  const diga = opts.aoProgredir ?? console.log;
  const pasta = join(REPOSITORY, CURSO_PASTA, PASTA);
  await mkdir(pasta, { recursive: true });

  const { md, r } = gerarTranscricaoGeral(db);
  const indice = gerarIndice(db);

  await Bun.write(join(pasta, ARQ_TRANSCRICAO), md);
  await Bun.write(join(pasta, ARQ_INDICE), indice);

  diga(`   ${ARQ_TRANSCRICAO} — ${r.aulas} aulas, ${(r.caracteres / 1000).toFixed(0)} mil caracteres`);
  diga(`   ${ARQ_INDICE} — ${r.materiais} material(is) linkado(s)`);
  if (r.semTranscricao) diga(`   ⚠ ${r.semTranscricao} aula(s) sem transcrição`);

  log(db, "info", "escritos",
    `gerou ${PASTA}: ${r.aulas} aulas (${(r.caracteres / 1000).toFixed(0)}k caracteres), ` +
    `${r.materiais} materiais, ${r.semTranscricao} sem transcrição`);

  return { ...r, arquivos: [join(CURSO_PASTA, PASTA, ARQ_INDICE), join(CURSO_PASTA, PASTA, ARQ_TRANSCRICAO)] };
}

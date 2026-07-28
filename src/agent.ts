/**
 * O agente — `gpt-4o-mini` via OpenRouter.
 *
 * Ele NÃO é chamado por item, e não fica no caminho feliz. O papel dele é
 * resolver o que a plataforma deixou ambíguo, uma vez, e gravar o resultado
 * junto da assinatura da entrada que o gerou. Enquanto a assinatura não mudar,
 * as execuções seguintes não fazem chamada de LLM nenhuma.
 *
 * Hoje ele resolve um problema concreto: **a plataforma não expõe o título das
 * aulas.** A playlist do CDN rotula tudo como "Aula 01", "Aula 02"… mas o
 * acervo já capturado usa os títulos reais ("Conceito.de.Marketing"). Esses
 * títulos existem no SUMÁRIO do PDF do módulo, misturados com os subtítulos —
 * e separar um do outro é exatamente o tipo de coisa que regex não resolve bem
 * e um modelo pequeno resolve barato.
 *
 * Sem chave de API, cai em heurística local. O pipeline nunca para por falta
 * de LLM: no pior caso os arquivos saem como "Aula 01".
 */
import type { Database } from "bun:sqlite";

import { AGENT_MODEL, BASE_DIR, OPENROUTER_API_KEY } from "./config.ts";
import { log, padraoSalvo, salvarPadrao } from "./db.ts";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const SISTEMA = `Você recebe dois trechos de um material didático e a quantidade N de videoaulas do módulo.

SUMÁRIO: lista hierárquica em que títulos principais e subtópicos aparecem misturados,
porque a extração de PDF perde a indentação. Tem muito mais linhas que N.

OBJETIVOS: lista numerada com exatamente N itens, um por videoaula, escrita como
objetivo de aprendizagem ("Definir o conceito de marketing", "Aplicar a técnica…").

Use os OBJETIVOS para descobrir QUAIS linhas do SUMÁRIO são os títulos principais:
o objetivo k descreve a aula k. Devolva o título com a grafia do SUMÁRIO, não a do objetivo.

Responda JSON: {"titulos": ["...", "..."]} com exatamente N itens, na ordem das aulas.
Preserve acentos. Não numere. Não invente título que não esteja no SUMÁRIO.`;

/** Assinatura da entrada — troca de PDF ou de contagem invalida o cache. */
async function assinatura(pdfUrl: string, nVideos: number): Promise<string> {
  const h = new Bun.CryptoHasher("sha256");
  h.update(`titles:${pdfUrl}:${nVideos}`);
  return h.digest("hex").slice(0, 32);
}

/**
 * Texto do PDF via o helper Python (pypdf mora lá).
 *
 * 12 páginas, não 8: nos materiais desta pós o SUMÁRIO fica por volta da página
 * 5 e o bloco OBJETIVOS por volta da 9 — cortar em 8 deixava o modelo sem a
 * segunda pista e ele devolvia subtópicos.
 */
async function textoDoPdf(url: string, paginas = 12): Promise<string> {
  const p = Bun.spawn(["uv", "run", "python", "-m", "focus.pdftext", url, "--pages", String(paginas)], {
    cwd: BASE_DIR,
    stdout: "pipe",
    // stderr descartado de propósito: `uv` escreve progresso aqui, e um pipe
    // que ninguém lê enche e trava o processo filho para sempre — foi assim que
    // uma disciplina ficou pendurada sem erro nem saída.
    stderr: "ignore",
  });

  // Teto próprio: PDF grande ou rede ruim não pode segurar o catálogo inteiro.
  const saida = await Promise.race([
    new Response(p.stdout).text(),
    new Promise<string>((r) => setTimeout(() => { p.kill(); r(""); }, 120_000)),
  ]);
  await p.exited;
  return p.exitCode === 0 ? saida : "";
}

/** Um trecho a partir de um marcador. Vazio se o marcador não existir. */
function trecho(texto: string, marcador: RegExp, limite: number): string {
  const i = texto.search(marcador);
  return i >= 0 ? texto.slice(i, i + limite) : "";
}

export function recortarSumario(texto: string, limite = 3000): string {
  return trecho(texto, /sum[áa]rio/i, limite) || texto.slice(0, limite);
}

/**
 * Recorta as duas pistas que o modelo precisa cruzar.
 *
 * Só o sumário não basta: a extração de PDF achata a hierarquia, e o modelo
 * devolve os N primeiros itens — que são subtópicos do primeiro título. A lista
 * de OBJETIVOS tem exatamente N entradas, uma por videoaula, e é ela que diz
 * quais linhas do sumário são de primeiro nível.
 */
export function recortarPistas(texto: string): { sumario: string; objetivos: string } {
  return {
    sumario: recortarSumario(texto),
    // Âncora no CABEÇALHO (linha isolada, caixa alta), não em "objetivos" solto:
    // o sumário costuma ter uma linha "Objetivos do marketing" que vem antes e
    // sequestrava o recorte, deixando o modelo sem a pista que importa.
    objetivos: trecho(texto, /^[ \t]*OBJETIVOS[ \t]*$/m, 1200),
  };
}

/** Heurística local: títulos de primeiro nível do sumário, sem LLM. */
export function titulosHeuristicos(texto: string, n: number): string[] {
  const linhas = recortarSumario(texto)
    .split("\n")
    .map((l) => l.replace(/\.{3,}.*$/, "").replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 3 && l.length < 90 && !/^sum[áa]rio$/i.test(l));

  // Sem hierarquia confiável no texto extraído, as N primeiras entradas são o
  // palpite mais razoável. É chute — por isso o agente existe.
  return linhas.slice(0, n);
}

async function perguntar(prompt: string): Promise<string[] | null> {
  if (!OPENROUTER_API_KEY) return null;
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://focus-scrap.local",
        "X-Title": "focus-scrap",
      },
      body: JSON.stringify({
        model: AGENT_MODEL,
        messages: [
          { role: "system", content: SISTEMA },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok) return null;
    const j = await r.json() as { choices?: { message?: { content?: string } }[] };
    const bruto = j.choices?.[0]?.message?.content;
    if (!bruto) return null;
    const parsed = JSON.parse(bruto) as { titulos?: unknown };
    return Array.isArray(parsed.titulos) ? parsed.titulos.map(String) : null;
  } catch {
    return null;
  }
}

/**
 * Títulos das aulas de um módulo. Ordem: cache → LLM → heurística → "Aula NN".
 * Devolve sempre exatamente `nVideos` títulos.
 */
export async function titulosDoModulo(
  db: Database,
  opts: { pdfUrl: string | null; nVideos: number; modulo: string },
): Promise<{ titulos: string[]; origem: "cache" | "agente" | "heuristica" | "fallback" }> {
  const fallback = () =>
    Array.from({ length: opts.nVideos }, (_, i) => `Aula ${String(i + 1).padStart(2, "0")}`);

  if (!opts.pdfUrl || opts.nVideos <= 0) return { titulos: fallback(), origem: "fallback" };

  const sig = await assinatura(opts.pdfUrl, opts.nVideos);
  const salvo = padraoSalvo(db, sig) as string[] | null;
  if (Array.isArray(salvo) && salvo.length === opts.nVideos)
    return { titulos: salvo, origem: "cache" };

  const texto = await textoDoPdf(opts.pdfUrl);
  if (!texto) return { titulos: fallback(), origem: "fallback" };

  const { sumario, objetivos } = recortarPistas(texto);
  const prompt =
    `Módulo: ${opts.modulo}\nN (videoaulas) = ${opts.nVideos}\n\n` +
    `--- SUMÁRIO ---\n${sumario}\n\n--- OBJETIVOS ---\n${objetivos || "(não encontrado neste material)"}`;
  const doModelo = await perguntar(prompt);

  // Só aceita se vier a quantidade exata: lista curta ou longa significa que o
  // modelo confundiu subtópico com título, e aí o resultado não presta.
  if (doModelo && doModelo.length === opts.nVideos && doModelo.every((t) => t.trim())) {
    const limpos = doModelo.map((t) => t.trim());
    salvarPadrao(db, sig, "titles", limpos, AGENT_MODEL);
    log(db, "agent", "agent", `títulos de "${opts.modulo}": ${limpos.join(" | ")}`);
    return { titulos: limpos, origem: "agente" };
  }

  const heur = titulosHeuristicos(texto, opts.nVideos);
  if (heur.length === opts.nVideos) {
    log(db, "agent", "agent", `heurística usada em "${opts.modulo}" (agente indisponível ou inconsistente)`);
    return { titulos: heur, origem: "heuristica" };
  }
  return { titulos: fallback(), origem: "fallback" };
}

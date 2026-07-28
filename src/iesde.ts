/**
 * O SEGUNDO sistema de conteúdo da Focus — IESDE.
 *
 * Nem toda disciplina usa o CDN da produtora (`cdn.ts`). A partir da segunda,
 * o iframe da lesson "Vídeo Aula" aponta para
 * `www5.faculdadefocus.com.br/iesde/<turma>/lessons/playlist`, um player
 * completamente diferente. Tratar as duas famílias como uma só era o motivo de
 * 8 das 9 disciplinas voltarem com zero vídeo.
 *
 * Duas boas notícias em relação ao outro sistema:
 *
 *  - **Os títulos vêm prontos.** A playlist lista "Processo de decisão do
 *    consumidor - parte 01" etc., que é exatamente o que o acervo usa. Aqui o
 *    agente não é necessário.
 *  - **Nada exige sessão.** A playlist e a página da aula respondem 200 sem
 *    cookie, e o `<source>` já vem renderizado no servidor.
 *
 * Uma má notícia: o MP4 tem **URL assinada e expirável** (`qsig=<jwt>` com
 * `exp`). Por isso o catálogo guarda a URL do `/show`, não a do vídeo — quem
 * baixa resolve na hora. Guardar o link assinado significaria uma fila que
 * apodrece antes de ser consumida.
 */

// Curiosamente é o MESMO markup do outro CDN — `<li data-src>` com um <span> de
// título. Só muda o alvo do data-src e o data-index, que aqui é o id da aula e
// não uma sequência, então a ordem vem da posição no HTML.
const RE_ITEM = /<li\b[^>]*>[\s\S]*?<\/li>/gi;
const RE_SRC = /\bdata-src\s*=\s*"([^"]+)"/i;
const RE_SPAN = /<span[^>]*>([\s\S]*?)<\/span>/i;
const RE_FONTE = /<source\b[^>]*\bsrc="([^"]+)"/i;

/**
 * O acervo não repete "- parte 01" no nome do arquivo: o prefixo `MM.VV` já diz
 * qual parte é. `01.01-Premissas.e.perspectivas.a.respeito.do.consumidor.mp4`,
 * não `…-parte.01.mp4`.
 */
export function tituloLimpo(bruto: string): string {
  return bruto.replace(/\s*[-–]\s*parte\s*\d+\s*$/i, "").trim();
}

export interface AulaIesde {
  indice: number;
  titulo: string;
  /** Página da aula; o MP4 assinado sai dela na hora do download. */
  show: string;
}

/** Reconhece as URLs desta família. */
export function ehIesde(url: string | null | undefined): boolean {
  return !!url && /\/iesde\//i.test(url);
}

function limparTitulo(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrai as aulas de um HTML de playlist IESDE. Função pura. */
export function extrairAulas(html: string): AulaIesde[] {
  const vistos = new Set<string>();
  const saida: AulaIesde[] = [];
  for (const bloco of html.match(RE_ITEM) ?? []) {
    const show = RE_SRC.exec(bloco)?.[1]?.trim();
    if (!show || !/\/iesde\/lessons\/\d+\/show/i.test(show) || vistos.has(show)) continue;
    vistos.add(show);
    const titulo = tituloLimpo(limparTitulo(RE_SPAN.exec(bloco)?.[1] ?? ""));
    if (!titulo) continue;
    saida.push({ indice: saida.length + 1, titulo, show });
  }
  return saida;
}

/** Extrai o MP4 assinado do HTML da página da aula. Função pura. */
export function extrairVideo(htmlShow: string): string | null {
  return RE_FONTE.exec(htmlShow)?.[1] ?? null;
}

async function baixar(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(30_000),
    });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

export interface GrupoIesde {
  posicao: number;
  titulo: string;
  aulas: AulaIesde[];
}

/**
 * Agrupa aulas consecutivas de mesmo título.
 *
 * A API diz que a disciplina tem UM módulo com 46 aulas, mas o acervo as
 * organiza em 10 pastas — uma por assunto (6+6+4+7+4+5+3+2+5+4 = 46). O sinal
 * que produz esse agrupamento está no próprio título: a playlist traz
 * "… - parte 01" até "… - parte 06" e depois muda de assunto. Agrupar por
 * título consecutivo reproduz o disco exatamente.
 */
export function agrupar(aulas: AulaIesde[]): GrupoIesde[] {
  const grupos: GrupoIesde[] = [];
  for (const a of aulas) {
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.titulo === a.titulo) ultimo.aulas.push(a);
    else grupos.push({ posicao: grupos.length + 1, titulo: a.titulo, aulas: [a] });
  }
  return grupos;
}

export async function lerPlaylist(url: string): Promise<AulaIesde[]> {
  const html = await baixar(url);
  return html ? extrairAulas(html) : [];
}

/** Resolve o MP4 de uma aula. A URL devolvida expira — use logo. */
export async function resolverVideo(showUrl: string): Promise<string | null> {
  const html = await baixar(showUrl);
  return html ? extrairVideo(html) : null;
}

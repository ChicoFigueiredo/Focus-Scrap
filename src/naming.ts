/**
 * Convenção de nomes do acervo — extraída dos arquivos que já estão em
 * `/mnt/e/Marketing/Focus`, não inventada.
 *
 *   <NN>-<Disciplina>/
 *     <NN>-<Disciplina>.xspf
 *     <MM>-<Módulo>/
 *       <MM>.<VV>-<Título>.mp4
 *       <MM>.<VV>-<Título>.srt
 *       <MM>.<VV>-<Título>-Fala.Cronometrada.txt
 *       <MM>.<VV>-Ebook-<Nome>.pdf
 *       <MM>.<VV>-Slides-<Nome>.pdf
 *
 * Espaço vira ponto, acento é preservado, prefixos com dois dígitos. `VV` conta
 * dentro do módulo e é contínuo entre tipos: se há 4 vídeos, o Ebook é `05`.
 *
 * O acervo existente é internamente inconsistente (há `…Produtos.e.Servicos`
 * como pasta e `…Produtos.e.Serviços` como arquivo, no mesmo módulo). Não dá
 * para reproduzi-lo byte a byte — por isso a geração segue uma regra única e
 * consistente, e o reconhecimento do que já existe usa `chave()`, que ignora
 * acento, caixa e pontuação.
 */

/** Caracteres proibidos em NTFS — o acervo mora num disco Windows. */
const ILEGAIS = /[\\/:*?"<>|]/g;

/**
 * "Conceito de Marketing" → "Conceito.de.Marketing"
 *
 * Preserva acentos (o acervo tem `Análise.SWOT`, `Informação.Estratégica`) e
 * colapsa pontuação repetida, que apareceria em títulos com vírgula ou hífen.
 */
export function pontuar(texto: string): string {
  return (texto ?? "")
    .normalize("NFC")
    .replace(/['"“”‘’]/g, "")          // aspas somem
    .replace(ILEGAIS, ".")             // proibidos viram separador: "E/S" → "E.S"
    .replace(/[\s_]+/g, ".")
    .replace(/[.,;:]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "")
    .trim();
}

/** Prefixo numérico de dois dígitos: 1 → "01". Acima de 99 não trunca. */
export function dd(n: number): string {
  return String(Math.max(0, Math.trunc(n))).padStart(2, "0");
}

/**
 * Chave de comparação, para reconhecer um arquivo já capturado mesmo quando o
 * nome antigo diverge do que geraríamos hoje. Ignora acento, caixa e separador.
 *
 *   "02-Marketing.e.o.Composto.de.Produtos.e.Servicos"
 *   "Marketing e o Composto de Produtos e Serviços"     → mesma chave
 */
export function chave(texto: string): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // tira diacríticos
    .toLowerCase()
    .replace(/^\d+(\.\d+)?-/, "")      // tira prefixo NN- ou NN.VV-
    .replace(/[^a-z0-9]+/g, "");
}

export function pastaDisciplina(posicao: number, nome: string): string {
  return `${dd(posicao)}-${pontuar(nome)}`;
}

export function pastaModulo(posicao: number, nome: string): string {
  return `${dd(posicao)}-${pontuar(nome)}`;
}

/** `01-Fundamentos.de.Marketing.xspf` — playlist VLC da disciplina. */
export function playlistDisciplina(posicao: number, nome: string): string {
  return `${pastaDisciplina(posicao, nome)}.xspf`;
}

/** Prefixo `MM.VV` de um item dentro do módulo. */
export function prefixo(modulo: number, item: number): string {
  return `${dd(modulo)}.${dd(item)}`;
}

export type Extensao = "mp4" | "srt" | "vtt" | "pdf" | "txt";

/** `01.01-Conceito.de.Marketing.mp4` */
export function arquivoVideo(modulo: number, item: number, titulo: string, ext: Extensao = "mp4"): string {
  return `${prefixo(modulo, item)}-${pontuar(titulo)}.${ext}`;
}

/** `01.01-Conceito.de.Marketing-Fala.Cronometrada.txt` — transcrição com tempo. */
export function arquivoCronometrada(modulo: number, item: number, titulo: string): string {
  return `${prefixo(modulo, item)}-${pontuar(titulo)}-Fala.Cronometrada.txt`;
}

/** Marcador que precede o nome nos materiais: `01.05-Ebook-<Nome>.pdf`. */
export type Marcador = "Ebook" | "Slides" | "Exercicios";

export function arquivoMaterial(
  modulo: number, item: number, marcador: Marcador, nome: string,
): string {
  return `${prefixo(modulo, item)}-${marcador}-${pontuar(nome)}.pdf`;
}

/** Caminho relativo à raiz do acervo (`repository/`). */
export function caminho(...partes: string[]): string {
  return partes.filter(Boolean).join("/");
}

/**
 * Classifica um material pelo nome/título vindo da plataforma.
 * É a heurística barata; o agente só entra quando ela devolve `null`.
 */
export function marcadorDe(titulo: string): Marcador | null {
  const k = chave(titulo);
  if (/ebook|livrodigital|livro/.test(k)) return "Ebook";
  if (/slide|apresentac|materialempdf|material/.test(k)) return "Slides";
  if (/exercic|atividade|pratica/.test(k)) return "Exercicios";
  return null;
}

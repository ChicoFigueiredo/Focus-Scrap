/**
 * Legenda: do `.srt` do acervo para o que o navegador entende.
 *
 * O `<track>` do HTML **não lê SRT** — só WebVTT. A diferença é pequena
 * (cabeçalho `WEBVTT` e vírgula decimal virando ponto), mas sem ela a faixa
 * carrega sem erro e simplesmente não aparece legenda nenhuma na tela.
 *
 * As mesmas falas viram também uma lista de trechos com tempo, que é o que
 * permite clicar na transcrição e o vídeo pular para aquele ponto.
 */

/** `00:01:23,456` (SRT) ou `00:01:23.456` (VTT) → segundos. */
export function paraSegundos(tempo: string): number {
  const m = /(\d+):(\d{2}):(\d{2})[.,](\d{1,3})/.exec(tempo.trim());
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]!.padEnd(3, "0")) / 1000;
}

export interface Trecho {
  /** Início em segundos — usado para o seek e para destacar o trecho corrente. */
  inicio: number;
  fim: number;
  texto: string;
}

const TEMPOS = /(\d+:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d+:\d{2}:\d{2}[.,]\d{1,3})/;

/** Lê um SRT (ou VTT) em trechos. Tolera numeração ausente e CRLF. */
export function lerTrechos(conteudo: string): Trecho[] {
  const trechos: Trecho[] = [];
  const blocos = conteudo.replace(/\r/g, "").replace(/^WEBVTT.*?\n\n/s, "").split(/\n{2,}/);

  for (const bloco of blocos) {
    const linhas = bloco.split("\n").filter((l) => l.trim());
    if (!linhas.length) continue;
    const iTempo = linhas.findIndex((l) => TEMPOS.test(l));
    if (iTempo < 0) continue;
    const m = TEMPOS.exec(linhas[iTempo]!)!;
    const texto = linhas.slice(iTempo + 1).join(" ").trim();
    if (!texto) continue;
    trechos.push({ inicio: paraSegundos(m[1]!), fim: paraSegundos(m[2]!), texto });
  }
  return trechos;
}

/** SRT → WebVTT, que é o único formato que o `<track>` aceita. */
export function srtParaVtt(srt: string): string {
  const corpo = srt
    .replace(/\r/g, "")
    .replace(/^WEBVTT.*?\n/s, "")
    // A vírgula decimal do SRT quebra o parser de VTT em silêncio.
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{1,3})/g, "$1.$2");
  return `WEBVTT\n\n${corpo.trim()}\n`;
}

/** Formata segundos como `12:34` — rótulo do trecho na transcrição. */
export function comoRelogio(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

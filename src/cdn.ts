/**
 * Leitura determinística do CDN — sem navegador, sem LLM, só HTTP e regex.
 *
 * O caminho até o vídeo tem três saltos, todos públicos:
 *
 *   1. playlist  grupofocus.b-cdn.net/playlist_videoaulas/…/<slug>_videos_<N>.html
 *                HTML estático, um <li data-src> por aula do módulo
 *   2. player    scorm.onilearning.com.br/player.php?id=…&video=…
 *                página com hls.js apontando para o CloudFront
 *   3. manifesto d2un266hqcizhh.cloudfront.net/…/….m3u8?v=oni
 *                master com 360/720/1080 e a trilha de legenda em português
 *
 * É aqui que mora o "padrão determinístico" do projeto. O agente só é acionado
 * quando um destes regex para de casar — ver `agent.ts`.
 */

/** `<li data-src="…" data-index="0"><span>Aula 01</span></li>` */
const ITEM = /<li\b[^>]*>[\s\S]*?<\/li>/gi;
const ATTR = (nome: string) => new RegExp(`\\b${nome}\\s*=\\s*"([^"]*)"`, "i");
const SPAN = /<span[^>]*>([\s\S]*?)<\/span>/i;
const M3U8 = /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i;

export interface VideoCdn {
  /** Posição dentro do módulo, base 1 (o `data-index` do HTML é base 0). */
  indice: number;
  /** Rótulo exibido na playlist — normalmente "Aula 01". Não é o título real. */
  rotulo: string;
  player: string;
  manifesto?: string;
  legenda?: string;
}

/** Extrai os vídeos de um HTML de playlist. Função pura — testável sem rede. */
export function extrairPlayers(html: string): VideoCdn[] {
  const saida: VideoCdn[] = [];
  for (const bloco of html.match(ITEM) ?? []) {
    const src = ATTR("data-src").exec(bloco)?.[1]?.trim();
    if (!src || !/player\.php/i.test(src)) continue;
    const idx = Number(ATTR("data-index").exec(bloco)?.[1] ?? saida.length);
    const rotulo = SPAN.exec(bloco)?.[1]?.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() ?? "";
    saida.push({ indice: idx + 1, rotulo: rotulo || `Aula ${idx + 1}`, player: src });
  }
  return saida.sort((a, b) => a.indice - b.indice);
}

/** Acha o manifesto HLS dentro do HTML do player. Função pura. */
export function extrairManifesto(htmlPlayer: string): string | null {
  return M3U8.exec(htmlPlayer)?.[0] ?? null;
}

/**
 * Deriva a trilha de legenda do manifesto master.
 *
 * Feito por derivação, não por observação de rede: o player da lesson anterior
 * continua baixando depois que o painel troca, e a legenda dele contamina a
 * lesson seguinte (visto em produção). O manifesto master já declara a trilha,
 * e o nome segue sempre `<id>LEGENDA.m3u8`.
 */
export function legendaDe(manifesto: string): string {
  return `${manifesto.replace(/\?.*$/, "").replace(/\.m3u8$/i, "")}LEGENDA.m3u8`;
}

/** URL da playlist de um módulo. `N` é a posição do módulo, base 1. */
export function urlPlaylist(cdnSlug: string, modulo: number): string {
  return `https://grupofocus.b-cdn.net/playlist_videoaulas/produtora_tele/${cdnSlug}_videos_${modulo}.html`;
}

/** "Fundamentos de Marketing" → "fundamentos-de-marketing" */
export function slugCdn(nomeDisciplina: string): string {
  return nomeDisciplina
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function baixar(url: string, timeoutMs = 30_000): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

/** Confere se uma playlist existe, sem baixar o corpo inteiro. */
export async function playlistExiste(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Resolve uma playlist inteira: lista os vídeos e busca o manifesto de cada um.
 * Os players são resolvidos em paralelo — são requisições independentes.
 */
export async function lerPlaylist(url: string): Promise<VideoCdn[]> {
  const html = await baixar(url);
  if (!html) return [];
  const videos = extrairPlayers(html);

  await Promise.all(
    videos.map(async (v) => {
      const p = await baixar(v.player);
      const m = p ? extrairManifesto(p) : null;
      if (m) {
        v.manifesto = m;
        v.legenda = legendaDe(m);
      }
    }),
  );
  return videos;
}

import { describe, expect, test } from "bun:test";
import * as cdn from "../src/cdn.ts";

// Trecho fiel da playlist real (fundamentos-de-marketing_videos_1.html).
const PLAYLIST = `
  <ul class="playlist">
    <li data-src="https://scorm.onilearning.com.br/player.php?id=1555&video=6594644ef1a1b25837bd303507b482eb&estudante=" data-index="0"><span>Aula 01</span></li>
<li data-src="https://scorm.onilearning.com.br/player.php?id=1554&video=699c9776e7ba86d87880f755b2ad969b&estudante=" data-index="1"><span>Aula 02</span></li>
<li data-src="https://scorm.onilearning.com.br/player.php?id=1553&video=8e4a7bfcbadbd21261fd50a2d6701049&estudante=" data-index="2"><span>Aula 03</span></li>
<li data-src="https://scorm.onilearning.com.br/player.php?id=1557&video=69f4de4a4a7fba7f2e2de432106e1751&estudante=" data-index="3"><span>Aula 04</span></li>
  </ul>`;

describe("extrairPlayers", () => {
  test("lê os 4 vídeos e converte data-index 0-based em posição 1-based", () => {
    const v = cdn.extrairPlayers(PLAYLIST);
    expect(v).toHaveLength(4);
    expect(v[0]!.indice).toBe(1);
    expect(v[3]!.indice).toBe(4);
    expect(v[0]!.rotulo).toBe("Aula 01");
    expect(v[0]!.player).toContain("id=1555");
  });

  test("ignora <li> que não seja de player", () => {
    expect(cdn.extrairPlayers(`<li data-index="0"><span>Vazio</span></li>`)).toHaveLength(0);
    expect(cdn.extrairPlayers(`<li data-src="/outro.html"><span>x</span></li>`)).toHaveLength(0);
  });

  test("tolera atributos em ordem trocada", () => {
    const v = cdn.extrairPlayers(
      `<li data-index="5" class="x" data-src="https://s/player.php?id=9"><span>Aula 06</span></li>`);
    expect(v).toHaveLength(1);
    expect(v[0]!.indice).toBe(6);
    expect(v[0]!.rotulo).toBe("Aula 06");
  });

  test("playlist vazia não quebra", () => {
    expect(cdn.extrairPlayers("")).toEqual([]);
    expect(cdn.extrairPlayers("<html><body>nada</body></html>")).toEqual([]);
  });
});

describe("extrairManifesto", () => {
  test("acha o m3u8 dentro do HTML do player", () => {
    const html = `hls.loadSource("https://d2un266hqcizhh.cloudfront.net/1236881/379577675/379577675.m3u8?v=oni");`;
    expect(cdn.extrairManifesto(html)).toBe(
      "https://d2un266hqcizhh.cloudfront.net/1236881/379577675/379577675.m3u8?v=oni");
  });

  test("devolve null quando não há vídeo", () => {
    expect(cdn.extrairManifesto("<html>sem player</html>")).toBeNull();
  });
});

describe("legendaDe", () => {
  test("deriva a trilha de legenda do manifesto, descartando a query", () => {
    expect(cdn.legendaDe("https://cf.net/1/379577675/379577675.m3u8?v=oni"))
      .toBe("https://cf.net/1/379577675/379577675LEGENDA.m3u8");
  });
});

describe("slugCdn / urlPlaylist", () => {
  test("reproduz o slug real do CDN", () => {
    expect(cdn.slugCdn("Fundamentos de Marketing")).toBe("fundamentos-de-marketing");
    expect(cdn.slugCdn("Marketing e o Composto de Produtos e Serviços"))
      .toBe("marketing-e-o-composto-de-produtos-e-servicos");
  });

  test("monta a URL com o N do módulo", () => {
    expect(cdn.urlPlaylist("fundamentos-de-marketing", 1))
      .toBe("https://grupofocus.b-cdn.net/playlist_videoaulas/produtora_tele/fundamentos-de-marketing_videos_1.html");
    expect(cdn.urlPlaylist("fundamentos-de-marketing", 4)).toEndWith("_videos_4.html");
  });
});

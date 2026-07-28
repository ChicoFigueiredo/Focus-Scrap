import { describe, expect, test } from "bun:test";
import * as iesde from "../src/iesde.ts";
import { arquivoVideo } from "../src/naming.ts";

// Markup fiel da playlist real (iesde/101046/lessons/playlist).
const PLAYLIST = `
<ul class="playlist">
  <li data-src="https://www5.faculdadefocus.com.br/iesde/lessons/337839/show"
      data-index="337839">
      <span>Premissas e perspectivas a respeito do consumidor - parte 01</span>
  </li>
  <li data-src="https://www5.faculdadefocus.com.br/iesde/lessons/337840/show"
      data-index="337840">
      <span>Premissas e perspectivas a respeito do consumidor - parte 02</span>
  </li>
  <li data-src="https://www5.faculdadefocus.com.br/iesde/lessons/337845/show"
      data-index="337845">
      <span>Processo de decisão do consumidor - parte 01</span>
  </li>
</ul>`;

describe("ehIesde", () => {
  test("separa as duas famílias de conteúdo", () => {
    expect(iesde.ehIesde("https://www5.faculdadefocus.com.br/iesde/101046/lessons/playlist")).toBe(true);
    expect(iesde.ehIesde("https://grupofocus.b-cdn.net/playlist_videoaulas/x_videos_1.html")).toBe(false);
    expect(iesde.ehIesde(null)).toBe(false);
  });
});

describe("extrairAulas", () => {
  test("lê as aulas e numera pela ordem, não pelo data-index (que é o id)", () => {
    const a = iesde.extrairAulas(PLAYLIST);
    expect(a).toHaveLength(3);
    expect(a.map((x) => x.indice)).toEqual([1, 2, 3]);
    expect(a[0]!.show).toEndWith("/lessons/337839/show");
  });

  test("remove o sufixo '- parte NN' — o prefixo MM.VV já carrega a parte", () => {
    const a = iesde.extrairAulas(PLAYLIST);
    expect(a[0]!.titulo).toBe("Premissas e perspectivas a respeito do consumidor");
    expect(a[1]!.titulo).toBe("Premissas e perspectivas a respeito do consumidor");
    expect(a[2]!.titulo).toBe("Processo de decisão do consumidor");
  });

  test("não confunde com playlist da outra família", () => {
    expect(iesde.extrairAulas(
      `<li data-src="https://scorm.onilearning.com.br/player.php?id=1"><span>Aula 01</span></li>`,
    )).toHaveLength(0);
  });
});

describe("agrupar", () => {
  test("junta aulas consecutivas de mesmo título", () => {
    const g = iesde.agrupar(iesde.extrairAulas(PLAYLIST));
    expect(g).toHaveLength(2);
    expect(g[0]!.aulas).toHaveLength(2);
    expect(g[1]!.aulas).toHaveLength(1);
    expect(g[0]!.posicao).toBe(1);
    expect(g[1]!.posicao).toBe(2);
  });

  test("título repetido NÃO consecutivo vira grupo novo", () => {
    const g = iesde.agrupar([
      { indice: 1, titulo: "A", show: "s1" },
      { indice: 2, titulo: "B", show: "s2" },
      { indice: 3, titulo: "A", show: "s3" },
    ]);
    expect(g.map((x) => x.titulo)).toEqual(["A", "B", "A"]);
  });

  test("lista vazia não quebra", () => {
    expect(iesde.agrupar([])).toEqual([]);
  });
});

describe("extrairVideo", () => {
  test("acha o MP4 assinado no HTML da aula", () => {
    const html = `<video><source src="https://videoiesde.dlt.qwilted-cds.cqloud.com/qsig=abc/x/qualidade-720.mp4" type="video/mp4"></video>`;
    expect(iesde.extrairVideo(html)).toContain("qualidade-720.mp4");
  });

  test("null quando a página não tem vídeo", () => {
    expect(iesde.extrairVideo("<html>vazio</html>")).toBeNull();
  });
});

describe("nome final", () => {
  test("reproduz exatamente o arquivo que já está no acervo", () => {
    const g = iesde.agrupar(iesde.extrairAulas(PLAYLIST));
    expect(arquivoVideo(g[0]!.posicao, 1, g[0]!.titulo))
      .toBe("01.01-Premissas.e.perspectivas.a.respeito.do.consumidor.mp4");
    expect(arquivoVideo(g[0]!.posicao, 2, g[0]!.titulo))
      .toBe("01.02-Premissas.e.perspectivas.a.respeito.do.consumidor.mp4");
  });
});

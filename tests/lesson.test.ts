import { describe, expect, test } from "bun:test";
import { classificar, PROIBIDO } from "../src/lesson.ts";

// URLs reais colhidas na navegação de 27/07/2026 (disciplina 603).
const VIDEO = [
  "https://grupofocus.b-cdn.net/playlist_videoaulas/produtora_tele/fundamentos-de-marketing_videos_1.html",
  "https://scorm.onilearning.com.br/player.php?id=1555&video=6594644ef1a1b25837bd303507b482eb&estudante=",
  "https://d2un266hqcizhh.cloudfront.net/1236881/379577675/379577675.m3u8?v=oni",
  "https://d2un266hqcizhh.cloudfront.net/1236881/379577675/379577675_360.m3u8",
];
const PDF = ["https://scorm.onilearning.com.br/conteudo/componente.php?id=42717&instituicao=337&componente=b2124408b75b2ff8bc89ea203585629e&saida=arquivo&estudante="];
const LIVRO = ["https://scorm.onilearning.com.br/conteudo/componente.php?id=5267&instituicao=337&onepage=ae5a33919e56ac3a542dbc312aece258&estudante="];

describe("classificar", () => {
  test("reconhece vídeo e prefere o manifesto master, não a variante de qualidade", () => {
    const f = classificar(VIDEO);
    expect(f.tipo).toBe("video");
    expect(f.manifesto).toContain("379577675.m3u8?v=oni");
    expect(f.manifesto).not.toContain("_360");
    expect(f.playlist).toContain("_videos_1.html");
  });

  test("distingue PDF baixável de livro digital paginado", () => {
    expect(classificar(PDF).tipo).toBe("pdf");
    expect(classificar(PDF).arquivo).toContain("saida=arquivo");
    expect(classificar(LIVRO).tipo).toBe("livro");
    expect(classificar(LIVRO).visualizador).toContain("onepage=");
  });

  test("deriva a legenda do manifesto e ignora a vazada da lesson anterior", () => {
    // O player da lesson anterior segue baixando depois que o painel troca, e a
    // resposta atrasada entra no balde errado — foi observado em produção.
    const f = classificar([
      "https://d2un266hqcizhh.cloudfront.net/1236881/379580201/379580201.m3u8?v=oni",
      "https://d2un266hqcizhh.cloudfront.net/1236881/379581417/379581417LEGENDA.m3u8",
    ]);
    expect(f.legenda).toBe("https://d2un266hqcizhh.cloudfront.net/1236881/379580201/379580201LEGENDA.m3u8");
    expect(f.legenda).not.toContain("379581417");
  });

  test("sem nada reconhecível, não inventa tipo", () => {
    expect(classificar([]).tipo).toBe("desconhecido");
    expect(classificar(["https://exemplo.com/qualquer.html"]).tipo).toBe("desconhecido");
  });
});

describe("PROIBIDO", () => {
  test("barra tudo que é avaliação", () => {
    for (const t of ["Fazer prova", "9 · Refazer", "Avaliação Final", "Simulado", "Questionário", "/exams?course_id=510"])
      expect(PROIBIDO.test(t)).toBe(true);
  });

  test("não barra material legítimo", () => {
    for (const t of ["Vídeo Aula", "Material em PDF", "Livro Digital", "Marketing e o Ambiente de Negócio"])
      expect(PROIBIDO.test(t)).toBe(false);
  });
});

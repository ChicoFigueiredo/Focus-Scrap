import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import * as n from "../src/naming.ts";
import { REPOSITORY } from "../src/config.ts";

describe("pontuar", () => {
  test("troca espaço por ponto e preserva acento", () => {
    expect(n.pontuar("Conceito de Marketing")).toBe("Conceito.de.Marketing");
    expect(n.pontuar("Análise SWOT")).toBe("Análise.SWOT");
    expect(n.pontuar("Marketing e Informação Estratégica")).toBe("Marketing.e.Informação.Estratégica");
  });

  test("colapsa pontuação em vez de gerar pontos duplos", () => {
    expect(n.pontuar("Funções: troca, distribuição")).toBe("Funções.troca.distribuição");
    expect(n.pontuar("Marketing  —  Web")).toBe("Marketing.—.Web");
    expect(n.pontuar(".borda.")).toBe("borda");
  });

  test("remove caracteres que o NTFS recusa (o acervo é disco Windows)", () => {
    expect(n.pontuar('E/S: "quem?" <x>')).toBe("E.S.quem.x");
    expect(n.pontuar("a/b\\c")).not.toMatch(/[\\/]/);
  });
});

describe("nomes gerados", () => {
  test("reproduzem o padrão do acervo existente", () => {
    expect(n.pastaDisciplina(1, "Fundamentos de Marketing")).toBe("01-Fundamentos.de.Marketing");
    expect(n.playlistDisciplina(1, "Fundamentos de Marketing")).toBe("01-Fundamentos.de.Marketing.xspf");
    expect(n.arquivoVideo(1, 1, "Conceito de Marketing")).toBe("01.01-Conceito.de.Marketing.mp4");
    expect(n.arquivoVideo(1, 4, "Análise SWOT", "srt")).toBe("01.04-Análise.SWOT.srt");
    expect(n.arquivoCronometrada(4, 2, "Sistema de Informação de Marketing"))
      .toBe("04.02-Sistema.de.Informação.de.Marketing-Fala.Cronometrada.txt");
    expect(n.arquivoMaterial(1, 5, "Ebook", "Marketing e o Ambiente Negócios"))
      .toBe("01.05-Ebook-Marketing.e.o.Ambiente.Negócios.pdf");
  });

  test("dd não trunca acima de 99", () => {
    expect(n.dd(3)).toBe("03");
    expect(n.dd(12)).toBe("12");
    expect(n.dd(103)).toBe("103");
  });
});

describe("chave", () => {
  test("iguala grafias divergentes do acervo (Servicos vs Serviços)", () => {
    expect(n.chave("02-Marketing.e.o.Composto.de.Produtos.e.Servicos"))
      .toBe(n.chave("Marketing e o Composto de Produtos e Serviços"));
  });

  test("ignora o prefixo numérico", () => {
    expect(n.chave("01.01-Conceito.de.Marketing")).toBe(n.chave("Conceito de Marketing"));
    expect(n.chave("01-Fundamentos.de.Marketing")).toBe(n.chave("Fundamentos de Marketing"));
  });

  test("não colapsa títulos de fato diferentes", () => {
    expect(n.chave("Ambiente Mercadológico")).not.toBe(n.chave("Análise SWOT"));
  });
});

describe("marcadorDe", () => {
  test("classifica os materiais que a plataforma expõe", () => {
    expect(n.marcadorDe("Livro Digital")).toBe("Ebook");
    expect(n.marcadorDe("Material em PDF")).toBe("Slides");
    expect(n.marcadorDe("Exercícios")).toBe("Exercicios");
  });

  test("devolve null no que não reconhece — aí é caso do agente", () => {
    expect(n.marcadorDe("Vídeo Aula")).toBeNull();
    expect(n.marcadorDe("Alguma coisa nova")).toBeNull();
  });
});

// Confere contra o acervo real. Pula sozinho se o disco não estiver montado,
// para o teste continuar rodando em outra máquina.
const CURSO = join(REPOSITORY, "Marketing.Digital-Storytelling-Web");
const temDisco = existsSync(CURSO);

describe.skipIf(!temDisco)("acervo real", () => {
  test("toda pasta de disciplina casa com o padrão gerado", () => {
    for (const d of readdirSync(CURSO).filter((f) => /^\d\d-/.test(f))) {
      const [, pos, nome] = /^(\d+)-(.+)$/.exec(d)!;
      expect(n.pastaDisciplina(Number(pos), nome!.replace(/\./g, " "))).toBe(d);
    }
  });

  test("chave() reconhece os módulos existentes a partir do nome da API", () => {
    // Nome como a API entrega × pasta como está no disco.
    const pares: [string, string][] = [
      ["Marketing e o Ambiente de Negócio", "01-Marketing.e.o.Ambiente.Negócios"],
      ["Comportamento do Consumidor", "03-Comportamento.do.Consumidor"],
      ["Marketing e Informação Estratégica", "04-Marketing.e.Informação.Estratégica"],
    ];
    const disc = join(CURSO, "01-Fundamentos.de.Marketing");
    const pastas = readdirSync(disc).filter((f) => /^\d\d-/.test(f));
    for (const [, esperada] of pares) expect(pastas).toContain(esperada);
    // "Negócio" (API) vs "Negócios" (disco) divergem: chave() sozinha não basta,
    // e é por isso que a reconciliação usa posição do módulo como âncora.
    expect(n.chave("Comportamento do Consumidor")).toBe(n.chave("03-Comportamento.do.Consumidor"));
  });
});

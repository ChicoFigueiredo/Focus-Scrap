import { describe, expect, test } from "bun:test";
import * as l from "../src/legenda.ts";

// Trecho fiel de um .srt gerado pelo pipeline.
const SRT = `1
00:00:07,950 --> 00:00:36,179
Olá, seja bem-vindo à primeira unidade letiva.

2
00:00:36,179 --> 00:01:01,409
já que a venda era praticamente automática.
Quando a concorrência aumenta, as empresas mudam.
`;

describe("paraSegundos", () => {
  test("aceita vírgula (SRT) e ponto (VTT)", () => {
    expect(l.paraSegundos("00:00:07,950")).toBeCloseTo(7.95, 3);
    expect(l.paraSegundos("00:00:07.950")).toBeCloseTo(7.95, 3);
    expect(l.paraSegundos("01:02:03,004")).toBeCloseTo(3723.004, 3);
  });

  test("milissegundos curtos não viram número errado", () => {
    // "1" precisa valer 100ms, não 1ms.
    expect(l.paraSegundos("00:00:01,1")).toBeCloseTo(1.1, 3);
  });

  test("lixo devolve 0 em vez de NaN", () => {
    expect(l.paraSegundos("qualquer coisa")).toBe(0);
  });
});

describe("lerTrechos", () => {
  test("lê os blocos com tempo e junta linhas de fala", () => {
    const t = l.lerTrechos(SRT);
    expect(t).toHaveLength(2);
    expect(t[0]!.inicio).toBeCloseTo(7.95, 2);
    expect(t[0]!.fim).toBeCloseTo(36.179, 2);
    expect(t[1]!.texto).toContain("as empresas mudam");
    expect(t[1]!.texto).not.toContain("\n");
  });

  test("tolera CRLF e cabeçalho WEBVTT", () => {
    expect(l.lerTrechos(SRT.replace(/\n/g, "\r\n"))).toHaveLength(2);
    expect(l.lerTrechos(`WEBVTT\n\n${SRT}`)).toHaveLength(2);
  });

  test("bloco sem tempo é ignorado, não vira trecho vazio", () => {
    expect(l.lerTrechos("só um texto solto\n\noutro")).toEqual([]);
    expect(l.lerTrechos("")).toEqual([]);
  });
});

describe("srtParaVtt", () => {
  test("põe o cabeçalho e troca a vírgula decimal por ponto", () => {
    const v = l.srtParaVtt(SRT);
    expect(v).toStartWith("WEBVTT\n\n");
    expect(v).toContain("00:00:07.950 --> 00:00:36.179");
    // A vírgula decimal quebra o parser do navegador em silêncio.
    expect(v).not.toContain("07,950");
  });

  test("não duplica o cabeçalho se já for VTT", () => {
    const v = l.srtParaVtt(l.srtParaVtt(SRT));
    expect(v.match(/WEBVTT/g)).toHaveLength(1);
  });
});

describe("comoRelogio", () => {
  test("m:ss abaixo de uma hora, h:mm:ss acima", () => {
    expect(l.comoRelogio(7.95)).toBe("0:07");
    expect(l.comoRelogio(95)).toBe("1:35");
    expect(l.comoRelogio(3723)).toBe("1:02:03");
    expect(l.comoRelogio(-5)).toBe("0:00");
  });
});

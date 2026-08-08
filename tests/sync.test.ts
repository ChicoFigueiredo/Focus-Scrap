import { describe, expect, test } from "bun:test";
import { aplicarSync, connect, lerNotas, lerPrefs, lerProgresso } from "../src/db.ts";

const banco = () => connect(":memory:");

describe("aplicarSync — progresso", () => {
  test("grava posição e marca de visto", () => {
    const db = banco();
    aplicarSync(db, [{ t: "progresso", chave: "i:7", segundos: 42.5, visto: true }]);
    expect(lerProgresso(db)["i:7"]).toEqual({ segundos: 42.5, visto: true });
  });

  test("gravar só a posição não apaga a marca de visto", () => {
    const db = banco();
    aplicarSync(db, [{ t: "progresso", chave: "i:7", visto: true }]);
    aplicarSync(db, [{ t: "progresso", chave: "i:7", segundos: 10 }]);
    expect(lerProgresso(db)["i:7"]).toEqual({ segundos: 10, visto: true });
  });

  test("recusa chave fora do formato i:<n> / md:<caminho>", () => {
    const db = banco();
    const r = aplicarSync(db, [{ t: "progresso", chave: "DROP TABLE", visto: true }]);
    expect(r).toEqual({ aplicadas: 0, ignoradas: 1 });
    expect(lerProgresso(db)).toEqual({});
  });

  test("aceita chave de material escrito", () => {
    const db = banco();
    aplicarSync(db, [{ t: "progresso", chave: "md:00-Materiais.Escritos.md", visto: true }]);
    expect(lerProgresso(db)["md:00-Materiais.Escritos.md"]!.visto).toBe(true);
  });
});

describe("aplicarSync — lote", () => {
  test("marca todas as chaves de uma vez", () => {
    const db = banco();
    aplicarSync(db, [{ t: "lote", chaves: ["i:1", "i:2", "md:x.md"], visto: true }]);
    const p = lerProgresso(db);
    expect(Object.keys(p).sort()).toEqual(["i:1", "i:2", "md:x.md"]);
    expect(Object.values(p).every((v) => v.visto)).toBe(true);
  });

  test("descarta só as chaves inválidas do lote, e aplica o resto", () => {
    const db = banco();
    aplicarSync(db, [{ t: "lote", chaves: ["i:1", "lixo"], visto: true }]);
    expect(Object.keys(lerProgresso(db))).toEqual(["i:1"]);
  });
});

describe("aplicarSync — anotações", () => {
  test("grava o texto da anotação", () => {
    const db = banco();
    aplicarSync(db, [{ t: "nota", chave: "i:7", texto: "revisar o slide 12" }]);
    expect(lerNotas(db)).toEqual({ "i:7": "revisar o slide 12" });
  });

  test("texto em branco apaga a anotação em vez de guardar linha vazia", () => {
    const db = banco();
    aplicarSync(db, [{ t: "nota", chave: "i:7", texto: "algo" }]);
    aplicarSync(db, [{ t: "nota", chave: "i:7", texto: "   " }]);
    expect(lerNotas(db)).toEqual({});
  });

  test("a última gravação da mesma chave vence", () => {
    const db = banco();
    aplicarSync(db, [
      { t: "nota", chave: "i:7", texto: "do tablet" },
      { t: "nota", chave: "i:7", texto: "do PC" },
    ]);
    expect(lerNotas(db)["i:7"]).toBe("do PC");
  });

  test("recusa chave fora do formato", () => {
    const db = banco();
    aplicarSync(db, [{ t: "nota", chave: "../etc/passwd", texto: "x" }]);
    expect(lerNotas(db)).toEqual({});
  });
});

describe("aplicarSync — preferências", () => {
  test("grava e depois sobrescreve", () => {
    const db = banco();
    aplicarSync(db, [{ t: "pref", nome: "velocidade", valor: "1.5" }]);
    aplicarSync(db, [{ t: "pref", nome: "velocidade", valor: "2" }]);
    expect(lerPrefs(db)).toEqual({ velocidade: "2" });
  });

  test("recusa nome de preferência desconhecido", () => {
    const db = banco();
    const r = aplicarSync(db, [{ t: "pref", nome: "qualquer_coisa", valor: "1" }]);
    expect(r.ignoradas).toBe(1);
    expect(lerPrefs(db)).toEqual({});
  });
});

describe("aplicarSync — robustez da fila", () => {
  test("operação desconhecida é ignorada sem derrubar as boas do mesmo lote", () => {
    const db = banco();
    const r = aplicarSync(db, [
      { t: "progresso", chave: "i:1", visto: true },
      { t: "invenção" as never },
      { t: "nota", chave: "i:1", texto: "ok" },
    ]);
    expect(r).toEqual({ aplicadas: 2, ignoradas: 1 });
    expect(lerProgresso(db)["i:1"]!.visto).toBe(true);
    expect(lerNotas(db)["i:1"]).toBe("ok");
  });

  test("lote vazio não é erro", () => {
    expect(aplicarSync(banco(), [])).toEqual({ aplicadas: 0, ignoradas: 0 });
  });

  test("reenviar a mesma operação não duplica nada (a fila reenvia após falha)", () => {
    const db = banco();
    const ops = [{ t: "progresso" as const, chave: "i:1", visto: true }];
    aplicarSync(db, ops);
    aplicarSync(db, ops);
    expect(Object.keys(lerProgresso(db))).toEqual(["i:1"]);
  });
});

describe("aplicarSync — tela em cartaz", () => {
  test("guarda o JSON da última tela aberta", () => {
    const db = banco();
    aplicarSync(db, [{ t: "tela", valor: '{"disc":3,"item":7}' }]);
    const r = db.query<{ value: string }, []>(`SELECT value FROM ui_state WHERE name='painel'`).get()!;
    expect(JSON.parse(r.value)).toEqual({ disc: 3, item: 7 });
  });
});

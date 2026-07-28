import { describe, expect, test } from "bun:test";
import { connect, marcarBaixado, upsertDiscipline, upsertItem, upsertModule } from "../src/db.ts";

/** Banco em memória com uma disciplina e um módulo prontos. */
function preparar() {
  const db = connect(":memory:");
  upsertDiscipline(db, { id: 1, enrollment_id: 9, position: 1, name: "D", folder: "01-D" });
  const mod = upsertModule(db, { discipline_id: 1, position: 1, name: "M", folder: "01-M" });
  return { db, mod };
}

const item = (mod: number, rel: string) => ({
  module_id: mod, kind: "video" as const, position: 1,
  title: "Aula", source_url: "https://x/a.m3u8", rel_path: rel,
});

describe("upsertItem", () => {
  test("não rebaixa item já baixado", () => {
    const { db, mod } = preparar();
    upsertItem(db, item(mod, "01-D/01-M/01.01-Aula.mp4"));
    const id = db.query<{ id: number }, []>(`SELECT id FROM items`).get()!.id;
    marcarBaixado(db, id, 1234);

    upsertItem(db, item(mod, "01-D/01-M/01.01-Aula.mp4"));
    const r = db.query<{ s: string; b: number }, []>(
      `SELECT download_status s, bytes b FROM items`).get()!;
    expect(r.s).toBe("done");
    expect(r.b).toBe(1234);
  });

  test("PRESERVA o caminho de item já baixado", () => {
    // O `scan` corrige o rel_path para o nome REAL do disco, que costuma diferir
    // do que geramos (acervo anterior ao projeto, grafia inconsistente). Uma
    // recatalogação regravando o nome gerado fazia 46 arquivos existentes serem
    // dados como sumidos na conferência seguinte — e rebaixados à toa.
    const { db, mod } = preparar();
    upsertItem(db, item(mod, "01-D/01-M/01.01-Aula.mp4"));
    const id = db.query<{ id: number }, []>(`SELECT id FROM items`).get()!.id;
    marcarBaixado(db, id, 999, "01-D/01-M/01.01-Aula com espaços.mp4");

    upsertItem(db, item(mod, "01-D/01-M/01.01-Aula.mp4"));   // recatalogação
    expect(db.query<{ p: string }, []>(`SELECT rel_path p FROM items`).get()!.p)
      .toBe("01-D/01-M/01.01-Aula com espaços.mp4");
  });

  test("mas ATUALIZA o caminho de item ainda pendente", () => {
    const { db, mod } = preparar();
    upsertItem(db, item(mod, "01-D/01-M/antigo.mp4"));
    upsertItem(db, item(mod, "01-D/01-M/novo.mp4"));
    expect(db.query<{ p: string }, []>(`SELECT rel_path p FROM items`).get()!.p)
      .toBe("01-D/01-M/novo.mp4");
  });

  test("renova a URL de origem mesmo em item baixado (assinatura expira)", () => {
    const { db, mod } = preparar();
    upsertItem(db, { ...item(mod, "x.mp4"), source_url: "https://x/velha?qsig=1" });
    const id = db.query<{ id: number }, []>(`SELECT id FROM items`).get()!.id;
    marcarBaixado(db, id, 1);
    upsertItem(db, { ...item(mod, "x.mp4"), source_url: "https://x/nova?qsig=2" });
    expect(db.query<{ u: string }, []>(`SELECT source_url u FROM items`).get()!.u)
      .toBe("https://x/nova?qsig=2");
  });
});

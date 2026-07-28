/**
 * Estado do focus-scrap em SQLite — e o único contrato entre o lado TypeScript
 * (que cataloga) e o lado Python (que baixa e transcreve).
 *
 * WAL + busy_timeout porque os dois processos escrevem ao mesmo tempo: o painel
 * lê enquanto o worker atualiza status. Sem WAL, um trava o outro.
 *
 * A fila é resumível: `pending → running → done | error`. Itens presos em
 * `running` (máquina reiniciada no meio) voltam para `pending` no boot, senão
 * ficariam órfãos para sempre.
 */
import { Database } from "bun:sqlite";

import { DB_PATH } from "./config.ts";

export type Status = "pending" | "running" | "done" | "error" | "skipped";
export type Kind = "video" | "pdf" | "livro";

export interface Item {
  id: number;
  module_id: number;
  kind: Kind;
  position: number;
  title: string;
  source_url: string;
  subtitle_url: string | null;
  rel_path: string | null;
  bytes: number;
  duration: number | null;
  download_status: Status;
  download_error: string | null;
  download_attempts: number;
  transcribe_status: Status;
  transcribe_error: string | null;
  transcribe_attempts: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS disciplines (
  id            INTEGER PRIMARY KEY,          -- discipline_id da API
  enrollment_id INTEGER NOT NULL,
  position      INTEGER NOT NULL,
  name          TEXT    NOT NULL,
  folder        TEXT,                          -- pasta no acervo
  cdn_slug      TEXT,                          -- slug usado nas playlists do CDN
  scraped_at    TEXT
);

CREATE TABLE IF NOT EXISTS modules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  discipline_id INTEGER NOT NULL REFERENCES disciplines(id),
  position      INTEGER NOT NULL,
  name          TEXT    NOT NULL,
  folder        TEXT,
  UNIQUE(discipline_id, position)
);

CREATE TABLE IF NOT EXISTS items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id           INTEGER NOT NULL REFERENCES modules(id),
  kind                TEXT    NOT NULL,        -- video | pdf | livro
  position            INTEGER NOT NULL,        -- VV dentro do módulo, contínuo entre tipos
  title               TEXT    NOT NULL,
  source_url          TEXT    NOT NULL,        -- manifesto HLS, PDF direto ou visualizador
  subtitle_url        TEXT,                    -- trilha de legenda oficial (derivada do manifesto)
  rel_path            TEXT,                    -- destino relativo à raiz do acervo
  bytes               INTEGER NOT NULL DEFAULT 0,
  duration            REAL,
  download_status     TEXT    NOT NULL DEFAULT 'pending',
  download_error      TEXT,
  download_attempts   INTEGER NOT NULL DEFAULT 0,
  transcribe_status   TEXT    NOT NULL DEFAULT 'pending',
  transcribe_error    TEXT,
  transcribe_attempts INTEGER NOT NULL DEFAULT 0,
  updated_at          TEXT,
  UNIQUE(module_id, kind, position)
);

CREATE INDEX IF NOT EXISTS idx_items_download  ON items(download_status);
CREATE INDEX IF NOT EXISTS idx_items_transcribe ON items(transcribe_status);

CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL DEFAULT (datetime('now')),
  level   TEXT NOT NULL,                       -- info | error | agent
  source  TEXT NOT NULL,
  message TEXT NOT NULL
);

-- Padrões sintetizados pelo agente, guardados com a assinatura da entrada que
-- os gerou. Enquanto a assinatura não mudar, roda tudo sem LLM.
CREATE TABLE IF NOT EXISTS patterns (
  signature  TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,                    -- titles | cdn_slug | marker
  value      TEXT NOT NULL,                    -- JSON
  model      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function connect(path: string = DB_PATH): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 10000");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

/**
 * Solta itens presos: um `running` no banco depois de um reinício significa
 * processo morto, não trabalho em andamento.
 */
export function destravar(db: Database): number {
  const r = db.run(
    `UPDATE items SET download_status='pending' WHERE download_status='running'`,
  ).changes;
  const t = db.run(
    `UPDATE items SET transcribe_status='pending' WHERE transcribe_status='running'`,
  ).changes;
  if (r + t > 0) log(db, "info", "db", `destravou ${r} download(s) e ${t} transcrição(ões)`);
  return r + t;
}

export function log(db: Database, level: string, source: string, message: string): void {
  db.run(`INSERT INTO events (level, source, message) VALUES (?, ?, ?)`, [level, source, message]);
}

export function upsertDiscipline(
  db: Database,
  d: { id: number; enrollment_id: number; position: number; name: string; folder: string; cdn_slug?: string },
): void {
  db.run(
    `INSERT INTO disciplines (id, enrollment_id, position, name, folder, cdn_slug, scraped_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       position=excluded.position, name=excluded.name, folder=excluded.folder,
       cdn_slug=COALESCE(excluded.cdn_slug, disciplines.cdn_slug),
       scraped_at=datetime('now')`,
    [d.id, d.enrollment_id, d.position, d.name, d.folder, d.cdn_slug ?? null],
  );
}

export function upsertModule(
  db: Database,
  m: { discipline_id: number; position: number; name: string; folder: string },
): number {
  db.run(
    `INSERT INTO modules (discipline_id, position, name, folder) VALUES (?, ?, ?, ?)
     ON CONFLICT(discipline_id, position) DO UPDATE SET name=excluded.name, folder=excluded.folder`,
    [m.discipline_id, m.position, m.name, m.folder],
  );
  return db.query<{ id: number }, [number, number]>(
    `SELECT id FROM modules WHERE discipline_id=? AND position=?`,
  ).get(m.discipline_id, m.position)!.id;
}

/**
 * Insere ou atualiza um item SEM rebaixar progresso: se já está `done`, uma
 * recatalogação não pode devolvê-lo para a fila.
 *
 * E, pelo mesmo motivo, **não sobrescreve o `rel_path` de item já baixado.** O
 * caminho de um item `done` foi conferido contra o disco pelo `scan` e aponta
 * para o arquivo real, que muitas vezes tem grafia diferente da que geramos
 * (o acervo é anterior a este projeto). Deixar a recatalogação regravar o nome
 * gerado fazia 46 arquivos existentes serem dados como sumidos na conferência
 * seguinte — e reenfileirados para baixar de novo.
 */
export function upsertItem(
  db: Database,
  it: {
    module_id: number; kind: Kind; position: number; title: string;
    source_url: string; subtitle_url?: string | null; rel_path?: string | null;
  },
): void {
  db.run(
    `INSERT INTO items (module_id, kind, position, title, source_url, subtitle_url, rel_path, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(module_id, kind, position) DO UPDATE SET
       title=excluded.title,
       source_url=excluded.source_url,
       subtitle_url=COALESCE(excluded.subtitle_url, items.subtitle_url),
       rel_path=CASE WHEN items.download_status='done' THEN items.rel_path
                     ELSE COALESCE(excluded.rel_path, items.rel_path) END,
       updated_at=datetime('now')`,
    [it.module_id, it.kind, it.position, it.title, it.source_url,
     it.subtitle_url ?? null, it.rel_path ?? null],
  );
}

/**
 * Aponta o item para o caminho que existe de fato no disco.
 *
 * Usado pelo `scan` mesmo em item PENDENTE: o destino precisa apontar para a
 * pasta que já existe, senão o download cria uma pasta irmã com grafia
 * diferente e o acervo racha em dois.
 */
export function definirCaminho(db: Database, id: number, relPath: string): void {
  db.run(`UPDATE items SET rel_path=?, updated_at=datetime('now') WHERE id=?`, [relPath, id]);
}

/**
 * Marca a transcrição como pronta sem passar pela GPU.
 *
 * Usado quando a legenda já existe: veio oficial no manifesto HLS, ou já estava
 * no acervo desde antes deste projeto.
 */
export function marcarTranscrito(db: Database, id: number): void {
  db.run(
    `UPDATE items SET transcribe_status='done', transcribe_error=NULL,
            updated_at=datetime('now') WHERE id=?`, [id]);
}

/** Marca como já capturado — usado pelo `scan` ao achar o arquivo no disco. */
export function marcarBaixado(db: Database, id: number, bytes: number, relPath?: string): void {
  db.run(
    `UPDATE items SET download_status='done', bytes=?, download_error=NULL,
            rel_path=COALESCE(?, rel_path), updated_at=datetime('now') WHERE id=?`,
    [bytes, relPath ?? null, id],
  );
}

export interface Stats {
  disciplinas: number;
  modulos: number;
  itens: number;
  porStatus: Record<string, number>;
  porTipo: Record<string, number>;
  bytes: number;
}

export function stats(db: Database): Stats {
  const um = (sql: string): number => db.query<{ n: number }, []>(sql).get()?.n ?? 0;

  const porStatus: Record<string, number> = {};
  for (const r of db.query<{ s: string; n: number }, []>(
    `SELECT download_status AS s, COUNT(*) AS n FROM items GROUP BY 1`).all())
    porStatus[r.s] = r.n;

  const porTipo: Record<string, number> = {};
  for (const r of db.query<{ k: string; n: number }, []>(
    `SELECT kind AS k, COUNT(*) AS n FROM items GROUP BY 1`).all())
    porTipo[r.k] = r.n;

  return {
    disciplinas: um(`SELECT COUNT(*) AS n FROM disciplines`),
    modulos: um(`SELECT COUNT(*) AS n FROM modules`),
    itens: um(`SELECT COUNT(*) AS n FROM items`),
    porStatus,
    porTipo,
    bytes: um(`SELECT COALESCE(SUM(bytes),0) AS n FROM items`),
  };
}

/** Reenfileira o que deu erro. `qual` escolhe a fase. */
export function reenfileirar(db: Database, qual: "download" | "transcribe"): number {
  const col = qual === "download" ? "download_status" : "transcribe_status";
  const err = qual === "download" ? "download_error" : "transcribe_error";
  return db.run(
    `UPDATE items SET ${col}='pending', ${err}=NULL, updated_at=datetime('now') WHERE ${col}='error'`,
  ).changes;
}

export function padraoSalvo(db: Database, signature: string): unknown | null {
  const r = db.query<{ value: string }, [string]>(
    `SELECT value FROM patterns WHERE signature=?`).get(signature);
  return r ? JSON.parse(r.value) : null;
}

export function salvarPadrao(
  db: Database, signature: string, kind: string, value: unknown, model: string,
): void {
  db.run(
    `INSERT INTO patterns (signature, kind, value, model) VALUES (?, ?, ?, ?)
     ON CONFLICT(signature) DO UPDATE SET value=excluded.value, model=excluded.model`,
    [signature, kind, JSON.stringify(value), model],
  );
}

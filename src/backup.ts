/**
 * Cópia do `focus.db` dentro do próprio acervo.
 *
 * `focus.db` mora em `BASE_DIR` — fora do disco de estudo, sem redundância
 * própria. Os arquivos capturados já estão a salvo em `repository`; falta o
 * catálogo que sabe o que cada um é, o que falta, e o que deu erro. Se
 * `BASE_DIR` se perder, este projeto se reconstrói do zero (`git clone`), mas
 * o catálogo — status de cada item, padrões do agente, histórico de erros —
 * não tem como ser refeito sem revisitar o site inteiro. Por isso a cópia.
 *
 * `VACUUM INTO` em vez de copiar o arquivo cru: o banco roda em WAL, então
 * parte dos dados mais recentes pode estar só no `.db-wal`, ainda não
 * migrada para o `.db` principal — copiar o arquivo bruto arriscaria uma
 * foto inconsistente. `VACUUM INTO` sempre lê a visão consolidada (WAL +
 * principal) e não precisa de exclusividade: outro processo pode estar
 * escrevendo ao mesmo tempo.
 *
 * A escrita vai para um `.tmp` e só então vira o nome final por `rename` —
 * uma cópia interrompida a meio nunca substitui a anterior, que ainda era boa.
 */
import { existsSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";

import { REPOSITORY } from "./config.ts";
import { log } from "./db.ts";

export const COPIA_PATH = join(REPOSITORY, "focus.db");

export interface Sincronizado {
  ok: boolean;
  bytes: number;
  ms: number;
  caminho: string;
  erro?: string;
}

export function sincronizarCopia(db: Database): Sincronizado {
  const inicio = Date.now();
  const tmp = `${COPIA_PATH}.tmp`;
  try {
    // VACUUM INTO recusa escrever num arquivo que já existe.
    if (existsSync(tmp)) unlinkSync(tmp);
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    renameSync(tmp, COPIA_PATH);
    return { ok: true, bytes: statSync(COPIA_PATH).size, ms: Date.now() - inicio, caminho: COPIA_PATH };
  } catch (e) {
    const erro = String(e).slice(0, 300);
    log(db, "error", "sync", `cópia do banco falhou: ${erro}`);
    return { ok: false, bytes: 0, ms: Date.now() - inicio, caminho: COPIA_PATH, erro };
  }
}

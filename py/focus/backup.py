"""Cópia do `focus.db` dentro do próprio acervo — espelha `src/backup.ts`.

Mesmo motivo do lado TypeScript: os arquivos capturados já estão a salvo em
`repository`, mas o catálogo (status de cada item, histórico de erro) só
existe em `BASE_DIR`, fora do disco de estudo. `VACUUM INTO` em vez de copiar
o arquivo cru porque o banco roda em WAL — copiar o `.db` bruto arriscaria uma
foto sem os dados ainda só no `.db-wal`.
"""
from __future__ import annotations

import sqlite3
import time

from . import config, db

COPIA_PATH = config.REPOSITORY / "focus.db"


def sincronizar_copia(conn: sqlite3.Connection) -> dict:
    inicio = time.monotonic()
    tmp = COPIA_PATH.with_name(COPIA_PATH.name + ".tmp")
    try:
        # VACUUM INTO recusa escrever num arquivo que já existe.
        tmp.unlink(missing_ok=True)
        alvo = str(tmp).replace("'", "''")
        conn.execute(f"VACUUM INTO '{alvo}'")
        tmp.replace(COPIA_PATH)
        ms = round((time.monotonic() - inicio) * 1000)
        return {"ok": True, "bytes": COPIA_PATH.stat().st_size, "ms": ms}
    except Exception as e:  # noqa: BLE001 — falha aqui não pode derrubar o worker
        ms = round((time.monotonic() - inicio) * 1000)
        db.log(conn, "error", "sync", f"cópia do banco falhou: {e}"[:300])
        return {"ok": False, "bytes": 0, "ms": ms, "erro": str(e)}

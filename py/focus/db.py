"""Acesso ao mesmo SQLite que o lado TypeScript escreve.

O schema é criado lá (`src/db.ts`) — aqui só se lê a fila e se atualiza status.
WAL e `busy_timeout` são obrigatórios: painel, scrape e worker escrevem juntos.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Iterator

from . import config


def connect(path: Path | str = config.DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), timeout=30, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 10000")
    return conn


def log(conn: sqlite3.Connection, level: str, source: str, message: str) -> None:
    conn.execute(
        "INSERT INTO events (level, source, message) VALUES (?, ?, ?)",
        (level, source, message[:500]),
    )


def proximos_downloads(conn: sqlite3.Connection, limite: int = 50) -> list[sqlite3.Row]:
    """Fila de download, na ordem em que o curso é estudado."""
    return conn.execute(
        """
        SELECT i.*, m.position AS mod_pos, d.position AS disc_pos, d.name AS disc_nome
          FROM items i
          JOIN modules m ON m.id = i.module_id
          JOIN disciplines d ON d.id = m.discipline_id
         WHERE i.download_status = 'pending'
         ORDER BY d.position, m.position, i.position
         LIMIT ?
        """,
        (limite,),
    ).fetchall()


def proximas_transcricoes(conn: sqlite3.Connection, limite: int = 50) -> list[sqlite3.Row]:
    """Vídeos já baixados e ainda sem transcrição."""
    return conn.execute(
        """
        SELECT i.*, m.position AS mod_pos
          FROM items i
          JOIN modules m ON m.id = i.module_id
         WHERE i.kind = 'video'
           AND i.download_status = 'done'
           AND i.transcribe_status = 'pending'
         ORDER BY i.id
         LIMIT ?
        """,
        (limite,),
    ).fetchall()


def marcar(conn: sqlite3.Connection, item_id: int, fase: str, status: str,
           erro: str | None = None, **campos: Any) -> None:
    """Atualiza o status de uma fase ('download' ou 'transcribe') de um item."""
    sets = [f"{fase}_status = ?", f"{fase}_error = ?", "updated_at = datetime('now')"]
    vals: list[Any] = [status, (erro or "")[:400] or None]
    if status == "running":
        sets.append(f"{fase}_attempts = {fase}_attempts + 1")
    for k, v in campos.items():
        sets.append(f"{k} = ?")
        vals.append(v)
    vals.append(item_id)
    conn.execute(f"UPDATE items SET {', '.join(sets)} WHERE id = ?", vals)


def iter_pendentes(conn: sqlite3.Connection, buscar, limite: int = 50) -> Iterator[sqlite3.Row]:
    """Reconsulta a fila a cada rodada — o painel pode ter reenfileirado algo."""
    while True:
        lote = buscar(conn, limite)
        if not lote:
            return
        yield from lote

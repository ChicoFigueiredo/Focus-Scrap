"""Worker de mídia: consome a fila que o `scrape` (lado TypeScript) preencheu.

    uv run python -m focus.worker                # baixa e transcreve o que faltar
    uv run python -m focus.worker --no-transcribe
    uv run python -m focus.worker --limit 3      # útil para testar

É resumível: reinicie a máquina e rode de novo. Itens presos em `running` (o
processo morreu no meio) voltam para `pending` no início.
"""
from __future__ import annotations

import argparse

from . import backup, config, db, downloader, transcriber


def destravar(conn) -> int:
    """`running` no banco depois de um reinício é processo morto, não trabalho."""
    n = 0
    for fase in ("download", "transcribe"):
        n += conn.execute(
            f"UPDATE items SET {fase}_status='pending' WHERE {fase}_status='running'"
        ).rowcount
    if n:
        db.log(conn, "info", "worker", f"destravou {n} item(ns) presos em running")
    return n


def main() -> int:
    ap = argparse.ArgumentParser(description="worker de mídia do focus-scrap")
    ap.add_argument("--no-transcribe", action="store_true", help="só baixa (dispensa GPU)")
    ap.add_argument("--no-download", action="store_true", help="só transcreve")
    ap.add_argument("--limit", type=int, default=None, help="processa no máximo N itens")
    a = ap.parse_args()

    config.ensure_dirs()
    if not config.DB_PATH.exists():
        print(f"banco não existe em {config.DB_PATH} — rode 'bun run scrape' antes.")
        return 1

    conn = db.connect()
    destravar(conn)
    db.log(conn, "info", "worker", "worker iniciado")

    baixados = 0 if a.no_download else downloader.rodar(conn, a.limit)
    print(f"download: {baixados} item(ns)")

    transcritos = 0 if a.no_transcribe else transcriber.rodar(conn, a.limit)
    print(f"transcrição: {transcritos} item(ns)")

    fila = conn.execute(
        "SELECT download_status AS s, COUNT(*) AS n FROM items GROUP BY 1"
    ).fetchall()
    print("fila:", {r["s"]: r["n"] for r in fila})

    r = backup.sincronizar_copia(conn)
    print(f"cópia do banco: ok ({r['bytes']/1e6:.1f} MB)" if r["ok"]
          else f"cópia do banco: falhou — {r.get('erro')}")

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

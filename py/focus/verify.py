"""Conferência de integridade do acervo — o "double check".

Um item marcado `done` no banco é uma promessa: o arquivo existe, tem tamanho
plausível e abre. Esta rotina cobra essa promessa item a item e devolve para a
fila o que não cumprir.

Vale a pena porque as três formas de sujeira aqui são silenciosas:

  - **MP4 truncado.** Download interrompido deixa arquivo que parece bom pelo
    tamanho mas não abre. O `ffprobe` é quem sabe.
  - **PDF que virou HTML.** Sessão expirada faz o servidor devolver uma página
    de login com status 200. Sem checar o cabeçalho `%PDF`, isso vira um
    "material" de 3 KB no acervo.
  - **Legenda ausente.** O item diz `transcribe=done` mas o `.srt` sumiu.

Nada é apagado sem substituto: arquivo reprovado volta para `pending` e o
worker o baixa de novo na próxima passada.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

from . import config, db
from .downloader import duracao_segundos

# Um vídeo de aula abaixo disto é quase certamente erro de download, não aula.
MIN_BYTES_VIDEO = 200_000
MIN_BYTES_PDF = 5_000


class Reprovado(Exception):
    """Motivo pelo qual um item não passou na conferência."""


def _conferir_video(caminho: Path) -> float:
    if caminho.stat().st_size < MIN_BYTES_VIDEO:
        raise Reprovado(f"vídeo com {caminho.stat().st_size} bytes — truncado")
    dur = duracao_segundos(caminho)
    if dur is None:
        raise Reprovado("ffprobe não conseguiu ler o arquivo")
    if dur < 5:
        raise Reprovado(f"duração de {dur:.1f}s — arquivo incompleto")
    return dur


def _conferir_pdf(caminho: Path) -> None:
    tamanho = caminho.stat().st_size
    if tamanho < MIN_BYTES_PDF:
        raise Reprovado(f"PDF com {tamanho} bytes")
    with caminho.open("rb") as f:
        if not f.read(5).startswith(b"%PDF"):
            raise Reprovado("não começa com %PDF — provavelmente página de erro salva como arquivo")


def rodar(conn: sqlite3.Connection, corrigir: bool = True) -> dict[str, int]:
    """Confere todo item `done`. Com `corrigir`, reenfileira o que reprovar."""
    itens = conn.execute(
        """
        SELECT i.id, i.kind, i.rel_path, i.bytes, i.duration, i.transcribe_status
          FROM items i
         WHERE i.download_status = 'done'
         ORDER BY i.id
        """
    ).fetchall()

    r = {"conferidos": 0, "ok": 0, "reprovados": 0, "sem_legenda": 0, "duracao_preenchida": 0}

    for it in itens:
        r["conferidos"] += 1
        caminho = config.REPOSITORY / (it["rel_path"] or "")
        try:
            if not it["rel_path"] or not caminho.exists():
                raise Reprovado("arquivo não está no disco")

            if it["kind"] == "video":
                dur = _conferir_video(caminho)
                # Aproveita a passada para preencher minutagem que faltava.
                if not it["duration"]:
                    conn.execute("UPDATE items SET duration=? WHERE id=?", (dur, it["id"]))
                    r["duracao_preenchida"] += 1

                # Legenda prometida que não existe: só a transcrição volta para
                # a fila; o vídeo em si está bom e não precisa baixar de novo.
                if it["transcribe_status"] == "done":
                    tem = any(
                        caminho.with_suffix(s).exists() for s in (".srt", ".vtt")
                    ) or caminho.with_name(caminho.stem + "-Fala.Cronometrada.txt").exists()
                    if not tem:
                        r["sem_legenda"] += 1
                        if corrigir:
                            db.marcar(conn, it["id"], "transcribe", "pending")
            else:
                _conferir_pdf(caminho)

            # Tamanho no banco pode ter ficado defasado.
            real = caminho.stat().st_size
            if real != it["bytes"]:
                conn.execute("UPDATE items SET bytes=? WHERE id=?", (real, it["id"]))
            r["ok"] += 1

        except Reprovado as e:
            r["reprovados"] += 1
            if corrigir:
                db.marcar(conn, it["id"], "download", "pending", str(e))
                db.log(conn, "error", "verify", f"{caminho.name}: {e} — reenfileirado")

    db.log(conn, "info", "verify",
           f"conferiu {r['conferidos']}: {r['ok']} ok, {r['reprovados']} reprovado(s), "
           f"{r['sem_legenda']} sem legenda, {r['duracao_preenchida']} com minutagem preenchida")
    return r


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser(description="confere a integridade do acervo capturado")
    ap.add_argument("--dry-run", action="store_true", help="só relata, não reenfileira")
    a = ap.parse_args()

    conn = db.connect()
    r = rodar(conn, corrigir=not a.dry_run)
    for k, v in r.items():
        print(f"  {k.replace('_',' '):22} {v}")
    conn.close()
    return 1 if r["reprovados"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

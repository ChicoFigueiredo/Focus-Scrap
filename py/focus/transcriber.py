"""Transcrição por GPU — **fallback**, não caminho padrão.

O manifesto HLS da Focus já traz legenda oficial em português, e o downloader a
salva junto do vídeo. Quando ela existe, o item já sai `transcribe=done` e o
Whisper nem é chamado: a legenda do produtor é melhor que a nossa transcrição e
custa zero de GPU.

Este módulo cobre só o resto — vídeo que veio sem legenda. Gera os três formatos
que o acervo usa: `.srt`, `-Fala.Cronometrada.txt` e `.txt`.

`faster-whisper` e `torch` estão no extra `gpu` do pyproject; se não estiverem
instalados, o worker registra e segue sem transcrever, em vez de quebrar.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

from . import config, db


def _carregar_modelo():
    """Importa em tempo de uso: sem o extra `gpu` instalado isto falha, e falhar
    aqui é melhor do que impedir o downloader de rodar."""
    from faster_whisper import BatchedInferencePipeline, WhisperModel

    modelo = WhisperModel(config.WHISPER_MODEL, device="cuda", compute_type=config.WHISPER_COMPUTE)
    return BatchedInferencePipeline(model=modelo)


def _hms(segundos: float, virgula: bool = True) -> str:
    h, resto = divmod(max(0.0, segundos), 3600)
    m, s = divmod(resto, 60)
    milis = int((s - int(s)) * 1000)
    sep = "," if virgula else "."
    return f"{int(h):02}:{int(m):02}:{int(s):02}{sep}{milis:03}"


def escrever_saidas(trechos: list, destino_base: Path) -> None:
    """Grava os três formatos do acervo a partir dos trechos do Whisper."""
    srt, cron, plano = [], [], []
    for i, t in enumerate(trechos, 1):
        texto = t.text.strip()
        srt.append(f"{i}\n{_hms(t.start)} --> {_hms(t.end)}\n{texto}\n")
        cron.append(f"[{_hms(t.start, False)}] {texto}")
        plano.append(texto)

    destino_base.with_suffix(".srt").write_text("\n".join(srt), encoding="utf-8")
    destino_base.with_name(destino_base.stem + "-Fala.Cronometrada.txt").write_text(
        "\n".join(cron), encoding="utf-8")
    destino_base.with_suffix(".txt").write_text(" ".join(plano), encoding="utf-8")


def processar(conn: sqlite3.Connection, item: sqlite3.Row, pipeline) -> None:
    video = config.REPOSITORY / item["rel_path"]
    if not video.exists():
        db.marcar(conn, item["id"], "transcribe", "error", "vídeo não está no disco")
        return

    db.marcar(conn, item["id"], "transcribe", "running")
    try:
        trechos, _info = pipeline.transcribe(
            str(video),
            language=config.WHISPER_LANGUAGE,
            beam_size=config.WHISPER_BEAM,
            batch_size=config.WHISPER_BATCH,
        )
        escrever_saidas(list(trechos), video)
        db.marcar(conn, item["id"], "transcribe", "done")
        db.log(conn, "info", "transcriber", f"transcreveu {video.name}")
    except Exception as e:
        db.marcar(conn, item["id"], "transcribe", "error", str(e))
        db.log(conn, "error", "transcriber", f"{video.name}: {e}")


def rodar(conn: sqlite3.Connection, limite: int | None = None) -> int:
    pendentes = db.proximas_transcricoes(conn, limite or 500)
    if not pendentes:
        return 0

    try:
        pipeline = _carregar_modelo()
    except Exception as e:
        db.log(conn, "error", "transcriber",
               f"GPU indisponível ({e}) — instale o extra: uv sync --extra gpu")
        return 0

    for item in pendentes:
        processar(conn, item, pipeline)
    return len(pendentes)

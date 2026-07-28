"""Worker de download: vídeo (HLS) e material (PDF).

Vídeo vem em HLS no CloudFront, sem DRM, e o manifesto master já traz a
**legenda oficial em português**. Baixar essa legenda é mais barato e mais fiel
que transcrever com Whisper — por isso a transcrição virou fallback.

Downloads são sequenciais e com limite de banda, no espírito do kultivi:
"baixar aos poucos". Cada `.mp4` é validado com ffprobe antes de virar `done`;
arquivo truncado volta para a fila em vez de virar sucesso falso.
"""
from __future__ import annotations

import json
import re
import shutil
import sqlite3
import subprocess
import time
from pathlib import Path

import requests

from . import config, db


class FalhaDownload(RuntimeError):
    pass


def _exigir(binario: str) -> str:
    caminho = shutil.which(binario)
    if not caminho:
        raise FalhaDownload(f"{binario} não está no PATH")
    return caminho


def duracao_segundos(arquivo: Path) -> float | None:
    """Duração real via ffprobe. `None` se o arquivo não for um vídeo válido."""
    try:
        r = subprocess.run(
            [_exigir("ffprobe"), "-v", "error", "-show_entries", "format=duration",
             "-of", "json", str(arquivo)],
            capture_output=True, text=True, timeout=120,
        )
        if r.returncode != 0:
            return None
        return float(json.loads(r.stdout)["format"]["duration"])
    except Exception:
        return None


RE_FONTE = re.compile(r'<source\b[^>]*\bsrc="([^"]+)"', re.I)


_CABECALHOS = {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://www5.faculdadefocus.com.br/",
}


def _via_api(show_url: str) -> str | None:
    """`/lessons/<id>/api/url` — o endpoint que o próprio player consulta."""
    r = requests.get(show_url.replace("/show", "/api/url"), timeout=45, headers=_CABECALHOS)
    r.raise_for_status()
    return (r.json() or {}).get("url") or None


def _via_source(show_url: str) -> str | None:
    """Tag `<source>` renderizada no servidor."""
    r = requests.get(show_url, timeout=60, headers=_CABECALHOS)
    r.raise_for_status()
    m = RE_FONTE.search(r.text)
    return m.group(1) if m else None


def resolver_iesde(show_url: str, tentativas: int = 4) -> str:
    """Traduz a página `/iesde/lessons/<id>/show` no MP4 de fato.

    O link do vídeo é **assinado e expira** (`qsig=<jwt>` com `exp`), então o
    catálogo guarda a página e não o arquivo — resolver aqui, na hora de baixar,
    é o que evita uma fila que apodrece antes de ser consumida.

    Duas vias, porque nenhuma cobre tudo:

      - `/api/url` é o que o player usa e é o caminho limpo, mas devolve
        `{"url":null}` em parte das aulas;
      - o `<source>` da página cobre essas, mas às vezes vem 200 **sem** a tag
        quando pedimos rápido demais — conferindo na mão, o vídeo estava lá.

    Daí tentar as duas alternadamente, com espera crescente. Desistir na
    primeira falha descartava aula boa como se não tivesse vídeo.
    """
    ultimo = "sem tentativa"
    for n in range(tentativas):
        if n:
            time.sleep(4 * n)
        for via in (_via_api, _via_source):
            try:
                u = via(show_url)
                if u:
                    return u
                ultimo = f"{via.__name__} devolveu vazio"
            except Exception as e:
                ultimo = f"{via.__name__}: {str(e)[:90]}"
    raise FalhaDownload(f"não resolvi {show_url} em {tentativas} rodadas — {ultimo}")


def baixar_video(manifesto: str, destino: Path) -> tuple[int, float]:
    """Baixa o vídeo e a legenda oficial. Devolve (bytes, duração)."""
    if "/iesde/lessons/" in manifesto:
        manifesto = resolver_iesde(manifesto)

    destino.parent.mkdir(parents=True, exist_ok=True)
    parcial = destino.with_suffix(destino.suffix + ".parcial")
    parcial.unlink(missing_ok=True)

    cmd = [
        _exigir("yt-dlp"),
        "--no-playlist",
        "--newline",
        "--retries", "5",
        "--fragment-retries", "10",
        "--limit-rate", config.DOWNLOAD_RATE_LIMIT,
        "-f", config.YTDLP_FORMAT,
        "--merge-output-format", "mp4",
        # A legenda vem embutida no manifesto HLS; converte para .srt, que é o
        # formato que o acervo já usa.
        "--write-subs", "--sub-langs", "por,pt,pt-BR,pt.*",
        "--convert-subs", "srt",
        "-o", str(parcial),
        manifesto,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
    if r.returncode != 0:
        parcial.unlink(missing_ok=True)
        raise FalhaDownload((r.stderr or r.stdout or "yt-dlp falhou")[-400:])

    # yt-dlp pode acrescentar extensão ao nome; encontra o que ele de fato criou.
    gerado = parcial if parcial.exists() else next(
        iter(sorted(parcial.parent.glob(parcial.name + "*"), key=lambda p: -p.stat().st_size)), None)
    if not gerado or gerado.stat().st_size == 0:
        raise FalhaDownload("yt-dlp terminou sem produzir arquivo")

    dur = duracao_segundos(gerado)
    if dur is None:
        gerado.unlink(missing_ok=True)
        raise FalhaDownload("ffprobe rejeitou o arquivo (truncado ou corrompido)")

    gerado.replace(destino)

    # Move a legenda para o nome do acervo: <mesmo prefixo>.srt
    for srt in parcial.parent.glob(parcial.stem + "*.srt"):
        srt.replace(destino.with_suffix(".srt"))
        break

    return destino.stat().st_size, dur


def baixar_arquivo(url: str, destino: Path) -> int:
    """Download direto (PDF). O `componente.php?saida=arquivo` já devolve o cru."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    parcial = destino.with_suffix(destino.suffix + ".parcial")
    with requests.get(url, stream=True, timeout=300,
                      headers={"User-Agent": "Mozilla/5.0",
                               "Referer": "https://faculdadefocus.com.br/"}) as r:
        # PDF do IESDE vem por URL assinada com validade curta. Se o catálogo é
        # de horas atrás, a assinatura já morreu — e o erro precisa dizer o que
        # fazer, não só "403".
        if r.status_code == 403 and "qsig=" in url:
            raise FalhaDownload(
                "URL assinada expirou (qsig) — rode 'Catalogar' de novo para renovar e baixe em seguida")
        r.raise_for_status()
        with parcial.open("wb") as f:
            for pedaco in r.iter_content(chunk_size=1 << 16):
                f.write(pedaco)

    if parcial.stat().st_size == 0:
        parcial.unlink(missing_ok=True)
        raise FalhaDownload("arquivo veio vazio")

    cabecalho = parcial.open("rb").read(5)
    if destino.suffix.lower() == ".pdf" and not cabecalho.startswith(b"%PDF"):
        parcial.unlink(missing_ok=True)
        raise FalhaDownload(f"não é PDF (começa com {cabecalho!r}) — sessão expirada?")

    parcial.replace(destino)
    return destino.stat().st_size


def processar(conn: sqlite3.Connection, item: sqlite3.Row) -> None:
    """Executa um item da fila e grava o resultado."""
    destino = config.REPOSITORY / item["rel_path"]
    db.marcar(conn, item["id"], "download", "running")

    try:
        if item["kind"] == "video":
            tamanho, dur = baixar_video(item["source_url"], destino)
            db.marcar(conn, item["id"], "download", "done", None, bytes=tamanho, duration=dur)
            # Legenda oficial baixada junto dispensa o Whisper.
            if destino.with_suffix(".srt").exists():
                db.marcar(conn, item["id"], "transcribe", "done")
            db.log(conn, "info", "downloader",
                   f"{destino.name} — {tamanho/1e6:.1f} MB, {dur/60:.1f} min")

        elif item["kind"] == "pdf":
            tamanho = baixar_arquivo(item["source_url"], destino)
            db.marcar(conn, item["id"], "download", "done", None, bytes=tamanho)
            db.marcar(conn, item["id"], "transcribe", "skipped")
            db.log(conn, "info", "downloader", f"{destino.name} — {tamanho/1e6:.1f} MB")

        else:
            # "Livro Digital" é visualizador paginado por imagem, não arquivo.
            # Fica registrado como pulado em vez de erro: não é falha, é formato
            # que ainda não sabemos capturar.
            db.marcar(conn, item["id"], "download", "skipped",
                      "livro digital é visualizador paginado — captura não implementada")
            db.marcar(conn, item["id"], "transcribe", "skipped")

    except Exception as e:
        db.marcar(conn, item["id"], "download", "error", str(e))
        db.log(conn, "error", "downloader", f"{destino.name}: {e}")


def rodar(conn: sqlite3.Connection, limite: int | None = None) -> int:
    """Consome a fila de download. Devolve quantos itens processou."""
    feitos = 0
    for item in db.iter_pendentes(conn, db.proximos_downloads):
        if limite is not None and feitos >= limite:
            break
        processar(conn, item)
        feitos += 1
        if item["kind"] == "video":
            time.sleep(config.DELAY_BETWEEN_DOWNLOADS)   # baixar aos poucos
    return feitos

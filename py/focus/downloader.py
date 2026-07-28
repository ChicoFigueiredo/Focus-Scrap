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


# --- Estratégias de download -------------------------------------------------
#
# Uma ferramenta só é um ponto único de falha. Cada estratégia abaixo baixa
# `url` em `parcial` ou levanta exceção; `baixar_video` tenta na ordem e
# registra qual funcionou, para a próxima vez começar pela que costuma resolver.


def _http_direto(url: str, parcial: Path) -> None:
    """Streaming HTTP puro — o caminho certo para MP4 direto (IESDE).

    Retoma de onde parou via `Range`, então uma queda no meio de um arquivo de
    200 MB não recomeça do zero. Não serve para HLS, que é lista de segmentos.
    """
    ja = parcial.stat().st_size if parcial.exists() else 0
    cab = dict(_CABECALHOS)
    if ja:
        cab["Range"] = f"bytes={ja}-"

    with requests.get(url, stream=True, timeout=300, headers=cab) as r:
        if ja and r.status_code == 200:
            ja = 0                      # servidor ignorou o Range: recomeça
            parcial.unlink(missing_ok=True)
        elif ja and r.status_code != 206:
            r.raise_for_status()
        else:
            r.raise_for_status()

        limite = _bytes_por_segundo()
        with parcial.open("ab" if ja else "wb") as f:
            inicio = time.monotonic()
            escritos = 0
            for pedaco in r.iter_content(chunk_size=1 << 16):
                f.write(pedaco)
                escritos += len(pedaco)
                # "baixar aos poucos": respeita o mesmo limite do yt-dlp.
                if limite:
                    esperado = escritos / limite
                    atraso = esperado - (time.monotonic() - inicio)
                    if atraso > 0:
                        time.sleep(atraso)


def _com_ytdlp(url: str, parcial: Path) -> None:
    """yt-dlp — obrigatório em HLS, e é quem traz a legenda oficial embutida."""
    cmd = [
        _exigir("yt-dlp"),
        "--no-playlist", "--newline",
        "--retries", "5", "--fragment-retries", "10",
        "--limit-rate", config.DOWNLOAD_RATE_LIMIT,
        "-f", config.YTDLP_FORMAT,
        "--merge-output-format", "mp4",
        # A legenda vem embutida no manifesto HLS; converte para .srt, que é o
        # formato que o acervo já usa.
        "--write-subs", "--sub-langs", "por,pt,pt-BR,pt.*",
        "--convert-subs", "srt",
        "-o", str(parcial),
        url,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
    if r.returncode != 0:
        raise FalhaDownload((r.stderr or r.stdout or "yt-dlp falhou")[-300:])


def _com_ffmpeg(url: str, parcial: Path) -> None:
    """ffmpeg — segunda opinião para HLS e para MP4 que o yt-dlp recuse.

    Remuxa sem recodificar (`-c copy`), então é rápido e não perde qualidade.
    Não traz legenda; quando é ele que salva o download, a transcrição fica
    para o Whisper.
    """
    saida = parcial.with_suffix(".mp4") if parcial.suffix != ".mp4" else parcial
    cmd = [
        _exigir("ffmpeg"), "-y", "-loglevel", "error",
        "-headers", f"Referer: {_CABECALHOS['Referer']}\r\nUser-Agent: {_CABECALHOS['User-Agent']}\r\n",
        "-i", url, "-c", "copy", "-bsf:a", "aac_adtstoasc", str(saida),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
    if r.returncode != 0:
        raise FalhaDownload((r.stderr or "ffmpeg falhou")[-300:])
    if saida != parcial:
        saida.replace(parcial)


def _bytes_por_segundo() -> float:
    """Traduz "3M" do config em bytes/s. 0 desliga o limite."""
    v = (config.DOWNLOAD_RATE_LIMIT or "").strip().upper()
    if not v:
        return 0
    mult = {"K": 1 << 10, "M": 1 << 20, "G": 1 << 30}.get(v[-1:], 1)
    try:
        return float(v.rstrip("KMG")) * mult
    except ValueError:
        return 0


def _estrategias(url: str) -> list:
    """HLS é lista de segmentos: só ferramenta que entende o formato serve.
    MP4 direto começa pelo HTTP puro, que é mais simples e retomável."""
    if ".m3u8" in url:
        return [_com_ytdlp, _com_ffmpeg]
    return [_http_direto, _com_ytdlp, _com_ffmpeg]


def baixar_video(manifesto: str, destino: Path,
                 registrar=None) -> tuple[int, float]:
    """Baixa o vídeo e a legenda oficial. Devolve (bytes, duração)."""
    if "/iesde/lessons/" in manifesto:
        manifesto = resolver_iesde(manifesto)

    destino.parent.mkdir(parents=True, exist_ok=True)
    parcial = destino.with_suffix(destino.suffix + ".parcial")

    falhas: list[str] = []
    gerado = None
    for estrategia in _estrategias(manifesto):
        nome = estrategia.__name__.strip("_")
        try:
            estrategia(manifesto, parcial)
            # yt-dlp pode acrescentar extensão ao nome; acha o que criou.
            gerado = parcial if parcial.exists() else next(
                iter(sorted(parcial.parent.glob(parcial.name + "*"),
                            key=lambda p: -p.stat().st_size)), None)
            if not gerado or gerado.stat().st_size == 0:
                raise FalhaDownload("terminou sem produzir arquivo")
            if duracao_segundos(gerado) is None:
                raise FalhaDownload("ffprobe rejeitou o arquivo (truncado ou corrompido)")
            if registrar:
                registrar(f"{destino.name}: baixado por {nome}" +
                          (f" (após {', '.join(falhas)})" if falhas else ""))
            break
        except Exception as e:
            falhas.append(f"{nome}: {str(e)[:90]}")
            # Restos de tentativa fracassada envenenariam a próxima.
            for lixo in parcial.parent.glob(parcial.name + "*"):
                lixo.unlink(missing_ok=True)
            gerado = None

    if not gerado:
        raise FalhaDownload("todas as estratégias falharam — " + " | ".join(falhas))

    dur = duracao_segundos(gerado)
    gerado.replace(destino)

    # Move a legenda para o nome do acervo: <mesmo prefixo>.srt
    for srt in parcial.parent.glob(parcial.stem + "*.srt"):
        srt.replace(destino.with_suffix(".srt"))
        break

    return destino.stat().st_size, float(dur or 0)


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
            tamanho, dur = baixar_video(
                item["source_url"], destino,
                registrar=lambda m: db.log(conn, "info", "downloader", m))
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

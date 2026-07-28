"""Extrai texto de um PDF (URL ou caminho) — usado pelo agente do lado TypeScript.

O agente precisa do SUMÁRIO do material para deduzir os títulos das aulas, e a
extração de PDF vive no Python (pypdf já está nas dependências). O TS chama
isto por subprocesso em vez de ganhar uma biblioteca de PDF só para isso.

    uv run python -m focus.pdftext <url|caminho> [--pages 10]
"""
from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

import requests
from pypdf import PdfReader

from . import config


def carregar(origem: str, timeout: int = 120) -> bytes:
    if origem.startswith(("http://", "https://")):
        r = requests.get(origem, headers={"User-Agent": config.ENV.get("FOCUS_UA", "Mozilla/5.0")},
                         timeout=timeout)
        r.raise_for_status()
        return r.content
    return Path(origem).read_bytes()


def texto(origem: str, paginas: int = 10) -> str:
    """Texto das primeiras `paginas` páginas. É onde ficam capa e sumário."""
    leitor = PdfReader(io.BytesIO(carregar(origem)))
    partes = []
    for p in leitor.pages[:paginas]:
        try:
            partes.append(p.extract_text() or "")
        except Exception as e:                      # PDF quebrado não derruba o pipeline
            partes.append(f"[falha ao extrair página: {e}]")
    return "\n".join(partes)


def main() -> int:
    ap = argparse.ArgumentParser(description="extrai texto de um PDF")
    ap.add_argument("origem", help="URL ou caminho do PDF")
    ap.add_argument("--pages", type=int, default=10)
    a = ap.parse_args()
    try:
        sys.stdout.write(texto(a.origem, a.pages))
        return 0
    except Exception as e:
        print(f"erro: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

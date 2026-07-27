"""Configuração central do focus-scrap (lado Python: download e transcrição).

Espelha `src/config.ts` — os dois leem o mesmo `.env` da raiz. Variável nova
entra nos dois arquivos e no `.env.example`.
"""
from __future__ import annotations

import os
from pathlib import Path

# --- Caminhos ------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent.parent   # raiz do projeto
ENV_FILE = BASE_DIR / ".env"
DB_PATH = BASE_DIR / "focus.db"
STATE_DIR = BASE_DIR / "state"
REPOSITORY = BASE_DIR / "repository"                        # symlink -> /mnt/e/Marketing/Focus


def _load_env(path: Path = ENV_FILE) -> dict[str, str]:
    """Lê um .env simples (KEY=VALUE) sem dependências externas."""
    data: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            data[k.strip()] = v.strip().strip('"').strip("'")
    data.update({k: v for k, v in os.environ.items() if k.startswith("FOCUS_")})
    if os.environ.get("OPENROUTER_API_KEY"):
        data["OPENROUTER_API_KEY"] = os.environ["OPENROUTER_API_KEY"]
    return data


ENV = _load_env()

# --- Download ------------------------------------------------------------
# mp4 até 720p: bom para transcrição e arquivo enxuto.
YTDLP_FORMAT = "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]/b"
DOWNLOAD_RATE_LIMIT = ENV.get("FOCUS_RATE_LIMIT", "3M")
DELAY_BETWEEN_DOWNLOADS = float(ENV.get("FOCUS_DELAY", "20"))
MAX_DOWNLOAD_ATTEMPTS = 4

# --- Transcrição ---------------------------------------------------------
WHISPER_MODEL = ENV.get("FOCUS_WHISPER_MODEL", "large-v3")
WHISPER_COMPUTE = ENV.get("FOCUS_WHISPER_COMPUTE", "float16")   # RTX 4080 aguenta float16
WHISPER_BATCH = int(ENV.get("FOCUS_WHISPER_BATCH", "16"))
WHISPER_BEAM = 5
WHISPER_LANGUAGE = ENV.get("FOCUS_WHISPER_LANGUAGE", "pt")


def ensure_dirs() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)

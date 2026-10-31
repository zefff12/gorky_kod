"""Настройки из переменных окружения"""
from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

BASE_DIR = Path(__file__).resolve().parent.parent

DB_PATH = Path(os.getenv("DB_PATH", BASE_DIR / "data" / "assistant.db"))
SEED_DEMO = os.getenv("SEED_DEMO", "0") == "1"
SEED_CSV = Path(os.getenv("SEED_CSV", BASE_DIR / "data" / "voice_assistant_events_1000.csv"))
TIMEZONE = ZoneInfo(os.getenv("APP_TZ", "Europe/Moscow"))

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "claude-haiku-5-5")
LLM_TIMEOUT_S = float(os.getenv("LLM_TIMEOUT_S", "15"))
USE_LLM = bool(ANTHROPIC_API_KEY) and os.getenv("USE_LLM", "1") != "0"

SEMANTIC_SEARCH = os.getenv("SEMANTIC_SEARCH", "1") != "0"
MODEL_CACHE = os.getenv("MODEL_CACHE", str(BASE_DIR / "data" / "models"))

_FAKE_NOW = os.getenv("FAKE_NOW")


def now() -> datetime:
    """Текущее локальное время пользователя"""
    if _FAKE_NOW:
        return datetime.fromisoformat(_FAKE_NOW)
    return datetime.now(TIMEZONE).replace(tzinfo=None, microsecond=0)

import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ.setdefault("DB_PATH", str(Path(tempfile.mkdtemp()) / "test.db"))
os.environ.setdefault("FAKE_NOW", "2026-10-15T11:20")
os.environ["USE_LLM"] = "0"
os.environ["SEMANTIC_SEARCH"] = "0" 

from app.assistant import Assistant  
from app.seed import seed_if_empty  
from app.storage import Storage  

NOW = datetime(2026, 10, 15, 11, 20)
CSV = ROOT / "data" / "voice_assistant_events_1000.csv"


@pytest.fixture
def storage():
    return Storage(":memory:")


@pytest.fixture
def bot(storage):
    return Assistant(storage, clock=lambda: NOW)


@pytest.fixture
def seeded_bot():
    st = Storage(":memory:")
    seed_if_empty(st, CSV)
    return Assistant(st, clock=lambda: NOW)

"""Правки из «Исправления (3)»: название в правильном падеже для любых фраз; у повторяющейся
записи выполненным отмечается и удаляется отдельный день, а не вся серия."""
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app import config
from app.main import app
from app.nlu import rules

NOW = datetime(2026, 10, 31, 12, 0)
TODAY = config.now().date()


@pytest.mark.parametrize("text, title", [
    ("поставь мне поездку в москву завтра в 6 вечера", "Поездка в Москву"),
    ("Добавь стрижку в субботу в 12", "Стрижка"),
    ("Запиши тренировку в зале завтра в 19", "Тренировка в зале"),
    ("Поставь большую стирку завтра в 9", "Большая стирка"),
    ("запланируй презентацию проекта в пятницу в 11", "Презентация проекта"),
    ("Добавь встречу с иваном завтра в 15", "Встреча с Иваном"),
    ("Запиши маму к врачу завтра в 10", "Записать маму к врачу"),
    ("Поставь позвонить Ивану завтра в 10", "Позвонить Ивану"),
    ("Напомни купить хлеб в 18", "Купить хлеб"),
    ("Поставь звонок в банк завтра в 10", "Звонок в банк"),
    ("Йога каждый понедельник в 8", "Йога"),
])
def test_title_in_nominative(text, title):
    assert rules.parse(text, NOW).title == title


def _daily(c, h):
    r = c.post("/api/message", json={"text": "Поставь ежедневную задачу на прогулку с собакой в 15:00"}, headers=h).json()
    return r["events"][0]["id"]


def _day(c, h, eid, day):
    items = c.get("/api/items", params={"start": day.isoformat(), "end": day.isoformat()}, headers=h).json()
    return next((e for e in items if e["id"] == eid), None)


def test_done_marks_only_one_day_of_series():
    c, h = TestClient(app), {"X-User-Id": "u-occ-done"}
    eid = _daily(c, h)
    tomorrow = TODAY + timedelta(days=1)
    r = c.patch(f"/api/events/{eid}", json={"done": True, "date": tomorrow.isoformat()}, headers=h)
    assert r.status_code == 200 and r.json()["done"] and r.json()["date"] == tomorrow.isoformat()
    assert _day(c, h, eid, tomorrow)["done"] is True
    assert _day(c, h, eid, tomorrow + timedelta(days=1))["done"] is False      # соседние дни не тронуты
    done = c.get("/api/items", params={"status": "done"}, headers=h).json()
    assert [(e["id"], e["date"]) for e in done] == [(eid, tomorrow.isoformat())]
    c.patch(f"/api/events/{eid}", json={"done": False, "date": tomorrow.isoformat()}, headers=h)
    assert _day(c, h, eid, tomorrow)["done"] is False


def test_delete_one_day_of_series():
    c, h = TestClient(app), {"X-User-Id": "u-occ-del"}
    eid = _daily(c, h)
    day = TODAY + timedelta(days=4)
    assert c.delete(f"/api/events/{eid}", params={"date": day.isoformat()}, headers=h).json()["skipped"] == day.isoformat()
    assert _day(c, h, eid, day) is None
    assert _day(c, h, eid, day + timedelta(days=1)) is not None
    c.delete(f"/api/events/{eid}", headers=h)                                   # без даты — вся серия
    assert c.get("/api/items", headers=h).json() == []


def test_voice_delete_one_day():
    c, h = TestClient(app), {"X-User-Id": "u-occ-voice"}
    eid = _daily(c, h)
    day = TODAY + timedelta(days=4)
    r = c.post("/api/message", json={"text": f"удали {day.day} {_month(day)} прогулку с собакой"}, headers=h).json()
    assert r["awaiting"] == "confirm_delete" and "только" in r["text"]
    r = c.post("/api/message", json={"text": "да"}, headers=h).json()
    assert "остальные дни" in r["text"]
    assert _day(c, h, eid, day) is None and _day(c, h, eid, day + timedelta(days=1)) is not None


def test_voice_only_that_day_answer():
    """«Удалить всю серию?» → «нет, только 4 ноября» удаляет один день."""
    c, h = TestClient(app), {"X-User-Id": "u-occ-only"}
    eid = _daily(c, h)
    r = c.post("/api/message", json={"text": "удали прогулку с собакой"}, headers=h).json()
    assert r["awaiting"] == "confirm_delete" and "повтор" in r["text"]
    day = TODAY + timedelta(days=4)
    r = c.post("/api/message", json={"text": f"нет, только {day.day} {_month(day)}"}, headers=h).json()
    assert r["intent"] == "delete" and "остальные дни" in r["text"]
    assert _day(c, h, eid, day) is None and _day(c, h, eid, day + timedelta(days=1)) is not None


def test_voice_complete_marks_today_only():
    c, h = TestClient(app), {"X-User-Id": "u-occ-complete"}
    eid = _daily(c, h)
    r = c.post("/api/message", json={"text": "отметь прогулку с собакой выполненной"}, headers=h).json()
    assert r["intent"] == "complete" and "другие дни" in r["text"]
    assert _day(c, h, eid, TODAY)["done"] is True
    assert _day(c, h, eid, TODAY + timedelta(days=1))["done"] is False


def test_backup_keeps_series_marks():
    c, h = TestClient(app), {"X-User-Id": "u-occ-backup"}
    eid = _daily(c, h)
    tomorrow = TODAY + timedelta(days=1)
    c.patch(f"/api/events/{eid}", json={"done": True, "date": tomorrow.isoformat()}, headers=h)
    c.delete(f"/api/events/{eid}", params={"date": (TODAY + timedelta(days=2)).isoformat()}, headers=h)
    backup = c.get("/api/export", headers=h).json()
    h2 = {"X-User-Id": "u-occ-backup2"}
    assert c.post("/api/import", json=backup, headers=h2).status_code == 200
    [new] = c.get("/api/items", headers=h2).json()
    assert _day(c, h2, new["id"], tomorrow)["done"] is True
    assert _day(c, h2, new["id"], TODAY + timedelta(days=2)) is None


MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября",
          "ноября", "декабря"]


def _month(d: date) -> str:
    return MONTHS[d.month - 1]

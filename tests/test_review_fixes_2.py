"""Правки из «Исправления (2)»: название задачи отделяется от самой просьбы и ставится
в именительный падеж, «ежедневную задачу» понимаем как повтор, «и напоминай мне об этом» —
как просьбу создать напоминание."""
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import EventType, Recurrence
from app.nlu import rules

NOW = datetime(2026, 10, 31, 12, 0)


@pytest.mark.parametrize("text, title", [
    ("Поставь мне ежедневную задачу на прогулку с собакой в 15:00 и Напоминай мне об этом", "Прогулка с собакой"),
    ("Поставь задачу на вечернюю пробежку завтра в 19", "Вечерняя пробежка"),
    ("Создай напоминание про оплату интернета завтра в 10", "Оплата интернета"),
    ("Напомни о звонке маме завтра в 9", "Звонок маме"),
    ("Напомни об оплате квартиры в пятницу в 10", "Оплата квартиры"),
    ("Поставь задачу на понедельник позвонить Ивану в 10", "Позвонить Ивану"),
    ("Йога каждый понедельник в 8", "Йога"),
])
def test_title_is_separated_from_request(text, title):
    assert rules.parse(text, NOW).title == title


def test_daily_task_with_reminder_is_parsed():
    cmd = rules.parse("Поставь мне ежедневную задачу на прогулку с собакой в 15:00 и Напоминай мне об этом", NOW)
    assert cmd.event_type is EventType.TASK
    assert cmd.recurrence is Recurrence.DAILY
    assert cmd.time.strftime("%H:%M") == "15:00"
    assert cmd.extras.get("also_remind") is True


@pytest.mark.parametrize("word, rec", [("ежедневную", Recurrence.DAILY), ("еженедельную", Recurrence.WEEKLY)])
def test_recurrence_adjectives(word, rec):
    assert rules.parse(f"Поставь {word} задачу на уборку в 11", NOW).recurrence is rec


def test_also_remind_creates_task_and_reminder():
    c = TestClient(app)
    h = {"X-User-Id": "u-alsoremind"}
    r = c.post("/api/message", json={"text": "Поставь мне ежедневную задачу на прогулку с собакой в 15:00 "
                                             "и Напоминай мне об этом"}, headers=h).json()
    assert [(e["type"], e["title"], e["recurrence"]) for e in r["events"]] == [
        ("task", "Прогулка с собакой", "daily"), ("reminder", "Прогулка с собакой", "daily")]
    assert "Напомню" in r["text"]


def test_meeting_with_reminder_stays_meeting():
    c = TestClient(app)
    h = {"X-User-Id": "u-meetremind"}
    r = c.post("/api/message", json={"text": "Добавь встречу с Иваном завтра в 12 и напомни мне об этом"}, headers=h).json()
    assert [e["type"] for e in r["events"]] == ["meeting", "reminder"]


def test_done_items_listed_separately():
    c = TestClient(app)
    h = {"X-User-Id": "u-donelist"}
    for text in ["Напомни завтра в 10 позвонить Ивану", "Поставь задачу сдать отчёт завтра в 12"]:
        c.post("/api/message", json={"text": text}, headers=h)
    items = c.get("/api/items", headers=h).json()
    c.patch(f"/api/events/{items[0]['id']}", json={"done": True}, headers=h)
    done = c.get("/api/items", params={"status": "done"}, headers=h).json()
    active = c.get("/api/items", params={"status": "active"}, headers=h).json()
    assert [e["id"] for e in done] == [items[0]["id"]]
    assert items[0]["id"] not in [e["id"] for e in active]

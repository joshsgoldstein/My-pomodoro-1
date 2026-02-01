"""SQLite persistence layer using two tables: kv and events."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from models import Config, Event, State

DB_PATH = Path("data/pomodoro.db")


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    conn = _connect()
    conn.execute(
        "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS events ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  ts TEXT NOT NULL,"
        "  type TEXT NOT NULL,"
        "  payload TEXT NOT NULL"
        ")"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS plans ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  date TEXT NOT NULL,"
        "  start_hour INTEGER NOT NULL,"
        "  start_min INTEGER NOT NULL DEFAULT 0,"
        "  duration_min INTEGER NOT NULL DEFAULT 25,"
        "  mode TEXT NOT NULL DEFAULT 'work',"
        "  intent TEXT NOT NULL DEFAULT ''"
        ")"
    )
    conn.commit()
    conn.close()


# --- KV helpers ---

def _get_kv(key: str) -> dict | None:
    conn = _connect()
    row = conn.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
    conn.close()
    if row is None:
        return None
    return json.loads(row[0])


def _set_kv(key: str, value: dict) -> None:
    conn = _connect()
    conn.execute(
        "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, json.dumps(value)),
    )
    conn.commit()
    conn.close()


# --- State ---

def load_state() -> State:
    d = _get_kv("state")
    if d is None:
        return State()
    return State.from_dict(d)


def save_state(state: State) -> None:
    _set_kv("state", state.to_dict())


# --- Config ---

def load_config() -> Config:
    d = _get_kv("config")
    if d is None:
        return Config()
    return Config.from_dict(d)


def save_config(config: Config) -> None:
    _set_kv("config", config.to_dict())


# --- Events ---

def insert_event(ts: str, event_type: str, payload: dict[str, Any]) -> Event:
    conn = _connect()
    cur = conn.execute(
        "INSERT INTO events (ts, type, payload) VALUES (?, ?, ?)",
        (ts, event_type, json.dumps(payload)),
    )
    event_id = cur.lastrowid
    conn.commit()
    conn.close()
    return Event(id=event_id, ts=ts, type=event_type, payload=payload)


def get_events(limit: int = 100, since: str | None = None) -> list[Event]:
    conn = _connect()
    if since:
        rows = conn.execute(
            "SELECT id, ts, type, payload FROM events WHERE ts > ? ORDER BY id DESC LIMIT ?",
            (since, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, ts, type, payload FROM events ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    conn.close()
    return [Event(id=r[0], ts=r[1], type=r[2], payload=json.loads(r[3])) for r in rows]


def get_today_events(date_str: str) -> list[Event]:
    """Return all events whose ts starts with the given date (YYYY-MM-DD)."""
    conn = _connect()
    rows = conn.execute(
        "SELECT id, ts, type, payload FROM events WHERE ts >= ? AND ts < ? ORDER BY id DESC",
        (date_str + "T00:00:00", date_str + "T99:99:99"),
    ).fetchall()
    conn.close()
    return [Event(id=r[0], ts=r[1], type=r[2], payload=json.loads(r[3])) for r in rows]


# --- Plans ---

def get_plans(date_str: str) -> list[dict]:
    conn = _connect()
    rows = conn.execute(
        "SELECT id, date, start_hour, start_min, duration_min, mode, intent "
        "FROM plans WHERE date = ? ORDER BY start_hour, start_min",
        (date_str,),
    ).fetchall()
    conn.close()
    return [
        {"id": r[0], "date": r[1], "start_hour": r[2], "start_min": r[3],
         "duration_min": r[4], "mode": r[5], "intent": r[6]}
        for r in rows
    ]


def add_plan(date_str: str, start_hour: int, start_min: int,
             duration_min: int, mode: str, intent: str) -> dict:
    conn = _connect()
    cur = conn.execute(
        "INSERT INTO plans (date, start_hour, start_min, duration_min, mode, intent) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (date_str, start_hour, start_min, duration_min, mode, intent),
    )
    plan_id = cur.lastrowid
    conn.commit()
    conn.close()
    return {"id": plan_id, "date": date_str, "start_hour": start_hour,
            "start_min": start_min, "duration_min": duration_min,
            "mode": mode, "intent": intent}


def delete_plan(plan_id: int) -> bool:
    conn = _connect()
    cur = conn.execute("DELETE FROM plans WHERE id = ?", (plan_id,))
    conn.commit()
    conn.close()
    return cur.rowcount > 0

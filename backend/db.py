"""SQLite persistence layer using two tables: kv and events."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from models import Config, Event, State, Task

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
        "CREATE TABLE IF NOT EXISTS tasks ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  title TEXT NOT NULL,"
        "  estimate_pomodoros INTEGER NOT NULL DEFAULT 1,"
        "  spent_pomodoros INTEGER NOT NULL DEFAULT 0,"
        "  status TEXT NOT NULL DEFAULT 'active',"
        "  created_at TEXT NOT NULL,"
        "  completed_at TEXT,"
        "  sort_order INTEGER NOT NULL DEFAULT 0"
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


def get_events_since(since_ts: str) -> list[Event]:
    """Return all events with ts >= since_ts, oldest first (for multi-day stats)."""
    conn = _connect()
    rows = conn.execute(
        "SELECT id, ts, type, payload FROM events WHERE ts >= ? ORDER BY id ASC",
        (since_ts,),
    ).fetchall()
    conn.close()
    return [Event(id=r[0], ts=r[1], type=r[2], payload=json.loads(r[3])) for r in rows]


# --- Tasks ---

_TASK_COLS = (
    "id, title, estimate_pomodoros, spent_pomodoros, status, "
    "created_at, completed_at, sort_order"
)


def list_tasks(include_done: bool = True) -> list[Task]:
    conn = _connect()
    sql = f"SELECT {_TASK_COLS} FROM tasks"
    if not include_done:
        sql += " WHERE status != 'done'"
    sql += " ORDER BY status = 'done', sort_order, id"
    rows = conn.execute(sql).fetchall()
    conn.close()
    return [Task.from_row(r) for r in rows]


def get_task(task_id: int) -> Task | None:
    conn = _connect()
    row = conn.execute(
        f"SELECT {_TASK_COLS} FROM tasks WHERE id = ?", (task_id,)
    ).fetchone()
    conn.close()
    return Task.from_row(row) if row else None


def create_task(title: str, estimate_pomodoros: int, created_at: str) -> Task:
    conn = _connect()
    next_order = conn.execute(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks"
    ).fetchone()[0]
    cur = conn.execute(
        "INSERT INTO tasks (title, estimate_pomodoros, spent_pomodoros, status, "
        "created_at, completed_at, sort_order) VALUES (?, ?, 0, 'active', ?, NULL, ?)",
        (title, estimate_pomodoros, created_at, next_order),
    )
    task_id = cur.lastrowid
    conn.commit()
    conn.close()
    return get_task(task_id)


def update_task(task_id: int, **fields) -> Task | None:
    allowed = {
        "title", "estimate_pomodoros", "spent_pomodoros",
        "status", "completed_at", "sort_order",
    }
    sets = {k: v for k, v in fields.items() if k in allowed}
    if not sets:
        return get_task(task_id)
    conn = _connect()
    assignments = ", ".join(f"{k} = ?" for k in sets)
    conn.execute(
        f"UPDATE tasks SET {assignments} WHERE id = ?",
        (*sets.values(), task_id),
    )
    conn.commit()
    conn.close()
    return get_task(task_id)


def increment_task_spent(task_id: int) -> Task | None:
    conn = _connect()
    conn.execute(
        "UPDATE tasks SET spent_pomodoros = spent_pomodoros + 1 WHERE id = ?",
        (task_id,),
    )
    conn.commit()
    conn.close()
    return get_task(task_id)


def delete_task(task_id: int) -> None:
    conn = _connect()
    conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()


# --- Planner config & day plans (stored in kv) ---

def load_planner_config() -> dict | None:
    return _get_kv("planner_config")


def save_planner_config(cfg: dict) -> None:
    _set_kv("planner_config", cfg)


def load_plan(date_str: str) -> dict | None:
    return _get_kv(f"plan:{date_str}")


def save_plan(date_str: str, plan: dict) -> None:
    _set_kv(f"plan:{date_str}", plan)

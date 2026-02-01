from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any


# --- Config ---

DEFAULT_WORK_SEC = 1500
DEFAULT_SHORT_BREAK_SEC = 300
DEFAULT_LONG_BREAK_SEC = 900
DEFAULT_CYCLES_BEFORE_LONG_BREAK = 4

# Schedule defaults (9-to-5 workday, lunch at noon)
DEFAULT_DAY_START_HOUR = 9
DEFAULT_DAY_START_MIN = 0
DEFAULT_DAY_END_HOUR = 17
DEFAULT_DAY_END_MIN = 0
DEFAULT_LUNCH_HOUR = 12
DEFAULT_LUNCH_MIN = 0
DEFAULT_LUNCH_DURATION_MIN = 60


@dataclass
class Config:
    work_sec: int = DEFAULT_WORK_SEC
    short_break_sec: int = DEFAULT_SHORT_BREAK_SEC
    long_break_sec: int = DEFAULT_LONG_BREAK_SEC
    cycles_before_long_break: int = DEFAULT_CYCLES_BEFORE_LONG_BREAK
    day_start_hour: int = DEFAULT_DAY_START_HOUR
    day_start_min: int = DEFAULT_DAY_START_MIN
    day_end_hour: int = DEFAULT_DAY_END_HOUR
    day_end_min: int = DEFAULT_DAY_END_MIN
    lunch_hour: int = DEFAULT_LUNCH_HOUR
    lunch_min: int = DEFAULT_LUNCH_MIN
    lunch_duration_min: int = DEFAULT_LUNCH_DURATION_MIN

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> Config:
        return cls(
            work_sec=d.get("work_sec", DEFAULT_WORK_SEC),
            short_break_sec=d.get("short_break_sec", DEFAULT_SHORT_BREAK_SEC),
            long_break_sec=d.get("long_break_sec", DEFAULT_LONG_BREAK_SEC),
            cycles_before_long_break=d.get("cycles_before_long_break", DEFAULT_CYCLES_BEFORE_LONG_BREAK),
            day_start_hour=d.get("day_start_hour", DEFAULT_DAY_START_HOUR),
            day_start_min=d.get("day_start_min", DEFAULT_DAY_START_MIN),
            day_end_hour=d.get("day_end_hour", DEFAULT_DAY_END_HOUR),
            day_end_min=d.get("day_end_min", DEFAULT_DAY_END_MIN),
            lunch_hour=d.get("lunch_hour", DEFAULT_LUNCH_HOUR),
            lunch_min=d.get("lunch_min", DEFAULT_LUNCH_MIN),
            lunch_duration_min=d.get("lunch_duration_min", DEFAULT_LUNCH_DURATION_MIN),
        )


# --- State ---

MODE_IDLE = "idle"
MODE_WORK = "work"
MODE_SHORT_BREAK = "short_break"
MODE_LONG_BREAK = "long_break"

STATUS_STOPPED = "stopped"
STATUS_RUNNING = "running"
STATUS_PAUSED = "paused"


@dataclass
class State:
    mode: str = MODE_IDLE
    status: str = STATUS_STOPPED
    remaining_sec: int = 0
    cycle_index: int = 1
    cycles_before_long_break: int = DEFAULT_CYCLES_BEFORE_LONG_BREAK
    intent: str = ""
    started_at: str | None = None
    updated_at: str = field(default_factory=lambda: _now_iso())
    # Internal: monotonic reference for ticking (not persisted as meaningful across restarts,
    # but wall-clock based fallback is used on reload)
    _last_tick: float = 0.0

    def to_dict(self) -> dict:
        return {
            "mode": self.mode,
            "status": self.status,
            "remaining_sec": self.remaining_sec,
            "cycle_index": self.cycle_index,
            "cycles_before_long_break": self.cycles_before_long_break,
            "intent": self.intent,
            "started_at": self.started_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, d: dict) -> State:
        return cls(
            mode=d.get("mode", MODE_IDLE),
            status=d.get("status", STATUS_STOPPED),
            remaining_sec=d.get("remaining_sec", 0),
            cycle_index=d.get("cycle_index", 1),
            cycles_before_long_break=d.get("cycles_before_long_break", DEFAULT_CYCLES_BEFORE_LONG_BREAK),
            intent=d.get("intent", ""),
            started_at=d.get("started_at"),
            updated_at=d.get("updated_at", _now_iso()),
        )


# --- Event ---

@dataclass
class Event:
    id: int | None
    ts: str
    type: str
    payload: dict[str, Any]

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "ts": self.ts,
            "type": self.type,
            "payload": self.payload,
        }


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

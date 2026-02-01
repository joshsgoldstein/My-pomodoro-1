from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any


# --- Config ---

DEFAULT_WORK_SEC = 1500
DEFAULT_SHORT_BREAK_SEC = 300
DEFAULT_LONG_BREAK_SEC = 900
DEFAULT_CYCLES_BEFORE_LONG_BREAK = 4


@dataclass
class Config:
    work_sec: int = DEFAULT_WORK_SEC
    short_break_sec: int = DEFAULT_SHORT_BREAK_SEC
    long_break_sec: int = DEFAULT_LONG_BREAK_SEC
    cycles_before_long_break: int = DEFAULT_CYCLES_BEFORE_LONG_BREAK

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> Config:
        return cls(
            work_sec=d.get("work_sec", DEFAULT_WORK_SEC),
            short_break_sec=d.get("short_break_sec", DEFAULT_SHORT_BREAK_SEC),
            long_break_sec=d.get("long_break_sec", DEFAULT_LONG_BREAK_SEC),
            cycles_before_long_break=d.get("cycles_before_long_break", DEFAULT_CYCLES_BEFORE_LONG_BREAK),
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

"""Pomodoro state machine and timing logic.

All mutations go through this module. The API layer should call tick() before
reads and before applying commands.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

import db
from models import (
    Config, Event, State,
    MODE_IDLE, MODE_WORK, MODE_SHORT_BREAK, MODE_LONG_BREAK,
    STATUS_STOPPED, STATUS_RUNNING, STATUS_PAUSED,
)

# Module-level singletons loaded at init
_state: State = State()
_config: Config = Config()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mono() -> float:
    return time.monotonic()


def _emit(event_type: str, payload: dict) -> Event:
    return db.insert_event(_now_iso(), event_type, payload)


def _state_snapshot() -> dict:
    """Common fields included in event payloads."""
    return {
        "mode": _state.mode,
        "status": _state.status,
        "remaining_sec": _state.remaining_sec,
        "cycle_index": _state.cycle_index,
    }


def _duration_for_mode(mode: str) -> int:
    if mode == MODE_WORK:
        return _config.work_sec
    elif mode == MODE_SHORT_BREAK:
        return _config.short_break_sec
    elif mode == MODE_LONG_BREAK:
        return _config.long_break_sec
    return 0


def _next_mode_after_work() -> str:
    if _state.cycle_index % _config.cycles_before_long_break == 0:
        return MODE_LONG_BREAK
    return MODE_SHORT_BREAK


def _transition_to(mode: str) -> None:
    """Transition to a new phase, setting duration and starting it."""
    _state.mode = mode
    _state.remaining_sec = _duration_for_mode(mode)
    _state.status = STATUS_RUNNING
    _state.started_at = _now_iso()
    _state._last_tick = _mono()
    _state.updated_at = _now_iso()


def _complete_phase() -> None:
    """Handle phase completion: stop and wait for manual start."""
    ending_mode = _state.mode
    snapshot = _state_snapshot()
    if _state.active_task_id is not None:
        snapshot["task_id"] = _state.active_task_id
    _emit("phase_completed", snapshot)

    # A completed work session counts toward its assigned task.
    if ending_mode == MODE_WORK and _state.active_task_id is not None:
        db.increment_task_spent(_state.active_task_id)

    # Update cycle index
    if ending_mode in (MODE_SHORT_BREAK, MODE_LONG_BREAK):
        if ending_mode == MODE_LONG_BREAK:
            _state.cycle_index = 1
        else:
            _state.cycle_index += 1

    # Stop and wait for manual start
    _state.mode = MODE_IDLE
    _state.status = STATUS_STOPPED
    _state.remaining_sec = 0
    _save()


def _save() -> None:
    _state.updated_at = _now_iso()
    db.save_state(_state)


# --- Public API ---

def init() -> None:
    """Load state and config from DB. Called once at startup."""
    global _state, _config
    db.init_db()
    _config = db.load_config()
    _state = db.load_state()

    # If the timer was running, compute elapsed from wall-clock updated_at
    if _state.status == STATUS_RUNNING and _state.updated_at:
        try:
            updated = datetime.fromisoformat(_state.updated_at)
            elapsed = (datetime.now(timezone.utc) - updated).total_seconds()
            _state.remaining_sec = max(0, _state.remaining_sec - int(elapsed))
        except (ValueError, TypeError):
            pass

    _state._last_tick = _mono()


def tick() -> None:
    """Advance the timer based on elapsed monotonic time. Handles phase transitions."""
    if _state.status != STATUS_RUNNING:
        return

    now = _mono()
    elapsed = int(now - _state._last_tick)
    if elapsed <= 0:
        return

    _state._last_tick = now
    _state.remaining_sec -= elapsed

    while _state.remaining_sec <= 0 and _state.status == STATUS_RUNNING:
        overflow = -_state.remaining_sec
        _state.remaining_sec = 0
        _complete_phase()
        # Subtract overflow from the new phase
        if _state.status == STATUS_RUNNING and overflow > 0:
            _state.remaining_sec = max(0, _state.remaining_sec - overflow)
        else:
            break

    _save()


def get_state() -> dict:
    tick()
    return _state.to_dict()


def cmd_start(
    mode: str = MODE_WORK,
    intent: str | None = None,
    task_id: int | None = None,
) -> dict:
    tick()

    if mode not in (MODE_WORK, MODE_SHORT_BREAK, MODE_LONG_BREAK):
        mode = MODE_WORK

    _state.mode = mode
    _state.remaining_sec = _duration_for_mode(mode)
    _state.status = STATUS_RUNNING
    _state.started_at = _now_iso()
    _state._last_tick = _mono()

    # A task can drive the work session: its title becomes the intent.
    if mode == MODE_WORK:
        if task_id is not None:
            task = db.get_task(task_id)
            if task is not None:
                _state.active_task_id = task.id
                if not intent:
                    intent = task.title
        # else keep whatever task was already active
    else:
        _state.active_task_id = None

    if intent is not None and intent != "":
        _state.intent = intent

    _state.cycles_before_long_break = _config.cycles_before_long_break

    payload: dict = {"mode": mode, "cycle_index": _state.cycle_index}
    if _state.intent:
        payload["intent"] = _state.intent
    if _state.active_task_id is not None:
        payload["task_id"] = _state.active_task_id

    _emit("started", payload)
    _save()
    return _state.to_dict()


def cmd_pause() -> dict:
    tick()
    if _state.status == STATUS_RUNNING:
        _state.status = STATUS_PAUSED
        _emit("paused", _state_snapshot())
        _save()
    return _state.to_dict()


def cmd_resume() -> dict:
    tick()
    if _state.status == STATUS_PAUSED:
        _state.status = STATUS_RUNNING
        _state._last_tick = _mono()
        _emit("resumed", _state_snapshot())
        _save()
    return _state.to_dict()


def cmd_toggle() -> dict:
    tick()
    if _state.status == STATUS_RUNNING:
        _state.status = STATUS_PAUSED
        _emit("toggled", {**_state_snapshot(), "action": "paused"})
    elif _state.status == STATUS_PAUSED:
        _state.status = STATUS_RUNNING
        _state._last_tick = _mono()
        _emit("toggled", {**_state_snapshot(), "action": "resumed"})
    _save()
    return _state.to_dict()


def cmd_skip() -> dict:
    tick()
    if _state.mode == MODE_IDLE:
        return _state.to_dict()

    ending_mode = _state.mode
    _emit("skipped", _state_snapshot())

    if ending_mode == MODE_WORK:
        next_mode = _next_mode_after_work()
        _transition_to(next_mode)
    elif ending_mode in (MODE_SHORT_BREAK, MODE_LONG_BREAK):
        if ending_mode == MODE_LONG_BREAK:
            _state.cycle_index = 1
        else:
            _state.cycle_index += 1
        _transition_to(MODE_WORK)

    _save()
    return _state.to_dict()


def cmd_stop() -> dict:
    tick()
    _emit("stopped", _state_snapshot())
    _state.mode = MODE_IDLE
    _state.status = STATUS_STOPPED
    _state.remaining_sec = 0
    _state.cycle_index = 1
    _state.intent = ""
    _state.active_task_id = None
    _state.started_at = None
    _save()
    return _state.to_dict()


def cmd_set_intent(intent: str) -> dict:
    tick()
    _state.intent = intent
    _emit("intent_set", {**_state_snapshot(), "intent": intent})
    _save()
    return _state.to_dict()


def cmd_set_config(
    work_sec: int | None = None,
    short_break_sec: int | None = None,
    long_break_sec: int | None = None,
    cycles_before_long_break: int | None = None,
    daily_goal_pomodoros: int | None = None,
) -> dict:
    global _config
    if work_sec is not None:
        _config.work_sec = work_sec
    if short_break_sec is not None:
        _config.short_break_sec = short_break_sec
    if long_break_sec is not None:
        _config.long_break_sec = long_break_sec
    if cycles_before_long_break is not None:
        _config.cycles_before_long_break = cycles_before_long_break
    if daily_goal_pomodoros is not None:
        _config.daily_goal_pomodoros = daily_goal_pomodoros

    _state.cycles_before_long_break = _config.cycles_before_long_break
    db.save_config(_config)
    _emit("config_updated", _config.to_dict())
    _save()
    return _state.to_dict()


def get_config() -> dict:
    return _config.to_dict()


def add_note(message: str) -> Event:
    tick()
    payload = {
        "message": message,
        **_state_snapshot(),
    }
    event = _emit("note_added", payload)
    return event


def add_distraction(message: str = "") -> Event:
    tick()
    payload = {**_state_snapshot()}
    if message:
        payload["message"] = message
    return _emit("distraction", payload)

"""Day-planner block generation.

Turns a planner config (work hours, session/break lengths, lunch) into a list
of time blocks for a single day. Blocks are the schedule-first counterpart to
the timer: you assign tasks to work blocks ahead of time, then run the plan.
"""

from __future__ import annotations

from models import PlannerConfig

WORK = "work"
SHORT_BREAK = "short_break"
LONG_BREAK = "long_break"
LUNCH = "lunch"

STATUS_UPCOMING = "upcoming"
STATUS_DONE = "done"
STATUS_SKIPPED = "skipped"


def _to_min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _to_hhmm(mins: int) -> str:
    return f"{mins // 60:02d}:{mins % 60:02d}"


def generate_blocks(cfg: PlannerConfig) -> list[dict]:
    """Generate the ordered list of blocks for a work day."""
    start = _to_min(cfg.work_start)
    end = _to_min(cfg.work_end)
    lunch_start = _to_min(cfg.lunch_start)

    blocks: list[dict] = []
    t = start
    work_count = 0
    lunch_done = cfg.lunch_min <= 0
    idx = 0

    def add(block_type: str, t0: int, t1: int, intent: str = "") -> None:
        nonlocal idx
        blocks.append({
            "index": idx,
            "type": block_type,
            "start": _to_hhmm(t0),
            "end": _to_hhmm(t1),
            "task_id": None,
            "intent": intent,
            "status": STATUS_UPCOMING,
        })
        idx += 1

    guard = 0
    while t < end and guard < 1000:
        guard += 1

        # Drop lunch in once we've reached the lunch hour.
        if not lunch_done and t >= lunch_start:
            b_end = min(t + cfg.lunch_min, end)
            add(LUNCH, t, b_end, "Lunch")
            t = b_end
            lunch_done = True
            continue

        # Work block.
        b_end = min(t + cfg.session_min, end)
        add(WORK, t, b_end)
        t = b_end
        work_count += 1
        if t >= end:
            break

        # Following break (long every Nth work block).
        is_long = cfg.cycles_before_long_break > 0 and (
            work_count % cfg.cycles_before_long_break == 0
        )
        dur = cfg.long_break_min if is_long else cfg.short_break_min
        if dur <= 0:
            continue
        b_end = min(t + dur, end)
        add(LONG_BREAK if is_long else SHORT_BREAK, t, b_end,
            "Long break" if is_long else "Short break")
        t = b_end

    return blocks


def build_plan(date_str: str, cfg: PlannerConfig, previous: dict | None = None) -> dict:
    """Build a plan for a date, preserving task assignments from a previous
    plan where the block index and type still line up."""
    blocks = generate_blocks(cfg)

    if previous:
        prev_by_index = {b.get("index"): b for b in previous.get("blocks", [])}
        for b in blocks:
            prev = prev_by_index.get(b["index"])
            if prev and prev.get("type") == b["type"]:
                b["task_id"] = prev.get("task_id")
                if prev.get("intent") and b["type"] == WORK:
                    b["intent"] = prev["intent"]
                if prev.get("status") in (STATUS_DONE, STATUS_SKIPPED):
                    b["status"] = prev["status"]

    return {"date": date_str, "config": cfg.to_dict(), "blocks": blocks}

"""FastAPI application – thin layer over pomodoro_core."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from datetime import timedelta

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

import db
import planner
import pomodoro_core as core
from models import PlannerConfig


@asynccontextmanager
async def lifespan(app: FastAPI):
    core.init()
    yield


app = FastAPI(lifespan=lifespan)


# --- Health ---

@app.get("/health")
def health():
    return {"ok": True}


# --- State ---

@app.get("/state")
def get_state():
    return core.get_state()


# --- Commands ---

CMD_DISPATCH = {
    "start": lambda body: core.cmd_start(
        mode=body.get("mode", "work"),
        intent=body.get("intent"),
        task_id=body.get("task_id"),
    ),
    "pause": lambda body: core.cmd_pause(),
    "resume": lambda body: core.cmd_resume(),
    "toggle": lambda body: core.cmd_toggle(),
    "skip": lambda body: core.cmd_skip(),
    "stop": lambda body: core.cmd_stop(),
    "set_intent": lambda body: core.cmd_set_intent(body.get("intent", "")),
    "set_config": lambda body: core.cmd_set_config(
        work_sec=body.get("work_sec"),
        short_break_sec=body.get("short_break_sec"),
        long_break_sec=body.get("long_break_sec"),
        cycles_before_long_break=body.get("cycles_before_long_break"),
        daily_goal_pomodoros=body.get("daily_goal_pomodoros"),
    ),
}


@app.post("/cmd")
def post_cmd(body: dict[str, Any]):
    cmd_type = body.get("type")
    if not cmd_type or cmd_type not in CMD_DISPATCH:
        raise HTTPException(status_code=400, detail=f"Invalid command type: {cmd_type}")
    result = CMD_DISPATCH[cmd_type](body)
    return result


# --- Notes ---

@app.post("/notes")
def post_note(body: dict[str, Any]):
    message = body.get("message", "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")
    event = core.add_note(message)
    return event.to_dict()


# --- Distractions ---

@app.post("/distractions")
def post_distraction(body: dict[str, Any] = {}):
    message = body.get("message", "").strip() if body else ""
    event = core.add_distraction(message)
    return event.to_dict()


# --- Config ---

@app.get("/config")
def get_config():
    return db.load_config().to_dict()


# --- Events ---

@app.get("/events")
def get_events(
    limit: int = Query(default=100, ge=1, le=500),
    since: str | None = Query(default=None),
):
    events = db.get_events(limit=limit, since=since)
    return [e.to_dict() for e in events]


# --- Today summary ---

@app.get("/today")
def get_today():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    events = db.get_today_events(today)

    focus_sec = 0
    work_completed = 0
    break_completed = 0
    notes_count = 0
    distractions_count = 0

    for e in events:
        if e.type == "phase_completed":
            mode = e.payload.get("mode", "")
            if mode == "work":
                work_completed += 1
            elif mode in ("short_break", "long_break"):
                break_completed += 1
        elif e.type == "note_added":
            notes_count += 1
        elif e.type == "distraction":
            distractions_count += 1

    # Estimate focus_sec from completed work sessions
    # Each completed work session = config work_sec (approximate)
    config = db.load_config()
    focus_sec = work_completed * config.work_sec
    goal = config.daily_goal_pomodoros

    state = core.get_state()
    active_task = None
    if state.get("active_task_id") is not None:
        t = db.get_task(state["active_task_id"])
        if t is not None:
            active_task = t.to_dict()

    recent = events[:50]
    return {
        "date": today,
        "focus_sec": focus_sec,
        "work_sessions_completed": work_completed,
        "break_sessions_completed": break_completed,
        "notes_count": notes_count,
        "distractions_count": distractions_count,
        "daily_goal_pomodoros": goal,
        "goal_met": goal > 0 and work_completed >= goal,
        "goal_remaining": max(0, goal - work_completed),
        "active_task": active_task,
        "recent_events": [e.to_dict() for e in recent],
    }


# --- Tasks ---

@app.get("/tasks")
def get_tasks(include_done: bool = Query(default=True)):
    return [t.to_dict() for t in db.list_tasks(include_done=include_done)]


@app.post("/tasks")
def create_task(body: dict[str, Any]):
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    estimate = body.get("estimate_pomodoros", 1)
    try:
        estimate = max(1, int(estimate))
    except (TypeError, ValueError):
        estimate = 1
    task = db.create_task(title, estimate, datetime.now(timezone.utc).isoformat())
    return task.to_dict()


@app.patch("/tasks/{task_id}")
def patch_task(task_id: int, body: dict[str, Any]):
    if db.get_task(task_id) is None:
        raise HTTPException(status_code=404, detail="task not found")
    fields: dict[str, Any] = {}
    if "title" in body:
        title = (body.get("title") or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="title cannot be empty")
        fields["title"] = title
    if "estimate_pomodoros" in body:
        fields["estimate_pomodoros"] = max(1, int(body["estimate_pomodoros"]))
    if "spent_pomodoros" in body:
        fields["spent_pomodoros"] = max(0, int(body["spent_pomodoros"]))
    if "sort_order" in body:
        fields["sort_order"] = int(body["sort_order"])
    if "status" in body:
        status = body["status"]
        if status not in ("active", "done"):
            raise HTTPException(status_code=400, detail="invalid status")
        fields["status"] = status
        fields["completed_at"] = (
            datetime.now(timezone.utc).isoformat() if status == "done" else None
        )
    task = db.update_task(task_id, **fields)
    return task.to_dict()


@app.delete("/tasks/{task_id}")
def remove_task(task_id: int):
    if db.get_task(task_id) is None:
        raise HTTPException(status_code=404, detail="task not found")
    db.delete_task(task_id)
    return {"ok": True}


# --- Stats & insights ---

@app.get("/stats")
def get_stats(days: int = Query(default=14, ge=1, le=90)):
    config = db.load_config()
    goal = config.daily_goal_pomodoros
    work_sec = config.work_sec

    today = datetime.now(timezone.utc).date()
    start_date = today - timedelta(days=days - 1)
    since = start_date.strftime("%Y-%m-%d") + "T00:00:00"
    events = db.get_events_since(since)

    # Bucket by date.
    buckets: dict[str, dict] = {}
    for i in range(days):
        d = (start_date + timedelta(days=i)).strftime("%Y-%m-%d")
        buckets[d] = {
            "date": d,
            "work_sessions": 0,
            "distractions": 0,
            "notes": 0,
        }

    for e in events:
        d = e.ts[:10]
        if d not in buckets:
            continue
        if e.type == "phase_completed" and e.payload.get("mode") == "work":
            buckets[d]["work_sessions"] += 1
        elif e.type == "distraction":
            buckets[d]["distractions"] += 1
        elif e.type == "note_added":
            buckets[d]["notes"] += 1

    series = []
    total_sessions = 0
    total_distractions = 0
    best = {"date": None, "work_sessions": 0}
    for d in sorted(buckets):
        b = buckets[d]
        sessions = b["work_sessions"]
        total_sessions += sessions
        total_distractions += b["distractions"]
        if sessions > best["work_sessions"]:
            best = {"date": d, "work_sessions": sessions}
        series.append({
            **b,
            "focus_sec": sessions * work_sec,
            "goal": goal,
            "goal_met": goal > 0 and sessions >= goal,
        })

    # Current streak: consecutive days up to today with >= 1 work session.
    # Allow the streak to start "yesterday" if today has no sessions yet.
    streak = 0
    by_date = {b["date"]: b["work_sessions"] for b in series}
    cursor = today
    if by_date.get(today.strftime("%Y-%m-%d"), 0) == 0:
        cursor = today - timedelta(days=1)
    while True:
        key = cursor.strftime("%Y-%m-%d")
        if by_date.get(key, 0) >= 1:
            streak += 1
            cursor -= timedelta(days=1)
        else:
            break

    days_with_activity = sum(1 for b in series if b["work_sessions"] > 0)
    avg = round(total_sessions / max(1, days_with_activity), 1)

    return {
        "days": days,
        "series": series,
        "totals": {
            "work_sessions": total_sessions,
            "focus_sec": total_sessions * work_sec,
            "distractions": total_distractions,
            "days_with_activity": days_with_activity,
            "avg_sessions_per_active_day": avg,
        },
        "current_streak": streak,
        "best_day": best,
        "daily_goal_pomodoros": goal,
    }


# --- Planner / day plan ---

def _planner_config() -> PlannerConfig:
    return PlannerConfig.from_dict(db.load_planner_config() or {})


@app.get("/planner/config")
def get_planner_config():
    return _planner_config().to_dict()


@app.post("/planner/config")
def set_planner_config(body: dict[str, Any]):
    cfg = PlannerConfig.from_dict({**_planner_config().to_dict(), **body})
    db.save_planner_config(cfg.to_dict())
    return cfg.to_dict()


def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


@app.get("/plan")
def get_plan(date: str | None = Query(default=None)):
    date = date or _today_str()
    plan = db.load_plan(date)
    if plan is None:
        plan = planner.build_plan(date, _planner_config())
        db.save_plan(date, plan)
    return plan


@app.post("/plan/generate")
def regenerate_plan(body: dict[str, Any] = {}):
    date = (body or {}).get("date") or _today_str()
    previous = db.load_plan(date)
    plan = planner.build_plan(date, _planner_config(), previous=previous)
    db.save_plan(date, plan)
    return plan


@app.post("/plan/block")
def assign_block(body: dict[str, Any]):
    date = body.get("date") or _today_str()
    index = body.get("index")
    if index is None:
        raise HTTPException(status_code=400, detail="index is required")
    plan = db.load_plan(date)
    if plan is None:
        raise HTTPException(status_code=404, detail="no plan for date")
    found = None
    for b in plan["blocks"]:
        if b["index"] == index:
            found = b
            break
    if found is None:
        raise HTTPException(status_code=404, detail="block not found")
    if "task_id" in body:
        found["task_id"] = body["task_id"]
        if body["task_id"] is not None:
            task = db.get_task(body["task_id"])
            if task is not None:
                found["intent"] = task.title
    if "intent" in body:
        found["intent"] = body["intent"]
    if "status" in body:
        found["status"] = body["status"]
    db.save_plan(date, plan)
    return plan


@app.post("/plan/start")
def start_block(body: dict[str, Any]):
    """Start the timer for a given plan block; intent/task come from the block."""
    date = body.get("date") or _today_str()
    index = body.get("index")
    plan = db.load_plan(date)
    if plan is None:
        raise HTTPException(status_code=404, detail="no plan for date")
    block = next((b for b in plan["blocks"] if b["index"] == index), None)
    if block is None:
        raise HTTPException(status_code=404, detail="block not found")

    mode_map = {
        planner.WORK: "work",
        planner.SHORT_BREAK: "short_break",
        planner.LONG_BREAK: "long_break",
    }
    mode = mode_map.get(block["type"])
    if mode is None:
        raise HTTPException(status_code=400, detail="block is not runnable")

    result = core.cmd_start(
        mode=mode,
        intent=block.get("intent") or None,
        task_id=block.get("task_id"),
    )
    block["status"] = planner.STATUS_DONE
    db.save_plan(date, plan)
    return result


# --- Static files (frontend) – mounted last so it doesn't shadow API routes ---

app.mount("/", StaticFiles(directory="static", html=True), name="static")

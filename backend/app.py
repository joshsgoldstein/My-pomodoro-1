"""FastAPI application – thin layer over pomodoro_core."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

import db
import pomodoro_core as core


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

    recent = events[:50]
    return {
        "date": today,
        "focus_sec": focus_sec,
        "work_sessions_completed": work_completed,
        "break_sessions_completed": break_completed,
        "notes_count": notes_count,
        "distractions_count": distractions_count,
        "recent_events": [e.to_dict() for e in recent],
    }


# --- Static files (frontend) – mounted last so it doesn't shadow API routes ---

app.mount("/", StaticFiles(directory="static", html=True), name="static")

# Pomodoro API

Local-first Pomodoro timer with REST API, event logging, and a minimal web UI.

## Prerequisites

- **Docker** (with Docker Compose): [Install Docker](https://docs.docker.com/get-docker/)
- Or, for running without Docker: **Python 3.11+**

## Running with Docker (recommended)

```bash
git clone <repo-url> && cd My-pomodoro-1
docker compose up --build
```

Open http://localhost:8000 in your browser. The timer UI loads automatically.

To stop: `Ctrl+C` or `docker compose down`.

Data persists in `backend/data/pomodoro.db` (mounted as a volume). Restarting the container picks up where you left off.

## Running without Docker

```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000.

The SQLite database is created automatically at `backend/data/pomodoro.db` on first run.

## Usage

### Web UI

The single-page UI at `/` provides:

- **Timer display** (MM:SS) with mode, status, and cycle indicator
- **Intent input** — type your focus goal before starting
- **Start Work** — begins a 25-min work session (reads the intent input)
- **Start Break** — begins a short break
- **Toggle** — pause/resume the current timer
- **Skip** — jump to the next phase
- **Stop** — reset everything to idle
- **Add Note** — log a quick note (e.g. "distracted by Slack")
- **History** — shows the event log, newest first

### Timer behavior

- Work sessions default to 25 minutes
- After every 4 work sessions, you get a long break (15 min) instead of a short break (5 min)
- Phases auto-transition: work → break → work → ...
- Skip ends the current phase and moves to the next one
- Stop resets to idle (cycle 1, no intent)

## REST API

Base URL: `http://localhost:8000`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (`{"ok": true}`) |
| GET | `/state` | Current timer state (server ticks the timer before responding) |
| POST | `/cmd` | Send a command |
| POST | `/notes` | Add a timestamped note |
| GET | `/events?limit=100&since=ISO_TS` | Event log, newest first |
| GET | `/today` | Today's summary (focus time, session counts, notes, recent events) |

### Commands (`POST /cmd`)

All commands return the updated state object.

```bash
# Start a work session with an intent
curl -X POST http://localhost:8000/cmd \
  -H 'Content-Type: application/json' \
  -d '{"type": "start", "mode": "work", "intent": "draft intro paragraph"}'

# Pause/resume
curl -X POST http://localhost:8000/cmd -H 'Content-Type: application/json' -d '{"type": "toggle"}'
curl -X POST http://localhost:8000/cmd -H 'Content-Type: application/json' -d '{"type": "pause"}'
curl -X POST http://localhost:8000/cmd -H 'Content-Type: application/json' -d '{"type": "resume"}'

# Skip to next phase
curl -X POST http://localhost:8000/cmd -H 'Content-Type: application/json' -d '{"type": "skip"}'

# Stop and reset
curl -X POST http://localhost:8000/cmd -H 'Content-Type: application/json' -d '{"type": "stop"}'

# Change intent mid-session
curl -X POST http://localhost:8000/cmd -H 'Content-Type: application/json' -d '{"type": "set_intent", "intent": "new focus"}'

# Update timer durations
curl -X POST http://localhost:8000/cmd \
  -H 'Content-Type: application/json' \
  -d '{"type": "set_config", "work_sec": 1500, "short_break_sec": 300, "long_break_sec": 900, "cycles_before_long_break": 4}'
```

### Notes (`POST /notes`)

```bash
curl -X POST http://localhost:8000/notes \
  -H 'Content-Type: application/json' \
  -d '{"message": "distracted by slack"}'
```

### State object

```json
{
  "mode": "work",
  "status": "running",
  "remaining_sec": 1423,
  "cycle_index": 1,
  "cycles_before_long_break": 4,
  "intent": "draft intro paragraph",
  "started_at": "2026-01-31T10:00:00+00:00",
  "updated_at": "2026-01-31T10:01:17+00:00"
}
```

## Configuration defaults

| Setting | Default | Description |
|---------|---------|-------------|
| `work_sec` | 1500 (25 min) | Work session duration |
| `short_break_sec` | 300 (5 min) | Short break duration |
| `long_break_sec` | 900 (15 min) | Long break duration |
| `cycles_before_long_break` | 4 | Work sessions before a long break |

Change at runtime via `POST /cmd` with `{"type": "set_config", ...}`.

## Project structure

```
pomodoro/
  docker-compose.yml
  backend/
    app.py              # FastAPI routes
    pomodoro_core.py    # State machine + timing logic
    db.py               # SQLite persistence
    models.py           # Data models
    requirements.txt
    Dockerfile
    static/
      index.html
      app.js
      styles.css
    data/
      pomodoro.db       # Created at runtime
```

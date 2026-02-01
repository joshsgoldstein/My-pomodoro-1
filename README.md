# Pomodoro API

Local-first Pomodoro timer with REST API, event logging, and a minimal web UI.

## Quick Start

```bash
docker compose up --build
```

Open http://localhost:8000 in your browser.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/state` | Current timer state (ticks before responding) |
| POST | `/cmd` | Send a command (start, pause, resume, toggle, skip, stop, set_intent, set_config) |
| POST | `/notes` | Add a note |
| GET | `/events?limit=100&since=ISO_TS` | Event log (newest first) |
| GET | `/today` | Today's summary |

### Commands

```json
{ "type": "start", "mode": "work", "intent": "draft intro paragraph" }
{ "type": "toggle" }
{ "type": "pause" }
{ "type": "resume" }
{ "type": "skip" }
{ "type": "stop" }
{ "type": "set_intent", "intent": "new focus" }
{ "type": "set_config", "work_sec": 1500, "short_break_sec": 300 }
```

## Data

SQLite database stored in `backend/data/pomodoro.db`. State and events persist across restarts.

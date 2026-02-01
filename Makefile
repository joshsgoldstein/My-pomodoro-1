.PHONY: up down build run install clean logs reset

# Docker
up:
	docker compose up --build

down:
	docker compose down

build:
	docker compose build

logs:
	docker compose logs -f

# Local (no Docker)
install:
	pip install -r backend/requirements.txt

run:
	cd backend && uvicorn app:app --host 0.0.0.0 --port 8000 --reload

# Data
clean:
	rm -f backend/data/pomodoro.db backend/data/pomodoro.db-wal backend/data/pomodoro.db-shm

reset: clean
	@echo "Database cleared. Restart to get fresh state."

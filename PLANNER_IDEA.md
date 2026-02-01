# Pomodoro Day Planner — Future Idea

## Concept

Flip the pomodoro app on its head: instead of a timer with a schedule view,
it becomes a **day planner that creates pomodoro blocks**.

You configure your work day (e.g. 9–5, 45-min work sessions, lunch at noon)
and the app generates a grid of pomodoro blocks. You then **assign tasks to
those blocks** — that's the planning. The timer just runs whatever block
you're currently in.

## How it works

1. **Config defines the day structure**
   - Work hours: 9:00 AM – 5:00 PM
   - Work session length: 45 min
   - Short break: 15 min, long break: 30 min
   - Cycles before long break: 4
   - Lunch: 12:00 PM for 60 min

2. **App generates empty pomodoro slots**
   - e.g. 9:00–9:45 Work, 9:45–10:00 Break, 10:00–10:45 Work, ...
   - Lunch block at noon
   - All laid out on a vertical day timeline

3. **You fill in the blocks with tasks**
   - Click a work block → type what you'll work on
   - Drag to reorder or reassign
   - Each block gets an intent/task label

4. **Timer follows the schedule**
   - "Start" picks up the current or next block
   - The intent comes FROM the block, not from a separate text input
   - Auto-transitions through work → break → work as configured

5. **Timeline is the primary UI**
   - Left side: active timer + current task + distractions
   - Right side: full day plan with blocks, tasks assigned, progress
   - Past blocks show as completed/skipped
   - Active block is highlighted
   - Future blocks show assigned tasks

## Why this is different from the current app

The current app is a **timer-first** tool: you press Start, it counts down,
the timeline just shows what happened. The planner idea is **schedule-first**:
the blocks exist before you start, and you plan your day by assigning work
to each slot. The timer is secondary — it just runs the plan.

## Key UX elements

- Clickable work blocks on the timeline to assign tasks
- "Plan Day" view where you list tasks and drag them into blocks
- Visual progress: completed blocks fill in, upcoming blocks show tasks
- Pomodoro count: "6/10 pomodoros completed today"
- Works with the same backend timer/state machine — just changes how
  sessions get started and what intent they carry

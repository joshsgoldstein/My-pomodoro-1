const timerEl = document.getElementById("timer");
const modeEl = document.getElementById("mode-label");
const statusEl = document.getElementById("status-label");
const cycleEl = document.getElementById("cycle-label");
const intentEl = document.getElementById("intent-label");
const intentInput = document.getElementById("intent-input");
const noteInput = document.getElementById("note-input");
const distractionInput = document.getElementById("distraction-input");
const eventList = document.getElementById("event-list");
const distractionCountEl = document.getElementById("distraction-count");
const buttonsEl = document.getElementById("buttons");
const timelineEl = document.getElementById("timeline");

let currentMode = "idle";
let currentStatus = "stopped";
let currentCycleIndex = 1;
let currentCyclesBeforeLong = 4;

// Cached config for timeline generation
let cachedConfig = null;

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function modeDisplay(mode) {
  return mode.replace(/_/g, " ");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  return res.json();
}

// --- Smart break ---

function nextBreakMode() {
  if (currentCycleIndex % currentCyclesBeforeLong === 0) return "long_break";
  return "short_break";
}

function nextBreakLabel() {
  return nextBreakMode() === "long_break" ? "Long Break" : "Short Break";
}

// --- Context-aware buttons ---

function renderButtons() {
  buttonsEl.innerHTML = "";
  const btns = [];

  if (currentMode === "idle" || currentStatus === "stopped") {
    btns.push({ id: "btn-start-work", label: "Start Work", cls: "btn-green" });
    btns.push({ id: "btn-start-break", label: nextBreakLabel(), cls: "" });
  } else {
    if (currentStatus === "running") {
      btns.push({ id: "btn-pause", label: "Pause", cls: "" });
    } else if (currentStatus === "paused") {
      btns.push({ id: "btn-resume", label: "Resume", cls: "btn-green" });
    }
    btns.push({ id: "btn-skip", label: "Skip", cls: "" });
    btns.push({ id: "btn-stop", label: "Stop", cls: "btn-red" });
  }

  for (const b of btns) {
    const el = document.createElement("button");
    el.id = b.id;
    el.textContent = b.label;
    if (b.cls) el.classList.add(b.cls);
    buttonsEl.appendChild(el);
  }

  const startWork = document.getElementById("btn-start-work");
  if (startWork) startWork.addEventListener("click", async () => {
    const intent = intentInput.value.trim();
    const body = { type: "start", mode: "work" };
    if (intent) body.intent = intent;
    await api("POST", "/cmd", body);
    refresh();
  });

  const startBreak = document.getElementById("btn-start-break");
  if (startBreak) startBreak.addEventListener("click", async () => {
    await api("POST", "/cmd", { type: "start", mode: nextBreakMode() });
    refresh();
  });

  const pause = document.getElementById("btn-pause");
  if (pause) pause.addEventListener("click", async () => {
    await api("POST", "/cmd", { type: "pause" });
    refresh();
  });

  const resume = document.getElementById("btn-resume");
  if (resume) resume.addEventListener("click", async () => {
    await api("POST", "/cmd", { type: "resume" });
    refresh();
  });

  const skip = document.getElementById("btn-skip");
  if (skip) skip.addEventListener("click", async () => {
    await api("POST", "/cmd", { type: "skip" });
    refresh();
  });

  const stop = document.getElementById("btn-stop");
  if (stop) stop.addEventListener("click", async () => {
    await api("POST", "/cmd", { type: "stop" });
    refresh();
  });
}

// --- State polling ---

async function pollState() {
  try {
    const s = await api("GET", "/state");
    timerEl.textContent = fmt(s.remaining_sec);
    modeEl.textContent = modeDisplay(s.mode);
    statusEl.textContent = s.status;
    cycleEl.textContent = "Cycle " + s.cycle_index + " / " + s.cycles_before_long_break;
    intentEl.textContent = s.intent || "";

    const changed = s.mode !== currentMode || s.status !== currentStatus
      || s.cycle_index !== currentCycleIndex || s.cycles_before_long_break !== currentCyclesBeforeLong;

    currentMode = s.mode;
    currentStatus = s.status;
    currentCycleIndex = s.cycle_index;
    currentCyclesBeforeLong = s.cycles_before_long_break;

    if (changed) renderButtons();
  } catch (e) { /* ignore */ }
}

// --- Events ---

async function loadEvents() {
  try {
    const events = await api("GET", "/events?limit=50");
    eventList.innerHTML = "";
    for (const ev of events) {
      const li = document.createElement("li");
      const time = ev.ts.substring(11, 19);
      let detail = "";
      if (ev.type === "distraction") {
        detail = ev.payload.message || "";
      } else if (ev.type === "note_added") {
        detail = ev.payload.message || "";
      } else if (ev.type === "started" && ev.payload.intent) {
        detail = ev.payload.intent;
      } else if (ev.payload.mode) {
        detail = modeDisplay(ev.payload.mode);
      }
      li.innerHTML =
        '<span class="event-time">' + time + "</span>" +
        '<span class="event-type">' + ev.type + "</span>" +
        '<span class="event-detail">' + detail + "</span>";
      eventList.appendChild(li);
    }
  } catch (e) { /* ignore */ }
}

// --- Distraction ---

document.getElementById("btn-distraction").addEventListener("click", async () => {
  const msg = distractionInput.value.trim();
  if (!msg) {
    distractionInput.focus();
    distractionInput.classList.add("input-error");
    setTimeout(() => distractionInput.classList.remove("input-error"), 600);
    return;
  }
  await api("POST", "/distractions", { message: msg });
  distractionInput.value = "";
  loadDistractionCount();
  loadEvents();
});

distractionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("btn-distraction").click();
});

async function loadDistractionCount() {
  try {
    const data = await api("GET", "/today");
    distractionCountEl.textContent = data.distractions_count || 0;
  } catch (e) { /* ignore */ }
}

// --- Notes ---

document.getElementById("btn-note").addEventListener("click", async () => {
  const msg = noteInput.value.trim();
  if (!msg) return;
  await api("POST", "/notes", { message: msg });
  noteInput.value = "";
  loadEvents();
});

noteInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("btn-note").click();
});

// --- Settings ---

const settingsPanel = document.getElementById("settings-panel");
const cfgWork = document.getElementById("cfg-work");
const cfgShortBreak = document.getElementById("cfg-short-break");
const cfgLongBreak = document.getElementById("cfg-long-break");
const cfgCycles = document.getElementById("cfg-cycles");
const cfgDayStart = document.getElementById("cfg-day-start");
const cfgDayEnd = document.getElementById("cfg-day-end");
const cfgLunchTime = document.getElementById("cfg-lunch-time");
const cfgLunchDuration = document.getElementById("cfg-lunch-duration");

// Populate time dropdowns with 15-min increments (5:00 - 23:00)
function populateTimeSelect(selectEl, startHour, endHour) {
  selectEl.innerHTML = "";
  for (let h = startHour; h <= endHour; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === endHour && m > 0) break;
      const opt = document.createElement("option");
      const val = h * 60 + m;
      opt.value = val;
      opt.textContent = pad2(h) + ":" + pad2(m);
      selectEl.appendChild(opt);
    }
  }
}

function setTimeSelectValue(selectEl, hour, min) {
  // Snap to nearest 15-min
  const snapped = Math.round(min / 15) * 15;
  const val = hour * 60 + (snapped >= 60 ? 0 : snapped);
  selectEl.value = val;
}

function getTimeSelectValue(selectEl) {
  const val = parseInt(selectEl.value, 10);
  return { hour: Math.floor(val / 60), min: val % 60 };
}

// Init time dropdowns
populateTimeSelect(cfgDayStart, 5, 23);
populateTimeSelect(cfgDayEnd, 5, 23);
populateTimeSelect(cfgLunchTime, 5, 23);

document.getElementById("btn-settings-toggle").addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
  if (!settingsPanel.classList.contains("hidden")) loadConfig();
});

async function loadConfig() {
  try {
    const cfg = await api("GET", "/config");
    cachedConfig = cfg;
    cfgWork.value = Math.round(cfg.work_sec / 60);
    cfgShortBreak.value = Math.round(cfg.short_break_sec / 60);
    cfgLongBreak.value = Math.round(cfg.long_break_sec / 60);
    cfgCycles.value = cfg.cycles_before_long_break;
    setTimeSelectValue(cfgDayStart, cfg.day_start_hour, cfg.day_start_min);
    setTimeSelectValue(cfgDayEnd, cfg.day_end_hour, cfg.day_end_min);
    setTimeSelectValue(cfgLunchTime, cfg.lunch_hour, cfg.lunch_min);
    cfgLunchDuration.value = cfg.lunch_duration_min;
  } catch (e) { /* ignore */ }
}

document.getElementById("btn-save-config").addEventListener("click", async () => {
  const dayStart = getTimeSelectValue(cfgDayStart);
  const dayEnd = getTimeSelectValue(cfgDayEnd);
  const lunchTime = getTimeSelectValue(cfgLunchTime);

  await api("POST", "/cmd", {
    type: "set_config",
    work_sec: (parseInt(cfgWork.value, 10) || 25) * 60,
    short_break_sec: (parseInt(cfgShortBreak.value, 10) || 5) * 60,
    long_break_sec: (parseInt(cfgLongBreak.value, 10) || 15) * 60,
    cycles_before_long_break: parseInt(cfgCycles.value, 10) || 4,
    day_start_hour: dayStart.hour,
    day_start_min: dayStart.min,
    day_end_hour: dayEnd.hour,
    day_end_min: dayEnd.min,
    lunch_hour: lunchTime.hour,
    lunch_min: lunchTime.min,
    lunch_duration_min: parseInt(cfgLunchDuration.value, 10) || 60,
  });
  settingsPanel.classList.add("hidden");
  // Reload config and rebuild timeline
  cachedConfig = null;
  refresh();
});

// --- Generate schedule blocks from config ---

function generateScheduleBlocks(cfg) {
  const blocks = [];
  const workMin = Math.round(cfg.work_sec / 60);
  const shortBreakMin = Math.round(cfg.short_break_sec / 60);
  const longBreakMin = Math.round(cfg.long_break_sec / 60);
  const cyclesBeforeLong = cfg.cycles_before_long_break;

  const dayStartMin = cfg.day_start_hour * 60 + cfg.day_start_min;
  const dayEndMin = cfg.day_end_hour * 60 + cfg.day_end_min;
  const lunchStartMin = cfg.lunch_hour * 60 + cfg.lunch_min;
  const lunchEndMin = lunchStartMin + cfg.lunch_duration_min;

  // Add lunch block
  blocks.push({
    startMin: lunchStartMin,
    durationMin: cfg.lunch_duration_min,
    mode: "lunch",
  });

  let cursor = dayStartMin;
  let cycle = 0;

  while (cursor + workMin <= dayEndMin) {
    // If work block would overlap lunch, skip to after lunch
    if (cursor < lunchEndMin && cursor + workMin > lunchStartMin) {
      cursor = lunchEndMin;
      continue;
    }
    if (cursor >= dayEndMin) break;

    // Work block
    const workEnd = Math.min(cursor + workMin, dayEndMin);
    blocks.push({
      startMin: cursor,
      durationMin: workEnd - cursor,
      mode: "work",
    });
    cursor = workEnd;
    cycle++;

    if (cursor >= dayEndMin) break;

    // Break block
    let breakMin;
    if (cycle % cyclesBeforeLong === 0) {
      breakMin = longBreakMin;
    } else {
      breakMin = shortBreakMin;
    }

    // If break would overlap lunch, skip to after lunch
    if (cursor < lunchEndMin && cursor + breakMin > lunchStartMin) {
      cursor = lunchEndMin;
      continue;
    }

    const breakEnd = Math.min(cursor + breakMin, dayEndMin);
    if (breakEnd > cursor) {
      blocks.push({
        startMin: cursor,
        durationMin: breakEnd - cursor,
        mode: cycle % cyclesBeforeLong === 0 ? "long_break" : "short_break",
      });
      cursor = breakEnd;
    }
  }

  return blocks;
}

// --- Vertical day timeline ---

const HOUR_HEIGHT = 60; // px per hour

function buildTimeline(events, cfg) {
  const now = new Date();
  timelineEl.innerHTML = "";

  const timelineStartHour = cfg.day_start_hour;
  // End at least 1 hour after day_end, snapped up
  const timelineEndHour = Math.min(23, cfg.day_end_hour + 1);
  const totalHours = timelineEndHour - timelineStartHour;
  timelineEl.style.height = (totalHours * HOUR_HEIGHT) + "px";

  // Hour grid lines and labels
  for (let h = timelineStartHour; h <= timelineEndHour; h++) {
    const line = document.createElement("div");
    line.className = "tl-hour-line";
    line.style.top = ((h - timelineStartHour) * HOUR_HEIGHT) + "px";
    timelineEl.appendChild(line);

    const label = document.createElement("span");
    label.className = "tl-hour-label";
    label.style.top = ((h - timelineStartHour) * HOUR_HEIGHT) + "px";
    label.textContent = pad2(h) + ":00";
    timelineEl.appendChild(label);
  }

  // Schedule blocks (auto-generated from config)
  const scheduleBlocks = generateScheduleBlocks(cfg);
  for (const bl of scheduleBlocks) {
    const top = ((bl.startMin / 60) - timelineStartHour) * HOUR_HEIGHT;
    const height = (bl.durationMin / 60) * HOUR_HEIGHT;
    if (top < 0 || top >= totalHours * HOUR_HEIGHT) continue;

    const block = document.createElement("div");
    block.className = "tl-sched tl-sched-" + bl.mode;
    block.style.top = Math.max(0, top) + "px";
    block.style.height = Math.max(4, height) + "px";

    const text = document.createElement("span");
    text.className = "tl-sched-text";
    if (bl.mode === "lunch") {
      text.textContent = "Lunch";
    } else if (bl.mode === "work") {
      text.textContent = bl.durationMin + "m work";
    } else {
      text.textContent = bl.durationMin + "m " + modeDisplay(bl.mode);
    }
    block.appendChild(text);
    timelineEl.appendChild(block);
  }

  // Actual session blocks
  const spans = buildSpans(events, now);
  for (const sp of spans) {
    const startMin = sp.start.getHours() * 60 + sp.start.getMinutes();
    const endMin = sp.end.getHours() * 60 + sp.end.getMinutes();
    const top = ((startMin / 60) - timelineStartHour) * HOUR_HEIGHT;
    const height = Math.max(3, ((endMin - startMin) / 60) * HOUR_HEIGHT);
    if (top < 0) continue;

    const block = document.createElement("div");
    block.className = "tl-session tl-session-" + (sp.mode || "work");
    block.style.top = top + "px";
    block.style.height = height + "px";
    block.title = modeDisplay(sp.mode || "work") + " " +
      sp.start.toTimeString().substring(0, 5) + "-" +
      sp.end.toTimeString().substring(0, 5);
    timelineEl.appendChild(block);
  }

  // Now marker
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowTop = ((nowMin / 60) - timelineStartHour) * HOUR_HEIGHT;
  if (nowTop >= 0 && nowTop <= totalHours * HOUR_HEIGHT) {
    const marker = document.createElement("div");
    marker.className = "tl-now";
    marker.style.top = nowTop + "px";
    timelineEl.appendChild(marker);
  }
}

function buildSpans(events, now) {
  const spans = [];
  const sorted = events.slice().reverse();
  let activeStart = null;
  let activeMode = null;

  for (const ev of sorted) {
    const t = new Date(ev.ts);
    if (ev.type === "started") {
      activeStart = t;
      activeMode = ev.payload.mode || "work";
    } else if (ev.type === "phase_completed" || ev.type === "skipped") {
      if (activeStart) spans.push({ start: activeStart, end: t, mode: activeMode });
      activeStart = null;
      activeMode = null;
      if (ev.type === "phase_completed") {
        activeStart = t;
        const m = ev.payload.mode;
        activeMode = (m === "work") ? "short_break" : "work";
      }
    } else if (ev.type === "stopped") {
      if (activeStart) spans.push({ start: activeStart, end: t, mode: activeMode });
      activeStart = null;
      activeMode = null;
    }
  }

  if (activeStart) spans.push({ start: activeStart, end: now, mode: activeMode });
  return spans;
}

async function loadTimeline() {
  try {
    // Load config if not cached
    if (!cachedConfig) {
      cachedConfig = await api("GET", "/config");
    }
    const events = await api("GET", "/events?limit=200");
    buildTimeline(events, cachedConfig);
  } catch (e) { /* ignore */ }
}

// --- Refresh ---

function refresh() {
  loadEvents();
  loadTimeline();
  loadDistractionCount();
}

// --- Init ---

renderButtons();
setInterval(pollState, 1000);
setInterval(refresh, 5000);
pollState();
refresh();

const timerEl = document.getElementById("timer");
const modeEl = document.getElementById("mode-label");
const statusEl = document.getElementById("status-label");
const cycleEl = document.getElementById("cycle-label");
const pomodoroCountEl = document.getElementById("pomodoro-count");
const intentEl = document.getElementById("intent-label");
const intentInput = document.getElementById("intent-input");
const noteInput = document.getElementById("note-input");
const distractionInput = document.getElementById("distraction-input");
const eventList = document.getElementById("event-list");
const distractionCountEl = document.getElementById("distraction-count");
const buttonsEl = document.getElementById("buttons");
let currentMode = "idle";
let currentStatus = "stopped";
let currentCycleIndex = 1;
let currentCyclesBeforeLong = 4;

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

function fmtEventTime(ts) {
  // ts is ISO like "2025-01-01T14:30:45..."
  const h = parseInt(ts.substring(11, 13), 10);
  const m = ts.substring(14, 16);
  const s = ts.substring(17, 19);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  return h12 + ":" + m + ":" + s + " " + ampm;
}

async function loadEvents() {
  try {
    const events = await api("GET", "/events?limit=50");
    eventList.innerHTML = "";
    for (const ev of events) {
      const li = document.createElement("li");
      const time = fmtEventTime(ev.ts);
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
  loadTodayStats();
  loadEvents();
});

distractionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("btn-distraction").click();
});

// --- Today stats (pomodoro count + distraction count) ---

async function loadTodayStats() {
  try {
    const data = await api("GET", "/today");
    distractionCountEl.textContent = data.distractions_count || 0;
    const count = data.work_sessions_completed || 0;
    pomodoroCountEl.textContent = count + " pomodoro" + (count !== 1 ? "s" : "") + " today";
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

document.getElementById("btn-settings-toggle").addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
  if (!settingsPanel.classList.contains("hidden")) loadConfig();
});

async function loadConfig() {
  try {
    const cfg = await api("GET", "/config");
    cfgWork.value = Math.round(cfg.work_sec / 60);
    cfgShortBreak.value = Math.round(cfg.short_break_sec / 60);
    cfgLongBreak.value = Math.round(cfg.long_break_sec / 60);
    cfgCycles.value = cfg.cycles_before_long_break;
  } catch (e) { /* ignore */ }
}

document.getElementById("btn-save-config").addEventListener("click", async () => {
  await api("POST", "/cmd", {
    type: "set_config",
    work_sec: (parseInt(cfgWork.value, 10) || 25) * 60,
    short_break_sec: (parseInt(cfgShortBreak.value, 10) || 5) * 60,
    long_break_sec: (parseInt(cfgLongBreak.value, 10) || 15) * 60,
    cycles_before_long_break: parseInt(cfgCycles.value, 10) || 4,
  });
  settingsPanel.classList.add("hidden");
  refresh();
});

// --- Refresh ---

function refresh() {
  loadEvents();
  loadTodayStats();
}

// --- Init ---

renderButtons();
setInterval(pollState, 1000);
setInterval(refresh, 5000);
pollState();
refresh();

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

// --- Plan form ---

const planForm = document.getElementById("add-plan-form");

document.getElementById("btn-add-plan").addEventListener("click", () => {
  planForm.classList.toggle("hidden");
  if (!planForm.classList.contains("hidden")) {
    const now = new Date();
    document.getElementById("plan-hour").value = now.getHours();
    document.getElementById("plan-min").value = 0;
    document.getElementById("plan-intent").focus();
  }
});

document.getElementById("btn-save-plan").addEventListener("click", async () => {
  const hour = parseInt(document.getElementById("plan-hour").value, 10);
  const min = parseInt(document.getElementById("plan-min").value, 10) || 0;
  const duration = parseInt(document.getElementById("plan-duration").value, 10) || 25;
  const intent = document.getElementById("plan-intent").value.trim();
  if (isNaN(hour)) return;
  await api("POST", "/plans", {
    start_hour: hour,
    start_min: min,
    duration_min: duration,
    mode: "work",
    intent: intent,
  });
  planForm.classList.add("hidden");
  document.getElementById("plan-intent").value = "";
  loadTimeline();
});

// --- Vertical day timeline ---

const HOUR_HEIGHT = 60; // px per hour
const TIMELINE_START_HOUR = 6;
const TIMELINE_END_HOUR = 23;

function buildTimeline(events, plans) {
  const now = new Date();
  timelineEl.innerHTML = "";

  const totalHours = TIMELINE_END_HOUR - TIMELINE_START_HOUR;
  timelineEl.style.height = (totalHours * HOUR_HEIGHT) + "px";

  // Hour grid lines and labels
  for (let h = TIMELINE_START_HOUR; h <= TIMELINE_END_HOUR; h++) {
    const line = document.createElement("div");
    line.className = "tl-hour-line";
    line.style.top = ((h - TIMELINE_START_HOUR) * HOUR_HEIGHT) + "px";
    timelineEl.appendChild(line);

    const label = document.createElement("span");
    label.className = "tl-hour-label";
    label.style.top = ((h - TIMELINE_START_HOUR) * HOUR_HEIGHT) + "px";
    label.textContent = pad2(h) + ":00";
    timelineEl.appendChild(label);
  }

  // Planned slots (dashed outline)
  for (const p of plans) {
    const startMin = (p.start_hour - TIMELINE_START_HOUR) * 60 + p.start_min;
    const top = (startMin / 60) * HOUR_HEIGHT;
    const height = (p.duration_min / 60) * HOUR_HEIGHT;
    if (top < 0 || top > totalHours * HOUR_HEIGHT) continue;

    const block = document.createElement("div");
    block.className = "tl-plan";
    block.style.top = Math.max(0, top) + "px";
    block.style.height = Math.max(16, height) + "px";

    const text = document.createElement("span");
    text.className = "tl-plan-text";
    text.textContent = (p.intent || "planned") + " (" + p.duration_min + "m)";
    block.appendChild(text);

    // Click to start this plan
    block.addEventListener("click", async () => {
      intentInput.value = p.intent || "";
      const body = { type: "start", mode: "work" };
      if (p.intent) body.intent = p.intent;
      await api("POST", "/cmd", body);
      refresh();
    });

    // Delete button
    const del = document.createElement("button");
    del.className = "tl-plan-del";
    del.textContent = "x";
    del.title = "Remove";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      await api("DELETE", "/plans/" + p.id);
      loadTimeline();
    });
    block.appendChild(del);

    timelineEl.appendChild(block);
  }

  // Actual session blocks
  const spans = buildSpans(events, now);
  for (const sp of spans) {
    const startMin = (sp.start.getHours() - TIMELINE_START_HOUR) * 60 + sp.start.getMinutes();
    const endMin = (sp.end.getHours() - TIMELINE_START_HOUR) * 60 + sp.end.getMinutes();
    const top = (startMin / 60) * HOUR_HEIGHT;
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
  const nowMin = (now.getHours() - TIMELINE_START_HOUR) * 60 + now.getMinutes();
  const nowTop = (nowMin / 60) * HOUR_HEIGHT;
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
    const [events, plans] = await Promise.all([
      api("GET", "/events?limit=200"),
      api("GET", "/plans"),
    ]);
    buildTimeline(events, plans);
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

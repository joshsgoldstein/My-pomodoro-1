// ===== Helpers =====

function $(id) { return document.getElementById(id); }

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function modeDisplay(mode) { return mode.replace(/_/g, " "); }

function fmtFocus(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return h + "h " + m + "m";
  return m + "m";
}

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  return res.json();
}

// ===== Tabs =====

const panels = document.querySelectorAll(".panel");
const tabButtons = document.querySelectorAll(".tab");

function showTab(name) {
  tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  panels.forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== name));
  if (name === "tasks") loadTasks();
  if (name === "plan") loadPlan();
  if (name === "stats") loadStats();
}

tabButtons.forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

// ===== Timer state =====

const timerEl = $("timer");
const modeEl = $("mode-label");
const statusEl = $("status-label");
const cycleEl = $("cycle-label");
const intentEl = $("intent-label");
const intentInput = $("intent-input");
const taskSelect = $("task-select");
const buttonsEl = $("buttons");
const goalFill = $("goal-fill");
const goalLabel = $("goal-label");

let currentMode = "idle";
let currentStatus = "stopped";
let currentCycleIndex = 1;
let currentCyclesBeforeLong = 4;

function nextBreakMode() {
  if (currentCycleIndex % currentCyclesBeforeLong === 0) return "long_break";
  return "short_break";
}
function nextBreakLabel() {
  return nextBreakMode() === "long_break" ? "Long Break" : "Short Break";
}

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

  const startWork = $("btn-start-work");
  if (startWork) startWork.addEventListener("click", async () => {
    const body = { type: "start", mode: "work" };
    const taskId = taskSelect.value;
    if (taskId) body.task_id = parseInt(taskId, 10);
    const intent = intentInput.value.trim();
    if (intent) body.intent = intent;
    await api("POST", "/cmd", body);
    intentInput.value = "";
    refresh();
  });
  const startBreak = $("btn-start-break");
  if (startBreak) startBreak.addEventListener("click", async () => {
    await api("POST", "/cmd", { type: "start", mode: nextBreakMode() });
    refresh();
  });
  const pause = $("btn-pause");
  if (pause) pause.addEventListener("click", async () => { await api("POST", "/cmd", { type: "pause" }); refresh(); });
  const resume = $("btn-resume");
  if (resume) resume.addEventListener("click", async () => { await api("POST", "/cmd", { type: "resume" }); refresh(); });
  const skip = $("btn-skip");
  if (skip) skip.addEventListener("click", async () => { await api("POST", "/cmd", { type: "skip" }); refresh(); });
  const stop = $("btn-stop");
  if (stop) stop.addEventListener("click", async () => { await api("POST", "/cmd", { type: "stop" }); refresh(); });
}

async function pollState() {
  try {
    const s = await api("GET", "/state");
    timerEl.textContent = fmt(s.remaining_sec);
    modeEl.textContent = modeDisplay(s.mode);
    statusEl.textContent = s.status;
    cycleEl.textContent = "Cycle " + s.cycle_index + " / " + s.cycles_before_long_break;
    intentEl.textContent = s.intent || "";
    document.title = (s.status === "running" ? fmt(s.remaining_sec) + " · " : "") + "Pomodoro";

    const changed = s.mode !== currentMode || s.status !== currentStatus
      || s.cycle_index !== currentCycleIndex || s.cycles_before_long_break !== currentCyclesBeforeLong;
    currentMode = s.mode;
    currentStatus = s.status;
    currentCycleIndex = s.cycle_index;
    currentCyclesBeforeLong = s.cycles_before_long_break;
    if (changed) renderButtons();
  } catch (e) { /* ignore */ }
}

// ===== Events / history =====

function fmtEventTime(ts) {
  const d = new Date(ts);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  return h12 + ":" + m + ":" + s + " " + ampm;
}

async function loadEvents() {
  try {
    const events = await api("GET", "/events?limit=50");
    const eventList = $("event-list");
    eventList.innerHTML = "";
    for (const ev of events) {
      const li = document.createElement("li");
      const time = fmtEventTime(ev.ts);
      let detail = "";
      if (ev.type === "distraction" || ev.type === "note_added") detail = ev.payload.message || "";
      else if (ev.type === "started" && ev.payload.intent) detail = ev.payload.intent;
      else if (ev.payload.mode) detail = modeDisplay(ev.payload.mode);
      li.innerHTML =
        '<span class="event-time">' + time + "</span>" +
        '<span class="event-type">' + ev.type + "</span>" +
        '<span class="event-detail">' + detail + "</span>";
      eventList.appendChild(li);
    }
  } catch (e) { /* ignore */ }
}

// ===== Today: goal + distraction count =====

async function loadToday() {
  try {
    const data = await api("GET", "/today");
    $("distraction-count").textContent = data.distractions_count || 0;
    const done = data.work_sessions_completed || 0;
    const goal = data.daily_goal_pomodoros || 0;
    if (goal > 0) {
      const pct = Math.min(100, Math.round((done / goal) * 100));
      goalFill.style.width = pct + "%";
      goalFill.classList.toggle("goal-done", done >= goal);
      goalLabel.textContent = done >= goal
        ? "Goal reached: " + done + " / " + goal + " 🎉"
        : done + " / " + goal + " pomodoros today";
    } else {
      goalFill.style.width = "0%";
      goalLabel.textContent = done + " pomodoro" + (done !== 1 ? "s" : "") + " today";
    }
  } catch (e) { /* ignore */ }
}

// ===== Distraction & notes =====

$("btn-distraction").addEventListener("click", async () => {
  const di = $("distraction-input");
  const msg = di.value.trim();
  if (!msg) {
    di.focus();
    di.classList.add("input-error");
    setTimeout(() => di.classList.remove("input-error"), 600);
    return;
  }
  await api("POST", "/distractions", { message: msg });
  di.value = "";
  loadToday();
  loadEvents();
});
$("distraction-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-distraction").click(); });

$("btn-note").addEventListener("click", async () => {
  const ni = $("note-input");
  const msg = ni.value.trim();
  if (!msg) return;
  await api("POST", "/notes", { message: msg });
  ni.value = "";
  loadEvents();
});
$("note-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-note").click(); });

// ===== Tasks =====

function taskOptionLabel(t) {
  return t.title + " (" + t.spent_pomodoros + "/" + t.estimate_pomodoros + ")";
}

async function loadTasks() {
  try {
    const tasks = await api("GET", "/tasks");
    renderTaskList(tasks);
    renderTaskSelect(tasks);
  } catch (e) { /* ignore */ }
}

function renderTaskSelect(tasks) {
  const prev = taskSelect.value;
  taskSelect.innerHTML = '<option value="">No task — free focus</option>';
  for (const t of tasks) {
    if (t.status === "done") continue;
    const o = document.createElement("option");
    o.value = t.id;
    o.textContent = taskOptionLabel(t);
    taskSelect.appendChild(o);
  }
  taskSelect.value = prev;
}

function renderTaskList(tasks) {
  const list = $("task-list");
  list.innerHTML = "";
  if (tasks.length === 0) {
    list.innerHTML = '<li class="empty">No tasks yet. Add one above.</li>';
    return;
  }
  for (const t of tasks) {
    const li = document.createElement("li");
    li.className = "task" + (t.status === "done" ? " task-done" : "");
    const over = t.spent_pomodoros > t.estimate_pomodoros;
    const pct = Math.min(100, Math.round((t.spent_pomodoros / Math.max(1, t.estimate_pomodoros)) * 100));
    li.innerHTML =
      '<div class="task-main">' +
        '<input type="checkbox" class="task-check" ' + (t.status === "done" ? "checked" : "") + ' />' +
        '<span class="task-title">' + escapeHtml(t.title) + "</span>" +
        '<span class="task-count' + (over ? " over" : "") + '">' + t.spent_pomodoros + " / " + t.estimate_pomodoros + "</span>" +
      "</div>" +
      '<div class="task-bar"><div class="task-fill' + (over ? " over" : "") + '" style="width:' + pct + '%"></div></div>' +
      '<div class="task-actions">' +
        (t.status === "done" ? "" : '<button class="task-start btn-green">Start</button>') +
        '<button class="task-del btn-red">Delete</button>' +
      "</div>";

    li.querySelector(".task-check").addEventListener("change", async (e) => {
      await api("PATCH", "/tasks/" + t.id, { status: e.target.checked ? "done" : "active" });
      loadTasks();
    });
    const startBtn = li.querySelector(".task-start");
    if (startBtn) startBtn.addEventListener("click", async () => {
      await api("POST", "/cmd", { type: "start", mode: "work", task_id: t.id });
      showTab("timer");
      refresh();
    });
    li.querySelector(".task-del").addEventListener("click", async () => {
      await api("DELETE", "/tasks/" + t.id);
      loadTasks();
    });
    list.appendChild(li);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("btn-add-task").addEventListener("click", async () => {
  const title = $("task-title").value.trim();
  if (!title) { $("task-title").focus(); return; }
  const estimate = parseInt($("task-estimate").value, 10) || 1;
  await api("POST", "/tasks", { title, estimate_pomodoros: estimate });
  $("task-title").value = "";
  $("task-estimate").value = "1";
  loadTasks();
});
$("task-title").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-add-task").click(); });

// ===== Plan =====

let planLoaded = false;

async function loadPlannerConfig() {
  const cfg = await api("GET", "/planner/config");
  $("pl-start").value = cfg.work_start;
  $("pl-end").value = cfg.work_end;
  $("pl-session").value = cfg.session_min;
  $("pl-short").value = cfg.short_break_min;
  $("pl-long").value = cfg.long_break_min;
  $("pl-cycles").value = cfg.cycles_before_long_break;
  $("pl-lunch-start").value = cfg.lunch_start;
  $("pl-lunch-min").value = cfg.lunch_min;
}

async function loadPlan() {
  try {
    if (!planLoaded) { await loadPlannerConfig(); planLoaded = true; }
    const [plan, tasks] = await Promise.all([
      api("GET", "/plan"),
      api("GET", "/tasks?include_done=false"),
    ]);
    renderPlan(plan, tasks);
  } catch (e) { /* ignore */ }
}

function renderPlan(plan, tasks) {
  const wrap = $("plan-blocks");
  wrap.innerHTML = "";
  for (const b of plan.blocks) {
    const div = document.createElement("div");
    div.className = "plan-block block-" + b.type + " status-" + b.status;
    const time = '<span class="block-time">' + b.start + "–" + b.end + "</span>";
    const typeLabel = '<span class="block-type">' + modeDisplay(b.type) + "</span>";

    if (b.type === "work") {
      const sel = document.createElement("select");
      sel.className = "block-task";
      sel.innerHTML = '<option value="">— assign task —</option>';
      for (const t of tasks) {
        const o = document.createElement("option");
        o.value = t.id;
        o.textContent = taskOptionLabel(t);
        if (b.task_id === t.id) o.selected = true;
        sel.appendChild(o);
      }
      // include a free-text option for intents without a task
      sel.addEventListener("change", async () => {
        const val = sel.value;
        await api("POST", "/plan/block", { index: b.index, task_id: val ? parseInt(val, 10) : null });
        loadPlan();
      });

      div.innerHTML = time + typeLabel;
      if (b.intent && !b.task_id) {
        const intentSpan = document.createElement("span");
        intentSpan.className = "block-intent";
        intentSpan.textContent = b.intent;
        div.appendChild(intentSpan);
      }
      div.appendChild(sel);
      const startBtn = document.createElement("button");
      startBtn.className = "block-start btn-green";
      startBtn.textContent = b.status === "done" ? "Re-run" : "Start";
      startBtn.addEventListener("click", async () => {
        await api("POST", "/plan/start", { index: b.index });
        showTab("timer");
        refresh();
      });
      div.appendChild(startBtn);
    } else {
      div.innerHTML = time + typeLabel +
        '<span class="block-intent">' + escapeHtml(b.intent || "") + "</span>";
      if (b.type !== "lunch") {
        const startBtn = document.createElement("button");
        startBtn.className = "block-start";
        startBtn.textContent = "Start";
        startBtn.addEventListener("click", async () => {
          await api("POST", "/plan/start", { index: b.index });
          showTab("timer");
          refresh();
        });
        div.appendChild(startBtn);
      }
    }
    wrap.appendChild(div);
  }
}

$("btn-generate-plan").addEventListener("click", async () => {
  await api("POST", "/planner/config", {
    work_start: $("pl-start").value,
    work_end: $("pl-end").value,
    session_min: parseInt($("pl-session").value, 10) || 25,
    short_break_min: parseInt($("pl-short").value, 10) || 5,
    long_break_min: parseInt($("pl-long").value, 10) || 15,
    cycles_before_long_break: parseInt($("pl-cycles").value, 10) || 4,
    lunch_start: $("pl-lunch-start").value,
    lunch_min: parseInt($("pl-lunch-min").value, 10) || 0,
  });
  await api("POST", "/plan/generate", {});
  loadPlan();
});

// ===== Stats =====

async function loadStats() {
  try {
    const data = await api("GET", "/stats?days=14");
    renderStatsSummary(data);
    renderStatsChart(data.series);
  } catch (e) { /* ignore */ }
}

function statCard(value, label) {
  return '<div class="stat-card"><div class="stat-value">' + value + '</div><div class="stat-label">' + label + "</div></div>";
}

function renderStatsSummary(data) {
  const t = data.totals;
  const best = data.best_day && data.best_day.date
    ? new Date(data.best_day.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " (" + data.best_day.work_sessions + ")"
    : "—";
  $("stats-summary").innerHTML =
    statCard("🔥 " + data.current_streak, "day streak") +
    statCard(t.work_sessions, "pomodoros (" + data.days + "d)") +
    statCard(fmtFocus(t.focus_sec), "focus time") +
    statCard(t.avg_sessions_per_active_day, "avg / active day") +
    statCard(t.distractions, "distractions") +
    statCard(best, "best day");
}

function renderStatsChart(series) {
  const chart = $("stats-chart");
  chart.innerHTML = "";
  const max = Math.max(1, ...series.map((d) => d.work_sessions), series[0] ? series[0].goal : 1);
  for (const d of series) {
    const col = document.createElement("div");
    col.className = "chart-col";
    const h = Math.round((d.work_sessions / max) * 100);
    const date = new Date(d.date);
    const label = date.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2) + " " + date.getDate();
    col.innerHTML =
      '<div class="chart-bar-wrap" title="' + d.work_sessions + ' pomodoros, ' + d.distractions + ' distractions">' +
        '<div class="chart-bar' + (d.goal_met ? " met" : "") + '" style="height:' + h + '%"></div>' +
      "</div>" +
      '<div class="chart-count">' + (d.work_sessions || "") + "</div>" +
      '<div class="chart-label">' + label + "</div>";
    chart.appendChild(col);
  }
}

// ===== Settings =====

const settingsPanel = $("settings-panel");
$("btn-settings-toggle").addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
  if (!settingsPanel.classList.contains("hidden")) loadConfig();
});

async function loadConfig() {
  try {
    const cfg = await api("GET", "/config");
    $("cfg-work").value = Math.round(cfg.work_sec / 60);
    $("cfg-short-break").value = Math.round(cfg.short_break_sec / 60);
    $("cfg-long-break").value = Math.round(cfg.long_break_sec / 60);
    $("cfg-cycles").value = cfg.cycles_before_long_break;
    $("cfg-goal").value = cfg.daily_goal_pomodoros;
  } catch (e) { /* ignore */ }
}

$("btn-save-config").addEventListener("click", async () => {
  await api("POST", "/cmd", {
    type: "set_config",
    work_sec: (parseInt($("cfg-work").value, 10) || 25) * 60,
    short_break_sec: (parseInt($("cfg-short-break").value, 10) || 5) * 60,
    long_break_sec: (parseInt($("cfg-long-break").value, 10) || 15) * 60,
    cycles_before_long_break: parseInt($("cfg-cycles").value, 10) || 4,
    daily_goal_pomodoros: parseInt($("cfg-goal").value, 10) || 0,
  });
  settingsPanel.classList.add("hidden");
  refresh();
});

// ===== Refresh loop =====

function refresh() {
  loadEvents();
  loadToday();
  loadTasks();
}

renderButtons();
setInterval(pollState, 1000);
setInterval(loadToday, 5000);
setInterval(loadEvents, 5000);
pollState();
refresh();

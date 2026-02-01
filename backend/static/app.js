const timerEl = document.getElementById("timer");
const modeEl = document.getElementById("mode-label");
const statusEl = document.getElementById("status-label");
const cycleEl = document.getElementById("cycle-label");
const intentEl = document.getElementById("intent-label");
const intentInput = document.getElementById("intent-input");
const noteInput = document.getElementById("note-input");
const eventList = document.getElementById("event-list");

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function modeDisplay(mode) {
  return mode.replace(/_/g, " ");
}

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  return res.json();
}

async function pollState() {
  try {
    const s = await api("GET", "/state");
    timerEl.textContent = fmt(s.remaining_sec);
    modeEl.textContent = modeDisplay(s.mode);
    statusEl.textContent = s.status;
    cycleEl.textContent = "Cycle " + s.cycle_index + " / " + s.cycles_before_long_break;
    intentEl.textContent = s.intent ? s.intent : "";
  } catch (e) {
    /* ignore transient fetch errors */
  }
}

async function loadEvents() {
  try {
    const events = await api("GET", "/events?limit=50");
    eventList.innerHTML = "";
    for (const ev of events) {
      const li = document.createElement("li");
      const time = ev.ts.substring(11, 19);
      let detail = "";
      if (ev.type === "note_added") {
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
  } catch (e) {
    /* ignore */
  }
}

document.getElementById("btn-start-work").addEventListener("click", async () => {
  const intent = intentInput.value.trim();
  const body = { type: "start", mode: "work" };
  if (intent) body.intent = intent;
  await api("POST", "/cmd", body);
  loadEvents();
});

document.getElementById("btn-start-break").addEventListener("click", async () => {
  await api("POST", "/cmd", { type: "start", mode: "short_break" });
  loadEvents();
});

document.getElementById("btn-toggle").addEventListener("click", async () => {
  await api("POST", "/cmd", { type: "toggle" });
  loadEvents();
});

document.getElementById("btn-skip").addEventListener("click", async () => {
  await api("POST", "/cmd", { type: "skip" });
  loadEvents();
});

document.getElementById("btn-stop").addEventListener("click", async () => {
  await api("POST", "/cmd", { type: "stop" });
  loadEvents();
});

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

// Poll state every second, refresh events every 5 seconds
setInterval(pollState, 1000);
setInterval(loadEvents, 5000);
pollState();
loadEvents();

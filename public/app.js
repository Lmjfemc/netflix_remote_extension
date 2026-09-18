const $ = (id) => document.getElementById(id);
// The session key lives in localStorage so a phone stays paired across tab
// closes and helper restarts. Storage can be unavailable (private mode), so
// every access is guarded and the page still works for one session.
const store = {
  get() {
    try {
      return localStorage.getItem("remote-key");
    } catch {
      return null;
    }
  },
  set(v) {
    try {
      localStorage.setItem("remote-key", v);
    } catch {}
  },
  clear() {
    try {
      localStorage.removeItem("remote-key");
    } catch {}
  },
};
let ws,
  key = store.get(),
  state = {},
  online = false,
  stopped = false,
  dragging = false,
  catalogHash = "",
  checking = false,
  retryDelay = 2000,
  retryTimer = null;
function message(t) {
  $("message").textContent = t;
  clearTimeout(message.timer);
  message.timer = setTimeout(() => ($("message").textContent = ""), 5000);
}
const format = (n) => {
  n = Math.max(0, Math.floor(n || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};
function command(command, value) {
  if (!online || ws?.readyState !== 1) {
    message("Waiting for Netflix to reconnect.");
    return;
  }
  ws.send(
    JSON.stringify({
      type: "command",
      command,
      value,
      id: `${Date.now()}-${Math.random()}`,
    }),
  );
}
function render() {
  const s = state;
  const ready = online && s.ready;
  $("title").textContent = s.playingPage
    ? s.title
    : "Choose something to watch";
  $("detail").textContent = !online
    ? "Open Netflix in Chrome on your PC"
    : s.ad
      ? "Ad playing · seeking unavailable"
      : ready
        ? s.paused
          ? "Paused"
          : "Playing"
        : "Browse titles below";
  $("play").textContent = s.paused ? "▶" : "Ⅱ";
  $("play").setAttribute("aria-label", s.paused ? "Play" : "Pause");
  $("play").disabled = !ready;
  for (const id of ["back", "forward", "seek"]) $(id).disabled = !ready || s.ad;
  for (const id of ["volume", "mute"]) $(id).disabled = !ready;
  for (const id of ["fullscreen", "browse", "auto"]) $(id).disabled = !online;
  $("next").disabled = !ready || s.ad || !s.canNext;
  $("skip").disabled = !ready || s.ad || !s.canSkipIntro;
  $("recap").disabled = !ready || s.ad || !s.canSkipRecap;
  if (ready && s.seeking) $("detail").textContent = "Seeking…";
  // Adapter self-diagnosis (player API missing, adapter exception) outranks
  // the generic status line so the user learns why controls are disabled.
  if (online && s.warning) $("detail").textContent = s.warning;
  if (!dragging) {
    const displayTime = s.seeking ? s.seekTarget : s.time;
    $("seek").max = s.duration || 1;
    $("seek").value = displayTime || 0;
    $("elapsed").textContent = format(displayTime);
  }
  $("duration").textContent = format(s.duration);
  if (document.activeElement !== $("volume")) $("volume").value = s.volume ?? 1;
  $("volumeValue").textContent = Math.round((s.volume ?? 1) * 100) + "%";
  $("mute").textContent = s.muted ? "Unmute" : "Mute";
  $("auto").checked = !!s.autoSkip;
  $("fullscreen").textContent = s.fullscreen
    ? "Exit full screen"
    : "Full screen";
}
function cards(items) {
  const h = JSON.stringify(items);
  if (h === catalogHash) return;
  catalogHash = h;
  $("cards").replaceChildren();
  $("empty").hidden = !!items.length;
  for (const item of items) {
    const b = document.createElement("button");
    b.className = "card";
    const img = document.createElement("img");
    try {
      const u = new URL(item.image);
      if (
        u.protocol === "https:" &&
        /(^|\.)(nflxso|nflximg)\.net$/.test(u.hostname)
      )
        img.src = u.href;
    } catch {}
    img.alt = "";
    img.loading = "lazy";
    const title = document.createElement("span");
    title.textContent = item.title;
    const hint = document.createElement("small");
    hint.textContent = "Play on PC →";
    b.append(img, title, hint);
    b.onclick = () => {
      command("select", item.id);
      message("Opening " + item.title + " on your PC");
    };
    $("cards").append(b);
  }
}
function setStatus(text, isOnline = false) {
  $("status").textContent = text;
  $("status").classList.toggle("online", isOnline);
}
// Forget the key and go back to the code form. Only called when the PC said
// the key is invalid or the user unpaired, never because the PC was merely off.
function showPairing(text) {
  key = null;
  store.clear();
  online = false;
  state = {};
  $("remote").hidden = true;
  $("pair").hidden = false;
  setStatus("Not paired");
  if (text) message(text);
}
function retry() {
  if (stopped || retryTimer) return;
  if (retryDelay === 2000)
    message(
      "Can't reach the PC. Retrying… To pair with a new code, tap Unpair.",
    );
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, retryDelay);
  retryDelay = Math.min(15000, retryDelay * 2);
}
async function connect() {
  if (!key || checking || ws?.readyState === 0 || ws?.readyState === 1) return;
  $("pair").hidden = true;
  $("remote").hidden = false;
  // Ask the PC whether this key is still valid before opening the socket. A
  // failed WebSocket upgrade exposes no status code, so this is the only way
  // to tell "PC is off, keep waiting" from "pairing was reset, ask for a code".
  checking = true;
  let verdict = null;
  try {
    const r = await fetch("/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (r.status === 204) verdict = true;
    else if (r.status === 401) verdict = false;
  } catch {}
  checking = false;
  if (stopped) return;
  if (verdict === false) {
    showPairing("Pairing was reset on the PC. Enter the new code.");
    return;
  }
  if (verdict === null) {
    setStatus("Looking for PC…");
    retry();
    return;
  }
  ws = new WebSocket(
    `ws://${location.host}/ws?role=phone&key=${encodeURIComponent(key)}`,
  );
  ws.onopen = () => {
    retryDelay = 2000;
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "status") {
      online = m.pc;
      setStatus(online ? "● PC connected" : "Waiting for PC", online);
      render();
    }
    if (m.type === "state") {
      state = m.state;
      render();
    }
    if (m.type === "catalog") cards(m.catalog || []);
    if (m.type === "ack" && m.error) message(m.error);
  };
  ws.onclose = (e) => {
    online = false;
    render();
    setStatus("Disconnected");
    if (e.code === 4001) {
      stopped = true;
      message("Another phone connected. Pair again to take control.");
      return;
    }
    if (e.code === 4002) {
      showPairing("Pairing was reset on the PC. Enter the new code.");
      return;
    }
    retry();
  };
  // onclose follows every error and owns the retry; no toast per attempt.
  ws.onerror = () => {};
}
async function pair(code) {
  try {
    const r = await fetch("/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await r.json();
    if (!r.ok) throw Error(data.error);
    key = data.key;
    store.set(key);
    stopped = false;
    retryDelay = 2000;
    history.replaceState(null, "", location.pathname);
    connect();
  } catch (e) {
    message(e.message);
  }
}
$("pairForm").onsubmit = (e) => {
  e.preventDefault();
  pair($("code").value);
};
$("play").onclick = () => command(state.paused ? "play" : "pause");
$("back").onclick = () => command("seekBy", -10);
$("forward").onclick = () => command("seekBy", 10);
$("seek").oninput = () => {
  dragging = true;
  $("elapsed").textContent = format($("seek").value);
};
$("seek").onchange = () => {
  command("seek", Number($("seek").value));
  dragging = false;
};
$("seek").onpointercancel = () => {
  dragging = false;
};
$("volume").onchange = () => command("volume", Number($("volume").value));
$("mute").onclick = () => command("mute", !state.muted);
$("fullscreen").onclick = () => command("fullscreen");
$("skip").onclick = () => command("skipIntro");
$("next").onclick = () => command("next");
$("auto").onchange = () => command("autoSkip", $("auto").checked);
$("browse").onclick = () => command("browse");
$("searchForm").onsubmit = (e) => {
  e.preventDefault();
  command("search", $("query").value.trim());
};
$("disconnect").onclick = () => {
  stopped = true;
  clearTimeout(retryTimer);
  ws?.close();
  store.clear();
  location.assign("/");
};
$("recap").onclick = () => command("skipRecap");
const code = new URLSearchParams(location.hash.slice(1)).get("code");
if (code) {
  $("code").value = code;
  pair(code);
} else connect();
document.addEventListener("visibilitychange", () => {
  if (document.hidden || stopped || !key) return;
  // Coming back to the foreground: reconnect right away rather than waiting
  // out whatever backoff was pending while the phone slept.
  clearTimeout(retryTimer);
  retryTimer = null;
  retryDelay = 2000;
  if (!ws || ws.readyState === 3) connect();
});

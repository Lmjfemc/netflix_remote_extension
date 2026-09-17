const $ = (id) => document.getElementById(id);
let ws,
  key = sessionStorage.getItem("remote-key"),
  state = {},
  online = false,
  stopped = false,
  dragging = false,
  catalogHash = "",
  failedConnections = 0;
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
function connect() {
  if (!key || ws?.readyState === 0 || ws?.readyState === 1) return;
  $("pair").hidden = true;
  $("remote").hidden = false;
  ws = new WebSocket(
    `ws://${location.host}/ws?role=phone&key=${encodeURIComponent(key)}`,
  );
  ws.onopen = () => {
    failedConnections = 0;
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "status") {
      online = m.pc;
      $("status").textContent = online ? "● PC connected" : "Waiting for PC";
      $("status").classList.toggle("online", online);
      render();
    }
    if (m.type === "state") {
      state = m.state;
      cards(m.catalog || []);
      render();
    }
    if (m.type === "ack" && m.error) message(m.error);
  };
  ws.onclose = (e) => {
    online = false;
    render();
    $("status").textContent = "Disconnected";
    $("status").classList.remove("online");
    if (e.code === 4001) {
      stopped = true;
      message("Another phone connected. Pair again to take control.");
    }
    if (++failedConnections >= 3 && !stopped) {
      key = null;
      sessionStorage.removeItem("remote-key");
      $("remote").hidden = true;
      $("pair").hidden = false;
      message("Reconnect with the current code on your PC.");
      return;
    }
    if (!stopped) setTimeout(connect, 2000);
  };
  ws.onerror = () => {
    message(
      "Connection failed. Check Wi-Fi and the PC server. If restarted, unpair and enter the new code.",
    );
  };
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
    sessionStorage.setItem("remote-key", key);
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
  ws?.close();
  sessionStorage.removeItem("remote-key");
  location.assign("/");
};
$("recap").onclick = () => command("skipRecap");
const code = new URLSearchParams(location.hash.slice(1)).get("code");
if (code) {
  $("code").value = code;
  pair(code);
} else connect();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !stopped && key && ws?.readyState === 3) connect();
});

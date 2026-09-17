const HOST = "com.netflixlan.remote";
let nativePort = null,
  selectedTab = null,
  previousWindowState = "normal",
  setup = null,
  lastError = "",
  latestState = null;
function send(m) {
  try {
    nativePort?.postMessage(m);
  } catch {}
}
function status() {
  return {
    running: !!nativePort && !!setup,
    starting: !!nativePort && !setup,
    setup,
    error: lastError,
  };
}
function start() {
  if (nativePort) return status();
  lastError = "";
  try {
    const port = chrome.runtime.connectNative(HOST);
    nativePort = port;
    port.onMessage.addListener((m) => {
      if (nativePort !== port) return;
      if (m.type === "ready") {
        setup = m;
        if (latestState) send(latestState);
        return;
      }
      if (m.type === "error") {
        lastError = m.error;
        return;
      }
      if (m.type === "command") handleCommand(m);
    });
    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      if (nativePort === port) {
        nativePort = null;
        setup = null;
        if (!lastError) lastError = err?.message || "";
      }
    });
  } catch (e) {
    nativePort = null;
    lastError = e.message;
  }
  return status();
}
function stop() {
  const port = nativePort;
  nativePort = null;
  setup = null;
  lastError = "";
  if (port) {
    try {
      port.postMessage({ type: "stop" });
      port.disconnect();
    } catch {}
  }
  return status();
}
async function handleCommand(m) {
  try {
    if (!selectedTab) throw Error("Open Netflix in Chrome.");
    if (m.command === "fullscreen") {
      const t = await chrome.tabs.get(selectedTab),
        w = await chrome.windows.get(t.windowId);
      if (w.state !== "fullscreen") previousWindowState = w.state;
      await chrome.windows.update(w.id, {
        state: w.state === "fullscreen" ? previousWindowState : "fullscreen",
      });
      send({ type: "ack", id: m.id });
      return;
    }
    if (m.command === "autoSkip")
      await chrome.storage.local.set({ autoSkip: !!m.value });
    const r = await chrome.tabs.sendMessage(selectedTab, m);
    send({ type: "ack", id: m.id, ...r });
  } catch (err) {
    send({ type: "ack", id: m.id, error: err.message });
  }
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (sender.url === chrome.runtime.getURL("popup.html")) {
    if (m.type === "start") reply(start());
    else if (m.type === "stop") reply(stop());
    else if (m.type === "status") reply(status());
    return;
  }
  if (!sender.tab?.url?.startsWith("https://www.netflix.com/")) return;
  if (
    m.type === "state" &&
    (selectedTab === null ||
      m.state.playingPage ||
      sender.tab.id === selectedTab)
  ) {
    selectedTab = sender.tab.id;
    chrome.windows
      .get(sender.tab.windowId)
      .then((w) => {
        latestState = {
          ...m,
          state: { ...m.state, fullscreen: w.state === "fullscreen" },
        };
        send(latestState);
      })
      .catch(() => {});
  }
  if (m.type === "settings") {
    chrome.storage.local.get({ autoSkip: false }).then(reply);
    return true;
  }
});
chrome.tabs.onRemoved.addListener((id) => {
  if (id === selectedTab) {
    selectedTab = null;
    latestState = null;
  }
});

const HOST = "com.netflixlan.remote";
// Exponential backoff: 1s, 2s, 4s ... capped at 30s, at most this many tries
// before giving up. Enough to ride out a helper crash or a port-in-use race,
// short enough that a missing host installation does not retry forever.
const MAX_RECONNECTS = 10;
let nativePort = null,
  selectedTab = null,
  selectedDocument = null,
  previousWindowState = "normal",
  setup = null,
  lastError = "",
  latestState = null,
  latestCatalog = null,
  catalogVersion = null,
  catalogRequestedAt = 0,
  wantRunning = false,
  intentChanged = false,
  reconnectAttempts = 0,
  reconnectTimer = null;
function send(m) {
  try {
    nativePort?.postMessage(m);
  } catch {}
}
function status() {
  return {
    running: !!nativePort && !!setup,
    starting: !!nativePort && !setup,
    reconnecting: !nativePort && wantRunning,
    attempts: reconnectAttempts,
    setup,
    error: lastError,
  };
}
// The user's intent ("keep the remote on") survives service worker restarts in
// session storage: it is per browser session, extension-private and never
// written to disk. Everything else is rebuilt from the host and the tab.
function remember(value) {
  intentChanged = true;
  wantRunning = value;
  chrome.storage.session.set({ wantRunning: value }).catch(() => {});
}
function connect() {
  if (nativePort) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  let ready = false,
    hostError = "";
  try {
    const port = chrome.runtime.connectNative(HOST);
    nativePort = port;
    port.onMessage.addListener((m) => {
      if (nativePort !== port) return;
      if (m.type === "ready") {
        ready = true;
        reconnectAttempts = 0;
        lastError = "";
        const { key, ...rest } = m;
        setup = rest;
        // Keep the session key (extension-private storage, never on the LAN
        // page) so the next helper launch can resume it and paired phones
        // reconnect without a new code.
        if (key) chrome.storage.local.set({ sessionKey: key }).catch(() => {});
        if (latestState) send(latestState);
        if (latestCatalog) send(latestCatalog);
        return;
      }
      if (m.type === "error") {
        hostError = m.error;
        lastError = m.error;
        return;
      }
      if (m.type === "command") handleCommand(m);
    });
    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      if (nativePort !== port) return;
      nativePort = null;
      setup = null;
      // stop() already cleared wantRunning; anything else is unexpected.
      if (!wantRunning) return;
      lastError =
        hostError ||
        err?.message ||
        (ready
          ? "보조 프로그램과의 연결이 끊어졌습니다."
          : "보조 프로그램이 준비되기 전에 종료되었습니다.");
      scheduleReconnect();
    });
    // Authentication stays unavailable until the stored key is restored.
    chrome.storage.local
      .get({ sessionKey: "" })
      .then((s) => {
        if (nativePort === port)
          send({ type: "hello", key: s.sessionKey || undefined });
      })
      .catch(() => {
        if (nativePort === port) send({ type: "hello" });
      });
  } catch (e) {
    nativePort = null;
    lastError = e.message;
    if (wantRunning) scheduleReconnect();
  }
}
// New key and code on the helper; the connected phone is told to re-pair and
// the stored key is dropped so a later restart cannot resurrect it.
function rotate() {
  chrome.storage.local.remove("sessionKey").catch(() => {});
  send({ type: "rotate" });
  return status();
}
function scheduleReconnect() {
  if (reconnectTimer) return;
  if (reconnectAttempts >= MAX_RECONNECTS) {
    remember(false);
    lastError = `자동 재연결 ${MAX_RECONNECTS}회 실패: ${lastError}`;
    return;
  }
  const delay = Math.min(30000, 1000 * 2 ** reconnectAttempts);
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (wantRunning && !nativePort) connect();
  }, delay);
}
// Safety net for the case where this worker was restarted and no timer exists:
// any incoming event (tab heartbeat, popup poll) re-establishes the host.
function ensureRunning() {
  if (wantRunning && !nativePort && !reconnectTimer) connect();
}
function start() {
  reconnectAttempts = 0;
  lastError = "";
  remember(true);
  connect();
  return status();
}
function stop() {
  remember(false);
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectAttempts = 0;
  lastError = "";
  const port = nativePort;
  nativePort = null;
  setup = null;
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
// The adapter only emits the catalog when it changes. If this worker has no
// copy for the selected tab (worker restart, tab switch, lost message), the
// catalogVersion carried by the state heartbeat reveals the gap and we ask
// that tab for a resync instead of receiving the whole list every 750 ms.
function requestCatalog(tabId) {
  if (Date.now() - catalogRequestedAt < 3000) return;
  catalogRequestedAt = Date.now();
  chrome.tabs.sendMessage(tabId, { type: "sync" }).catch(() => {});
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (sender.url === chrome.runtime.getURL("popup.html")) {
    if (m.type === "start") reply(start());
    else if (m.type === "stop") reply(stop());
    else if (m.type === "rotate") reply(rotate());
    else if (m.type === "status") {
      ensureRunning();
      reply(status());
    }
    return;
  }
  if (!sender.tab?.url?.startsWith("https://www.netflix.com/")) return;
  if (
    m.type === "state" &&
    (selectedTab === null ||
      m.state.playingPage ||
      sender.tab.id === selectedTab)
  ) {
    ensureRunning();
    if (sender.tab.id !== selectedTab) {
      selectedTab = sender.tab.id;
      latestCatalog = null;
      catalogVersion = null;
    }
    if (sender.documentId !== selectedDocument) {
      selectedDocument = sender.documentId;
      catalogVersion = null;
      catalogRequestedAt = 0;
    }
    if (m.state.catalogVersion !== catalogVersion)
      requestCatalog(sender.tab.id);
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
  if (m.type === "catalog" && sender.tab.id === selectedTab) {
    if (sender.documentId !== selectedDocument) return;
    catalogVersion = m.version;
    // A new watch document has never scanned a browse catalog. Its sync
    // acknowledges the version without erasing the last usable list.
    // A scanned browse/search page may legitimately publish an empty array.
    if (!m.available) return;
    latestCatalog = { type: "catalog", version: m.version, catalog: m.catalog };
    send(latestCatalog);
  }
  if (m.type === "settings") {
    chrome.storage.local.get({ autoSkip: false }).then(reply);
    return true;
  }
});
chrome.tabs.onRemoved.addListener((id) => {
  if (id === selectedTab) {
    selectedTab = null;
    selectedDocument = null;
    latestState = null;
    latestCatalog = null;
    catalogVersion = null;
  }
});
// Worker (re)start: if the user left the remote on, bring the host back. When
// the worker was terminated the native port died with it and the Go helper
// exited on stdin EOF, so this is a fresh launch, not a reattach.
chrome.storage.session
  .get({ wantRunning: false })
  .then((s) => {
    if (!intentChanged && s.wantRunning && !nativePort) {
      wantRunning = true;
      connect();
    }
  })
  .catch(() => {});

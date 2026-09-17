(() => {
  const pending = new Map();
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "netflix-lan-adapter") return;
    const m = e.data;
    if (m.type === "state")
      chrome.runtime
        .sendMessage({ type: "state", state: m.state, catalog: m.catalog })
        .catch(() => {});
    if (m.type === "ack" && pending.has(m.id)) {
      pending.get(m.id)(m.error ? { error: m.error } : {});
      pending.delete(m.id);
    }
  });
  chrome.runtime.onMessage.addListener((m, s, r) => {
    if (m.type !== "command") return;
    pending.set(m.id, r);
    window.postMessage(
      { ...m, source: "netflix-lan-content" },
      location.origin,
    );
    setTimeout(() => {
      if (pending.has(m.id)) {
        pending.delete(m.id);
        r({ error: "Netflix adapter timed out." });
      }
    }, 6500);
    return true;
  });
  chrome.runtime
    .sendMessage({ type: "settings" })
    .then((s) =>
      window.postMessage(
        {
          source: "netflix-lan-content",
          type: "command",
          command: "autoSkip",
          value: s.autoSkip,
          id: "settings",
        },
        location.origin,
      ),
    )
    .catch(() => {});
})();

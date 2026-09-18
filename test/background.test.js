import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
const source = fs.readFileSync(
  new URL("../extension/background.js", import.meta.url),
  "utf8",
);
function fixture() {
  let listener, restore;
  const ports = [],
    sent = [],
    timers = new Map();
  let seq = 0;
  const chrome = {
    runtime: {
      id: "test",
      getURL: (p) => "chrome-extension://test/" + p,
      onMessage: { addListener: (f) => (listener = f) },
      connectNative() {
        const p = {
          postMessage: (m) => sent.push(m),
          disconnect() {},
          onMessage: { addListener: (f) => (p.message = f) },
          onDisconnect: { addListener: (f) => (p.disconnected = f) },
        };
        ports.push(p);
        return p;
      },
    },
    storage: {
      session: {
        set: async () => {},
        get: () => new Promise((r) => (restore = r)),
      },
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
    },
    tabs: { sendMessage: async () => {}, onRemoved: { addListener() {} } },
    windows: { get: async () => ({ state: "normal" }) },
  };
  vm.runInNewContext(source, {
    chrome,
    Date,
    setTimeout: (f, delay) => {
      timers.set(++seq, { f, delay });
      return seq;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  return {
    ports,
    sent,
    timers,
    restore,
    popup(type) {
      let result;
      listener(
        { type },
        { id: "test", url: "chrome-extension://test/popup.html" },
        (v) => (result = v),
      );
      return result;
    },
    msg: (m, doc = "browse", url = "browse") =>
      listener(
        m,
        {
          id: "test",
          documentId: doc,
          tab: { id: 1, windowId: 1, url: "https://www.netflix.com/" + url },
        },
        () => {},
      ),
  };
}
test("explicit stop wins over delayed session restoration", async () => {
  const f = fixture();
  f.popup("stop");
  f.restore({ wantRunning: true });
  await Promise.resolve();
  assert.equal(f.ports.length, 0);
});
test("restore starts once and explicit stop cancels reconnect", async () => {
  const f = fixture();
  f.restore({ wantRunning: true });
  await Promise.resolve();
  assert.equal(f.ports.length, 1);
  f.ports[0].disconnected();
  assert.equal(f.timers.size, 1);
  f.popup("stop");
  assert.equal(f.timers.size, 0);
  assert.equal(f.popup("status").reconnecting, false);
});
test("reconnect stops after ten failed retries", async () => {
  const f = fixture();
  f.restore({ wantRunning: false });
  await Promise.resolve();
  f.popup("start");
  for (let i = 0; i < 10; i++) {
    f.ports.at(-1).disconnected();
    assert.equal(f.timers.size, 1);
    const [id, timer] = [...f.timers][0];
    assert.equal(timer.delay, Math.min(30000, 1000 * 2 ** i));
    f.timers.delete(id);
    timer.f();
  }
  f.ports.at(-1).disconnected();
  assert.equal(f.timers.size, 0);
  assert.equal(f.popup("status").reconnecting, false);
  assert.match(f.popup("status").error, /10/);
});
test("watch sync preserves browse catalog but real empty search clears it", async () => {
  const f = fixture();
  f.restore({ wantRunning: false });
  await Promise.resolve();
  f.popup("start");
  f.msg({ type: "state", state: { catalogVersion: 1 } });
  f.msg({
    type: "catalog",
    version: 1,
    available: true,
    catalog: [{ id: "123" }],
  });
  f.msg(
    { type: "state", state: { catalogVersion: 0, playingPage: true } },
    "watch",
    "watch/123",
  );
  f.msg(
    { type: "catalog", version: 0, available: false, catalog: [] },
    "watch",
    "watch/123",
  );
  assert.equal(
    f.sent.filter((m) => m.type === "catalog").at(-1).catalog.length,
    1,
  );
  f.msg(
    { type: "catalog", version: 2, available: true, catalog: [] },
    "browse",
  );
  assert.equal(
    f.sent.filter((m) => m.type === "catalog").at(-1).catalog.length,
    1,
    "ignore old document",
  );
  f.msg({ type: "state", state: { catalogVersion: 1 } }, "search", "search");
  f.msg(
    { type: "catalog", version: 1, available: true, catalog: [] },
    "search",
    "search",
  );
  assert.equal(
    f.sent.filter((m) => m.type === "catalog").at(-1).catalog.length,
    0,
  );
});

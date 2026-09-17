import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../extension/netflix-adapter.js", import.meta.url),
  "utf8",
);
function fixture({ intro = false, recap = false, ad = false } = {}) {
  let time = 100000,
    listener;
  const messages = [],
    calls = [],
    intervals = [];
  const video = { currentTime: 100, seeking: false };
  const skip = {
    getClientRects: () => [{}],
    click() {
      calls.push("click");
    },
  };
  const p = {
    getMovieId: () => 123,
    getCurrentTime: () => time,
    getDuration: () => 300000,
    isPaused: () => true,
    getVolume: () => 1,
    isMuted: () => false,
    getTimeCodes: () =>
      intro
        ? [{ type: "skip_credits", startOffsetMs: 90000, endOffsetMs: 150000 }]
        : [],
    seek(target) {
      calls.push(target);
      video.seeking = true;
      setTimeout(() => {
        time = target;
        video.currentTime = target / 1000;
        video.seeking = false;
      }, 90);
    },
  };
  const window = {
    netflix: {
      appContext: {
        state: {
          playerApp: {
            getAPI: () => ({
              videoPlayer: {
                getAllPlayerSessionIds: () => ["watch-test"],
                getVideoPlayerBySessionId: () => p,
              },
            }),
          },
        },
      },
    },
    addEventListener(type, fn) {
      listener = fn;
    },
    postMessage(m) {
      messages.push(m);
    },
  };
  const document = {
    title: "Test",
    querySelector: (s) => (s === "video" ? video : null),
    querySelectorAll(s) {
      if (s.includes("player-skip-intro") && intro) return [skip];
      if (s.includes("player-skip-recap") && recap) return [skip];
      if (s.includes("ads-info-container") && ad) return [skip];
      return [];
    },
  };
  vm.runInNewContext(source, {
    window,
    document,
    location: { pathname: "/watch/123", origin: "https://www.netflix.com" },
    sessionStorage: { getItem: () => null },
    setTimeout,
    setInterval: (fn) => intervals.push(fn),
    clearInterval,
    URL,
    Date,
    Promise,
    PointerEvent: class {},
  });
  let id = 0;
  const command = (command, value) =>
    listener({
      source: window,
      data: {
        source: "netflix-lan-content",
        type: "command",
        command,
        value,
        id: String(++id),
      },
    });
  return { command, calls, messages, intervals, p };
}
test("three rapid forward taps accumulate to thirty seconds", async () => {
  const f = fixture();
  await Promise.all([
    f.command("seekBy", 10),
    f.command("seekBy", 10),
    f.command("seekBy", 10),
  ]);
  assert.equal(f.p.getCurrentTime(), 130000);
  assert.equal(f.messages.filter((m) => m.type === "ack" && m.error).length, 0);
});
test("tap during in-flight seek uses pending target; later scrub wins", async () => {
  const f = fixture();
  const a = f.command("seekBy", 10);
  await new Promise((r) => setTimeout(r, 20));
  const b = f.command("seekBy", 10),
    c = f.command("seekBy", -10);
  await Promise.all([a, b, c]);
  assert.equal(f.p.getCurrentTime(), 110000);
  const d = f.command("seekBy", 10);
  await new Promise((r) => setTimeout(r, 20));
  const e = f.command("seek", 42);
  await Promise.all([d, e]);
  assert.equal(f.p.getCurrentTime(), 42000);
});
test("seek clamps at beginning and end", async () => {
  const f = fixture();
  await f.command("seek", -20);
  assert.equal(f.p.getCurrentTime(), 0);
  await f.command("seek", 999);
  assert.equal(f.p.getCurrentTime(), 299000);
});
test("manual seek into intro is not overridden by auto skip", async () => {
  const f = fixture({ intro: true });
  await f.command("seekBy", 10);
  await f.command("autoSkip", true);
  f.intervals[0]();
  assert.equal(f.p.getCurrentTime(), 110000);
  assert.deepEqual(f.calls, [110000]);
  assert.ok(f.messages.some((m) => m.type === "state" && m.state.seeking));
});
test("recap button is independent of intro and blocked during ads", async () => {
  const f = fixture({ recap: true });
  assert.equal(f.messages[0].state.canSkipRecap, true);
  assert.equal(f.messages[0].state.canSkipIntro, false);
  await f.command("skipRecap");
  assert.deepEqual(f.calls, ["click"]);
  const g = fixture({ recap: true, ad: true });
  await g.command("skipRecap");
  assert.deepEqual(g.calls, []);
  assert.ok(g.messages.find((m) => m.type === "ack").error);
});

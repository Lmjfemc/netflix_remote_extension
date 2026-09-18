import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../extension/netflix-adapter.js", import.meta.url),
  "utf8",
);
function fixture({
  intro = false,
  recap = false,
  ad = false,
  cards = [],
  clock = false,
  player = true,
  controllerNode = null,
  broken = false,
  pathname = "/watch/123",
} = {}) {
  let time = 100000,
    now = 1000000,
    cardList = cards,
    listener;
  const messages = [],
    calls = [],
    intervals = [],
    queries = [];
  // Catalog cards as the adapter scans them from the browse page.
  const anchors = () =>
    cardList.map((c) => ({
      href: `https://www.netflix.com/title/${c.id}`,
      getAttribute: (k) => (k === "aria-label" ? c.title : null),
      querySelector: () => ({ src: c.image || "", alt: c.title }),
    }));
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
    isPaused: () => {
      if (broken) throw Error("boom");
      return true;
    },
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
                getAllPlayerSessionIds: () => (player ? ["watch-test"] : []),
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
  // A player root whose React fiber leads to the given controller instance.
  const playerRoot = controllerNode && {
    __reactFiber$test: { stateNode: controllerNode, return: null },
  };
  const document = {
    title: "Test",
    querySelector: (s) =>
      s === "video" ? video : s === '[data-uia="player"]' ? playerRoot : null,
    querySelectorAll(s) {
      queries.push(s);
      if (s.startsWith("a[href")) return anchors();
      if (s.includes("player-skip-intro") && intro) return [skip];
      if (s.includes("player-skip-recap") && recap) return [skip];
      if (s.includes("ads-info-container") && ad) return [skip];
      return [];
    },
  };
  vm.runInNewContext(source, {
    window,
    document,
    location: { pathname, origin: "https://www.netflix.com" },
    sessionStorage: { getItem: () => null },
    setTimeout,
    setInterval: (fn) => intervals.push(fn),
    clearInterval,
    URL,
    // A frozen clock lets tests step past the adapter's 3-second scan throttle.
    Date: clock ? { now: () => now } : Date,
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
  const sync = () =>
    listener({
      source: window,
      data: { source: "netflix-lan-content", type: "sync" },
    });
  return {
    command,
    sync,
    calls,
    messages,
    intervals,
    queries,
    p,
    advance: (ms) => (now += ms),
    setCards: (list) => (cardList = list),
  };
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
  const first = f.messages.find((m) => m.type === "state");
  assert.equal(first.state.canSkipRecap, true);
  assert.equal(first.state.canSkipIntro, false);
  await f.command("skipRecap");
  assert.deepEqual(f.calls, ["click"]);
  const g = fixture({ recap: true, ad: true });
  await g.command("skipRecap");
  assert.deepEqual(g.calls, []);
  assert.ok(g.messages.find((m) => m.type === "ack").error);
});
test("catalog is sent only when it changes or on sync, never with each state", () => {
  const f = fixture({
    cards: [{ id: "80001", title: "Show One" }],
    clock: true,
    pathname: "/browse",
  });
  const catalogs = () => f.messages.filter((m) => m.type === "catalog");
  const states = () => f.messages.filter((m) => m.type === "state");
  assert.equal(catalogs().length, 1);
  // Arrays cross the vm realm boundary, so compare by value, not prototype.
  assert.equal(
    catalogs()[0]
      .catalog.map((c) => c.id)
      .join(),
    "80001",
  );
  assert.equal(catalogs()[0].version, 1);
  assert.equal(states()[0].state.catalogVersion, 1);
  f.advance(4000);
  f.intervals[0]();
  f.intervals[0]();
  assert.ok(states().length >= 3);
  assert.ok(states().every((m) => !("catalog" in m)));
  assert.equal(catalogs().length, 1, "unchanged page must not resend");
  f.sync();
  assert.equal(catalogs().length, 2, "sync re-emits the current catalog");
  assert.equal(catalogs()[1].version, 1);
  f.setCards([
    { id: "80001", title: "Show One" },
    { id: "80002", title: "Show Two" },
  ]);
  f.advance(4000);
  f.intervals[0]();
  assert.equal(catalogs().length, 3, "changed page sends a new version");
  assert.equal(catalogs()[2].version, 2);
  assert.equal(catalogs()[2].catalog.length, 2);
});
test("title fallback tolerates a controller without React state", () => {
  const f = fixture({
    controllerNode: { getNextEpisodicData: () => ({ id: 81 }) },
  });
  const s = f.messages.find((m) => m.type === "state");
  assert.ok(s, "state heartbeat must still be emitted");
  assert.equal(s.state.title, "Test");
  assert.equal(s.state.canNext, true);
  assert.equal(s.state.warning, "");
});

test("catalog distinguishes unscanned watch document from empty browse results", () => {
  const watch = fixture({ clock: true });
  watch.sync();
  const unknown = watch.messages.filter((m) => m.type === "catalog").at(-1);
  assert.equal(unknown.available, false);
  const browse = fixture({
    clock: true,
    pathname: "/search",
    cards: [{ id: "1", title: "One" }],
  });
  browse.setCards([]);
  browse.advance(4000);
  browse.intervals[0]();
  const empty = browse.messages.filter((m) => m.type === "catalog").at(-1);
  assert.equal(empty.available, true);
  assert.equal(empty.catalog.length, 0);
});
test("missing player API on a watch page is reported after a grace period", () => {
  const f = fixture({ player: false, clock: true });
  const last = () => f.messages.filter((m) => m.type === "state").at(-1).state;
  assert.equal(last().ready, false);
  assert.equal(last().warning, "");
  f.advance(9000);
  f.intervals[0]();
  assert.match(last().warning, /player API not found/);
});
test("an adapter exception still produces a heartbeat carrying the error", () => {
  const f = fixture({ broken: true });
  const s = f.messages.find((m) => m.type === "state");
  assert.ok(s, "heartbeat must survive a throwing player call");
  assert.equal(s.state.ready, false);
  assert.match(s.state.warning, /adapter error: boom/i);
});
test("button and fiber scans are skipped while no player is active", () => {
  const f = fixture({ player: false });
  f.queries.length = 0;
  f.intervals[0]();
  assert.ok(
    !f.queries.some((q) => q.includes("player-skip") || q === "button"),
    "idle page must not scan for player buttons: " + f.queries.join(","),
  );
  const g = fixture({ recap: true });
  g.queries.length = 0;
  g.intervals[0]();
  assert.ok(g.queries.some((q) => q.includes("player-skip-recap")));
});

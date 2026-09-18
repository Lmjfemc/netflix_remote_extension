import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { createServer } from "node:net";

const exe =
  process.env.NATIVE_HOST_EXE ||
  fileURLToPath(new URL("../dist/netflix-remote.exe", import.meta.url));
function host(port = 0) {
  const process = spawn(exe, ["--port=" + port], {
    cwd: tmpdir(),
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = Buffer.alloc(0),
    queue = [],
    waiters = [],
    stderr = "";
  process.stderr.on("data", (b) => (stderr += b));
  process.stdout.on("data", (b) => {
    buffer = Buffer.concat([buffer, b]);
    while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
      const n = buffer.readUInt32LE(0),
        m = JSON.parse(buffer.subarray(4, n + 4));
      buffer = buffer.subarray(n + 4);
      if (waiters.length) waiters.shift()(m);
      else queue.push(m);
    }
  });
  return {
    process,
    stderr: () => stderr,
    next: () =>
      queue.length
        ? Promise.resolve(queue.shift())
        : new Promise((resolve) => waiters.push(resolve)),
    send(m) {
      const b = Buffer.from(JSON.stringify(m)),
        h = Buffer.alloc(4);
      h.writeUInt32LE(b.length);
      process.stdin.write(Buffer.concat([h, b]));
    },
  };
}
test(
  "HTTP authentication stays retryable until delayed hello restores pairing",
  { timeout: 15000 },
  async (t) => {
    const listener = createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const port = listener.address().port;
    await new Promise((r) => listener.close(r));
    const h = host(port);
    t.after(() => h.process.kill());
    const base = `http://127.0.0.1:${port}`,
      key = "a".repeat(48);
    const session = () =>
      fetch(base + "/session", {
        method: "POST",
        headers: { Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
    let response;
    for (let i = 0; i < 100; i++) {
      try {
        response = await session();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    assert.equal(response?.status, 503);
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(
      (await session()).status,
      503,
      "no timeout may publish an interim key",
    );
    h.send({ type: "hello", key });
    const ready = await h.next();
    assert.equal(ready.key, key);
    assert.equal((await session()).status, 204);
  },
);
test(
  "built EXE embeds UI, pairs phone, relays native commands and exits on stop",
  { timeout: 15000 },
  async (t) => {
    const h = host();
    t.after(() => h.process.kill());
    const exit = once(h.process, "exit");
    const started = performance.now();
    h.send({ type: "hello" });
    const ready = await h.next();
    assert.equal(ready.type, "ready");
    assert.match(ready.key, /^[0-9a-f]{48}$/);
    const base = `http://127.0.0.1:${ready.port}`;
    const page = await fetch(base);
    assert.match(await page.text(), /Netflix/);
    const pair = await fetch(base + "/pair", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ code: ready.code }),
    });
    assert.equal(pair.status, 200);
    const { key } = await pair.json();
    const ws = new WebSocket(
      base.replace("http:", "ws:") + "/ws?role=phone&key=" + key,
      { origin: base },
    );
    t.after(() => ws.terminate());
    let messages = [];
    ws.on("message", (b) => messages.push(JSON.parse(b)));
    await once(ws, "open");
    h.send({
      type: "state",
      state: { ready: true, time: 100, paused: true },
    });
    const until = async (predicate) => {
      for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.fail("Timed out waiting for relay state");
    };
    await until(() => messages.some((m) => m.type === "status" && m.pc));
    h.send({
      type: "catalog",
      version: 1,
      catalog: [{ id: "80001", title: "Show One", image: "" }],
    });
    await until(() =>
      messages.some((m) => m.type === "catalog" && m.catalog.length === 1),
    );
    for (const [id, command, value] of [
      ["one", "seekBy", 10],
      ["two", "skipRecap", null],
    ]) {
      ws.send(JSON.stringify({ type: "command", id, command, value }));
      const m = await h.next();
      assert.equal(m.command, command);
      assert.equal(m.id, id);
      h.send({ type: "ack", id });
      await until(() => messages.some((m) => m.type === "ack" && m.id === id));
    }
    h.send({ type: "stop" });
    await exit;
    await assert.rejects(fetch(base));
    console.log(
      `Native EXE startup + HTTP + pairing: tested; total ${Math.round(performance.now() - started)} ms`,
    );
  },
);
test(
  "native stdin EOF releases the listener without leaving a helper process",
  { timeout: 10000 },
  async (t) => {
    const h = host();
    t.after(() => h.process.kill());
    const exit = once(h.process, "exit");
    h.send({ type: "hello" });
    const ready = await h.next();
    h.process.stdin.end();
    await exit;
    await assert.rejects(fetch(`http://127.0.0.1:${ready.port}`));
  },
);
test(
  "a phone's session key survives a helper restart through hello, and rotate revokes it",
  { timeout: 15000 },
  async (t) => {
    const session = (base, key) =>
      fetch(base + "/session", {
        method: "POST",
        headers: { Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      }).then((r) => r.status);
    const first = host();
    t.after(() => first.process.kill());
    first.send({ type: "hello" });
    const ready1 = await first.next();
    assert.equal(ready1.type, "ready");
    const exit1 = once(first.process, "exit");
    first.send({ type: "stop" });
    await exit1;
    // Second launch, as the extension does after a crash or Chrome restart.
    const second = host();
    t.after(() => second.process.kill());
    second.send({ type: "hello", key: ready1.key });
    const ready2 = await second.next();
    assert.equal(ready2.key, ready1.key, "previous key must be resumed");
    const base = `http://127.0.0.1:${ready2.port}`;
    assert.equal(await session(base, ready1.key), 204);
    assert.equal(await session(base, "0".repeat(48)), 401);
    const setup = await (await fetch(base + "/setup")).json();
    assert.equal(setup.key, undefined, "/setup must not expose the key");
    second.send({ type: "rotate" });
    const ready3 = await second.next();
    assert.equal(ready3.type, "ready");
    assert.notEqual(ready3.key, ready1.key);
    assert.equal(await session(base, ready1.key), 401);
    assert.equal(await session(base, ready3.key), 204);
    const exit2 = once(second.process, "exit");
    second.send({ type: "stop" });
    await exit2;
  },
);

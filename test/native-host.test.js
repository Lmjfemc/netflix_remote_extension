import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const exe =
  process.env.NATIVE_HOST_EXE ||
  fileURLToPath(new URL("../dist/netflix-remote.exe", import.meta.url));
function host() {
  const process = spawn(exe, ["--port=0"], {
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
  "built EXE embeds UI, pairs phone, relays native commands and exits on stop",
  { timeout: 15000 },
  async (t) => {
    const h = host();
    t.after(() => h.process.kill());
    const exit = once(h.process, "exit");
    const started = performance.now();
    const ready = await h.next();
    assert.equal(ready.type, "ready");
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
      catalog: [],
    });
    const until = async (predicate) => {
      for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.fail("Timed out waiting for relay state");
    };
    await until(() => messages.some((m) => m.type === "status" && m.pc));
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
    const ready = await h.next();
    h.process.stdin.end();
    await exit;
    await assert.rejects(fetch(`http://127.0.0.1:${ready.port}`));
  },
);

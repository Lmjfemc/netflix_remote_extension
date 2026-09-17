import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import WebSocket from "ws";
import http from "node:http";
test("pairing, origin checks, command relay, actual state relay and disconnect", async () => {
  const child = spawn(process.execPath, ["legacy/server.js"], {
    env: { ...process.env, PORT: "8799" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let pc, phone;
  try {
    await Promise.race([
      once(child.stdout, "data"),
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("Server startup timeout")), 5000).unref(),
      ),
    ]);
    const base = "http://127.0.0.1:8799",
      origin = "chrome-extension://" + "a".repeat(32);
    const badHost = await new Promise((resolve) =>
      http.get(
        base + "/setup",
        { headers: { Host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      ),
    );
    assert.equal(badHost, 403);
    assert.equal(
      (
        await fetch(base + "/bridge", {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
      404,
    );
    const setup = await (await fetch(base + "/setup")).json();
    assert.match(setup.code, /^\d{6}$/);
    assert.match(setup.qr, /^data:image\/png/);
    const pair = (code, originValue = base) =>
      fetch(base + "/pair", {
        method: "POST",
        headers: { Origin: originValue, "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
    assert.equal((await pair(setup.code, "https://evil.example")).status, 403);
    assert.equal((await pair("wrong")).status, 401);
    const { key } = await (await pair(setup.code)).json(),
      bridge = await (
        await fetch(base + "/bridge", { headers: { Origin: origin } })
      ).json();
    pc = new WebSocket(`ws://127.0.0.1:8799/ws?role=pc&key=${bridge.key}`, {
      origin,
    });
    await once(pc, "open");
    pc.send(
      JSON.stringify({
        type: "state",
        state: { paused: true, time: 42 },
        catalog: [{ id: "123", title: "Test title" }],
      }),
    );
    phone = new WebSocket(`ws://127.0.0.1:8799/ws?role=phone&key=${key}`, {
      origin: base,
    });
    const messages = [];
    phone.on("message", (m) => messages.push(JSON.parse(m)));
    await once(phone, "open");
    const wait = async (predicate) => {
      for (let i = 0; i < 50; i++) {
        const m = messages.find(predicate);
        if (m) return m;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw Error("Expected message missing");
    };
    assert.equal((await wait((m) => m.type === "state")).state.time, 42);
    const delivered = once(pc, "message");
    phone.send(
      JSON.stringify({ type: "command", id: "test-pause", command: "pause" }),
    );
    assert.equal(JSON.parse((await delivered)[0]).command, "pause");
    pc.send(JSON.stringify({ type: "ack", id: "test-pause" }));
    await wait((m) => m.id === "test-pause");
    const recapDelivered = once(pc, "message");
    phone.send(
      JSON.stringify({
        type: "command",
        id: "test-recap",
        command: "skipRecap",
      }),
    );
    assert.equal(JSON.parse((await recapDelivered)[0]).command, "skipRecap");
    pc.send(JSON.stringify({ type: "ack", id: "test-recap" }));
    await wait((m) => m.id === "test-recap");
    pc.close();
    await wait((m) => m.type === "status" && m.pc === false);
  } finally {
    pc?.terminate();
    phone?.terminate();
    child.kill();
  }
});

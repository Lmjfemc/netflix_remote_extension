import http from "node:http";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import QRCode from "qrcode";
const port = Number(process.env.PORT || 8787),
  bridgeKey = randomBytes(24).toString("hex"),
  phoneKey = randomBytes(24).toString("hex"),
  code = String(randomInt(100000, 1000000));
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((x) => x.family === "IPv4" && !x.internal && privateIP(x.address))
  .map((x) => x.address);
function privateIP(ip) {
  ip = ip.replace(/^::ffff:/, "");
  return (
    ip === "::1" ||
    ip.startsWith("127.") ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}
function loopback(ip) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
}
function equal(a, b) {
  return (
    typeof a === "string" &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
let pc,
  phone,
  state = null,
  catalog = [],
  lastState = 0;
const pending = new Map(),
  attempts = new Map();
const send = (s, m) => {
  if (s?.readyState === WebSocket.OPEN) s.send(JSON.stringify(m));
};
const status = () => ({
  type: "status",
  pc: !!pc && Date.now() - lastState < 6000,
});
const validHost = (h) =>
  ["localhost", "127.0.0.1", ...addresses].some((a) => h === `${a}:${port}`);
const extension = (o) => /^chrome-extension:\/\/[a-p]{32}$/.test(o || "");
const server = http.createServer(async (req, res) => {
  try {
    if (
      !privateIP(req.socket.remoteAddress || "") ||
      !validHost(req.headers.host)
    ) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url, "http://localhost"),
      host = req.headers.host;
    if (process.env.REMOTE_DEBUG === "1" && url.pathname === "/bridge")
      console.log(
        "Bridge request",
        req.socket.remoteAddress,
        req.headers.origin || "(no origin)",
      );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const json = (v, s = 200) => {
      res
        .writeHead(s, { "Content-Type": "application/json" })
        .end(JSON.stringify(v));
    };
    // Extension service-worker GET requests can omit Origin. The WebSocket still
    // requires a chrome-extension Origin; no CORS headers expose this response.
    if (
      url.pathname === "/bridge" &&
      loopback(req.socket.remoteAddress) &&
      (!req.headers.origin || extension(req.headers.origin))
    ) {
      json({ key: bridgeKey });
      return;
    }
    if (url.pathname === "/setup" && loopback(req.socket.remoteAddress)) {
      const links = (addresses.length ? addresses : ["127.0.0.1"]).map(
        (a) => `http://${a}:${port}/#code=${code}`,
      );
      json({
        code,
        links,
        qr: await QRCode.toDataURL(links[0]),
        pc: status().pc,
      });
      return;
    }
    if (url.pathname === "/pair" && req.method === "POST") {
      if (req.headers.origin !== `http://${host}`) {
        json({ error: "Invalid origin" }, 403);
        return;
      }
      const ip = req.socket.remoteAddress,
        now = Date.now(),
        a = attempts.get(ip) || { n: 0, start: now };
      if (now - a.start > 60000) {
        a.n = 0;
        a.start = now;
      }
      attempts.set(ip, a);
      if (++a.n > 10) {
        json({ error: "Too many attempts. Wait a minute." }, 429);
        return;
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 256) {
          res.writeHead(413).end();
          return;
        }
      }
      if (!equal(JSON.parse(body).code, code)) {
        json({ error: "Pairing code does not match." }, 401);
        return;
      }
      json({ key: phoneKey });
      return;
    }
    const files = {
      "/": "index.html",
      "/app.js": "app.js",
      "/style.css": "style.css",
      "/manifest.webmanifest": "manifest.webmanifest",
      "/icon.svg": "icon.svg",
      "/pc": "pc.html",
      "/pc.js": "pc.js",
    };
    const file = files[url.pathname];
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://*.nflxso.net https://*.nflximg.net; connect-src 'self'; frame-ancestors 'none'",
    );
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : file.endsWith(".svg")
            ? "image/svg+xml"
            : file.endsWith(".webmanifest")
              ? "application/manifest+json"
              : "text/html; charset=utf-8",
    );
    res.end(await readFile(new URL(`../public/${file}`, import.meta.url)));
  } catch {
    if (!res.headersSent) res.writeHead(400);
    res.end("Bad request");
  }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
server.on("upgrade", (req, socket, head) => {
  const u = new URL(req.url, "http://localhost"),
    role = u.searchParams.get("role"),
    key = u.searchParams.get("key"),
    origin = req.headers.origin || "";
  const valid =
    privateIP(req.socket.remoteAddress || "") &&
    u.pathname === "/ws" &&
    (role === "pc"
      ? loopback(req.socket.remoteAddress) &&
        extension(origin) &&
        equal(key, bridgeKey)
      : role === "phone" &&
        origin === `http://${req.headers.host}` &&
        validHost(req.headers.host) &&
        equal(key, phoneKey));
  if (process.env.REMOTE_DEBUG === "1")
    console.log("Socket", role, valid ? "accepted" : "rejected", origin);
  if (!valid) {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.role = role;
    wss.emit("connection", ws);
  });
});
const commands = new Set([
  "play",
  "pause",
  "seek",
  "seekBy",
  "volume",
  "mute",
  "fullscreen",
  "skipIntro",
  "skipRecap",
  "next",
  "autoSkip",
  "select",
  "search",
  "browse",
]);
wss.on("connection", (ws) => {
  if (ws.role === "pc") {
    pc?.close(4001, "Replaced");
    pc = ws;
    send(phone, status());
  } else {
    phone?.close(4001, "Another phone connected");
    phone = ws;
    send(ws, status());
    if (state) send(ws, { type: "state", state, catalog });
  }
  ws.on("message", (data) => {
    try {
      const m = JSON.parse(data);
      if (ws === pc) {
        if (m.type === "state") {
          lastState = Date.now();
          state = m.state;
          if (Array.isArray(m.catalog) && m.catalog.length)
            catalog = m.catalog.slice(0, 250);
          send(phone, { type: "state", state, catalog });
          send(phone, status());
        } else if (m.type === "ack" && pending.has(m.id)) {
          clearTimeout(pending.get(m.id));
          pending.delete(m.id);
          send(phone, m);
        }
      } else if (
        ws === phone &&
        m.type === "command" &&
        commands.has(m.command) &&
        typeof m.id === "string" &&
        m.id.length < 100
      ) {
        if (!status().pc) {
          send(ws, {
            type: "ack",
            id: m.id,
            error: "Netflix is disconnected.",
          });
          return;
        }
        if (pending.size >= 20) return;
        pending.set(
          m.id,
          setTimeout(() => {
            pending.delete(m.id);
            send(ws, {
              type: "ack",
              id: m.id,
              error: "No response from Netflix. Try again.",
            });
          }, 8000),
        );
        send(pc, m);
      }
    } catch {
      ws.close(1008, "Invalid message");
    }
  });
  ws.on("close", () => {
    if (ws === pc) {
      pc = null;
      send(phone, status());
    }
    if (ws === phone) phone = null;
  });
  ws.on("error", () => {});
});
setInterval(() => send(phone, status()), 3000).unref();
server.listen(port, "0.0.0.0", () =>
  console.log(
    `Netflix LAN Remote\nPC setup: http://localhost:${port}/pc\nPhone: ${addresses.map((a) => `http://${a}:${port}`).join(", ")}\nPairing code: ${code}`,
  ),
);

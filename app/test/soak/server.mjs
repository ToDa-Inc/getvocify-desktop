// The soak's stand-in for Vocify's servers, on one loopback port: the real dashboard's static build, the few API calls the
// dashboard makes at start (sign-in, the user), an empty answer for the rest, and the live transcription socket, which
// sends the scripted call's words instead of a speech engine. Nothing here reaches a network beyond 127.0.0.1.
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".wav": "audio/wav", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff" };
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** A JWT the dashboard reads for its expiry; the signature is not checked by the page. */
export function fakeJwt(userId) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
  const exp = Math.floor(Date.now() / 1000) + 6 * 3600;
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: userId, exp, iat: Math.floor(Date.now() / 1000) })}.soak`;
}

function frame(text) {
  const payload = Buffer.from(text);
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : Buffer.alloc(0);
  return Buffer.concat([head, payload]);
}

/** Starts the stand-in. `script(send)` is called for each transcription socket once it opens and sends the call. */
export function startStandIn({ port, dist, userId, onSocket, onRequest = () => {} }) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/v1/")) {
      onRequest(req.method, url.pathname);
      res.setHeader("Content-Type", "application/json");
      if (req.method === "OPTIONS") return res.writeHead(204).end();
      if (url.pathname === "/api/v1/auth/refresh") {
        return res.end(JSON.stringify({ access_token: fakeJwt(userId), refresh_token: "soak-refresh" }));
      }
      if (url.pathname === "/api/v1/transcription/ticket") {
        return res.end(JSON.stringify({ ticket: "soak-ticket", expires_at: Math.floor(Date.now() / 1000) + 86400 }));
      }
      if (url.pathname === "/api/v1/auth/me") {
        return res.end(JSON.stringify({ id: userId, email: "soak@example.invalid", name: "Soak", organization_id: "soak-org", role: "rep" }));
      }
      // Lists answer with an empty list, everything else with an empty object; the page reads what it needs from either.
      return res.end(req.method === "GET" && /\/(memos|playbooks|ask\/suggestions|crm\/hubspot\/recordings|notifications|interactions|activities)$/.test(url.pathname) ? "[]" : "{}");
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
    let file = join(dist, path || "index.html");
    try {
      if (!(await stat(file)).isFile()) throw new Error("dir");
    } catch {
      file = join(dist, "index.html");
    }
    try {
      res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });

  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (!url.pathname.endsWith("/transcription/live")) return socket.destroy();
    const key = req.headers["sec-websocket-key"];
    const accept = createHash("sha1").update(key + GUID).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    // Client frames are masked and ignored (the audio is not needed); only a close is honoured.
    socket.on("data", (buf) => {
      if ((buf[0] & 0x0f) === 0x8) socket.end();
    });
    socket.on("error", () => {});
    onSocket({ url, send: (obj) => { if (!socket.destroyed) socket.write(frame(JSON.stringify(obj))); }, close: () => socket.end() });
  });

  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port })));
}

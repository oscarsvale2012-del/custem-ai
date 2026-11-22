// Development only: runs the real backend in plain Node and serves the UI to a
// browser at http://localhost:5181, so the app can be tested without Electron.
// Secrets are only base64-encoded here (not encrypted) — never ship this.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Backend } = require("./core");
const { dispatch, lockedState } = require("./api");
const { AuthManager } = require("./auth");

const PORT = Number(process.env.PORT || 5181);
const dataDir = process.env.AF_DATA || path.join(__dirname, "..", ".devdata");
let host = {};
if (process.env.AF_DEMO_ROBLOX) {
  // Fake Roblox account + analytics for checking the Revenue page (dev only).
  const demo = require("../test/fake-roblox");
  host = demo.fakeHost;
  process.env.AF_ANALYTICS_BASE = "http://127.0.0.1:5198/universes";
  demo.fakeAnalytics();
}
const backend = new Backend({
  host,
  dataDir,
  encrypt: (s) => "plain:" + Buffer.from(s).toString("base64"),
  decrypt: (s) => (s.startsWith("plain:") ? Buffer.from(s.slice(6), "base64").toString() : s),
});
const enc = (s) => "plain:" + Buffer.from(s).toString("base64");
const dec = (s) => (s.startsWith("plain:") ? Buffer.from(s.slice(6), "base64").toString() : s);
const auth = new AuthManager({ dataDir, encrypt: enc, decrypt: dec, openExternal: (url) => console.log("Open to sign in with Google:", url) });
backend.authInfo = () => auth.public();
let started = false;
const clients = new Set();
const send = (type, payload) => { const msg = `data: ${JSON.stringify({ type, payload })}\n\n`; for (const c of clients) c.write(msg); };
const startBackend = async () => { if (!started) { started = true; await backend.init(); } };
const sendState = () => send("state", !auth.locked && started ? backend.publicState() : lockedState(auth));
backend.on("state", (s) => !auth.locked && send("state", s));
backend.on("log", (l) => !auth.locked && send("log", l));
backend.on("notify", (n) => send("notify", n));
auth.on("change", sendState);
auth.on("signedIn", async () => { await startBackend(); sendState(); });
auth.on("signedOut", () => sendState());

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };
const RENDERER = path.join(__dirname, "..", "renderer");

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    clients.add(res);
    res.write(`data: ${JSON.stringify({ type: "state", payload: !auth.locked && started ? backend.publicState() : lockedState(auth) })}\n\n`);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (url.pathname.startsWith("/api/") && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const value = await dispatch({ backend, auth }, url.pathname.slice(5), JSON.parse(body || "[]"));
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, value: value ?? null }));
      } catch (e) {
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }
  const file = path.join(RENDERER, url.pathname === "/" ? "index.html" : path.normalize(url.pathname));
  if (!file.startsWith(RENDERER) || !fs.existsSync(file)) return res.writeHead(404).end("not found");
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" }).end(fs.readFileSync(file));
}).listen(PORT, async () => {
  console.log(`VYRON dev server on http://localhost:${PORT} (data: ${dataDir})`);
  await auth.restore();
  if (!auth.locked) await startBackend();
  sendState();
});

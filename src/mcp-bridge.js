// Bridge for the Claude desktop app: Claude starts this (VYRON.exe in Node mode)
// and talks MCP over stdin/stdout; every message is passed on to VYRON's local
// connector (127.0.0.1, with the secret key read from VYRON's data folder).
// Only Node built-ins, so it runs from the installed app without anything extra.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

function controlConfig() {
  const dir = process.env.VYRON_DATA_DIR || path.join(process.env.APPDATA || path.join(require("os").homedir(), "AppData", "Roaming"), "VYRON");
  try { return JSON.parse(fs.readFileSync(path.join(dir, "vyron-control.json"), "utf8")); } catch { return null; }
}

function post(cfg, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(body);
    const req = http.request({
      host: "127.0.0.1", port: cfg.port || 47211, path: "/mcp", method: "POST", timeout: 10 * 60 * 1000,
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer " + cfg.token, "X-VYRON-Client": "claude-desktop", "Content-Length": data.length },
    }, (res) => {
      let out = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (out += c));
      res.on("end", () => resolve({ status: res.statusCode, text: out, type: String(res.headers["content-type"] || "") }));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.end(data);
  });
}

const write = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const fail = (id, message) => { if (id !== undefined && id !== null) write({ jsonrpc: "2.0", id, error: { code: -32000, message } }); };

async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const cfg = controlConfig();
  if (!cfg?.token) return fail(msg.id, "VYRON isn't set up on this PC yet. Install and open VYRON first.");
  if (cfg.enabled === false) return fail(msg.id, "The Claude connector is switched off in VYRON (Settings → Claude controls VYRON).");
  let r;
  try { r = await post(cfg, line); }
  catch { return fail(msg.id, "VYRON isn't running. Open VYRON (it can stay in the tray) and try again."); }
  if (r.status === 401) return fail(msg.id, "VYRON refused the connection (the key changed). Press “Connect Claude desktop” in VYRON again.");
  if (r.status === 202 || !r.text.trim()) return; // notification: no answer expected
  if (r.type.includes("text/event-stream")) {
    for (const ev of r.text.split(/\r?\n/)) if (ev.startsWith("data:")) { const d = ev.slice(5).trim(); if (d) process.stdout.write(d + "\n"); }
    return;
  }
  try { write(JSON.parse(r.text)); } catch { fail(msg.id, "VYRON sent an answer that couldn't be read."); }
}

let buf = "";
let chain = Promise.resolve();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) { const p = handle(line).catch(() => {}); chain = Promise.all([chain, p]); }
  }
});
process.stdin.on("end", () => chain.then(() => process.exit(0)));

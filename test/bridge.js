// Claude desktop → VYRON: the stdio bridge (spawned like Claude desktop does)
// and "Connect Claude desktop" writing Claude's settings file safely.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Backend } = require("../src/core");
const { ControlServer } = require("../src/control");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { failed++; console.log("  ✗", name, "\n     ", e.message); }
}

/** Start the bridge the way Claude desktop does and talk MCP over stdio. */
function bridge(dataDir) {
  const p = spawn(process.execPath, [path.join(__dirname, "..", "src", "mcp-bridge.js")], { env: { ...process.env, VYRON_DATA_DIR: dataDir } });
  let buf = ""; const waiting = new Map();
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); } });
  let n = 0;
  const rpc = (method, params) => new Promise((r) => { const id = ++n; waiting.set(id, r); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  const note = (method) => p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  return { p, rpc, note, close: () => p.stdin.end() };
}

(async () => {
  const TMP = path.join(__dirname, "..", ".testdata-bridge");
  fs.rmSync(TMP, { recursive: true, force: true });
  const be = new Backend({ dataDir: TMP, encrypt: (s) => s, decrypt: (s) => s, studio: false, claude: { exe: null }, fetchImpl: async () => { throw new Error("offline"); } });
  await be.init();
  const control = new ControlServer({ dataDir: TMP, getCtx: () => ({ backend: be, auth: null, control }), log: () => {}, version: "t",
    bridge: { command: "C:\\Program Files\\VYRON\\VYRON.exe", args: ["C:\\Program Files\\VYRON\\resources\\app.asar.unpacked\\src\\mcp-bridge.js"], env: { ELECTRON_RUN_AS_NODE: "1" } } });
  control.cfg.port = 47295; control.saveCfg();

  console.log("Bridge");
  await test("VYRON closed → a clear message instead of a silent failure", async () => {
    const b = bridge(TMP);
    const r = await b.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Claude", version: "1" } });
    assert(/VYRON isn't running/.test(r.error.message));
    b.close();
  });
  await control.start();
  await test("initialize → tools → call a tool, like Claude desktop", async () => {
    const b = bridge(TMP);
    const init = await b.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Claude", version: "1" } });
    assert.equal(init.result.serverInfo.name, "vyron");
    b.note("notifications/initialized");
    const list = await b.rpc("tools/list", {});
    assert(list.result.tools.some((t) => t.name === "vyron_status"));
    const st = await b.rpc("tools/call", { name: "vyron_list_ideas", arguments: { category: "Tycoon" } });
    assert(/Tycoon/.test(st.result.content[0].text));
    b.close();
  });
  await test("VYRON sees who is connected: Claude desktop (bridge) vs Claude Code vs its own tasks", async () => {
    const desk = control.clientsPublic().find((c) => c.kind === "desktop");
    assert(desk && desk.app === "Claude" && Date.now() - desk.last < 60000, JSON.stringify(control.clientsPublic()));
    const r = await fetch(`http://127.0.0.1:${control.cfg.port}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer " + control.cfg.token },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2" } } }) });
    assert.equal(r.status, 200);
    assert.equal(control.clientsPublic().find((c) => c.kind === "code").app, "claude-code");
    await fetch(`http://127.0.0.1:${control.cfg.port}/rpc/vyron_status`, { method: "POST", headers: { Authorization: "Bearer " + control.cfg.token, "X-VYRON-Client": "vyron" } });
    assert(control.clientsPublic().some((c) => c.kind === "vyron"));
    assert(control.status().clients.length === 3);
  });
  await test("a changed key is reported", async () => {
    const real = control.cfg.token;
    fs.writeFileSync(path.join(TMP, "vyron-control.json"), JSON.stringify({ ...control.cfg, token: "wrong-key" }));
    const b = bridge(TMP);
    const r = await b.rpc("tools/list", {});
    assert(/key changed/.test(r.error.message));
    b.close();
    control.cfg.token = real; control.saveCfg();
  });

  console.log("Connect Claude desktop");
  await test("adds VYRON to Claude's settings, keeps the rest, makes a backup; disconnect removes it", () => {
    const LA = path.join(TMP, "LocalAppData"), cfgDir = path.join(LA, "Claude-Data", "claude_abc");
    fs.mkdirSync(cfgDir, { recursive: true });
    const f = path.join(cfgDir, "claude_desktop_config.json");
    const before = { mcpServers: { Roblox_Studio: { command: "cmd.exe", args: ["/c", "mcp.bat"] } }, preferences: { keepAwakeEnabled: true } };
    fs.writeFileSync(f, JSON.stringify(before));
    const old = process.env.LOCALAPPDATA, oldAp = process.env.APPDATA;
    process.env.LOCALAPPDATA = LA; process.env.APPDATA = path.join(TMP, "Roaming");
    try {
      assert.equal(control.desktopStatus().connected, false);
      const s = control.setDesktop(true);
      assert(s.connected);
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      assert.deepEqual(j.mcpServers.Roblox_Studio, before.mcpServers.Roblox_Studio);
      assert.equal(j.preferences.keepAwakeEnabled, true);
      assert.equal(j.mcpServers.vyron.env.ELECTRON_RUN_AS_NODE, "1");
      assert(/mcp-bridge\.js$/.test(j.mcpServers.vyron.args[0]));
      assert(!JSON.stringify(j).includes(control.cfg.token), "the secret key must not be written into Claude's settings");
      assert.deepEqual(JSON.parse(fs.readFileSync(f + ".vyron-backup", "utf8")), before);
      control.setDesktop(false);
      assert(!JSON.parse(fs.readFileSync(f, "utf8")).mcpServers.vyron);
      fs.writeFileSync(f, "{ broken");
      assert.throws(() => control.setDesktop(true), /can't be read/);
      assert.equal(fs.readFileSync(f, "utf8"), "{ broken", "a broken file is left alone");
    } finally { process.env.LOCALAPPDATA = old; process.env.APPDATA = oldAp; }
  });

  await control.stop();
  await be.shutdown();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

// End-to-end tests of the real backend. The only test double is a scripted
// OpenAI-compatible HTTP server standing in for an AI model, so the full agent
// loop, planning, tools, approvals, history and MCP code paths run for real.
// Run: npm test   (needs internet for the Roblox and Anthropic checks)
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { Backend } = require("../src/backend");

const TMP = path.join(__dirname, "..", ".testdata");
fs.rmSync(TMP, { recursive: true, force: true });
const PROJECT_DIR = path.join(TMP, "game");
fs.mkdirSync(path.join(PROJECT_DIR, "src"), { recursive: true });

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { failed++; console.log("  ✗", name, "\n     ", e.message); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000, what = "condition") {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await wait(50); }
  throw new Error("Timed out waiting for " + what);
}

/* ---------- scripted model ---------- */
const { mockModel } = require("./mock-model");

(async () => {
  const model = await mockModel();
  const base = `http://127.0.0.1:${model.address().port}/v1`;
  const be = new Backend({ dataDir: TMP, encrypt: (s) => "x:" + Buffer.from(s).toString("hex"), decrypt: (s) => Buffer.from(s.slice(2), "hex").toString() });
  await be.init();

  console.log("Providers & agents");
  let provId;
  await test("OpenAI-compatible provider connects and lists models", async () => {
    provId = await be.addProvider({ type: "openai", name: "Mock", baseURL: base, apiKey: "sk-test-SECRET123" });
    assert.equal(be.provInfo(provId).status, "connected");
    assert.deepEqual(be.provInfo(provId).models, ["mock-model"]);
  });
  await test("first provider creates the default team of 6 real agents", async () => {
    assert.equal(be.d.agents.length, 6);
    for (const a of be.d.agents) { assert.equal(a.providerId, provId); assert.equal(a.model, "mock-model"); assert.equal(be.agentStatus(a), "idle"); }
  });
  await test("secrets never appear in the public state", async () => {
    assert(!JSON.stringify(be.publicState()).includes("SECRET123"));
  });
  await test("secrets are stored encrypted on disk", async () => {
    be.store.saveNow();
    assert(!fs.readFileSync(path.join(TMP, "agentforge-data.json"), "utf8").includes("SECRET123"));
  });
  await test("budget exhausted → OUT OF TOKENS status", async () => {
    const a = be.d.agents[5]; const keep = a.used; a.used = a.budget;
    assert.equal(be.agentStatus(a), "tokens"); a.used = keep;
  });
  await test("disabled agent → OFFLINE status", async () => {
    await be.agentAction(be.d.agents[5].id, "disable"); assert.equal(be.agentStatus(be.d.agents[5]), "offline");
    await be.agentAction(be.d.agents[5].id, "enable");
  });
  await test("unreachable provider → error and agents not idle", async () => {
    const id = await be.addProvider({ type: "openai", name: "Dead", baseURL: "http://127.0.0.1:9/v1" });
    assert.equal(be.provInfo(id).status, "error");
    assert.equal(be.provInfo(id).kind, "connection");
    be.removeProvider(id);
  });
  await test("Claude provider with a wrong key reports the key was rejected", async () => {
    const id = await be.addProvider({ type: "anthropic", name: "Claude bad key", apiKey: "sk-ant-invalid-key" });
    const info = be.provInfo(id);
    assert.equal(info.status, "error");
    assert(["auth", "connection"].includes(info.kind), "kind=" + info.kind + " " + info.error);
    console.log("     (Claude API said: " + info.error + ")");
    be.removeProvider(id);
  });

  console.log("Projects & Roblox");
  let projId;
  await test("project with Rojo folder + real Roblox game lookup (icon, name)", async () => {
    projId = await be.addProject({ name: "Test game", rojoDir: PROJECT_DIR, placeId: "920587237" });
    const p = be.project(projId);
    assert(p.game, "no game info: " + p.gameError);
    assert(p.game.name && p.game.universeId, "missing name/universe");
    assert(/^https:\/\//.test(p.game.iconUrl || ""), "no icon url");
    console.log(`     (${p.game.name}, universe ${p.game.universeId})`);
    be.setActiveProject(projId);
  });
  await test("unpublished place shows a clear message instead of a fake icon", async () => {
    const id = await be.addProject({ name: "Local only", placeId: "0" });
    assert.equal(be.project(id).game, null);
    assert(/not published/.test(be.project(id).gameError));
    be.removeProject(id);
  });

  console.log("Build pipeline (plan → parallel tasks → review)");
  await test("build request is planned, executed, reviewed and files are really written", async () => {
    const id = be.build("Make a coin system");
    const t = await until(() => { const x = be.d.tasks.find((q) => q.id === id); return x && ["completed", "failed"].includes(x.status) && x; }, 20000, "build to finish");
    assert.equal(t.status, "completed", t.error);
    const kids = be.d.tasks.filter((k) => k.parentId === id);
    assert.equal(kids.length, 3, "2 tasks + review");
    assert(kids.every((k) => k.status === "completed"));
    assert(fs.existsSync(path.join(PROJECT_DIR, "src/ReplicatedStorage/Coins.luau")));
    assert(fs.existsSync(path.join(PROJECT_DIR, "src/ServerScriptService/CoinServer.server.luau")));
    assert(/Review OK/.test(t.result));
    assert.equal(t.notes.length, 1, "team note shared");
    const srv = kids.find((k) => k.title === "Coin server"), mod = kids.find((k) => k.title === "Coins module");
    assert(srv.startedAt >= mod.finishedAt, "dependency order respected");
  });
  await test("history records changes and undo restores the file", async () => {
    const p = be.project(projId);
    const h = be.ws.history(p);
    assert(h.length >= 2);
    const rec = h.find((r) => r.path.endsWith("CoinServer.server.luau"));
    be.undoChange(projId, rec.id);
    assert(!fs.existsSync(path.join(PROJECT_DIR, rec.path)), "created file removed by undo");
  });
  await test("file locks stop two agents editing the same file", async () => {
    const p = be.project(projId);
    be.ws.lock(p, "src/A.luau", "t1", "Forge");
    assert.throws(() => be.ws.lock(p, "src/A.luau", "t2", "Iris"), /being edited by Forge/);
    be.ws.releaseTask("t1");
    be.ws.lock(p, "src/A.luau", "t2", "Iris");
    be.ws.releaseTask("t2");
  });
  await test("paths outside the project folder are refused", async () => {
    assert.throws(() => be.ws.resolve(be.project(projId), "../../evil.txt"), /escapes/);
  });

  console.log("Approvals");
  await test("in 'ask all' mode a write waits for approval, then applies", async () => {
    be.saveSettings({ permissionMode: "ask_all" });
    const id = be.createTask({ description: "Write please", agentId: be.d.agents[1].id });
    const apr = await until(() => [...be.approvals.values()][0], 10000, "approval request");
    assert.equal(be.d.tasks.find((t) => t.id === id).status, "waiting_approval");
    assert.equal(apr.detail.after, "return 1\n");
    assert(!fs.existsSync(path.join(PROJECT_DIR, "src/Approved.luau")), "not written before approval");
    be.resolveApproval(apr.id, true);
    await until(() => be.d.tasks.find((t) => t.id === id).status === "completed", 10000, "task done");
    assert(fs.existsSync(path.join(PROJECT_DIR, "src/Approved.luau")));
    be.saveSettings({ permissionMode: "ask_destructive" });
  });

  console.log("MCP servers");
  let srvId;
  await test("custom stdio MCP server connects and its tools are discovered", async () => {
    srvId = await be.addServer({ name: "Echo", transport: "stdio", command: process.execPath, args: [path.join(__dirname, "fixtures", "echo-mcp-server.js")], envSet: { SECRET_TOKEN: "TOKEN-XYZ" } });
    const s = be.serverPublic(be.d.mcpServers.find((x) => x.id === srvId));
    assert.equal(s.status, "connected", s.error);
    assert.deepEqual(s.tools.map((t) => t.name).sort(), ["echo", "wipe_place"]);
    assert.equal(s.tools.find((t) => t.name === "echo").effective, "auto");
    assert.equal(s.tools.find((t) => t.name === "wipe_place").effective, "ask");
    assert.deepEqual(s.envKeys, ["SECRET_TOKEN"]);
    assert(!JSON.stringify(be.publicState()).includes("TOKEN-XYZ"), "env secret leaked");
  });
  await test("calling an MCP tool returns its real output", async () => {
    const r = await be.mcp.call(srvId, "echo", { text: "hi" });
    assert.equal(r.text, "echo: hi");
  });
  await test("agents get MCP tools; destructive ones ask for approval first", async () => {
    const agent = be.d.agents[1];
    assert(be.toolsFor(null, agent).some((t) => t.name === "echo__echo"));
    const id = be.createTask({ description: "MCP please", agentId: agent.id });
    const apr = await until(() => [...be.approvals.values()][0], 10000, "approval");
    assert.equal(apr.kind, "tool");
    be.resolveApproval(apr.id, false, "not now");
    const t = await until(() => { const x = be.d.tasks.find((q) => q.id === id); return x.status === "completed" && x; }, 10000, "task done");
    assert(/tool result seen/.test(t.result));
  });
  await test("tool policy 'off' hides a tool from agents", async () => {
    be.setToolPolicy(srvId, "echo", "off");
    assert(!be.toolsFor(null, be.d.agents[1]).some((t) => t.name === "echo__echo"));
    be.setToolPolicy(srvId, "echo", "default");
  });
  await test("Roblox Studio MCP preset starts the real StudioMCP server", async () => {
    const id = await be.addServer({ preset: "roblox-studio" });
    const s = be.serverPublic(be.d.mcpServers.find((x) => x.id === id));
    console.log(`     (status: ${s.status}${s.error ? ", " + s.error : ""}, ${s.tools.length} tools)`);
    if (s.status === "connected") {
      const studios = await be.detectStudios(true);
      console.log(`     (open Studio windows: ${studios.length}${be.studioError ? " — " + be.studioError : ""})`);
    }
    assert(["connected", "error"].includes(s.status));
  });

  console.log("Chat, prompts, cancel");
  await test("chat message gets a real reply from the agent", async () => {
    const a = be.d.agents[0];
    be.sendChat({ agentIds: [a.id], text: "hello" });
    await until(() => (be.d.conversations[a.id] || []).some((m) => m.role === "assistant"), 10000, "reply");
    assert.equal(be.d.conversations[a.id].at(-1).text, "Hello from the mock model");
  });
  await test("improve prompt returns the model's expanded text", async () => {
    const out = await be.improvePrompt("pets game");
    assert.equal(out, "Hello from the mock model");
  });
  await test("tasks can be cancelled", async () => {
    be.saveSettings({ permissionMode: "ask_all" });
    fs.rmSync(path.join(PROJECT_DIR, "src/Approved.luau"), { force: true });
    const id = be.createTask({ description: "Write please", agentId: be.d.agents[2].id });
    await until(() => [...be.approvals.values()][0], 10000, "approval");
    be.cancelTask(id);
    const t = await until(() => { const x = be.d.tasks.find((q) => q.id === id); return x.status === "cancelled" && x; }, 10000, "cancel");
    assert.equal(t.error, "Cancelled by you");
    be.saveSettings({ permissionMode: "ask_destructive" });
  });

  await be.shutdown();
  model.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

// Tests for "Control VYRON from Claude": the local MCP server and JSON API.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { Backend } = require("../src/backend");
const { ControlServer } = require("../src/control");
const { dispatch } = require("../src/api");
const { mockModel } = require("./mock-model");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { failed++; console.log("  ✗", name, "\n     ", e.message); }
}

(async () => {
  const model = await mockModel();
  const TMP = path.join(__dirname, "..", ".testdata-control");
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(path.join(TMP, "game", "src"), { recursive: true });
  const be = new Backend({ dataDir: TMP, encrypt: (s) => s, decrypt: (s) => s });
  await be.init();
  await be.addProvider({ type: "openai", name: "Mock", baseURL: `http://127.0.0.1:${model.address().port}/v1`, apiKey: "SECRET-KEY-123", accountEmail: "me@test.com" });
  be.setActiveProject(await be.addProject({ name: "Test", rojoDir: path.join(TMP, "game") }));

  const control = new ControlServer({ dataDir: TMP, getCtx: () => ({ backend: be, auth: null, control }), log: () => {}, version: "test" });
  control.cfg.port = 47291;
  const ctx = { backend: be, auth: null, control };
  const base = `http://127.0.0.1:${control.cfg.port}`;
  const rpc = async (tool, args, headers = {}) => (await fetch(`${base}/rpc/${tool}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + control.cfg.token, ...headers }, body: JSON.stringify(args || {}) })).json();

  console.log("Switch");
  await test("off by default", async () => {
    assert.equal(control.status().enabled, false);
    await assert.rejects(fetch(base + "/health"));
  });
  await test("the Settings switch turns it on (127.0.0.1 only)", async () => {
    const s = await dispatch(ctx, "controlSetEnabled", [true]);
    assert(s.enabled && s.running, s.error);
    assert.equal((await (await fetch(base + "/health")).json()).app, "VYRON");
  });

  console.log("Security");
  await test("no key or a wrong key is refused", async () => {
    assert.equal((await fetch(`${base}/rpc/vyron_status`, { method: "POST" })).status, 401);
    assert.equal((await rpc("vyron_status", {}, { Authorization: "Bearer nope" })).ok, false);
  });
  await test("a request with a foreign Host header is refused (DNS rebinding)", async () => {
    const http = require("http");
    const code = await new Promise((r) => http.request({ host: "127.0.0.1", port: control.cfg.port, path: "/rpc/vyron_status", method: "POST", headers: { Host: "evil.example:47291", Authorization: "Bearer " + control.cfg.token } }, (res) => r(res.statusCode)).end());
    assert.equal(code, 401);
  });
  await test("API keys never come out, and there is no tool to approve risky actions", async () => {
    const r = await rpc("vyron_status");
    assert(r.ok && !JSON.stringify(r).includes("SECRET-KEY-123"));
    const tools = control.tools().map((t) => t.name);
    assert(!tools.some((t) => /approv|key|secret|delete_project/i.test(t)), tools.join(","));
  });
  await test("when VYRON is locked, nothing works", async () => {
    const locked = new ControlServer({ dataDir: TMP + "-l", getCtx: () => ({ backend: be, auth: { locked: true, public: () => ({ locked: true }) } }), version: "t" });
    await assert.rejects(locked.runTool("vyron_status", {}), /locked/);
    fs.rmSync(TMP + "-l", { recursive: true, force: true });
  });

  console.log("Controlling VYRON");
  await test("status shows the AIs with role, model and account email", async () => {
    const r = (await rpc("vyron_status")).result;
    assert.equal(r.ais.length, 6);
    assert.equal(r.ais[0].accountEmail, "me@test.com");
    assert.equal(r.activeProject.name, "Test");
  });
  await test("add an AI with a role", async () => {
    const r = await rpc("vyron_add_agent", { name: "Pix", role: "Image Creator" });
    assert(r.ok, r.error);
    assert(be.d.agents.some((a) => a.name === "Pix" && a.role === "Image Creator"));
  });
  await test("change an AI's permission", async () => {
    const r = await rpc("vyron_update_agent", { agent_name: "Pix", permissions: { stats: true } });
    assert(r.ok, r.error);
    assert.equal(be.d.agents.find((a) => a.name === "Pix").perms.stats, true);
  });
  await test("start a build and wait for the team to finish it", async () => {
    const b = await rpc("vyron_build", { request: "Make a coin system" });
    assert(b.ok, b.error);
    const w = await rpc("vyron_wait_for_task", { id: b.result.taskId, timeout_seconds: 60 });
    assert(w.ok, w.error);
    assert.equal(w.result.status, "completed");
    const t = await rpc("vyron_get_task", { id: b.result.taskId });
    assert.equal(t.result.subtasks.length, 3);
    assert(fs.existsSync(path.join(TMP, "game", "src", "ReplicatedStorage", "Coins.luau")));
  });
  await test("chat with an AI and read its reply", async () => {
    assert((await rpc("vyron_chat", { agent_name: "Atlas", message: "hello" })).ok);
    let reply;
    for (let i = 0; i < 40 && !reply; i++) { await new Promise((r) => setTimeout(r, 250)); reply = (await rpc("vyron_get_chat", { agent_name: "Atlas" })).result.messages.find((m) => m.from === "Atlas"); }
    assert.equal(reply.text, "Hello from the mock model");
  });
  await test("bad input gets a clear error", async () => {
    const r = await rpc("vyron_chat", { agent_name: "Nobody", message: "hi" });
    assert(!r.ok && /No AI called "Nobody"/.test(r.error));
  });

  console.log("Real MCP protocol");
  await test("an MCP client lists VYRON's tools and calls one", async () => {
    const client = new Client({ name: "test", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: { Authorization: "Bearer " + control.cfg.token } } }));
    const { tools } = await client.listTools();
    for (const n of ["vyron_status", "vyron_build", "vyron_chat", "vyron_wait_for_task", "vyron_list_agents"]) assert(tools.some((t) => t.name === n), "missing " + n);
    const r = await client.callTool({ name: "vyron_list_agents", arguments: {} });
    assert(JSON.parse(r.content[0].text).some((a) => a.name === "Pix"));
    await client.close();
  });
  await test("the MCP endpoint also needs the key", async () => {
    const client = new Client({ name: "test", version: "1" });
    await assert.rejects(client.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"))));
  });
  await test("the switch turns it off again", async () => {
    await dispatch(ctx, "controlSetEnabled", [false]);
    await assert.rejects(fetch(base + "/health"));
  });

  await be.shutdown();
  model.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

// Tests for VYRON as a Claude companion: ideas, DevEx kroner, the Claude
// runner (with a fake claude.exe process) and the Claude connector.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");
const { Backend } = require("../src/core");
const { ControlServer } = require("../src/control");
const { dispatch } = require("../src/api");
const { IDEAS, CATEGORIES } = require("../src/ideas");
const DX = require("../src/devex");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { failed++; console.log("  ✗", name, "\n     ", e.message); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Pages as the official sites serve them (trimmed).
const DEVEX_HTML = `<html><body><h2>Exchange rate</h2><p>The standard exchange rate for the DevEx program is <strong>$0.0038</strong> USD per 1 Earned Robux.</p></body></html>`;
const ECB_XML = `<gesmes:Envelope><Cube><Cube time='2026-11-20'><Cube currency='USD' rate='1.0990'/><Cube currency='JPY' rate='170.1'/><Cube currency='DKK' rate='7.4746'/></Cube></Cube></gesmes:Envelope>`;
const fakeFetch = async (url) => {
  if (url === DX.DEVEX_URL) return new Response(DEVEX_HTML);
  if (url === DX.ECB_URL) return new Response(ECB_XML);
  return new Response("", { status: 404 });
};

// A fake claude.exe: records how it was started and answers in stream-json.
const spawned = [];
function fakeSpawn(script) {
  return (exe, args, opts) => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
    let input = "";
    p.stdin = { end: (t) => { input = t; setTimeout(() => {
      spawned.push({ exe, args, opts, input });
      for (const l of script(input, args)) p.stdout.emit("data", Buffer.from(JSON.stringify(l) + "\n"));
      p.emit("close", 0);
    }, 10); } };
    p.kill = () => p.emit("close", 1);
    p.unref = () => {};
    return p;
  };
}
const reply = (input) => [
  { type: "system", subtype: "init", session_id: "sess-1" },
  { type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__roblox_studio__execute_luau", input: { code: "print(1)" } }] } },
  { type: "assistant", message: { content: [{ type: "text", text: "Built it: " + input.split("\n").pop().slice(0, 20) }] } },
  { type: "result", subtype: "success", is_error: false, result: "ok", session_id: "sess-1", duration_ms: 2100, num_turns: 3 },
];

(async () => {
  console.log("Game ideas");
  await test("a big library across many genres, ids unique, nothing empty", () => {
    assert(IDEAS.length >= 120, "only " + IDEAS.length);
    for (const c of ["Brainrot", "Shooter", "PvP & Fighting", "Simulator", "Tycoon", "Obby & Parkour", "Horror", "Tower Defense"]) assert(CATEGORIES.includes(c), c);
    assert.equal(new Set(IDEAS.map((i) => i.id)).size, IDEAS.length);
    assert.equal(new Set(IDEAS.map((i) => i.title)).size, IDEAS.length, "duplicate titles");
    assert(IDEAS.every((i) => i.title && i.pitch.length > 20 && i.features));
  });

  console.log("DevEx kroner (official sources)");
  await test("reads the DevEx rate from the Roblox page and USD→DKK from the ECB", async () => {
    const r = await DX.fetchRates(fakeFetch);
    assert.equal(r.usdPerRobux, 0.0038);
    assert(r.devexLive && r.ecbLive && r.ecbDate === "2026-11-20");
    assert(Math.abs(r.dkkPerUsd - 7.4746 / 1.099) < 1e-9);
    assert.equal(Math.round(DX.toDkk(30000, r) * 100) / 100, Math.round(30000 * 0.0038 * (7.4746 / 1.099) * 100) / 100);
  });
  await test("offline: keeps the last known rates and says why", async () => {
    const prev = await DX.fetchRates(fakeFetch);
    const r = await DX.fetchRates(async () => { throw new Error("no internet"); }, prev);
    assert(!r.devexLive && !r.ecbLive && r.errors.length === 2);
    assert.equal(r.dkkPerRobux, prev.dkkPerRobux);
  });
  await test("a page without the rate is not trusted", () => {
    assert.throws(() => DX.parseDevex("<p>Hello</p>"), /not found/);
    assert.throws(() => DX.parseEcb("<x/>"), /not found/);
  });

  const TMP = path.join(__dirname, "..", ".testdata-core");
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(path.join(TMP, "game"), { recursive: true });
  const be = new Backend({ dataDir: TMP, encrypt: (s) => s, decrypt: (s) => s, studio: false, fetchImpl: fakeFetch, claude: { exe: "C:/fake/claude.exe", spawnImpl: fakeSpawn(reply) } });
  be.claude.checkAuth = async () => (be.claude.auth = { loggedIn: true });
  const control = new ControlServer({ dataDir: TMP, getCtx: () => ({ backend: be, auth: null, control }), log: () => {}, version: "test" });
  control.cfg.port = 47292;
  be.controlInfo = (k) => (k ? { ...control.status(), token: control.cfg.token } : control.status());
  await be.init();
  await control.start();
  await wait(50);
  const ctx = { backend: be, auth: null, control };

  console.log("App");
  await test("only the Claude-era methods exist (agents, providers, roles are gone)", async () => {
    for (const m of ["addAgent", "addProvider", "sendChat", "build", "scanLocal", "createTask"]) await assert.rejects(dispatch(ctx, m, []), /Unknown method/);
    await assert.rejects(dispatch(ctx, "notify", ["hi"]), /Unknown method/); // connector only
    const s = await dispatch(ctx, "publicState");
    assert(!("agents" in s) && !("providers" in s) && s.claude && s.ideas && s.rates);
    assert.equal(s.ideas.count, IDEAS.length);
  });
  await test("rates are loaded on start", () => assert(be.d.rates.devexLive && be.d.rates.ecbLive));

  console.log("Ideas tab");
  await test("pick many ideas, and unknown ids are ignored", async () => {
    await dispatch(ctx, "setPicked", [[IDEAS[0].id, IDEAS[12].id, "nope"]]);
    assert.deepEqual(be.d.picked, [IDEAS[0].id, IDEAS[12].id]);
  });
  let mine;
  await test("custom ideas are saved and can be picked", async () => {
    await assert.rejects(dispatch(ctx, "addCustomIdea", [{}]), /Write your idea/);
    mine = await dispatch(ctx, "addCustomIdea", [{ title: "Cat Cafe Wars", pitch: "Cats run rival cafes and steal each other's customers." }]);
    await dispatch(ctx, "setPicked", [[...be.d.picked, mine]]);
    assert.equal(be.publicState().ideas.picked.length, 3);
  });
  await test("several ideas become one build request", async () => {
    const t = await dispatch(ctx, "ideaPrompt", [be.d.picked, "make it multiplayer"]);
    assert(/combines these ideas/.test(t) && t.includes(IDEAS[0].title) && t.includes("Cat Cafe Wars") && /make it multiplayer/.test(t));
  });

  console.log("Claude tab");
  be.setActiveProject(await be.addProject({ name: "Test Game", rojoDir: path.join(TMP, "game") }));
  await test("sends to claude.exe headless with VYRON + Studio tools, in the project folder", async () => {
    await dispatch(ctx, "claudeSend", ["make a coin system"]);
    for (let i = 0; i < 50 && be.claude.busy; i++) await wait(20);
    const run = spawned.at(-1);
    assert(run.args.includes("-p") && run.args.includes("stream-json") && run.args.includes("--strict-mcp-config"));
    assert.equal(run.opts.cwd, path.join(TMP, "game"));
    assert(/Active VYRON project: Test Game/.test(run.input) && /make a coin system$/.test(run.input));
    const cfg = JSON.parse(fs.readFileSync(run.args[run.args.indexOf("--mcp-config") + 1], "utf8"));
    assert.equal(cfg.mcpServers.vyron.url, "http://127.0.0.1:47292/mcp");
    assert.equal(cfg.mcpServers.vyron.headers.Authorization, "Bearer " + control.cfg.token);
    assert(run.args.includes("acceptEdits") && run.args.includes("mcp__vyron") && !run.args.includes("--dangerously-skip-permissions"));
    assert(!run.args.includes("Bash"), "shell must not be allowed in safe mode");
  });
  await test("replies, tool steps and the session show in the chat", () => {
    const m = be.publicState().claude.messages.map((x) => x.role + ":" + x.text);
    assert(m.some((x) => /^tool:roblox_studio · execute_luau/.test(x)), m.join(" | "));
    assert(m.some((x) => /^assistant:Built it/.test(x)));
    assert(m.some((x) => /^result:Done in 2 s · 3 steps/.test(x)));
    assert.equal(be.claude.sessionId, "sess-1");
    assert(!JSON.stringify(be.publicState()).includes(control.cfg.token), "control key leaked to the UI");
  });
  await test("the next message continues the same Claude chat", async () => {
    await dispatch(ctx, "claudeSend", ["now add a shop"]);
    for (let i = 0; i < 50 && be.claude.busy; i++) await wait(20);
    const a = spawned.at(-1).args;
    assert.equal(a[a.indexOf("--resume") + 1], "sess-1");
  });
  await test("Build with Claude sends the picked ideas", async () => {
    await dispatch(ctx, "buildIdeas", [be.d.picked, ""]);
    for (let i = 0; i < 50 && be.claude.busy; i++) await wait(20);
    assert(spawned.at(-1).input.includes("Cat Cafe Wars"));
  });
  await test("full access mode is a deliberate setting", async () => {
    await dispatch(ctx, "saveSettings", [{ claudeAccess: "full", claudeModel: "opus; rm -rf" }]);
    assert.equal(be.d.settings.claudeModel, "opusrm-rf");
    await dispatch(ctx, "claudeSend", ["hi"]);
    for (let i = 0; i < 50 && be.claude.busy; i++) await wait(20);
    assert(spawned.at(-1).args.includes("--dangerously-skip-permissions"));
    await dispatch(ctx, "saveSettings", [{ claudeAccess: "safe", claudeModel: "" }]);
  });
  await test("not signed in to Claude → a clear message", async () => {
    be.claude.o.spawnImpl = fakeSpawn(() => [{ type: "result", is_error: true, result: "Not logged in · Please run /login", duration_ms: 10 }]);
    await dispatch(ctx, "claudeSend", ["hello"]);
    for (let i = 0; i < 50 && be.claude.busy; i++) await wait(20);
    assert(be.claude.messages.some((m) => m.role === "error" && /Sign in to Claude/.test(m.text)));
    be.claude.o.spawnImpl = fakeSpawn(reply);
  });
  await test("new chat forgets the session", async () => {
    await dispatch(ctx, "claudeNewChat", []);
    assert.equal(be.claude.sessionId, null);
    assert.equal(be.publicState().claude.messages.length, 0);
  });

  console.log("Claude connector (MCP)");
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:47292/mcp"), { requestInit: { headers: { Authorization: "Bearer " + control.cfg.token } } }));
  const callTool = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); if (r.isError) throw new Error(r.content[0].text); return JSON.parse(r.content[0].text.startsWith("{") || r.content[0].text.startsWith("[") ? r.content[0].text : JSON.stringify(r.content[0].text)); };
  await test("only Claude-companion tools (no agents, roles or local AIs)", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of ["vyron_status", "vyron_list_ideas", "vyron_pick_ideas", "vyron_add_idea", "vyron_revenue", "vyron_notify", "vyron_list_projects", "vyron_set_project"]) assert(names.includes(n), n);
    assert(!names.some((n) => /agent|role|local|model|task|chat/.test(n)), names.join(","));
  });
  await test("status shows the project, ideas and kroner", async () => {
    const s = await callTool("vyron_status");
    assert.equal(s.activeProject.name, "Test Game");
    assert.equal(s.pickedIdeas, 3);
    assert.equal(s.revenue.minRobux, 30000);
    assert(s.revenue.rate.krPerRobux > 0.02 && s.revenue.rate.krPerRobux < 0.03);
  });
  await test("Claude can list ideas by genre and pick them", async () => {
    const r = await callTool("vyron_list_ideas", { category: "brainrot" });
    assert(r.ideas.length >= 10 && r.ideas.every((i) => i.category === "Brainrot"));
    await callTool("vyron_pick_ideas", { ids: [r.ideas[1].id] });
    assert.deepEqual(be.d.picked, [r.ideas[1].id]);
  });
  await test("Claude can show a message in VYRON", async () => {
    let got = null;
    be.once("notify", (n) => (got = n));
    await callTool("vyron_notify", { message: "Your game is ready" });
    assert.equal(got.text, "Your game is ready");
  });
  await test("wrong key is refused", async () => {
    const r = await fetch("http://127.0.0.1:47292/rpc/vyron_status", { method: "POST", headers: { Authorization: "Bearer nope" } });
    assert.equal(r.status, 401);
  });
  await client.close();

  await control.stop();
  await be.shutdown();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

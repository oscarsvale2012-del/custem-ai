// Studio team: Co-Founder plans in the Ideas tab → Accept → every role gets its
// jobs and the right tools (Builder gets Blender) → the Co-Founder directs them
// with team tools → on/off switches. Claude itself is faked.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");
process.env.VYRON_BLENDER_MCP = process.execPath; // pretend Blender's MCP server is installed
const { Backend } = require("../src/core");
const { ControlServer } = require("../src/control");
const { dispatch } = require("../src/api");
const R = require("../src/roles");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { failed++; console.log("  ✗", name, "\n     ", e.message); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PLAN = { title: "Lava Pet Tycoon", summary: "Hatch pets and escape lava.", features: ["pets", "lava obby", "shop"],
  work: { builder: [{ title: "Lava map", details: "A 200x200 baseplate with lava rivers" }, { title: "Pet model", details: "Low-poly dragon in Blender" }],
    coder: [{ title: "Pet system", details: "Hatching with 3 rarities" }], ui: [{ title: "Shop UI", details: "6 slots" }], money: [{ title: "2x Coins pass", details: "149 Robux" }] } };
const runs = [];
let slow = 0;
function fakeSpawn(exe, args, opts) {
  const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
  p.stdin = { end: (input) => setTimeout(() => {
    runs.push({ args, input });
    const sys = args[args.indexOf("--append-system-prompt") + 1];
    let text = "OK, working on it. Done.";
    if (/Make the full plan/.test(input)) text = "Here is my plan!\n```json\n" + JSON.stringify(PLAN) + "\n```";
    if (/Change the plan/.test(input)) text = "Updated:\n```json\n" + JSON.stringify({ ...PLAN, title: "Horror Pet Tycoon" }) + "\n```";
    if (/no json please/.test(input)) text = "I forgot the plan, sorry.";
    p.stdout.emit("data", Buffer.from(JSON.stringify({ type: "system", subtype: "init", session_id: "s-" + runs.length, model: "claude-opus-5-5" }) + "\n"));
    p.stdout.emit("data", Buffer.from(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }) + "\n"));
    p.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", is_error: false, duration_ms: 5, session_id: "s-" + runs.length, sys }) + "\n"));
    p.emit("close", 0);
  }, slow || 10) };
  p.kill = () => p.emit("close", 1);
  return p;
}

(async () => {
  const TMP = path.join(__dirname, "..", ".testdata-team");
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(path.join(TMP, "game"), { recursive: true });
  const be = new Backend({ dataDir: TMP, encrypt: (s) => s, decrypt: (s) => s, studio: false, fetchImpl: async () => { throw new Error("offline"); }, claude: { exe: "C:/fake/claude.exe", spawnImpl: fakeSpawn } });
  be.claude.checkAuth = async () => (be.claude.auth = { loggedIn: true });
  const control = new ControlServer({ dataDir: TMP, getCtx: () => ({ backend: be, auth: null, control }), log: () => {}, version: "t" });
  control.cfg.port = 47296;
  be.controlInfo = (k) => (k ? { ...control.status(), token: control.cfg.token } : control.status());
  await be.init(); await control.start();
  be.setActiveProject(await be.addProject({ name: "Test", rojoDir: path.join(TMP, "game") }));
  const ctx = { backend: be, auth: null, control };
  await dispatch(ctx, "saveSettings", [{ claudeParallel: 10 }]);
  const idle = async () => { for (let i = 0; i < 200 && be.claude.busy; i++) await wait(20); };
  const team = () => be.publicState().teams[0];
  const taskOf = (r) => be.claude.tasks.find((x) => x.id === team().roles[r].taskId);

  console.log("Roles");
  await test("five roles with their own jobs and tools", () => {
    assert.deepEqual(R.ROLE_IDS, ["cofounder", "builder", "coder", "ui", "money"]);
    assert(R.ROLES.builder.servers.includes("blender") && !R.ROLES.coder.servers.includes("blender"));
    assert(/gamepasses/i.test(R.ROLES.money.prompt) && /Blender/.test(R.ROLES.builder.prompt) && /control the team/.test(R.ROLES.cofounder.prompt));
  });
  await test("the plan is read from the Co-Founder's answer (and junk is ignored)", () => {
    assert.equal(R.parsePlan("x ```json\n" + JSON.stringify(PLAN) + "\n``` y").work.builder.length, 2);
    assert.equal(R.parsePlan("no plan here"), null);
    assert.equal(R.parsePlan("```json\n{not json}\n```"), null);
  });

  console.log("Ideas tab → Co-Founder");
  let id;
  await test("ask → the Co-Founder plans (nothing is built yet)", async () => {
    await assert.rejects(dispatch(ctx, "teamPlan", ["", []]), /Tell the Co-Founder/);
    id = await dispatch(ctx, "teamPlan", ["a lava pet tycoon", [be.listIdeas()[0].id]]);
    assert.equal(team().status, "planning");
    await idle();
    assert.equal(team().status, "proposed");
    assert.equal(team().plan.title, "Lava Pet Tycoon");
    assert(/Do NOT build/.test(runs.at(-1).input) && runs.at(-1).input.includes(be.listIdeas()[0].title));
    assert.equal(be.claude.tasks.filter((t) => t.teamId === id).length, 1, "only the Co-Founder works before Accept");
  });
  await test("Change → the Co-Founder updates the plan", async () => {
    await dispatch(ctx, "teamRevise", [id, "make it horror"]);
    await idle();
    assert.equal(team().plan.title, "Horror Pet Tycoon");
    assert.equal(team().status, "proposed");
  });
  await test("switch a role off before accepting → it isn't started", async () => {
    await dispatch(ctx, "teamSetRole", [id, "money", false]);
    assert.equal(team().roles.money.enabled, false);
  });
  await test("Accept → every switched-on role gets detailed jobs, the Co-Founder starts directing", async () => {
    const before = runs.length;
    await dispatch(ctx, "teamAccept", [id]);
    await idle();
    assert.equal(team().status, "building");
    for (const r of ["builder", "coder", "ui"]) assert(taskOf(r), r + " not started");
    assert.equal(team().roles.money.taskId, null);
    const builderRun = runs.slice(before).find((x) => /Builder & Modeler/.test(x.input));
    assert(/Lava map — A 200x200 baseplate/.test(builderRun.input), "builder got its jobs with details");
    const cfg = JSON.parse(fs.readFileSync(builderRun.args[builderRun.args.indexOf("--mcp-config") + 1], "utf8"));
    assert(cfg.mcpServers.blender && cfg.mcpServers.roblox_studio && cfg.mcpServers.vyron, "builder gets Blender + Studio + VYRON");
    assert(/You are the Builder & Modeler/.test(builderRun.args[builderRun.args.indexOf("--append-system-prompt") + 1]));
    const coderRun = runs.slice(before).find((x) => /as Coder/.test(x.input));
    assert(!JSON.parse(fs.readFileSync(coderRun.args[coderRun.args.indexOf("--mcp-config") + 1], "utf8")).mcpServers.blender, "coder doesn't get Blender");
    assert(runs.slice(before).some((x) => /accepted your plan/.test(x.input) && /vyron_team_status/.test(x.input)), "Co-Founder told to direct");
  });

  console.log("The Co-Founder directs through VYRON");
  const client = new Client({ name: "cofounder", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:47296/mcp"), { requestInit: { headers: { Authorization: "Bearer " + control.cfg.token } } }));
  const tool = async (name, args) => { const r = await client.callTool({ name, arguments: args }); if (r.isError) throw new Error(r.content[0].text); try { return JSON.parse(r.content[0].text); } catch { return r.content[0].text; } };
  await test("team status shows every role, its jobs and state", async () => {
    const s = await tool("vyron_team_status", {});
    assert.equal(s.game, "Horror Pet Tycoon");
    assert.equal(s.roles.find((r) => r.role === "money").state, "off");
    assert.deepEqual(s.roles.find((r) => r.role === "builder").jobs, ["Lava map", "Pet model"]);
  });
  await test("a message to a busy role waits and is delivered when its step ends", async () => {
    slow = 150;
    await tool("vyron_team_message", { role: "coder", message: "use RemoteEvent PetHatched", from: "Co-Founder" });
    await wait(30);
    await tool("vyron_team_message", { role: "coder", message: "and save pets in DataStore" });
    assert(taskOf("coder").busy && taskOf("coder").inbox.length === 1, "second message waits");
    await idle();
    assert(runs.some((x) => /save pets in DataStore/.test(x.input)), "delivered after the step");
    slow = 0;
  });
  await test("a switched-off role can't be messaged; switching on starts it", async () => {
    await assert.rejects(tool("vyron_team_message", { role: "Money Maker", message: "make passes" }), /switched off/);
    await dispatch(ctx, "teamSetRole", [id, "money", true]);
    await idle();
    assert(taskOf("money") && runs.some((x) => /Your jobs as Money Maker/.test(x.input) && /2x Coins pass — 149 Robux/.test(x.input)));
  });
  await test("switching a working role off stops it", async () => {
    slow = 300;
    await tool("vyron_team_message", { role: "ui", message: "make the shop bigger" });
    await wait(30);
    assert(taskOf("ui").busy);
    await dispatch(ctx, "teamSetRole", [id, "ui", false]);
    await idle();
    assert(taskOf("ui").messages.some((m) => m.text === "Stopped.") && team().roles.ui.state === "off");
    slow = 0;
  });
  await test("wait returns when the roles are done", async () => {
    const s = await tool("vyron_team_wait", { timeout_seconds: 10 });
    assert(s.roles.filter((r) => r.role !== "cofounder" && r.state !== "off").every((r) => r.state === "done"));
  });
  await test("a plan without JSON is reported, not crashed", async () => {
    const t2 = await dispatch(ctx, "teamPlan", ["no json please", []]);
    await idle();
    const t = be.publicState().teams.find((x) => x.id === t2);
    assert.equal(t.status, "failed"); assert(/no plan/i.test(t.error));
    await dispatch(ctx, "teamDiscard", [t2]);
    assert(!be.publicState().teams.some((x) => x.id === t2));
  });

  console.log("Blender");
  await test("Make a 3D model → a Builder Claude with Blender", async () => {
    const before = runs.length;
    await dispatch(ctx, "makeModel", ["a cartoon treasure chest"]);
    await idle();
    const r = runs.slice(before)[0];
    assert(/Make this 3D model in Blender: a cartoon treasure chest/.test(r.input) && /\.fbx/.test(r.input));
    assert(JSON.parse(fs.readFileSync(r.args[r.args.indexOf("--mcp-config") + 1], "utf8")).mcpServers.blender);
  });
  await test("Blender can be switched off for Claude in Settings", async () => {
    await dispatch(ctx, "saveSettings", [{ blender: false }]);
    await dispatch(ctx, "makeModel", ["a lamp"]);
    await idle();
    const r = runs.at(-1);
    assert(!JSON.parse(fs.readFileSync(r.args[r.args.indexOf("--mcp-config") + 1], "utf8")).mcpServers.blender);
    await dispatch(ctx, "saveSettings", [{ blender: true }]);
  });

  console.log("First-run setup");
  await test("the checklist has the 7 connections and isn't done on a new PC", () => {
    const s = be.publicState().setup;
    assert.deepEqual(s.items.map((i) => i.id), ["claude", "desktop", "code", "studio", "blender", "roblox", "discord"]);
    assert.equal(s.onboarded, false);
    assert(s.items.find((i) => i.id === "claude").ok, "Claude is signed in in this test");
    assert(s.items.find((i) => i.id === "code").ok, "this test's MCP client counts as Claude Code");
    assert(!s.items.find((i) => i.id === "discord").ok);
  });
  await test("Discord: only real webhook links, a hello message, task news is posted", async () => {
    const posts = [];
    be.fetch = async (url, o) => { posts.push({ url, body: JSON.parse(o.body) }); return new Response(null, { status: 204 }); };
    await assert.rejects(dispatch(ctx, "setDiscord", ["https://evil.example/hook"]), /isn't a Discord webhook/);
    const hook = "https://discord.com/api/webhooks/123456789/abcDEF_-x";
    await dispatch(ctx, "setDiscord", [hook]);
    assert(/VYRON is connected/.test(posts[0].body.content) && posts[0].url === hook);
    assert.deepEqual(posts[0].body.allowed_mentions, { parse: [] }, "never pings @everyone");
    assert(be.publicState().setup.items.find((i) => i.id === "discord").ok);
    assert(!JSON.stringify(be.publicState()).includes("abcDEF_-x"), "the webhook link stays secret");
    await dispatch(ctx, "makeModel", ["a sword"]);
    await idle();
    await wait(50);
    assert(posts.some((p) => /Claude finished/.test(p.body.content)), "task news reached Discord");
    be.fetch = async () => new Response("", { status: 404 });
    await assert.rejects(dispatch(ctx, "testDiscord", []), /doesn't exist/);
  });
  await test("missing apps are found and get their official download links", () => {
    const empty = path.join(TMP, "emptyPC");
    be._apps = null;
    const oldB = process.env.VYRON_BLENDER_MCP; delete process.env.VYRON_BLENDER_MCP;
    const A = be.installedApps({ LOCALAPPDATA: empty, APPDATA: empty, ProgramFiles: empty });
    process.env.VYRON_BLENDER_MCP = oldB;
    assert.equal(A.studio, false); assert.equal(A.blender, false);
    be._apps = { ...A, at: Date.now() };
    const items = be.setupStatus().items;
    const st = items.find((i) => i.id === "studio"), bl = items.find((i) => i.id === "blender");
    assert(st.installed === false && st.download === "https://create.roblox.com/landing");
    assert(bl.installed === false && bl.download === "https://www.blender.org/download/");
    be._apps = { ...A, blender: true, at: Date.now() };
    assert.equal(be.setupStatus().items.find((i) => i.id === "blender").download, "https://www.blender.org/lab/mcp-server/", "Blender installed but no MCP → add-on link");
    be._apps = null;
  });
  await test("the setup prompt's tools work through the connector", async () => {
    const st = await tool("vyron_setup_status", {});
    assert.equal(st.total, 6, "Discord is optional");
    assert.equal(st.items.length, 7);
    assert(st.items.every((i) => i.how));
    const LA = path.join(TMP, "LA"); fs.mkdirSync(path.join(LA, "Claude-Data", "acc"), { recursive: true });
    fs.writeFileSync(path.join(LA, "Claude-Data", "acc", "claude_desktop_config.json"), "{}");
    const old = process.env.LOCALAPPDATA; process.env.LOCALAPPDATA = LA;
    control.bridge = { command: "VYRON.exe", args: ["bridge.js"], env: { ELECTRON_RUN_AS_NODE: "1" } };
    try { const r = await tool("vyron_connect_claude_desktop", {}); assert(r.connected); } finally { process.env.LOCALAPPDATA = old; }
    const cc = await tool("vyron_check_connections", {});
    assert("studio" in cc && "blender" in cc);
  });
  await test("Finish needs everything except Discord", async () => {
    await assert.rejects(dispatch(ctx, "finishSetup", []), /Connect these first: .*Roblox Studio.*Blender.*Roblox account/);
    assert(!/Discord/.test(await dispatch(ctx, "finishSetup", []).catch((e) => e.message)));
    await dispatch(ctx, "skipDiscord", []);
    assert(be.publicState().setup.items.find((i) => i.id === "discord").skipped);
  });
  await test("Finish marks this PC as set up (not synced to other PCs)", async () => {
    be.setupStatus = () => ({ items: [], done: 6, total: 6, ready: true, onboarded: !!be.d.onboardedHere });
    await dispatch(ctx, "finishSetup", []);
    delete be.setupStatus;
    assert.equal(be.publicState().setup.onboarded, true);
    assert(!("onboardedHere" in be.exportForAccount().settings));
  });

  await client.close();
  await control.stop(); await be.shutdown();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

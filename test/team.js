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
  await dispatch(ctx, "saveSettings", [{ claudeParallel: 10, autoOpenBlender: false }]); // tests never start the real Blender
  const idle = async () => { for (let i = 0; i < 200 && be.claude.busy; i++) await wait(20); };
  const team = () => be.publicState().teams[0];
  const taskOf = (r) => be.claude.tasks.find((x) => x.id === team().roles[r].taskId);

  console.log("Roles");
  await test("eight Roblox roles with their own jobs and tools (Sound Designer, Animator and Debugger too)", () => {
    assert.deepEqual(R.ROLE_IDS, ["cofounder", "builder", "coder", "ui", "money", "sound", "animator", "debug"]);
    assert(/flickering/.test(R.ROLES.debug.prompt) && /z-fighting/.test(R.ROLES.debug.prompt) && /unanchored/i.test(R.ROLES.debug.prompt) && /get_console_output/.test(R.ROLES.debug.prompt), "the Debugger hunts flickering and flying parts and errors");
    assert.equal(be.roleId("QA"), "debug"); assert.equal(be.roleId("debugger"), "debug");
    assert(R.ROLES.builder.servers.includes("blender") && !R.ROLES.coder.servers.includes("blender"));
    assert(/gamepasses/i.test(R.ROLES.money.prompt) && /Blender/.test(R.ROLES.builder.prompt) && /control the team/.test(R.ROLES.cofounder.prompt));
    assert(/Creator Store/.test(R.ROLES.sound.prompt) && /SoundService/.test(R.ROLES.sound.prompt), "sounds from Roblox's Creator Store");
    assert(/R15/.test(R.ROLES.animator.prompt) && /Rig Builder/.test(R.ROLES.animator.prompt) && /generate_animation/.test(R.ROLES.animator.prompt), "official Roblox rigs + Studio's animation tool");
    for (const r of R.ROLE_IDS) assert(/You make Roblox games/.test(R.ROLES[r].prompt), r + " is made for Roblox game development");
  });
  await test("the team starts with only the Co-Founder; + adds the roles you pick (in the team's order)", async () => {
    assert.deepEqual(be.teamRoster(), [], "nothing added yet");
    assert(/nobody yet/.test(R.planPrompt("x", [])) && /"cofounder"/.test(R.planPrompt("x", [])), "alone → the Co-Founder plans its own jobs");
    assert.deepEqual(await dispatch(ctx, "setTeamRoles", [["animator", "sound designer", "music"]]), ["sound", "animator"], "names work, doubles are dropped, the team's order is kept");
    await assert.rejects(dispatch(ctx, "setTeamRoles", [["dragon"]]), /Unknown role/);
    assert.deepEqual(await dispatch(ctx, "setTeamRoles", [["cofounder"]]), [], "the Co-Founder is always there, so it isn't in the list");
    const p = R.planPrompt("x", ["builder", "sound"]);
    assert(/Sound Designer \("sound"\)/.test(p) && /"sound": \[/.test(p) && !/"coder": \[/.test(p), "the plan only has jobs for the roles in the team");
    await dispatch(ctx, "setTeamRoles", [["builder", "coder", "ui", "money"]]);
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
  await test("+ while the team builds: the new role starts and the Co-Founder is told to give it jobs", async () => {
    await idle();
    const before = runs.length;
    await dispatch(ctx, "setTeamRoles", [["builder", "coder", "money", "animator"]]);
    await idle();
    assert(team().roles.animator.enabled && taskOf("animator"), "Animator started");
    assert(runs.slice(before).some((x) => /Your jobs as Animator/.test(x.input)), "Animator got its brief");
    assert(runs.slice(before).some((x) => /I added Animator to the team/.test(x.input)), "the Co-Founder was told");
    assert.equal(team().roles.ui.enabled, false, "UI Maker was taken out of the team");
    await dispatch(ctx, "setTeamRoles", [["builder", "coder", "ui", "money"]]);
    await idle();
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

  console.log("Blender & Builds: reviews");
  const png = path.join(TMP, "dragon.png");
  fs.writeFileSync(png, Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c10000000049454e44ae426082", "hex"));
  await test("the Builder sends a picture and waits; nothing goes in the game until you approve", async () => {
    const r = await tool("vyron_submit_review", { kind: "model", title: "Baby dragon", details: "Low-poly, 3 colours", image_path: png, role: "Builder & Modeler" });
    assert.equal(r.decision, "pending");
    const waiting = tool("vyron_review_wait", { review_id: r.review_id, timeout_seconds: 30 });
    await wait(100);
    const pub = be.publicState().reviews.find((x) => x.id === r.review_id);
    assert(pub.status === "pending" && pub.hasImage && !("file" in pub));
    assert(/^data:image\/png;base64,/.test(await dispatch(ctx, "reviewImage", [r.review_id])));
    await dispatch(ctx, "reviewDecide", [r.review_id, true]);
    const ans = await waiting;
    assert.equal(ans.decision, "approved"); assert(/put it in the game/.test(ans.next));
  });
  await test("ask for changes → the agent gets your notes", async () => {
    const r = await tool("vyron_submit_review", { kind: "ui", title: "Shop UI", details: "6 slots" });
    await dispatch(ctx, "reviewDecide", [r.review_id, false, "make the buttons bigger"]);
    const ans = await tool("vyron_review_wait", { review_id: r.review_id });
    assert.equal(ans.decision, "changes"); assert.equal(ans.feedback, "make the buttons bigger");
    await assert.rejects(dispatch(ctx, "reviewDecide", [r.review_id, true]), /already answered/);
  });
  await test("only real pictures are accepted", async () => {
    await assert.rejects(tool("vyron_submit_review", { kind: "build", title: "x", image_path: path.join(TMP, "game") }), /\.png, \.jpg/);
    await assert.rejects(tool("vyron_submit_review", { kind: "build", title: "x", image_path: path.join(TMP, "nope.png") }), /not found/);
  });
  await test("auto mode uploads by itself; All auto also approves what's waiting", async () => {
    await dispatch(ctx, "setAuto", ["gamepass", true]);
    const g = await tool("vyron_submit_review", { kind: "gamepass", title: "2x Coins 149 R$" });
    assert(g.decision === "approved" && g.auto);
    const b = await tool("vyron_submit_review", { kind: "build", title: "Lava map" });
    assert.equal(b.decision, "pending");
    await dispatch(ctx, "setAuto", ["all", true]);
    assert.equal((await tool("vyron_review_wait", { review_id: b.review_id })).decision, "approved");
    assert.deepEqual(be.d.settings.autoApprove, { model: true, build: true, ui: true, gamepass: true });
    await dispatch(ctx, "setAuto", ["all", false]);
    assert(Object.values(be.d.settings.autoApprove).every((v) => v === false));
  });
  await test("roles are told to send a picture and wait before uploading", () => {
    for (const r of ["builder", "ui", "money"]) assert(/vyron_submit_review/.test(R.ROLES[r].prompt) && /Only put it into the game after it is approved/.test(R.ROLES[r].prompt), r);
  });

  console.log("Usage left");
  await test("Claude Code's usage event becomes 'usage left' (5-hour + weekly) and is remembered", async () => {
    const t = be.claude.tasks[0];
    be.claude.onLine(t, JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "five_hour", utilization: 0.42, resetsAt: 1795400000,
      unifiedWindows: { five_hour: { utilization: 0.42, resetsAt: 1795400000 }, seven_day: { utilization: 0.1, resetsAt: 1795900000 } } } }), () => {});
    const u = be.publicState().claude.usage;
    assert.equal(u.fiveHour.used, 42); assert.equal(u.week.used, 10);
    assert.equal(u.fiveHour.resetsAt, 1795400000 * 1000, "seconds become milliseconds");
    be.claude.setUsage({ status: "allowed_warning", rateLimitType: "seven_day", utilization: 85 });
    assert.equal(be.claude.usage.week.used, 85, "0–100 values work too");
    const { ClaudeRunner } = require("../src/claude");
    const again = new ClaudeRunner({ dataDir: TMP, exe: null, control: () => null, settings: () => ({}) });
    assert.equal(again.usage.week.used, 85, "kept after restart");
  });
  await test("usage meter style: circle, bar or off", async () => {
    await dispatch(ctx, "saveSettings", [{ usageStyle: "bar" }]); assert.equal(be.d.settings.usageStyle, "bar");
    await dispatch(ctx, "saveSettings", [{ usageStyle: "pie" }]); assert.equal(be.d.settings.usageStyle, "circle");
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
  await test("Blender version: 4.5 is too old for MCP, a portable 5.x in Downloads works", () => {
    const pc = path.join(TMP, "pcB");
    const mk = (p) => { fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, "blender.exe"), ""); };
    mk(path.join(pc, "PF", "Blender Foundation", "Blender 4.5"));
    const env = { ProgramFiles: path.join(pc, "PF"), USERPROFILE: path.join(pc, "home"), LOCALAPPDATA: path.join(pc, "la"), APPDATA: path.join(pc, "ad") };
    be._apps = null;
    let A = be.installedApps(env);
    assert.equal(A.blender, false); assert.equal(A.blenderOld, "4.5");
    be._apps = { ...A, at: Date.now() };
    const it = be.setupStatus().items.find((i) => i.id === "blender");
    assert(it.installed === false && it.tooOld === "4.5" && it.download === "https://www.blender.org/download/" && /5\.1 or newer/.test(it.how));
    mk(path.join(pc, "home", "Downloads", "blender-5.2.4-windows-x64", "blender-5.2.4-windows-x64"));
    be._apps = null;
    A = be.installedApps(env);
    assert.equal(A.blender, true);
    assert(A.blenders.some((b) => b.version === "5.2.4"));
    be._apps = null;
  });
  await test("Open Blender: starts Blender 5.1+ with the MCP add-on on and online mode, then waits for it", async () => {
    const pc = path.join(TMP, "pcC"), exeDir = path.join(pc, "home", "Downloads", "blender-5.2.4-x64", "blender-5.2.4-x64");
    fs.mkdirSync(exeDir, { recursive: true }); fs.writeFileSync(path.join(exeDir, "blender.exe"), "");
    const addonDir = path.join(pc, "ad", "Blender Foundation", "Blender", "5.2", "extensions", "user_default", "mcp");
    const env = { USERPROFILE: path.join(pc, "home"), APPDATA: path.join(pc, "ad"), LOCALAPPDATA: path.join(pc, "la") };
    const realFind = be.findBlenders.bind(be), realAddon = be.blenderAddon.bind(be), realCheck = be.checkBlender.bind(be);
    be.findBlenders = () => realFind(env); be.blenderAddon = (v) => realAddon(v, env);
    let started = null, open = false;
    be.spawnImpl = (exe, args) => { started = { exe, args }; setTimeout(() => (open = true), 50); return { unref() {} }; };
    be.checkBlender = async () => (be.blenderInfo = { found: true, open });
    const realList = be.listWindows.bind(be); be.listWindows = async () => (open ? [{ title: "Blender" }] : []);
    try {
      await assert.rejects(be.openBlender({ wait: 1 }), /MCP add-on isn't installed in Blender 5.2.4/);
      fs.mkdirSync(addonDir, { recursive: true }); fs.writeFileSync(path.join(addonDir, "__init__.py"), "");
      const r = await be.openBlender({ wait: 10 });
      assert(r.ok, r.message);
      assert.deepEqual(started.args, ["--online-mode", "--addons", "bl_ext.user_default.mcp"]);
      assert(/blender-5\.2\.4-x64[\\/]blender\.exe$/.test(started.exe));
      assert((await be.openBlender()).already, "doesn't open a second Blender");
    } finally { be.findBlenders = realFind; be.blenderAddon = realAddon; be.checkBlender = realCheck; be.listWindows = realList; delete be.spawnImpl; }
  });
  await test("Turn on MCP: runs Blender in the background with VYRON's script and reads the result", async () => {
    const pc = path.join(TMP, "pcD"), exeDir = path.join(pc, "PF", "Blender Foundation", "Blender 5.2");
    fs.mkdirSync(exeDir, { recursive: true }); fs.writeFileSync(path.join(exeDir, "blender.exe"), "");
    const env = { ProgramFiles: path.join(pc, "PF"), USERPROFILE: path.join(pc, "home"), APPDATA: path.join(pc, "ad"), LOCALAPPDATA: path.join(pc, "la") };
    const realFind = be.findBlenders.bind(be), realAddon = be.blenderAddon.bind(be);
    be.findBlenders = () => realFind(env); be.blenderAddon = (v) => realAddon(v, env);
    let ran = null;
    be.execFileImpl = (exe, args, opts, cb) => { ran = { exe, args }; cb(null, "Blender 5.2\nVYRON_RESULT " + JSON.stringify({ ok: true, module: args[4], online_access: true, autostart: true }) + "\n"); };
    try {
      const miss = await be.enableBlenderMcp();
      assert(miss.needsInstall && /Get Extensions/.test(miss.message), "add-on missing → install steps");
      const add = path.join(pc, "ad", "Blender Foundation", "Blender", "5.2", "extensions", "user_default", "mcp");
      fs.mkdirSync(add, { recursive: true }); fs.writeFileSync(path.join(add, "__init__.py"), "");
      const r = await be.enableBlenderMcp();
      assert(r.ok, r.message);
      assert.equal(ran.args[0], "-b"); assert(/blender-enable-mcp\.py$/.test(ran.args[2])); assert.equal(ran.args[4], "bl_ext.user_default.mcp");
      assert(fs.existsSync(ran.args[2]), "the script ships with VYRON");
      be.execFileImpl = (exe, args, opts, cb) => cb(null, "VYRON_RESULT " + JSON.stringify({ ok: false, error: "boom" }));
      assert(/boom/.test((await be.enableBlenderMcp()).message));
    } finally { be.findBlenders = realFind; be.blenderAddon = realAddon; delete be.execFileImpl; }
  });
  await test("the setup prompt's tools work through the connector", async () => {
    const st = await tool("vyron_setup_status", {});
    assert.equal(st.total, 5, "Claude Code / web and Discord are optional");
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
  await test("Finish needs everything except Claude Code / web and Discord", async () => {
    // (Roblox Studio is in the list only when Studio isn't open on the PC running the tests)
    await assert.rejects(dispatch(ctx, "finishSetup", []), /Connect these first: (?:.*Roblox Studio, )?Blender, Roblox account$/);
    const msg = await dispatch(ctx, "finishSetup", []).catch((e) => e.message);
    assert(!/Discord/.test(msg) && !/Claude Code \/ web/.test(msg), msg);
    await dispatch(ctx, "skipDiscord", []);
    assert(be.publicState().setup.items.find((i) => i.id === "discord").skipped);
  });
  await test("Skip: Claude Code / web and Discord can be skipped, nothing else", async () => {
    const code = () => be.publicState().setup.items.find((i) => i.id === "code");
    assert(code().optional && !code().skipped);
    await dispatch(ctx, "skipSetup", ["code"]);
    assert(code().skipped);
    await dispatch(ctx, "skipSetup", ["discord"]);
    await assert.rejects(dispatch(ctx, "skipSetup", ["blender"]), /can't be skipped/);
  });
  await test("Connect Blender: one click turns on MCP, opens Blender and says which step needs the user", async () => {
    const pc = path.join(TMP, "pcE"), exeDir = path.join(pc, "PF", "Blender Foundation", "Blender 5.2");
    const env = { ProgramFiles: path.join(pc, "PF"), USERPROFILE: path.join(pc, "home"), APPDATA: path.join(pc, "ad"), LOCALAPPDATA: path.join(pc, "la") };
    const realFind = be.findBlenders.bind(be), realAddon = be.blenderAddon.bind(be), realCheck = be.checkBlender.bind(be), realList = be.listWindows.bind(be);
    be.findBlenders = () => realFind(env); be.blenderAddon = (v) => realAddon(v, env);
    let open = false, running = false, enabled = 0, started = 0;
    be.checkBlender = async () => (be.blenderInfo = { found: true, open });
    be.listWindows = async () => (running ? [{ title: "Blender" }] : []);
    be.execFileImpl = (exe, args, opts, cb) => { enabled++; cb(null, "VYRON_RESULT " + JSON.stringify({ ok: true })); };
    be.spawnImpl = () => { started++; running = true; setTimeout(() => (open = true), 50); return { unref() {} }; };
    const saved = be.d.blenderMcpEnabled; delete be.d.blenderMcpEnabled;
    try {
      assert.equal((await dispatch(ctx, "connectBlender", [])).step, "install", "no Blender yet");
      fs.mkdirSync(exeDir, { recursive: true }); fs.writeFileSync(path.join(exeDir, "blender.exe"), "");
      assert.equal((await be.connectBlender({ wait: 1 })).step, "addon", "Blender but no MCP add-on");
      const addonDir = path.join(pc, "ad", "Blender Foundation", "Blender", "5.2", "extensions", "user_default", "mcp");
      fs.mkdirSync(addonDir, { recursive: true }); fs.writeFileSync(path.join(addonDir, "__init__.py"), "");
      be.blenderMcpServer = () => null;
      assert.equal((await be.connectBlender({ wait: 1 })).step, "extension", "no Blender extension in Claude desktop");
      be.blenderMcpServer = () => ({ command: "blender-mcp.exe" });
      running = true;
      assert.equal((await be.connectBlender({ wait: 1 })).step, "restart", "Blender open without MCP → close it first");
      running = false;
      const r = await be.connectBlender({ wait: 10 });
      assert(r.ok && r.step === "done", r.message);
      assert(enabled >= 1 && started === 1, "turned MCP on and opened Blender once");
      assert((await be.connectBlender()).ok, "already connected");
      assert.equal(started, 1, "doesn't open a second Blender");
    } finally {
      be.findBlenders = realFind; be.blenderAddon = realAddon; be.checkBlender = realCheck; be.listWindows = realList;
      delete be.execFileImpl; delete be.spawnImpl; delete be.blenderMcpServer; be.d.blenderMcpEnabled = saved;
    }
  });
  await test("Any Blender the MCP add-on supports: version range from the add-on's manifest, versions from any folder", () => {
    const pc = path.join(TMP, "pcF");
    const env = { ProgramFiles: path.join(pc, "PF"), "ProgramFiles(x86)": path.join(pc, "PF86"), USERPROFILE: path.join(pc, "home"), APPDATA: path.join(pc, "ad"), LOCALAPPDATA: path.join(pc, "la") };
    const mk = (p, inner) => { fs.mkdirSync(path.join(p, inner || ""), { recursive: true }); fs.writeFileSync(path.join(p, "blender.exe"), ""); };
    const manifest = (v, body) => { const d = path.join(pc, "ad", "Blender Foundation", "Blender", v, "extensions", "user_default", "mcp"); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "__init__.py"), ""); fs.writeFileSync(path.join(d, "blender_manifest.toml"), body); };
    mk(path.join(pc, "PF", "Blender Foundation", "Blender 4.5"));
    mk(path.join(pc, "PF86", "Steam", "steamapps", "common", "Blender"), "5.3"); // no version in the folder name
    const ver = (exe) => be.findBlenders(env).find((b) => b.exe.includes(exe)).version;
    assert.equal(ver("Steam"), "5.3", "version read from Blender's own 5.3 folder");
    be._mcpRange = null;
    assert.deepEqual(be.blenderMcpRange(env), { min: "5.1", max: null }, "no add-on yet → 5.1 or newer");
    assert(!be.blenderOk("4.5", env) && be.blenderOk("5.3", env) && be.blenderOk("6.0", env) && be.blenderOk("5.10", env));
    manifest("5.3", 'id = "mcp"\nblender_version_min = "4.2.0"\n');
    be._mcpRange = null;
    assert.equal(be.blenderMcpRange(env).min, "4.2");
    assert(be.blenderOk("4.5", env), "a newer add-on that supports 4.2+ makes Blender 4.5 work");
    assert.equal(be.blenderNeeds(env), "4.2 or newer");
    manifest("4.5", 'id = "mcp"\nblender_version_min = "4.2.0"\nblender_version_max = "6.0.0"\n');
    be._mcpRange = null;
    assert(!be.blenderOk("6.0", env) && be.blenderOk("5.9", env), "blender_version_max is respected");
    const ch = be.blenderChoices(env);
    assert.deepEqual(ch.map((b) => b.version), ["5.3", "4.5"], "newest first");
    assert(ch.every((b) => b.supported && b.addon));
    // a portable Blender keeps its add-ons in its own "portable" folder
    const port = path.join(pc, "home", "Downloads", "blender-5.4.0-windows-x64");
    mk(port); fs.mkdirSync(path.join(port, "portable", "extensions", "blender_org", "mcp"), { recursive: true }); fs.writeFileSync(path.join(port, "portable", "extensions", "blender_org", "mcp", "__init__.py"), "");
    assert.equal(be.blenderAddon("5.4.0", env, path.join(port, "blender.exe")), "bl_ext.blender_org.mcp");
    be._mcpRange = null; be._apps = null;
  });
  await test("Connect Blender: pick which Blender (remembered), and connect by itself at start when turned on", async () => {
    const pc = path.join(TMP, "pcG"), env = { ProgramFiles: path.join(pc, "PF"), USERPROFILE: path.join(pc, "home"), APPDATA: path.join(pc, "ad"), LOCALAPPDATA: path.join(pc, "la") };
    for (const v of ["4.5", "5.1", "5.2"]) { const d = path.join(pc, "PF", "Blender Foundation", "Blender " + v); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "blender.exe"), ""); }
    for (const v of ["5.1", "5.2"]) { const d = path.join(pc, "ad", "Blender Foundation", "Blender", v, "extensions", "user_default", "mcp"); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "__init__.py"), ""); }
    const exe = (v) => path.join(pc, "PF", "Blender Foundation", "Blender " + v, "blender.exe");
    const realFind = be.findBlenders.bind(be), realAddon = be.blenderAddon.bind(be), realCheck = be.checkBlender.bind(be), realList = be.listWindows.bind(be);
    be.findBlenders = () => realFind(env); be.blenderAddon = (v, e, x) => realAddon(v, env, x);
    let open = false, opened = [];
    be.checkBlender = async () => (be.blenderInfo = { found: true, open });
    be.listWindows = async () => [];
    be.blenderMcpServer = () => ({ command: "blender-mcp.exe" });
    be.execFileImpl = (x, args, opts, cb) => cb(null, "VYRON_RESULT " + JSON.stringify({ ok: true }));
    be.spawnImpl = (x) => { opened.push(x); setTimeout(() => (open = true), 30); return { unref() {} }; };
    const savedS = { ...be.d.settings };
    try {
      assert.equal(be.pickBlender().exe, exe("5.2"), "newest with the add-on by default");
      const old = await dispatch(ctx, "connectBlender", [{ exe: exe("4.5") }]);
      assert(!old.ok && old.step === "install" && /5\.1 or newer/.test(old.message), "4.5 can't run the add-on");
      const r = await dispatch(ctx, "connectBlender", [{ exe: exe("5.1"), wait: 5 }]);
      assert(r.ok, r.message);
      assert.equal(opened[0], exe("5.1"), "opened the Blender the user picked");
      assert.equal(be.d.settings.blenderExe, exe("5.1"), "remembered");
      assert.equal(be.pickBlender().exe, exe("5.1"));
      assert(be.installedApps(env).blenders.some((b) => b.version === "4.5" && !b.supported), "the picker shows 4.5 as not supported");
      // start: nothing happens unless "Connect Blender when VYRON starts" is on
      open = false; opened = [];
      be.d.settings.autoConnectBlender = false; await be.autoConnectBlender(); assert.equal(opened.length, 0);
      be.d.settings.autoConnectBlender = true; await be.autoConnectBlender(); assert.equal(opened.length, 1, "connects by itself at start");
      await be.autoConnectBlender(); assert.equal(opened.length, 1, "already connected → nothing");
      await dispatch(ctx, "saveSettings", [{ autoConnectBlender: false, blenderStartPrompt: false }]);
      assert(be.d.settings.blenderStartPrompt === false && be.d.settings.autoConnectBlender === false, "settings are saved");
    } finally {
      be.findBlenders = realFind; be.blenderAddon = realAddon; be.checkBlender = realCheck; be.listWindows = realList;
      delete be.execFileImpl; delete be.spawnImpl; delete be.blenderMcpServer; be.d.settings = Object.assign(be.d.settings, savedS); delete be.d.settings.blenderExe; be._apps = null;
      if (savedS.blenderExe) be.d.settings.blenderExe = savedS.blenderExe;
    }
  });
  await test("Do it for me: checks versions, downloads + installs the MCP add-on, connects — and glows while it works", async () => {
    const pc = path.join(TMP, "pcH"), env = { ProgramFiles: path.join(pc, "PF"), USERPROFILE: path.join(pc, "home"), APPDATA: path.join(pc, "ad"), LOCALAPPDATA: path.join(pc, "la") };
    const mkB = (v) => { const d = path.join(pc, "PF", "Blender Foundation", "Blender " + v); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "blender.exe"), ""); };
    mkB("4.5");
    const realFind = be.findBlenders.bind(be), realAddon = be.blenderAddon.bind(be), realCheck = be.checkBlender.bind(be), realList = be.listWindows.bind(be), realFetch = be.fetch;
    be.findBlenders = () => realFind(env); be.blenderAddon = (v, e, x) => realAddon(v, env, x);
    let open = false, server = null, installs = [], opened = [], fetched = [], glows = [];
    be.checkBlender = async () => (be.blenderInfo = { found: true, open });
    be.listWindows = async () => [];
    be.blenderMcpServer = () => server;
    // projects.blender.org: the newest release with the add-on (.zip) and the Claude extension (.mcpb)
    const ZIP = Buffer.from("PK-fake-addon"), MCPB = Buffer.from("PK-fake-mcpb");
    const base = "https://projects.blender.org/lab/blender_mcp/releases/download/v1.0.3/";
    be.fetch = async (url) => {
      fetched.push(url);
      if (/releases\/latest$/.test(url)) return { ok: true, json: async () => ({ tag_name: "v1.0.3", assets: [{ name: "mcp-1.0.3.zip", size: ZIP.length, browser_download_url: base + "mcp-1.0.3.zip" }, { name: "blender-1.0.3.mcpb", size: MCPB.length, browser_download_url: base + "blender-1.0.3.mcpb" }, { name: "evil.zip", size: 1, browser_download_url: "https://evil.example/mcp-9.zip" }] }) };
      if (url === base + "mcp-1.0.3.zip") return { ok: true, arrayBuffer: async () => ZIP };
      if (url === base + "blender-1.0.3.mcpb") return { ok: true, arrayBuffer: async () => MCPB };
      return { ok: false, status: 404 };
    };
    be.execFileImpl = (exe, args, opts, cb) => {
      if (args[0] === "--command") { // Blender's own installer: puts the add-on in the user extensions folder
        installs.push({ exe, args });
        const d = path.join(pc, "ad", "Blender Foundation", "Blender", "5.2", "extensions", "user_default", "mcp"); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "__init__.py"), "");
        return cb(null, "Installed \"mcp\"", "");
      }
      cb(null, "VYRON_RESULT " + JSON.stringify({ ok: true }));
    };
    be.spawnImpl = () => { setTimeout(() => (open = true), 30); return { unref() {} }; };
    const realOpenPath = be.host.openPath; be.host.openPath = async (p) => opened.push(p);
    const onGlow = (g) => glows.push(g.on); be.on("glow", onGlow);
    const savedPc = be.d.settings.pcControl, savedExe = be.d.settings.blenderExe; delete be.d.settings.blenderExe;
    try {
      // Only Blender 4.5 (can't run the MCP add-on) → VYRON gets a new Blender first, then carries on
      let gotBlender = 0;
      be.installBlender = async (progress) => { gotBlender++; progress("blender", "Downloading Blender 5.2.4… 50% of 390 MB", true); mkB("5.2"); be._apps = null; return { version: "5.2", exe: "x" }; };
      be.d.settings.pcControl = "off";
      const r = await dispatch(ctx, "blenderDoItForMe", []);
      assert.equal(gotBlender, 1, "downloaded Blender because 4.5 is too old");
      delete be.installBlender;
      const zip = path.join(TMP, "downloads", "mcp-1.0.3.zip"), mcpb = path.join(TMP, "downloads", "blender-1.0.3.mcpb");
      assert(fs.existsSync(zip) && fs.readFileSync(zip).equals(ZIP), "downloaded the add-on from projects.blender.org");
      assert(!fetched.some((u) => /evil/.test(u)), "only official projects.blender.org/lab files");
      assert.equal(installs.length, 1);
      assert.deepEqual(installs[0].args, ["--command", "extension", "install-file", "-r", "user_default", "-e", zip], "Blender installs + enables it");
      assert(/Blender 5\.2/.test(installs[0].exe));
      assert.deepEqual(opened, [mcpb], "opened the Claude Blender extension so Claude desktop installs it");
      assert(r.ok && r.started && r.step === "extension", JSON.stringify(r));
      assert.equal(be.d.settings.pcControl, "ask", "PC control: ask before each step");
      const t = be.claude.tasks.find((x) => x.id === r.taskId);
      const sent = t.messages.find((m) => m.role === "user").text;
      assert(/Install/.test(sent) && sent.includes(mcpb) && /vyron_connect_blender/.test(sent) && /Never type passwords/.test(sent), "Claude presses Install in Claude desktop");
      assert.equal(glows[0], true, "glows while VYRON works");
      assert(be.publicState().pc.glow && be.publicState().pc.doItTask === r.taskId, "still glowing while Claude does the last step");
      be.claude.emit("finished", { id: r.taskId, outcome: "done", title: t.title });
      assert.equal(be.glowOn(), false, "glow goes away when Claude is done");
      for (let i = 0; i < 50 && be.claude.busy; i++) await new Promise((res) => setTimeout(res, 20));
      // Everything there: VYRON finishes on its own, no Claude needed
      server = { command: "blender-mcp.exe" }; glows = [];
      const done = await dispatch(ctx, "blenderDoItForMe", []);
      assert(done.ok && !done.started && done.step === "done", JSON.stringify(done));
      assert.equal(installs.length, 1, "add-on already there → not installed again");
      assert.deepEqual(glows, [true, false], "glow on while working, off when done");
      assert((await dispatch(ctx, "blenderDoItForMe", [])).message.match(/already connected/));
      // Stop: Ctrl+Alt+X / Stop button clears the glow
      be.glow("doit", true); be.pcRevoke(); assert.equal(be.glowOn(), false, "Stop turns the glow off");
    } finally {
      be.off("glow", onGlow);
      be.findBlenders = realFind; be.blenderAddon = realAddon; be.checkBlender = realCheck; be.listWindows = realList; be.fetch = realFetch; be.host.openPath = realOpenPath;
      delete be.execFileImpl; delete be.spawnImpl; delete be.blenderMcpServer; be.d.settings.pcControl = savedPc;
      if (savedExe) be.d.settings.blenderExe = savedExe; be._apps = null;
    }
  });
  await test("Get Blender: newest Windows zip from download.blender.org, checksum-checked, unpacked to Programs (no installer)", async () => {
    const pc = path.join(TMP, "pcK"), la = path.join(pc, "la"), env = { LOCALAPPDATA: la };
    const ZIP = Buffer.from("PK-fake-blender-zip"), sha = require("crypto").createHash("sha256").update(ZIP).digest("hex");
    const B = "https://download.blender.org/release/";
    let shaFile = `${"0".repeat(64)}  blender-5.3.0-macos-arm64.dmg\n${sha}  blender-5.3.0-windows-x64.zip\n${"1".repeat(64)}  blender-5.3.0-windows-arm64.zip\n`;
    const pages = {
      [B]: '<a href="Blender4.5/">Blender4.5/</a><a href="Blender5.2/">Blender5.2/</a><a href="Blender5.3/">Blender5.3/</a><a href="Blender5.10/">Blender5.10/</a>',
      [B + "Blender5.10/"]: '<a href="blender-5.10.0-linux-x64.tar.xz">only linux</a>',
      [B + "Blender5.3/"]: '<a href="blender-5.3.0-windows-x64.msi">msi</a><a href="blender-5.3.0-windows-x64.zip">zip</a><a href="blender-5.3.0.sha256">sha</a>',
    };
    const realFetch = be.fetch, saved = be.d.settings.blenderExe;
    let untar = null, steps = [];
    be.fetch = async (url) => {
      if (pages[url]) return { ok: true, text: async () => pages[url] };
      if (url === B + "Blender5.3/blender-5.3.0.sha256") return { ok: true, text: async () => shaFile };
      if (url === B + "Blender5.3/blender-5.3.0-windows-x64.zip") return { ok: true, headers: { get: () => String(ZIP.length) }, body: (async function* () { yield ZIP.subarray(0, 5); yield ZIP.subarray(5); })() };
      return { ok: false, status: 404 };
    };
    be.execFileImpl = (exe, args, opts, cb) => { untar = { exe, args }; const d = path.join(args[3], "blender-5.3.0-windows-x64"); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "blender.exe"), ""); cb(null, ""); };
    try {
      const rel = await be.blenderLatestDownload();
      assert.equal(rel.version, "5.3.0", "newest folder with a Windows zip (5.10 has none)"); assert.equal(rel.sha256, sha);
      const r = await be.installBlender((s, t) => steps.push(t), env);
      const exe = path.join(la, "Programs", "blender-5.3.0-windows-x64", "blender.exe");
      assert.equal(r.exe, exe); assert.equal(be.d.settings.blenderExe, exe, "VYRON uses the new Blender");
      assert.equal(untar.exe, "tar.exe"); assert.deepEqual(untar.args.slice(0, 2), ["-xf", path.join(TMP, "downloads", "blender-5.3.0-windows-x64.zip")]);
      assert(!fs.existsSync(path.join(TMP, "downloads", "blender-5.3.0-windows-x64.zip")), "the 400 MB zip is removed after unpacking");
      assert(steps.some((t) => /100%/.test(t)) && steps.some((t) => /Unpacking/.test(t)), steps.join(" | "));
      // already there → no second download
      untar = null; await be.installBlender(() => {}, env); assert.equal(untar, null);
      // a download that doesn't match blender.org's checksum is thrown away
      shaFile = `${"f".repeat(64)}  blender-5.3.0-windows-x64.zip\n`;
      await assert.rejects(be.installBlender(() => {}, { LOCALAPPDATA: path.join(pc, "other") }), /checksum/);
      assert(!fs.existsSync(path.join(TMP, "downloads", "blender-5.3.0-windows-x64.zip")));
    } finally { be.fetch = realFetch; delete be.execFileImpl; if (saved) be.d.settings.blenderExe = saved; else delete be.d.settings.blenderExe; be._apps = null; }
  });
  await test("Blender MCP from the Store Claude app: runs its real Python when the normal AppData path isn't visible", () => {
    const { blenderServer } = require("../src/claude");
    const pc = path.join(TMP, "pcJ"), ad = path.join(pc, "ad"), la = path.join(pc, "la"), env = { APPDATA: ad, LOCALAPPDATA: la };
    const venv = path.join(la, "Claude-Data", "claude_abc", "Claude Extensions", "ant.dir.gh.blender.blender-mcp", ".venv");
    const exe = path.join(venv, "Scripts", "blender-mcp.exe");
    fs.mkdirSync(path.dirname(exe), { recursive: true }); fs.writeFileSync(exe, "");
    const home = path.join(ad, "uv", "python", "cpython-3.14.0-windows-x86_64-none");
    fs.writeFileSync(path.join(venv, "pyvenv.cfg"), `home = ${home}\nimplementation = CPython\nversion_info = 3.14.0\n`);
    const dist = path.join(venv, "Lib", "site-packages", "blender_mcp-1.0.0.dist-info"); fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, "entry_points.txt"), "[console_scripts]\nblender-mcp = blmcp:main\n");
    // Python only inside Claude's package folder (what VYRON sees on a PC with the Store app)
    const real = path.join(la, "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "uv", "python", "cpython-3.14.0-windows-x86_64-none");
    fs.mkdirSync(real, { recursive: true }); fs.writeFileSync(path.join(real, "python.exe"), "");
    let s = blenderServer(env);
    assert.equal(s.command, path.join(real, "python.exe"), "runs the real Python");
    assert.equal(s.args[0], "-I"); assert.equal(s.args[1], "-c");
    assert(s.args[2].includes("from blmcp import main as _main") && s.args[2].includes(JSON.stringify(path.join(venv, "Lib", "site-packages"))), s.args[2]);
    assert.equal(s.env.VIRTUAL_ENV, venv);
    // Normal install (Python where pyvenv.cfg says) → the venv's own exe, as before
    fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(path.join(home, "python.exe"), "");
    s = blenderServer(env);
    assert.equal(s.command, exe); assert.deepEqual(s.args, []);
  });
  await test("a broken Blender MCP program is reported as that (not 'Blender isn't open'), and Connect says to fix the extension", async () => {
    const fake = path.join(TMP, "fake-blender-mcp.exe"); fs.writeFileSync(fake, "");
    const old = process.env.VYRON_BLENDER_MCP; process.env.VYRON_BLENDER_MCP = fake;
    const realMcp = be.mcp, realCheck = be.checkBlender;
    be.mcp = { info: () => ({ status: "error", error: "MCP error -32000: Connection closed — did not find executable at 'C:\\Users\\x\\AppData\\Roaming\\uv\\python\\cpython-3.14.0\\python.exe': The system cannot find the path specified.", tools: [] }), connect: async () => {}, call: async () => ({}) };
    try {
      const b = await be.checkBlender();
      assert(!b.open && b.broken && /can't start/.test(b.error) && /Extensions/.test(b.error), b.error);
      const r = await be.connectBlender({ wait: 1 });
      assert.equal(r.step, "extension", "fix the extension, don't restart Blender");
    } finally { be.mcp = realMcp; be.checkBlender = realCheck; if (old === undefined) delete process.env.VYRON_BLENDER_MCP; else process.env.VYRON_BLENDER_MCP = old; be.blenderInfo = null; }
  });
  await test("PC control makes the screen glow for 15 s after Claude's last action", async () => {
    const saved = be.d.settings.pcControl, savedPc = be.pc;
    let glows = []; const onGlow = (g) => glows.push(g.on); be.on("glow", onGlow);
    be.pc = { key: async () => "ok" };
    try {
      be.d.settings.pcControl = "on";
      await be.pcAction("key", { keys: "enter" });
      assert.deepEqual(glows, [true]); assert(be.publicState().pc.glow);
      be.pcLast = Date.now() - 16000; be.glowChanged(true);
      assert.deepEqual(glows, [true, false], "fades after 15 s without actions");
    } finally { be.off("glow", onGlow); be.d.settings.pcControl = saved; be.pc = savedPc; be.pcLast = 0; }
  });
  await test("Open apps: brings an open app to the front, or starts Studio / Claude desktop / Blender", async () => {
    const pc = path.join(TMP, "pcI"), la = path.join(pc, "la"), env = { LOCALAPPDATA: la };
    const studio = path.join(la, "Roblox", "Versions", "version-abc", "RobloxStudioBeta.exe");
    fs.mkdirSync(path.dirname(studio), { recursive: true }); fs.writeFileSync(studio, "");
    fs.mkdirSync(path.join(la, "Packages", "Claude_pzs8sxrjxfjjc"), { recursive: true });
    const realList = be.listWindows.bind(be), realPick = be.pickBlender.bind(be);
    let running = {}, focused = [], started = [];
    be.listWindows = async (img) => running[img] || [];
    be.focusImpl = async (pid) => focused.push(pid);
    be.spawnImpl = (cmd, args) => { started.push([cmd, ...(args || [])]); return { unref() {} }; };
    try {
      assert((await be.openApp("studio", env)).ok); assert.equal(started.at(-1)[0], studio, "starts Roblox Studio");
      assert((await be.openApp("claude", env)).ok); assert.deepEqual(started.at(-1), ["explorer.exe", "shell:AppsFolder\\Claude_pzs8sxrjxfjjc!Claude"], "starts the Claude desktop app");
      running = { "RobloxStudioBeta.exe": [{ pid: 42, title: "Place1 - Roblox Studio" }], "claude.exe": [{ pid: 7, title: "" }, { pid: 8, title: "Claude" }] };
      const n = started.length;
      await be.openApp("studio", env); await be.openApp("claude", env);
      assert.deepEqual(focused, [42, 8], "already open → to the front (the Claude window, not Claude Code)");
      assert.equal(started.length, n, "doesn't start a second copy");
      be.pickBlender = () => null;
      const nb = await dispatch(ctx, "openApp", ["blender"]);
      assert(!nb.ok && /MCP add-on/.test(nb.message), "no supported Blender → says so");
      const none = await be.openApp("studio", { LOCALAPPDATA: path.join(pc, "nothing") });
      assert(none.ok || /isn't installed/.test(none.message));
      await assert.rejects(be.openApp("notepad", env), /Unknown app/);
    } finally { be.listWindows = realList; be.pickBlender = realPick; delete be.focusImpl; delete be.spawnImpl; }
  });
  await test("Keyboard shortcuts: defaults, change, clear, reset, off — and bad or doubled keys are refused", async () => {
    const saved = { on: be.d.settings.hotkeysOn, keys: be.d.settings.hotkeys };
    let events = 0; const on = () => events++; be.on("hotkeys", on);
    try {
      delete be.d.settings.hotkeys; be.d.settings.hotkeysOn = true;
      assert.deepEqual(be.hotkeys(), { vyron: "Ctrl+Alt+V", studio: "Ctrl+Alt+R", claude: "Ctrl+Alt+C", blender: "Ctrl+Alt+B" });
      await dispatch(ctx, "saveSettings", [{ hotkeys: { blender: "Ctrl+Shift+F9" } }]);
      assert.equal(be.hotkeys().blender, "Ctrl+Shift+F9"); assert.equal(events, 1, "main process is told to re-register");
      await assert.rejects(dispatch(ctx, "saveSettings", [{ hotkeys: { studio: "Shift+R" } }]), /can't be a shortcut/);
      await assert.rejects(dispatch(ctx, "saveSettings", [{ hotkeys: { studio: "B" } }]), /can't be a shortcut/);
      await assert.rejects(dispatch(ctx, "saveSettings", [{ hotkeys: { studio: "Ctrl+Alt+C" } }]), /already the shortcut for Claude desktop/);
      await dispatch(ctx, "saveSettings", [{ hotkeys: { claude: "" } }]);
      assert.equal(be.hotkeys().claude, "", "cleared");
      assert.equal(be.publicState().hotkeys.keys.claude, "");
      await dispatch(ctx, "saveSettings", [{ hotkeysOn: false }]);
      assert.deepEqual(be.hotkeys(), {}, "off → nothing registered");
      await dispatch(ctx, "saveSettings", [{ hotkeysOn: true, hotkeysReset: true }]);
      assert.equal(be.hotkeys().blender, "Ctrl+Alt+B", "reset to defaults");
      await dispatch(ctx, "saveSettings", [{ volume: 0.5 }]);
      const ev = events; await dispatch(ctx, "saveSettings", [{ volume: 0.4 }]); assert.equal(events, ev, "other settings don't re-register shortcuts");
    } finally { be.off("hotkeys", on); be.d.settings.hotkeysOn = saved.on; if (saved.keys) be.d.settings.hotkeys = saved.keys; else delete be.d.settings.hotkeys; }
  });
  await test("Finish marks this PC as set up (not synced to other PCs)", async () => {
    be.setupStatus = () => ({ items: [], done: 6, total: 6, ready: true, onboarded: (be.d.setupDoneFor || []).includes(be.setupKey()) });
    await dispatch(ctx, "finishSetup", []);
    delete be.setupStatus;
    assert.equal(be.publicState().setup.onboarded, true);
    assert(!("setupDoneFor" in be.exportForAccount()) && !JSON.stringify(be.exportForAccount()).includes("setupDoneFor"), "not synced to other devices");
    be.account = { user: { id: "someone-else" } };
    assert.equal(be.publicState().setup.onboarded, false, "another account on this PC must set up too");
    delete be.account;
    assert.equal(be.publicState().setup.onboarded, true);
  });

  await client.close();
  await control.stop(); await be.shutdown();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

// Tests for roles, permissions, role-based routing and the new AI tools.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { Backend } = require("../src/backend");
const { ROLES, PERMS, systemPrompt, effectivePerms } = require("../src/team");
const { mockModel } = require("./mock-model");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { failed++; console.log("  ✗", name, "\n     ", e.message); }
}
const names = (tools) => tools.map((t) => t.name);

(async () => {
  const model = await mockModel();
  const TMP = path.join(__dirname, "..", ".testdata-team");
  fs.rmSync(TMP, { recursive: true, force: true });
  const GAME = path.join(TMP, "game");
  fs.mkdirSync(path.join(GAME, "src"), { recursive: true });
  const rendered = [];
  const be = new Backend({
    dataDir: TMP, encrypt: (s) => "x:" + Buffer.from(s).toString("hex"), decrypt: (s) => Buffer.from(s.slice(2), "hex").toString(),
    host: { renderSvg: async (svg, w, h) => { rendered.push([w, h]); return Buffer.from("89504e470d0a1a0a", "hex"); } },
  });
  await be.init();
  const prov = await be.addProvider({ type: "openai", name: "Mock", baseURL: `http://127.0.0.1:${model.address().port}/v1`, apiKey: "k", accountEmail: "studio@gmail.com" });
  for (const a of [...be.d.agents]) be.removeAgent(a.id);
  const add = (name, role, extra = {}) => { const id = be.addAgent({ name, role, providerId: prov, model: "mock-model", ...extra }); return be.d.agents.find((a) => a.id === id); };
  const proj = await be.addProject({ name: "Test", rojoDir: GAME });
  be.setActiveProject(proj);

  console.log("Roles");
  await test("there are many roles, each with a group, permissions and instructions", async () => {
    const r = Object.keys(ROLES);
    for (const want of ["Co-Founder", "Idea Finder", "Image Creator", "Researcher", "Model Maker", "Producer", "QA Tester", "Data Analyst", "Monetization Strategist"]) assert(r.includes(want), "missing " + want);
    assert(r.length >= 19);
    for (const [k, v] of Object.entries(ROLES)) { assert(v.group && v.prompt && v.short, k); assert.deepEqual(Object.keys(v.perms).sort(), Object.keys(PERMS).sort(), k); }
  });
  await test("the system prompt tells the AI its role, the role rules, its permissions and the team", async () => {
    const a = { name: "Pix", role: "Image Creator" };
    const s = systemPrompt({ agent: a, project: null, perms: effectivePerms(a), team: [{ name: "Pix", role: "Image Creator" }, { name: "Boss", role: "Co-Founder" }] });
    assert(/the Image Creator/.test(s) && /Stay in your role/.test(s) && /create_image/.test(s));
    assert(/Your permissions: .*Create images/.test(s) && /Not allowed: .*Write files/.test(s));
    assert(/Boss — Co-Founder/.test(s));
  });

  console.log("Permissions decide the tools");
  const boss = add("Boss", "Co-Founder");
  const ideas = add("Idea", "Idea Finder");
  const pix = add("Pix", "Image Creator");
  const dev = add("Dev", "Luau Developer");
  const analyst = add("Ana", "Data Analyst");
  const fakeTask = (agent) => be.newTask({ title: "t", description: "d", agentId: agent.id, projectId: proj });
  await test("an Idea Finder can read but not write or delete files", async () => {
    const t = names(be.toolsFor(fakeTask(ideas), ideas));
    assert(t.includes("read_file") && !t.includes("write_file") && !t.includes("delete_file"));
  });
  await test("an Image Creator gets create_image; a developer doesn't", async () => {
    assert(names(be.toolsFor(fakeTask(pix), pix)).includes("create_image"));
    assert(!names(be.toolsFor(fakeTask(dev), dev)).includes("create_image"));
  });
  await test("only roles that may give tasks get assign_task", async () => {
    assert(names(be.toolsFor(fakeTask(boss), boss)).includes("assign_task"));
    assert(!names(be.toolsFor(fakeTask(dev), dev)).includes("assign_task"));
  });
  await test("a Data Analyst can read revenue stats", async () => {
    const tool = be.toolsFor(fakeTask(analyst), analyst).find((x) => x.name === "get_game_stats");
    assert(tool);
    assert(/No revenue or analytics yet|Robux/.test(await tool.run({})));
  });
  await test("web research is only given on Claude models (this one is not Claude)", async () => {
    assert(!names(be.toolsFor(fakeTask(ideas), ideas)).includes("web_search"));
    be.d.providers.find((p) => p.id === prov).type = "anthropic";
    assert(names(be.toolsFor(fakeTask(ideas), ideas)).includes("web_search"));
    be.d.providers.find((p) => p.id === prov).type = "openai";
  });
  await test("switching a permission off removes the tool; reset brings the role default back", async () => {
    be.updateAgent(dev.id, { perms: { write: false } });
    assert(!names(be.toolsFor(fakeTask(dev), dev)).includes("write_file"));
    assert.equal(be.agentPublic(dev).permOverrides.write, false);
    be.updateAgent(dev.id, { resetPerms: true });
    assert(names(be.toolsFor(fakeTask(dev), dev)).includes("write_file"));
  });
  await test("Studio tools need the Roblox Studio permission", async () => {
    const id = await be.addServer({ name: "Studio-like", transport: "stdio", command: process.execPath, args: [path.join(__dirname, "fixtures", "echo-mcp-server.js")] });
    be.d.mcpServers.find((s) => s.id === id).kind = "roblox-studio";
    assert(names(be.toolsFor(fakeTask(dev), dev)).some((n) => n.endsWith("__echo")), "dev should have studio tools");
    assert(!names(be.toolsFor(fakeTask(ideas), ideas)).some((n) => n.endsWith("__echo")), "idea finder must not");
    await be.removeServer(id);
  });

  console.log("Role-based routing");
  await test("a task for a role goes only to an AI with that role", async () => {
    assert.equal(be.chooseAgent({ role: "Image Creator" }).id, pix.id);
  });
  await test("if that AI is busy, the task waits instead of going to someone else", async () => {
    be.running.set("busy", { agentId: pix.id, ctrl: new AbortController() });
    assert.equal(be.chooseAgent({ role: "Image Creator" }), null);
    assert(/Waiting for a free Image Creator/.test(be.waitReason({ role: "Image Creator" })));
    be.running.delete("busy");
  });
  await test("a role nobody has goes to the Co-Founder", async () => {
    assert.equal(be.chooseAgent({ role: "Model Maker" }).id, boss.id);
  });
  await test("builds are planned by the Co-Founder when there is one", async () => {
    be.running.set("b1", { agentId: boss.id, ctrl: new AbortController() }); // keep it from starting
    const id = be.build("Make a pets update");
    assert.equal(be.d.tasks.find((t) => t.id === id).role, "Co-Founder");
    be.cancelTask(id); be.running.delete("b1");
  });
  await test("assign_task hands work to the right role", async () => {
    const t = fakeTask(boss);
    const tool = be.toolsFor(t, boss).find((x) => x.name === "assign_task");
    be.running.set("b2", { agentId: pix.id, ctrl: new AbortController() }); // hold Pix so the task stays pending
    const msg = await tool.run({ title: "VIP gamepass icon", description: "512x512 icon", role: "Image Creator", priority: "high" });
    assert(/Image Creator/.test(msg) && /Pix/.test(msg));
    const created = be.d.tasks.find((x) => x.title === "VIP gamepass icon");
    assert.equal(created.role, "Image Creator");
    assert.equal(created.assignedBy, "Boss");
    be.cancelTask(created.id); be.running.delete("b2");
  });

  console.log("Images");
  await test("create_image renders the SVG to a PNG of the right size and lists it", async () => {
    const t = fakeTask(pix);
    const tool = be.toolsFor(t, pix).find((x) => x.name === "create_image");
    const out = await tool.run({ name: "VIP pass", kind: "gamepass_icon", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="200" fill="gold"/></svg>' });
    assert(/512×512/.test(out));
    assert.deepEqual(rendered.at(-1), [512, 512]);
    const imgs = be.listImages(proj);
    assert.equal(imgs.length, 1);
    assert(imgs[0].dataUrl.startsWith("data:image/png;base64,"));
    assert(fs.existsSync(path.join(GAME, "assets", "images")));
    await tool.run({ name: "Thumb", kind: "thumbnail", svg: '<svg viewBox="0 0 1920 1080"></svg>' });
    assert.deepEqual(rendered.at(-1), [1920, 1080]);
  });
  await test("SVG with scripts or outside links is refused", async () => {
    const tool = be.toolsFor(fakeTask(pix), pix).find((x) => x.name === "create_image");
    await assert.rejects(tool.run({ name: "x", kind: "badge", svg: "<svg><script>alert(1)</script></svg>" }), /No scripts/);
    await assert.rejects(tool.run({ name: "x", kind: "badge", svg: '<svg><image href="https://evil.example/a.png"/></svg>' }), /No scripts/);
  });
  await test("deleting an image removes the file", async () => {
    const i = be.listImages(proj)[0];
    be.deleteImage(i.id);
    assert(!fs.existsSync(i.file));
  });

  console.log("Account emails");
  await test("an AI shows its provider's email, or its own", async () => {
    assert.equal(be.agentPublic(dev).accountEmail, "studio@gmail.com");
    be.updateAgent(dev.id, { accountEmail: "dev@gmail.com" });
    assert.equal(be.agentPublic(dev).accountEmail, "dev@gmail.com");
    assert.equal(be.agentPublic(dev).ownEmail, true);
  });
  await test("a wrong email is refused", async () => {
    assert.throws(() => be.updateAgent(dev.id, { accountEmail: "not an email" }), /doesn't look right/);
  });

  await be.shutdown();
  model.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

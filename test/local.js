// Tests for free local AIs: a fake Ollama (port 11434) and fake Forge (7860)
// answer like the real apps, so scanning, downloads, agents and images run for real.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { Backend } = require("../src/backend");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { failed++; console.log("  ✗", name, "\n     ", e.message); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const models = [{ name: "qwen2.5-coder:7b", size: 4.7e9, details: { parameter_size: "7.6B" } }];
function fakeOllama() {
  return http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const j = body ? JSON.parse(body) : {};
      const send = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.url === "/api/tags") return send(200, { models });
      if (req.url === "/v1/models") return send(200, { data: models.map((m) => ({ id: m.name })) });
      if (req.url === "/api/pull") {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        for (const pct of [0, 50, 100]) { res.write(JSON.stringify({ status: "pulling", total: 100, completed: pct }) + "\n"); await wait(30); }
        res.end(JSON.stringify({ status: "success" }) + "\n");
        models.push({ name: j.model, size: 5e9, details: { parameter_size: "12B" } });
        return;
      }
      if (req.url === "/api/delete") { const i = models.findIndex((m) => m.name === j.model); if (i >= 0) models.splice(i, 1); return send(200, {}); }
      if (req.url === "/v1/chat/completions") {
        if (j.model.startsWith("gemma3") && j.tools) return send(400, { error: { message: `registry.ollama.ai/library/${j.model} does not support tools` } });
        return send(200, { choices: [{ finish_reason: "stop", message: { content: `Hi from ${j.model}${j.tools ? " (with tools)" : ""}` } }], usage: { prompt_tokens: 5, completion_tokens: 5 } });
      }
      send(404, {});
    });
  });
}
function fakeForge() {
  return http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/sdapi/v1/sd-models") return res.end(JSON.stringify([{ model_name: "sdxl_base" }]));
      if (req.url === "/sdapi/v1/txt2img") { const j = JSON.parse(body); return res.end(JSON.stringify({ images: [Buffer.from("PNG:" + j.width + "x" + j.height).toString("base64")] })); }
      res.writeHead(404).end("{}");
    });
  });
}

(async () => {
  const o = fakeOllama(), f = fakeForge();
  try {
    await new Promise((r, x) => o.listen(11434, "127.0.0.1", r).on("error", x));
    await new Promise((r, x) => f.listen(7860, "127.0.0.1", r).on("error", x));
  } catch (e) { console.log("  (skipped: ports 11434/7860 are in use by real apps)"); process.exit(0); }
  const TMP = path.join(__dirname, "..", ".testdata-local");
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(path.join(TMP, "game", "src"), { recursive: true });
  const be = new Backend({ dataDir: TMP, encrypt: (s) => s, decrypt: (s) => s });
  await be.init();
  be.setActiveProject(await be.addProject({ name: "T", rojoDir: path.join(TMP, "game") }));

  await test("scan finds Ollama with its models and Forge for images", async () => {
    const L = await be.scanLocal();
    const ol = L.servers.find((s) => s.id === "ollama");
    assert(ol.running && ol.models[0].id === "qwen2.5-coder:7b");
    assert(L.image.running && L.image.models[0] === "sdxl_base");
    assert(L.servers.filter((s) => s.id !== "ollama").every((s) => !s.running));
  });
  await test("download a recommended model with progress", async () => {
    be.pullModel("gemma3:12b");
    await wait(20);
    assert(be.pulls["gemma3:12b"]);
    for (let i = 0; i < 40 && !be.pulls["gemma3:12b"].done; i++) await wait(50);
    assert.equal(be.pulls["gemma3:12b"].pct, 100);
    assert(be.local.servers.find((s) => s.id === "ollama").models.some((m) => m.id === "gemma3:12b"));
  });
  await test("model names are checked", async () => {
    assert.throws(() => be.pullModel("bad name; rm -rf"), /valid model name/);
  });
  let coder;
  await test("add a free local AI with a role (no key, no default team)", async () => {
    const id = await be.addLocalAgent({ serverId: "ollama", model: "qwen2.5-coder:7b", role: "Luau Developer", name: "Coder" });
    coder = be.d.agents.find((a) => a.id === id);
    const p = be.d.providers.find((x) => x.id === coder.providerId);
    assert(p.local && !p.apiKey && p.baseURL === "http://127.0.0.1:11434/v1");
    assert.equal(be.d.agents.length, 1);
    assert.equal(be.agentStatus(coder), "idle");
  });
  await test("a second local AI reuses the same connection", async () => {
    await be.addLocalAgent({ serverId: "ollama", model: "gemma3:12b", role: "Idea Finder", name: "Ideas" });
    assert.equal(be.d.providers.filter((p) => p.local).length, 1);
  });
  await test("local AIs answer, and chat-only models still work", async () => {
    const ideas = be.d.agents.find((a) => a.name === "Ideas");
    be.sendChat({ agentIds: [coder.id, ideas.id], text: "hi" });
    for (let i = 0; i < 60; i++) { await wait(100); if ((be.d.conversations[ideas.id] || []).some((m) => m.role === "assistant") && (be.d.conversations[coder.id] || []).some((m) => m.role === "assistant")) break; }
    assert.equal(be.d.conversations[coder.id].at(-1).text, "Hi from qwen2.5-coder:7b (with tools)");
    assert.equal(be.d.conversations[ideas.id].at(-1).text, "Hi from gemma3:12b");
  });
  await test("Forge makes images for the Image Creator (local only)", async () => {
    assert.throws(() => be.setImageBackend("http://evil.example:7860"), /Only local/);
    be.setImageBackend("http://127.0.0.1:7860");
    const pixId = be.addAgent({ name: "Pix", role: "Image Creator", providerId: coder.providerId, model: "qwen2.5-coder:7b" });
    const pix = be.d.agents.find((a) => a.id === pixId);
    const t = be.newTask({ title: "t", description: "d", agentId: pix.id });
    const tool = be.toolsFor(t, pix).find((x) => x.name === "generate_image");
    assert(tool, "generate_image missing");
    const out = await tool.run({ name: "Thumb", kind: "thumbnail", prompt: "a castle" });
    assert(/1344×768/.test(out) && /Forge/.test(out));
    assert.equal(Buffer.from(be.listImages()[0].dataUrl.split(",")[1], "base64").toString(), "PNG:1344x768");
  });
  await test("delete a model", async () => {
    await be.deleteModel("gemma3:12b");
    assert(!be.local.servers.find((s) => s.id === "ollama").models.some((m) => m.id === "gemma3:12b"));
  });

  await be.shutdown();
  o.close(); f.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

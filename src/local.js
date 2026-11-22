// Free local AIs that run on this PC (nothing is sent to the internet):
// finds known local AI servers, lists and downloads models through Ollama,
// and talks to Forge / AUTOMATIC1111 for local image generation.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const HOST = () => process.env.AF_LOCAL_HOST || "127.0.0.1";

// Well-known local AI apps and their default ports. All speak the OpenAI-style API.
const SERVERS = [
  { id: "ollama", name: "Ollama", port: 11434, site: "https://ollama.com/download" },
  { id: "lmstudio", name: "LM Studio", port: 1234, site: "https://lmstudio.ai" },
  { id: "jan", name: "Jan", port: 1337, site: "https://jan.ai" },
  { id: "gpt4all", name: "GPT4All", port: 4891, site: "https://gpt4all.io" },
  { id: "kobold", name: "KoboldCpp", port: 5001, site: "https://github.com/LostRuins/koboldcpp" },
  { id: "textgen", name: "Text Generation WebUI", port: 5000, site: "https://github.com/oobabooga/text-generation-webui" },
  { id: "llamacpp", name: "llama.cpp / LocalAI", port: 8080, site: "https://github.com/ggml-org/llama.cpp" },
];
const IMAGE_SERVER = { id: "forge", name: "Forge / AUTOMATIC1111", port: 7860, site: "https://github.com/lllyasviel/stable-diffusion-webui-forge" };

// Open models from well-known makers, from Ollama's official library.
// tools: whether the model can use VYRON's tools (read/write files etc.).
const RECOMMENDED = [
  { model: "qwen2.5-coder:7b", maker: "Alibaba (Qwen)", size: "4.7 GB", tools: true, goodFor: "Luau scripting, fixing bugs, reviewing code", roles: ["Luau Developer", "Debugger", "Code Reviewer"] },
  { model: "qwen3:8b", maker: "Alibaba (Qwen)", size: "5.2 GB", tools: true, goodFor: "Planning, giving tasks, all-round work", roles: ["Co-Founder", "Lead Developer", "Producer"] },
  { model: "llama3.1:8b", maker: "Meta", size: "4.9 GB", tools: true, goodFor: "Research, game design, writing", roles: ["Researcher", "Game Designer", "Level Designer"] },
  { model: "gemma3:12b", maker: "Google", size: "8.1 GB", tools: false, goodFor: "Ideas, descriptions, marketing text", roles: ["Idea Finder", "Marketing Manager"] },
  { model: "deepseek-r1:8b", maker: "DeepSeek", size: "5.2 GB", tools: false, goodFor: "Step-by-step thinking, prices and numbers", roles: ["Monetization Strategist", "Data Analyst"] },
  { model: "mistral:7b", maker: "Mistral AI", size: "4.1 GB", tools: true, goodFor: "Fast helper for testing and small jobs", roles: ["QA Tester", "Sound Designer", "Animator"] },
  { model: "llama3.2:3b", maker: "Meta", size: "2.0 GB", tools: true, goodFor: "Very fast, for slower PCs", roles: ["Producer", "QA Tester"] },
];

async function getJson(url, ms = 1200, init) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    if (!r.ok) return { status: r.status, json: null };
    return { status: r.status, json: await r.json().catch(() => null) };
  } catch { return { status: 0, json: null }; } finally { clearTimeout(t); }
}

function ollamaExe() {
  const p = path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe");
  return fs.existsSync(p) ? p : null;
}

/** Look for running local AI apps. */
async function scan() {
  const servers = await Promise.all(SERVERS.map(async (s) => {
    const base = `http://${HOST()}:${s.port}`;
    let models = [];
    let running = false;
    if (s.id === "ollama") {
      const r = await getJson(base + "/api/tags");
      if (Array.isArray(r.json?.models)) { running = true; models = r.json.models.map((m) => ({ id: m.name, size: m.size, params: m.details?.parameter_size || "" })); }
    } else {
      const r = await getJson(base + "/v1/models");
      if (Array.isArray(r.json?.data)) { running = true; models = r.json.data.map((m) => ({ id: m.id })); }
    }
    return { ...s, baseURL: base + "/v1", running, models, installed: s.id === "ollama" ? !!ollamaExe() || running : running };
  }));
  const img = `http://${HOST()}:${IMAGE_SERVER.port}`;
  const ir = await getJson(img + "/sdapi/v1/sd-models");
  const image = { ...IMAGE_SERVER, url: img, running: Array.isArray(ir.json), apiOff: false, models: Array.isArray(ir.json) ? ir.json.map((m) => m.model_name || m.title) : [] };
  if (!image.running) image.apiOff = (await getJson(img + "/", 1000)).status === 200; // running, but started without --api
  return { servers, image, scannedAt: Date.now() };
}

/** Start the Ollama server if it's installed but not running. */
function startOllama() {
  const exe = ollamaExe();
  if (!exe) throw new Error("Ollama is not installed. Get it free from ollama.com/download.");
  const p = spawn(exe, ["serve"], { detached: true, stdio: "ignore", windowsHide: true });
  p.unref();
}

/** Download a model with Ollama; calls onProgress({status, pct}). */
async function pullModel(model, onProgress, signal) {
  const r = await fetch(`http://${HOST()}:11434/api/pull`, { method: "POST", body: JSON.stringify({ model, stream: true }), signal }).catch(() => null);
  if (!r || !r.ok) throw new Error(r ? `Ollama said ${r.status}` : "Ollama is not running");
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      if (j.error) throw new Error(j.error);
      onProgress({ status: j.status || "", pct: j.total ? Math.round((j.completed || 0) / j.total * 100) : null });
    }
  }
}

async function deleteModel(model) {
  const r = await fetch(`http://${HOST()}:11434/api/delete`, { method: "DELETE", body: JSON.stringify({ model }) }).catch(() => null);
  if (!r || !r.ok) throw new Error("Could not delete the model (is Ollama running?)");
}

/** Generate a picture with Forge / AUTOMATIC1111 (started with --api). Returns a PNG buffer. */
async function forgeImage(url, { prompt, kind }) {
  const [width, height] = kind === "thumbnail" ? [1344, 768] : [1024, 1024];
  let r;
  try {
    r = await fetch(url.replace(/\/+$/, "") + "/sdapi/v1/txt2img", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, negative_prompt: "text errors, watermark, signature, blurry, low quality, logo of other brands", width, height, steps: 25, cfg_scale: 6, sampler_name: "DPM++ 2M" }),
    });
  } catch { throw new Error("Forge is not running"); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.images?.[0]) throw new Error("Forge could not make the image" + (j.detail ? ": " + JSON.stringify(j.detail).slice(0, 200) : ""));
  return { png: Buffer.from(j.images[0], "base64"), width, height };
}

module.exports = { SERVERS, IMAGE_SERVER, RECOMMENDED, scan, startOllama, pullModel, deleteModel, forgeImage, ollamaExe };

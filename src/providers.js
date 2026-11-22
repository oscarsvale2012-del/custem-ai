// AI provider adapters. Each adapter turns a neutral conversation into the
// provider's wire format and back, so agents and the orchestrator never care
// which provider sits behind an agent. Add a provider by adding an adapter.
//
// Neutral message:  { role: "user"|"assistant", content: Block[], raw? }
// Neutral blocks:   {type:"text",text} | {type:"tool_use",id,name,input} | {type:"tool_result",tool_use_id,content,is_error?}
// chat() returns:   { blocks, raw, usage:{input,output}, stop:"end"|"tool_use"|"max_tokens"|"refusal"|"pause" }

const sdk = require("@anthropic-ai/sdk");
const Anthropic = sdk.Anthropic || sdk.default || sdk;
const AERR = (n) => sdk[n] || Anthropic[n];

class ProviderError extends Error {
  // kind: auth | connection | billing | rate_limit | not_found | aborted | refusal | other
  constructor(kind, message, status) { super(message); this.kind = kind; this.status = status; }
}

/* ---------------- Anthropic (Claude) ---------------- */
const CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"];

function anthropicAdapter(cfg) {
  const client = () => new Anthropic({ apiKey: cfg.apiKey, ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}) });

  const wrap = (e) => {
    if (e instanceof AERR("APIUserAbortError")) return new ProviderError("aborted", "stopped");
    if (e instanceof AERR("AuthenticationError") || e instanceof AERR("PermissionDeniedError")) return new ProviderError("auth", "API key was rejected", e.status);
    if (e instanceof AERR("NotFoundError")) return new ProviderError("not_found", "model not found for this key", e.status);
    if (e instanceof AERR("RateLimitError")) return new ProviderError("rate_limit", "rate limited — try again shortly", e.status);
    if (e instanceof AERR("APIConnectionError")) return new ProviderError("connection", "cannot reach the Claude API", e.status);
    if (e instanceof AERR("APIError") && e.status === 402) return new ProviderError("billing", "out of credits on this account", 402);
    if (e instanceof AERR("APIError")) return new ProviderError("other", `Claude API error ${e.status}: ${e.message}`, e.status);
    return new ProviderError("other", String(e?.message || e));
  };

  const toWire = (messages) =>
    messages.map((m) => {
      if (m.role === "assistant" && m.raw && m.rawProvider === "anthropic") return { role: "assistant", content: m.raw };
      return {
        role: m.role,
        content: m.content.map((b) => {
          if (b.type === "text") return { type: "text", text: b.text || " " };
          if (b.type === "tool_use") return { type: "tool_use", id: b.id, name: b.name, input: b.input };
          if (b.type === "tool_result") return { type: "tool_result", tool_use_id: b.tool_use_id, content: String(b.content), ...(b.is_error ? { is_error: true } : {}) };
          return b;
        }),
      };
    });

  return {
    type: "anthropic",
    async test(model) {
      if (!cfg.apiKey) throw new ProviderError("auth", "no API key set");
      try { await client().models.retrieve(model || CLAUDE_MODELS[0]); } catch (e) { throw wrap(e); }
    },
    async listModels() {
      try {
        const out = [];
        for await (const m of client().models.list()) out.push(m.id);
        return out.length ? out : CLAUDE_MODELS;
      } catch { return CLAUDE_MODELS; }
    },
    async chat({ model, system, messages, tools, signal, effort = "high", maxTokens = 16000 }) {
      const params = {
        model,
        max_tokens: maxTokens,
        system,
        messages: toWire(messages),
        cache_control: { type: "ephemeral" },
        output_config: { effort },
      };
      if (tools && tools.length) params.tools = tools.map((t) => (t.serverTool ? t.serverTool : { name: t.name, description: t.description, input_schema: t.schema }));
      // Server-side refusal fallbacks (not available on Haiku).
      if (!model.startsWith("claude-haiku")) {
        params.betas = ["server-side-fallback-2026-07-01"];
        params.fallbacks = "default";
      }
      let res;
      try { res = await client().beta.messages.create(params, { signal }); } catch (e) { throw wrap(e); }
      const blocks = [];
      for (const b of res.content) {
        if (b.type === "text") blocks.push({ type: "text", text: b.text });
        else if (b.type === "tool_use") blocks.push({ type: "tool_use", id: b.id, name: b.name, input: b.input || {} });
      }
      const u = res.usage || {};
      const stop = { end_turn: "end", tool_use: "tool_use", max_tokens: "max_tokens", refusal: "refusal", pause_turn: "pause" }[res.stop_reason] || "end";
      return {
        blocks, raw: res.content, rawProvider: "anthropic", stop,
        usage: { input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), output: u.output_tokens || 0 },
      };
    },
  };
}

/* ---------------- OpenAI-compatible (OpenAI, OpenRouter, Groq, Ollama, LM Studio…) ---------------- */
const NO_TOOLS = new Set(); // "baseURL|model" pairs that can only chat
function openaiAdapter(cfg) {
  const base = (cfg.baseURL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const headers = () => ({ "Content-Type": "application/json", ...(cfg.apiKey ? { Authorization: "Bearer " + cfg.apiKey } : {}) });

  async function call(pathname, body, signal) {
    let r;
    try {
      r = await fetch(base + pathname, { method: body ? "POST" : "GET", headers: headers(), body: body ? JSON.stringify(body) : undefined, signal });
    } catch (e) {
      if (e?.name === "AbortError") throw new ProviderError("aborted", "stopped");
      throw new ProviderError("connection", "cannot reach " + base);
    }
    let j = null;
    try { j = await r.json(); } catch { /* non-JSON */ }
    if (!r.ok) {
      const msg = j?.error?.message || r.statusText;
      if (r.status === 401 || r.status === 403) throw new ProviderError("auth", "API key was rejected: " + msg, r.status);
      if (r.status === 402) throw new ProviderError("billing", "out of credits: " + msg, 402);
      if (r.status === 404) throw new ProviderError("not_found", msg, 404);
      if (r.status === 429) throw new ProviderError(j?.error?.code === "insufficient_quota" ? "billing" : "rate_limit", msg, 429);
      throw new ProviderError("other", `API error ${r.status}: ${msg}`, r.status);
    }
    if (!j) throw new ProviderError("other", "provider returned an invalid response");
    return j;
  }

  const toWire = (system, messages) => {
    const out = [{ role: "system", content: system }];
    for (const m of messages) {
      if (m.role === "assistant") {
        const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
        const calls = m.content.filter((b) => b.type === "tool_use");
        out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}) });
      } else {
        const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
        for (const b of m.content.filter((b) => b.type === "tool_result")) out.push({ role: "tool", tool_call_id: b.tool_use_id, content: String(b.content) });
        if (text) out.push({ role: "user", content: text });
      }
    }
    return out;
  };

  return {
    type: "openai",
    async test(model) {
      const j = await call("/models");
      if (model && Array.isArray(j.data) && j.data.length && !j.data.some((m) => m.id === model)) throw new ProviderError("not_found", `model "${model}" not offered by this provider`);
    },
    async listModels() {
      try { const j = await call("/models"); return (j.data || []).map((m) => m.id).sort(); } catch { return []; }
    },
    async chat({ model, system, messages, tools, signal, maxTokens = 16000 }) {
      const body = { model, messages: toWire(system, messages), max_tokens: maxTokens };
      const fnTools = (tools || []).filter((t) => !t.serverTool); // server tools are Claude-only
      const key = base + "|" + model;
      if (fnTools.length && !NO_TOOLS.has(key)) body.tools = fnTools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } }));
      let j;
      try { j = await call("/chat/completions", body, signal); }
      catch (e) {
        // Some local models can only chat (no tools). Remember that and retry without tools.
        if (!body.tools || !/does not support tools|tool.*not supported|tools? (is|are) not supported/i.test(e.message)) throw e;
        NO_TOOLS.add(key);
        delete body.tools;
        j = await call("/chat/completions", body, signal);
      }
      const choice = j.choices?.[0];
      if (!choice) throw new ProviderError("other", "provider returned no answer");
      const blocks = [];
      if (choice.message?.content) blocks.push({ type: "text", text: choice.message.content });
      for (const c of choice.message?.tool_calls || []) {
        let input = {};
        try { input = JSON.parse(c.function.arguments || "{}"); } catch { input = { __invalid_json: c.function.arguments }; }
        blocks.push({ type: "tool_use", id: c.id, name: c.function.name, input });
      }
      const stop = choice.finish_reason === "tool_calls" || blocks.some((b) => b.type === "tool_use") ? "tool_use" : choice.finish_reason === "length" ? "max_tokens" : choice.finish_reason === "content_filter" ? "refusal" : "end";
      return { blocks, stop, usage: { input: j.usage?.prompt_tokens || 0, output: j.usage?.completion_tokens || 0 } };
    },
  };
}

const PROVIDER_TYPES = {
  anthropic: { label: "Anthropic Claude", make: anthropicAdapter, needsKey: true, defaultModels: CLAUDE_MODELS },
  openai: { label: "OpenAI-compatible (OpenAI, OpenRouter, Groq, Ollama, LM Studio)", make: openaiAdapter, needsKey: false, defaultModels: [] },
};

function makeProvider(cfg) {
  const t = PROVIDER_TYPES[cfg.type];
  if (!t) throw new Error("unknown provider type " + cfg.type);
  return t.make(cfg);
}

module.exports = { makeProvider, ProviderError, PROVIDER_TYPES, CLAUDE_MODELS };

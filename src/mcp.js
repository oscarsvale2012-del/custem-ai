// MCP server manager: connects to external MCP servers (stdio or HTTP),
// discovers their tools and calls them for agents. Connection status is only
// "connected" after the MCP handshake and tool listing actually succeeded.
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport, getDefaultEnvironment } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { SSEClientTransport } = require("@modelcontextprotocol/sdk/client/sse.js");

const MAX_RESULT_CHARS = 60000;

const PRESETS = {
  "roblox-studio": () => ({
    name: "Roblox Studio",
    kind: "roblox-studio",
    transport: "stdio",
    command: "cmd.exe",
    args: ["/c", "cd /d %LOCALAPPDATA%\\Roblox && .\\mcp.bat"],
    url: "",
    env: {},
    headers: {},
    autoConnect: true,
    description: "Official Roblox Studio MCP server. Open Studio and enable the MCP / AI assistant connection in Studio's Assistant settings.",
  }),
};

const slug = (s) => String(s || "server").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 20) || "server";

class McpManager {
  constructor({ onChange, log }) {
    this.live = new Map(); // serverId -> { client, transport, status, error, tools, stderr }
    this.onChange = onChange;
    this.log = log;
  }

  info(id) {
    const l = this.live.get(id);
    return l ? { status: l.status, error: l.error, tools: l.tools, stderr: l.stderr.slice(-2000) } : { status: "disconnected", error: null, tools: [], stderr: "" };
  }

  async connect(cfg) {
    await this.disconnect(cfg.id, true);
    const l = { client: null, transport: null, status: "connecting", error: null, tools: [], stderr: "" };
    this.live.set(cfg.id, l);
    this.onChange();
    try {
      let transport;
      if (cfg.transport === "stdio") {
        if (!cfg.command) throw new Error("No command set");
        transport = new StdioClientTransport({
          command: cfg.command,
          args: cfg.args || [],
          env: { ...getDefaultEnvironment(), ...process.env, ...(cfg.env || {}) },
          cwd: cfg.cwd || undefined,
          stderr: "pipe",
        });
        transport.stderr?.on("data", (d) => { l.stderr = (l.stderr + d.toString()).slice(-8000); });
      } else if (cfg.transport === "http" || cfg.transport === "sse") {
        if (!cfg.url) throw new Error("No URL set");
        const opts = { requestInit: { headers: { ...(cfg.headers || {}) } } };
        transport = cfg.transport === "sse" ? new SSEClientTransport(new URL(cfg.url), opts) : new StreamableHTTPClientTransport(new URL(cfg.url), opts);
      } else throw new Error("Unknown transport " + cfg.transport);

      const client = new Client({ name: "agentforge", version: "0.2.0" }, { capabilities: {} });
      l.client = client;
      l.transport = transport;
      transport.onclose = () => {
        if (this.live.get(cfg.id) !== l || l.closing) return;
        l.status = "error";
        l.error = "Server closed the connection" + (l.stderr ? ": " + lastLine(l.stderr) : "");
        this.log(`MCP ${cfg.name}: connection closed`, "warn");
        this.onChange();
      };
      await withTimeout(client.connect(transport), 30000, "Timed out connecting (30 s)");
      l.tools = await this._listTools(client);
      l.status = "connected";
      this.log(`MCP ${cfg.name}: connected, ${l.tools.length} tools`, "ok");
    } catch (e) {
      l.status = "error";
      l.error = String(e?.message || e) + (l.stderr ? " — " + lastLine(l.stderr) : "");
      this.log(`MCP ${cfg.name}: ${l.error}`, "error");
      try { await l.client?.close(); } catch { /* ignore */ }
    }
    this.onChange();
    return this.info(cfg.id);
  }

  async _listTools(client) {
    const tools = [];
    let cursor;
    do {
      const r = await withTimeout(client.listTools(cursor ? { cursor } : {}), 30000, "Timed out listing tools");
      for (const t of r.tools || []) {
        tools.push({
          name: t.name,
          title: t.title || t.annotations?.title || t.name,
          description: t.description || "",
          inputSchema: t.inputSchema || { type: "object", properties: {} },
          readOnly: t.annotations?.readOnlyHint === true,
          destructive: t.annotations?.destructiveHint === true,
        });
      }
      cursor = r.nextCursor;
    } while (cursor);
    return tools;
  }

  async refresh(cfg) {
    const l = this.live.get(cfg.id);
    if (!l || l.status !== "connected") return this.connect(cfg);
    try {
      l.tools = await this._listTools(l.client);
      l.error = null;
    } catch (e) {
      l.status = "error";
      l.error = String(e?.message || e);
    }
    this.onChange();
    return this.info(cfg.id);
  }

  async disconnect(id, quiet) {
    const l = this.live.get(id);
    if (!l) return;
    l.closing = true;
    try { await l.client?.close(); } catch { /* ignore */ }
    this.live.delete(id);
    if (!quiet) this.onChange();
  }

  /** Call a tool; returns { text, isError }. */
  async call(serverId, name, args, signal) {
    const l = this.live.get(serverId);
    if (!l || l.status !== "connected") throw new Error("MCP server is not connected");
    const r = await l.client.callTool({ name, arguments: args || {} }, undefined, { timeout: 180000, signal });
    const parts = [];
    for (const c of r.content || []) {
      if (c.type === "text") parts.push(c.text);
      else if (c.type === "image") parts.push(`[image ${c.mimeType}]`);
      else if (c.type === "resource") parts.push(c.resource?.text || `[resource ${c.resource?.uri}]`);
      else parts.push(`[${c.type}]`);
    }
    if (!parts.length && r.structuredContent) parts.push(JSON.stringify(r.structuredContent));
    let text = parts.join("\n") || "(no output)";
    if (text.length > MAX_RESULT_CHARS) text = text.slice(0, MAX_RESULT_CHARS) + "\n…(truncated)";
    return { text, isError: !!r.isError, raw: r };
  }

  async closeAll() {
    for (const id of [...this.live.keys()]) await this.disconnect(id, true);
  }
}

function lastLine(s) { return s.trim().split(/\r?\n/).filter(Boolean).pop()?.slice(0, 200) || ""; }
function withTimeout(p, ms, msg) {
  let t;
  return Promise.race([p.finally(() => clearTimeout(t)), new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]);
}

module.exports = { McpManager, PRESETS, slug };

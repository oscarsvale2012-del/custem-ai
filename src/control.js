// "Control VYRON from Claude": a local MCP server (plus a tiny JSON API) so an
// assistant such as Claude Code on this PC can see the team and tasks, start
// builds, give tasks and chat with the AIs.
// - Off until the user turns it on in Settings.
// - Listens on 127.0.0.1 only, checks the Host header, needs a secret key.
// - Goes through the same method whitelist and sign-in lock as the app's UI.
// - Cannot approve risky actions, read or change API keys, or delete projects.
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");
const { dispatch } = require("./api");

const DEFAULT_PORT = 47211;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");

class ControlServer {
  constructor({ dataDir, getCtx, log, version }) {
    this.file = path.join(dataDir, "vyron-control.json");
    this.getCtx = getCtx;
    this.log = log || (() => {});
    this.version = version || "";
    this.server = null;
    this.error = null;
    try { this.cfg = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { this.cfg = {}; }
    this.cfg = { enabled: false, port: DEFAULT_PORT, ...this.cfg };
    if (!this.cfg.token) this.cfg.token = crypto.randomBytes(24).toString("base64url");
    this.saveCfg();
  }

  saveCfg() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.cfg, null, 2)); }

  status() {
    return { enabled: !!this.cfg.enabled, running: !!this.server, port: this.cfg.port, url: `http://127.0.0.1:${this.cfg.port}/mcp`, error: this.error, configFile: this.file };
  }

  async setEnabled(on) {
    this.cfg.enabled = !!on;
    this.saveCfg();
    if (on) await this.start(); else await this.stop();
    return this.status();
  }

  async newKey() {
    this.cfg.token = crypto.randomBytes(24).toString("base64url");
    this.saveCfg();
    this.log("Control key replaced — reconnect Claude", "info", "Control");
    return this.status();
  }

  /* ---------------- tools ---------------- */
  call(method, ...args) { return dispatch(this.getCtx(), method, args); }

  async state() {
    const s = await this.call("publicState");
    if (s.locked) throw new Error("VYRON is locked. Sign in to VYRON first.");
    return s;
  }

  agentByName(s, name) {
    const a = s.agents.find((x) => x.name.toLowerCase() === String(name || "").trim().toLowerCase());
    if (!a) throw new Error(`No AI called "${name}". AIs: ${s.agents.map((x) => x.name).join(", ") || "none"}`);
    return a;
  }

  taskBrief(s, t) {
    const who = s.agents.find((a) => a.id === t.agentId)?.name || null;
    return { id: t.id, title: t.title, kind: t.kind, status: t.status, role: t.role, agent: who, priority: t.priority, stage: t.stage, progress: t.progress, parentId: t.parentId, error: t.error || undefined };
  }

  tools() {
    const T = [];
    const tool = (name, description, shape, run) => T.push({ name, description, shape, run });

    tool("vyron_status", "Overview of VYRON: active project, AIs (name, role, status, model, account email), providers, running tasks, pending approvals and revenue.", {}, async () => {
      const s = await this.state();
      const p = s.projects.find((x) => x.id === s.activeProjectId);
      return {
        version: this.version,
        activeProject: p ? { name: p.game?.name || p.name, universeId: p.universeId || null, placeId: p.placeId || null, studioConnected: p.studioConnected, rojoFolder: p.rojoDir || null } : null,
        ais: s.agents.map((a) => ({ name: a.name, role: a.role, status: a.status, model: a.model, provider: a.providerName, accountEmail: a.accountEmail || null })),
        providers: s.providers.map((x) => ({ name: x.name, type: x.type, status: x.status, error: x.error || undefined })),
        mcpServers: s.mcpServers.map((m) => ({ name: m.name, status: m.status, tools: m.tools.length })),
        runningTasks: s.tasks.filter((t) => ["planning", "in_progress", "testing", "waiting_approval"].includes(t.status)).map((t) => this.taskBrief(s, t)),
        pendingTasks: s.tasks.filter((t) => t.status === "pending").length,
        approvalsWaiting: s.approvals.map((a) => ({ agent: a.agentName, wants: a.title, note: "Only the user can approve this, in VYRON." })),
        revenue: s.revenue?.summary ? { robux: s.revenue.summary.balance, pending: s.revenue.summary.pending, salesToday: s.revenue.summary.day.sales } : null,
      };
    });

    tool("vyron_list_roles", "All roles an AI can have, with what each does.", {}, async () => {
      const s = await this.state();
      return Object.entries(s.roleInfo).map(([role, v]) => ({ role, group: v.group, does: v.short, holders: s.agents.filter((a) => a.role === role).map((a) => a.name) }));
    });

    tool("vyron_list_agents", "List the AIs with role, status, model, provider, account email, token use and permissions.", {}, async () => {
      const s = await this.state();
      return s.agents.map((a) => ({ name: a.name, role: a.role, status: a.status, enabled: a.enabled, model: a.model, provider: a.providerName, accountEmail: a.accountEmail || null, tokens: `${a.used}/${a.budget}`, permissions: Object.entries(a.perms).filter(([, v]) => v).map(([k]) => k), tasksDone: a.tasksDone }));
    });

    tool("vyron_add_agent", "Add an AI to the team with a role.", {
      name: z.string(), role: z.string().describe("One of the roles from vyron_list_roles"), model: z.string().optional(), provider_name: z.string().optional(), account_email: z.string().optional(),
    }, async ({ name, role, model, provider_name, account_email }) => {
      const s = await this.state();
      if (!s.roleInfo[role]) throw new Error("Unknown role. Use vyron_list_roles.");
      const prov = provider_name ? s.providers.find((p) => p.name.toLowerCase() === provider_name.toLowerCase()) : s.providers.find((p) => p.status === "connected") || s.providers[0];
      if (!prov) throw new Error("No AI provider is set up in VYRON yet. The user adds one on the AI Agents page.");
      await this.call("addAgent", { name, role, providerId: prov.id, model: model || prov.models[0] || "", accountEmail: account_email || "" });
      return `Added ${name} as ${role} (${prov.name}).`;
    });

    tool("vyron_update_agent", "Change an AI: role, model, on/off, or permissions (read, write, delete, studio, mcp, web, images, delegate, stats; null = back to role default).", {
      agent_name: z.string(), role: z.string().optional(), model: z.string().optional(), enabled: z.boolean().optional(),
      permissions: z.record(z.string(), z.boolean().nullable()).optional(),
    }, async ({ agent_name, role, model, enabled, permissions }) => {
      const s = await this.state();
      const a = this.agentByName(s, agent_name);
      const patch = {};
      if (role) { if (!s.roleInfo[role]) throw new Error("Unknown role"); patch.role = role; }
      if (model) patch.model = model;
      if (permissions) patch.perms = permissions;
      if (Object.keys(patch).length) await this.call("updateAgent", a.id, patch);
      if (enabled !== undefined) await this.call("agentAction", a.id, enabled ? "enable" : "disable");
      return `Updated ${a.name}.`;
    });

    tool("vyron_list_projects", "List Roblox projects and which one is active.", {}, async () => {
      const s = await this.state();
      return s.projects.map((p) => ({ id: p.id, name: p.game?.name || p.name, active: p.id === s.activeProjectId, universeId: p.universeId || null, placeId: p.placeId || null, studioConnected: p.studioConnected, rojoFolder: p.rojoDir || null }));
    });

    tool("vyron_set_project", "Make a project the active one (by name or id).", { project: z.string() }, async ({ project }) => {
      const s = await this.state();
      const p = s.projects.find((x) => x.id === project || (x.game?.name || x.name).toLowerCase() === project.toLowerCase());
      if (!p) throw new Error("Project not found");
      await this.call("setActiveProject", p.id);
      return `Active project: ${p.game?.name || p.name}`;
    });

    tool("vyron_build", "Ask the team to build something in the active game. The Co-Founder or Lead Developer plans it and splits it into tasks for the right roles. Returns the build task id.", {
      request: z.string().describe("What to build, in detail"), priority: z.enum(["low", "normal", "high"]).optional(),
    }, async ({ request, priority }) => {
      await this.state();
      const id = await this.call("build", request, { priority });
      return { taskId: id, next: "Use vyron_wait_for_task or vyron_get_task to follow it." };
    });

    tool("vyron_create_task", "Give one task to a role or a specific AI.", {
      description: z.string(), title: z.string().optional(), role: z.string().optional(), agent_name: z.string().optional(), priority: z.enum(["low", "normal", "high"]).optional(),
    }, async ({ description, title, role, agent_name, priority }) => {
      const s = await this.state();
      const agent = agent_name ? this.agentByName(s, agent_name) : null;
      if (role && !s.roleInfo[role]) throw new Error("Unknown role");
      const id = await this.call("createTask", { title, description, role: role || null, agentId: agent?.id || null, priority: priority || "normal" });
      return { taskId: id };
    });

    tool("vyron_list_tasks", "List tasks (newest first).", {
      filter: z.enum(["active", "all", "completed", "failed"]).optional(), limit: z.number().int().min(1).max(100).optional(),
    }, async ({ filter = "active", limit = 30 }) => {
      const s = await this.state();
      const ok = (t) => filter === "all" || (filter === "active" ? !["completed", "failed", "cancelled"].includes(t.status) : filter === "completed" ? t.status === "completed" : ["failed", "cancelled"].includes(t.status));
      return s.tasks.filter((t) => t.kind !== "chat" && ok(t)).slice(-limit).reverse().map((t) => this.taskBrief(s, t));
    });

    tool("vyron_get_task", "Full details of a task: description, plan, sub-tasks, steps, changed files, team notes, result and errors.", { id: z.string() }, async ({ id }) => {
      const s = await this.state();
      const t = s.tasks.find((x) => x.id === id);
      if (!t) throw new Error("Task not found");
      return {
        ...this.taskBrief(s, t), description: t.description, plan: t.plan || undefined,
        subtasks: s.tasks.filter((k) => k.parentId === t.id).map((k) => this.taskBrief(s, k)),
        steps: (t.steps || []).slice(-25).map((x) => clip(x.text, 400)), changedFiles: (t.changes || []).map((c) => `${c.op} ${c.path}`),
        notes: (t.notes || []).map((n) => `${n.agent}: ${n.text}`), result: t.result || undefined,
      };
    });

    tool("vyron_wait_for_task", "Wait until a task (or build) finishes, up to the timeout, then return its status and result.", {
      id: z.string(), timeout_seconds: z.number().int().min(5).max(300).optional(),
    }, async ({ id, timeout_seconds = 120 }) => {
      const end = Date.now() + timeout_seconds * 1000;
      for (;;) {
        const s = await this.state();
        const t = s.tasks.find((x) => x.id === id);
        if (!t) throw new Error("Task not found");
        const done = ["completed", "failed", "cancelled"].includes(t.status);
        if (done || Date.now() > end) return { ...this.taskBrief(s, t), finished: done, result: t.result ? clip(t.result, 4000) : undefined, waitingForApproval: s.approvals.filter((a) => a.taskId === id || s.tasks.find((k) => k.id === a.taskId)?.parentId === id).map((a) => a.title) };
        await sleep(1500);
      }
    });

    tool("vyron_cancel_task", "Cancel a task (and its sub-tasks).", { id: z.string() }, async ({ id }) => { await this.call("cancelTask", id); return "Cancelled."; });
    tool("vyron_retry_task", "Retry a failed or cancelled task.", { id: z.string() }, async ({ id }) => { await this.call("retryTask", id); return "Retrying."; });

    tool("vyron_chat", "Send a message to one AI in VYRON (it can act on the project with its tools). Read the reply with vyron_get_chat.", {
      agent_name: z.string(), message: z.string(),
    }, async ({ agent_name, message }) => {
      const s = await this.state();
      const a = this.agentByName(s, agent_name);
      await this.call("sendChat", { agentIds: [a.id], text: message });
      return `Sent to ${a.name}. Use vyron_get_chat to read the reply.`;
    });

    tool("vyron_get_chat", "Read the latest messages in the chat with an AI.", { agent_name: z.string(), last: z.number().int().min(1).max(50).optional() }, async ({ agent_name, last = 10 }) => {
      const s = await this.state();
      const a = this.agentByName(s, agent_name);
      const busy = s.tasks.some((t) => t.kind === "chat" && t.agentId === a.id && ["pending", "in_progress", "waiting_approval"].includes(t.status));
      return { agent: a.name, stillWorking: busy, messages: (s.conversations[a.id] || []).slice(-last).map((m) => ({ from: m.role === "user" ? "you" : m.role === "error" ? "error" : a.name, text: clip(m.text, 3000) })) };
    });

    tool("vyron_activity", "Recent activity log.", { limit: z.number().int().min(1).max(150).optional() }, async ({ limit = 40 }) => {
      const s = await this.state();
      return s.activity.slice(-limit).map((l) => `${new Date(l.at).toLocaleTimeString()} [${l.source}] ${l.text}`);
    });

    tool("vyron_list_images", "Images the Image Creator made for the active project (file paths).", {}, async () => {
      const s = await this.state();
      const imgs = await this.call("listImages", s.activeProjectId);
      return imgs.map((i) => ({ name: i.name, kind: i.kind, size: `${i.w}x${i.h}`, by: i.agent, file: i.file }));
    });

    return T;
  }

  async runTool(name, args) {
    const t = this.tools().find((x) => x.name === name);
    if (!t) throw new Error("Unknown tool " + name);
    const parsed = z.object(t.shape).parse(args || {});
    return t.run(parsed);
  }

  mcpServer() {
    const server = new McpServer({ name: "vyron", version: this.version || "1.0.0" });
    for (const t of this.tools()) {
      server.registerTool(t.name, { description: t.description, inputSchema: t.shape }, async (args) => {
        try {
          const out = await t.run(args || {});
          return { content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text", text: "Error: " + (e.message || e) }], isError: true };
        }
      });
    }
    return server;
  }

  /* ---------------- HTTP ---------------- */
  authorized(req) {
    const host = String(req.headers.host || "");
    if (host !== `127.0.0.1:${this.cfg.port}` && host !== `localhost:${this.cfg.port}`) return false; // blocks DNS rebinding
    const got = Buffer.from(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    const want = Buffer.from(this.cfg.token);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }

  async start() {
    if (this.server) return;
    this.error = null;
    const srv = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const json = (code, obj) => { if (!res.headersSent) res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (url.pathname === "/health") return json(200, { ok: true, app: "VYRON", version: this.version });
      if (!this.authorized(req)) return json(401, { ok: false, error: "Missing or wrong control key" });
      let body = "";
      for await (const c of req) { body += c; if (body.length > 2e6) return json(413, { ok: false, error: "Too large" }); }
      let parsed;
      try { parsed = body ? JSON.parse(body) : undefined; } catch { return json(400, { ok: false, error: "Invalid JSON" }); }
      try {
        if (url.pathname === "/mcp") {
          if (req.method !== "POST") return json(405, { ok: false, error: "Use POST" });
          const server = this.mcpServer();
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
          res.on("close", () => { transport.close(); server.close(); });
          await server.connect(transport);
          await transport.handleRequest(req, res, parsed);
          return;
        }
        const m = url.pathname.match(/^\/rpc\/([a-z_]+)$/);
        if (m && req.method === "POST") return json(200, { ok: true, result: await this.runTool(m[1], parsed || {}) });
        if (url.pathname === "/rpc" && req.method === "GET") return json(200, { ok: true, tools: this.tools().map((t) => ({ name: t.name, description: t.description })) });
        json(404, { ok: false, error: "Not found" });
      } catch (e) {
        json(200, { ok: false, error: String(e.message || e) });
      }
    });
    await new Promise((resolve) => {
      srv.once("error", (e) => { this.error = e.code === "EADDRINUSE" ? `Port ${this.cfg.port} is already in use` : e.message; this.server = null; resolve(); });
      srv.listen(this.cfg.port, "127.0.0.1", () => { this.server = srv; this.log(`Claude control is on (127.0.0.1:${this.cfg.port})`, "ok", "Control"); resolve(); });
    });
  }

  async stop() {
    if (!this.server) return;
    await new Promise((r) => this.server.close(() => r()));
    this.server = null;
    this.log("Claude control is off", "info", "Control");
  }
}

module.exports = { ControlServer, DEFAULT_PORT };

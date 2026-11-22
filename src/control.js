// Claude connector: a local MCP server (plus a tiny JSON API) so Claude can
// see and control VYRON: projects, Studio, game ideas, revenue in kroner.
// (VYRON starts Claude with this connector from its Claude tab.)
// - On by default; can be switched off in Settings.
// - Listens on 127.0.0.1 only, checks the Host header, needs a secret key.
// - Goes through the same method whitelist and sign-in lock as the app's UI.
// - Cannot read or change keys or delete projects.
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
    this.cfg = { enabled: true, port: DEFAULT_PORT, ...this.cfg };
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
  call(method, ...args) { return dispatch({ ...this.getCtx(), internal: true }, method, args); }

  async state() {
    const s = await this.call("publicState");
    if (s.locked) throw new Error("VYRON is locked. Sign in to VYRON first.");
    return s;
  }

  findProject(s, q) {
    const p = s.projects.find((x) => x.id === q || (x.game?.name || x.name).toLowerCase() === String(q).trim().toLowerCase());
    if (!p) throw new Error(`No project "${q}". Projects: ${s.projects.map((x) => x.game?.name || x.name).join(", ") || "none"}`);
    return p;
  }

  tools() {
    const T = [];
    const tool = (name, description, shape, run) => T.push({ name, description, shape, run });
    const proj = (p, s) => ({ id: p.id, name: p.game?.name || p.name, active: p.id === s.activeProjectId, placeId: p.placeId || null, universeId: p.universeId || null, studioOpen: p.studioConnected, folder: p.rojoDir || null });

    tool("vyron_status", "Overview of VYRON: active project, Roblox Studio connection, picked game ideas and revenue in Robux and Danish kroner.", {}, async () => {
      const s = await this.state();
      const p = s.projects.find((x) => x.id === s.activeProjectId);
      return {
        version: this.version,
        activeProject: p ? proj(p, s) : null,
        studio: { connected: s.studio.status === "connected", windows: s.studios.map((w) => w.name || w.id), problem: s.studioError || undefined },
        pickedIdeas: s.ideas.picked.length,
        revenue: await this.call("revenueKr"),
        workFolder: s.workDir,
      };
    });

    tool("vyron_list_projects", "List the user's Roblox projects and which one is active.", {}, async () => {
      const s = await this.state();
      return s.projects.map((p) => proj(p, s));
    });

    tool("vyron_set_project", "Make a project the active one (by name or id).", { project: z.string() }, async ({ project }) => {
      const s = await this.state();
      const p = this.findProject(s, project);
      await this.call("setActiveProject", p.id);
      return `Active project: ${p.game?.name || p.name}`;
    });

    tool("vyron_add_project", "Add a Roblox project to VYRON. Give a place id to load the game's name and icon; folder is optional (a Rojo project folder).", {
      name: z.string().optional(), place_id: z.string().optional(), folder: z.string().optional(),
    }, async ({ name, place_id, folder }) => {
      const id = await this.call("addProject", { name, placeId: place_id, rojoDir: folder });
      return { projectId: id };
    });

    tool("vyron_studio", "Check which Roblox Studio windows VYRON sees (reconnects if needed).", {}, async () => {
      const s = await this.state();
      if (s.studio.status !== "connected") await this.call("connectStudio");
      const w = await this.call("detectStudios").catch((e) => ({ error: e.message }));
      return w;
    });

    tool("vyron_list_ideas", "Game ideas in VYRON's library. Filter by category (e.g. Brainrot, Shooter, Simulator) or only the ones the user picked.", {
      category: z.string().optional(), picked_only: z.boolean().optional(),
    }, async ({ category, picked_only }) => {
      const s = await this.state();
      let list = [...(await this.call("listIdeas", category)), ...s.ideas.custom.filter((i) => !category || i.category.toLowerCase() === category.toLowerCase())];
      if (picked_only) list = list.filter((i) => s.ideas.picked.includes(i.id));
      return { categories: s.ideas.categories, ideas: list.map((i) => ({ id: i.id, category: i.category, title: i.title, pitch: i.pitch, features: i.features, picked: s.ideas.picked.includes(i.id) })) };
    });

    tool("vyron_pick_ideas", "Set which ideas are picked in VYRON's Ideas tab (by id).", { ids: z.array(z.string()) }, async ({ ids }) => {
      await this.call("setPicked", ids);
      return `Picked ${ids.length} idea(s).`;
    });

    tool("vyron_add_idea", "Save a new game idea in the user's own ideas (Custom tab).", { title: z.string(), pitch: z.string(), features: z.string().optional() }, async (a) => {
      const id = await this.call("addCustomIdea", a);
      return { id };
    });

    tool("vyron_revenue", "The user's Robux, pending Robux and today's sales with Danish kroner at the official DevEx rate (Roblox DevEx page + ECB daily rates).", {}, async () => {
      await this.state();
      return this.call("revenueKr");
    });

    tool("vyron_notify", "Show a short message to the user inside VYRON (e.g. 'Your game is ready to test').", { message: z.string() }, async ({ message }) => {
      await this.state();
      await this.call("notify", message);
      return "Shown in VYRON.";
    });

    tool("vyron_activity", "Recent activity log.", { limit: z.number().int().min(1).max(150).optional() }, async ({ limit = 40 }) => {
      const s = await this.state();
      return s.activity.slice(-limit).map((l) => `${new Date(l.at).toLocaleTimeString()} [${l.source}] ${l.text}`);
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

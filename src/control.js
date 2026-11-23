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
  constructor({ dataDir, getCtx, log, version, bridge }) {
    this.bridge = bridge || null; // { command, args, env } that starts src/mcp-bridge.js
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

  /** Which Claude apps use the connector: VYRON's own tasks, the Claude desktop app (bridge) or Claude Code. */
  seen(req, body) {
    const tag = String(req.headers["x-vyron-client"] || "");
    const msgs = Array.isArray(body) ? body : body ? [body] : [];
    const init = msgs.find((m) => m && m.method === "initialize");
    const name = String(init?.params?.clientInfo?.name || "");
    const kind = tag === "vyron" ? "vyron" : tag === "claude-desktop" ? "desktop" : "code";
    this.clients = this.clients || {};
    const c = (this.clients[kind] = this.clients[kind] || { kind, first: Date.now(), calls: 0 });
    c.last = Date.now(); c.calls++;
    if (name) c.app = name.slice(0, 60);
    if (kind !== "vyron" && (!this._seenEmit || Date.now() - this._seenEmit > 5000)) { this._seenEmit = Date.now(); this.onSeen?.(); }
  }
  clientsPublic() { return Object.values(this.clients || {}).map(({ kind, app, last, calls }) => ({ kind, app: app || null, last, calls })); }

  status() {
    return {
      clients: this.clientsPublic(),
      desktop: this.desktopStatus(), enabled: !!this.cfg.enabled, running: !!this.server, port: this.cfg.port, url: `http://127.0.0.1:${this.cfg.port}/mcp`, error: this.error, configFile: this.file };
  }

  async setEnabled(on) {
    this.cfg.enabled = !!on;
    this.saveCfg();
    if (on) await this.start(); else await this.stop();
    return this.status();
  }

  /* ---------------- Claude desktop app ---------------- */
  /** Where the Claude desktop app keeps its MCP settings (newest Windows app first). */
  desktopConfigFiles(env = process.env) {
    const out = [];
    const la = env.LOCALAPPDATA, ap = env.APPDATA;
    const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
    if (la) for (const a of ls(path.join(la, "Claude-Data"))) { const f = path.join(la, "Claude-Data", a, "claude_desktop_config.json"); if (fs.existsSync(f)) out.push(f); }
    if (la) for (const p of ls(path.join(la, "Packages")).filter((x) => /^Claude_/.test(x))) { const f = path.join(la, "Packages", p, "LocalCache", "Roaming", "Claude", "claude_desktop_config.json"); if (fs.existsSync(f)) out.push(f); }
    if (ap) { const f = path.join(ap, "Claude", "claude_desktop_config.json"); if (fs.existsSync(f) || !out.length) out.push(f); }
    return out;
  }
  desktopStatus() {
    const files = this.desktopConfigFiles();
    const connected = files.some((f) => { try { return !!JSON.parse(fs.readFileSync(f, "utf8")).mcpServers?.vyron; } catch { return false; } });
    return { available: !!this.bridge, connected, files };
  }
  /** Adds (or removes) the "vyron" entry; keeps everything else and a backup of the old file. */
  setDesktop(on) {
    if (on && !this.bridge) throw new Error("Connecting Claude desktop works from the installed VYRON app.");
    const files = this.desktopConfigFiles();
    for (const f of files) {
      let j = {};
      const had = fs.existsSync(f);
      if (had) {
        const raw = fs.readFileSync(f, "utf8");
        try { j = JSON.parse(raw); } catch { throw new Error("Claude desktop's settings file can't be read, so it wasn't changed: " + f); }
        fs.writeFileSync(f + ".vyron-backup", raw);
      }
      j.mcpServers = j.mcpServers && typeof j.mcpServers === "object" ? j.mcpServers : {};
      if (on) j.mcpServers.vyron = { command: this.bridge.command, args: this.bridge.args, env: this.bridge.env };
      else delete j.mcpServers.vyron;
      if (!on && !had) continue;
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(j, null, 2));
    }
    this.log(on ? "Claude desktop connected — restart Claude desktop to use VYRON there" : "Claude desktop disconnected", "ok", "Control");
    return this.desktopStatus();
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

    const xy = { x: z.number().describe("x in pixels of the latest vyron_pc_screenshot"), y: z.number().describe("y in pixels of the latest vyron_pc_screenshot") };
    const pcNote = " Only works when the user turned on PC control in VYRON; they may have to approve it.";
    tool("vyron_pc_screenshot", "See the user's whole screen (all monitors). Use before clicking: coordinates for the other vyron_pc_ tools are pixels in this image." + pcNote, {}, async () => {
      const s = await this.call("pcAction", "screenshot", {});
      return { __image: s.data, mime: s.mime || "image/jpeg", text: `Screenshot ${s.w}×${s.h} (real screen ${s.realW}×${s.realH}). Mouse is at (${Math.round(((s.cx - s.left) * s.w) / s.realW)}, ${Math.round(((s.cy - s.top) * s.h) / s.realH)}).` };
    });
    tool("vyron_pc_click", "Click on the user's screen at a point in the latest screenshot." + pcNote, { ...xy, button: z.enum(["left", "right", "middle"]).optional(), double: z.boolean().optional() }, async (a) => { await this.call("pcAction", "click", a); return "Clicked. Take a new screenshot to see the result."; });
    tool("vyron_pc_scroll", "Scroll at a point; amount = wheel steps, positive scrolls down." + pcNote, { ...xy, amount: z.number().int().min(-20).max(20) }, async (a) => { await this.call("pcAction", "scroll", a); return "Scrolled."; });
    tool("vyron_pc_type", "Type text into the focused window." + pcNote, { text: z.string().max(2000) }, async (a) => { await this.call("pcAction", "type", a); return "Typed."; });
    tool("vyron_pc_key", "Press a key or shortcut, e.g. enter, esc, tab, ctrl+s, alt+tab, ctrl+shift+p, f5." + pcNote, { keys: z.string() }, async (a) => { await this.call("pcAction", "key", a); return "Pressed " + a.keys + "."; });

    const teamId = z.string().optional().describe("Team id (default: the team that is building now)");
    tool("vyron_team_status", "Studio team: what each role (Co-Founder, Builder & Modeler, Coder, UI Maker, Money Maker) is doing, their jobs and last update.", { team_id: teamId }, async ({ team_id }) => { await this.state(); return this.call("teamStatus", team_id); });
    tool("vyron_team_message", "Send a message to a role in the studio team (builder, coder, ui, money or cofounder). It reaches them right away, or as soon as their current step ends.", {
      role: z.string(), message: z.string(), team_id: teamId, from: z.string().optional().describe("Your role name, e.g. Coder"),
    }, async ({ role, message, team_id, from }) => { await this.state(); return this.call("teamMessage", team_id, role, message, from); });
    tool("vyron_team_wait", "Wait until roles finish their current work (default: all workers), then return the team status.", {
      roles: z.array(z.string()).optional(), timeout_seconds: z.number().int().min(10).max(900).optional(), team_id: teamId,
    }, async ({ roles, timeout_seconds, team_id }) => { await this.state(); return this.call("teamWait", team_id, roles, timeout_seconds); });

    tool("vyron_setup_status", "First-time setup checklist: Claude, Claude desktop, Claude Code, Roblox Studio, Blender, Roblox account and Discord — which are connected and how to fix the rest.", {}, async () => {
      const s = await this.state();
      return { ...s.setup, studioWindows: s.studios.map((w) => w.name), blender: s.blender, connector: { running: this.status().running, url: this.status().url } };
    });
    tool("vyron_connect_claude_desktop", "Add VYRON to the Claude desktop app's settings (keeps its other connections, makes a backup). The user must quit and reopen Claude desktop afterwards.", {}, async () => {
      await this.state();
      const r = this.setDesktop(true);
      return { connected: r.connected, files: r.files, next: "Tell the user to quit Claude desktop (tray icon → Quit) and open it again at the end." };
    });
    tool("vyron_enable_blender_mcp", "Turn on the MCP server in Blender for good: allows online access, enables the MCP add-on, switches on its Auto Start and saves Blender's preferences (runs Blender invisibly). If it says the add-on isn't installed, install it in Blender first.", {}, async () => {
      await this.state();
      return this.call("enableBlenderMcp");
    });
    tool("vyron_open_blender", "Open Blender (any version the MCP add-on supports — 5.1 or newer today) with the MCP add-on turned on, so it connects to VYRON and Claude by itself. Waits up to 45 seconds and says if it worked.", {}, async () => {
      await this.state();
      return this.call("openBlender");
    });
    tool("vyron_connect_blender", "One step to connect Blender: finds a Blender the MCP add-on supports (5.1 or newer today; VYRON reads the add-on's own version range), turns on its MCP server for good, opens it and waits until it's connected. If it stops, `step` says what's needed: install (get a supported Blender), addon (install the MCP add-on in Blender), extension (turn on the Blender extension in Claude desktop), restart (close Blender, then call again) or start (press Start in the MCP add-on).", {}, async () => {
      await this.state();
      return this.call("connectBlender");
    });
    tool("vyron_open_app", "Open an app on the user's PC, or bring it to the front if it's already open: \"blender\" (the Blender VYRON uses — only versions the MCP add-on supports), \"studio\" (Roblox Studio) or \"claude\" (the Claude desktop app). Use it instead of the Start menu when controlling the PC.", { app: z.enum(["blender", "studio", "claude"]) }, async ({ app }) => {
      await this.state();
      return this.call("openApp", app);
    });
    tool("vyron_check_connections", "Re-check Roblox Studio and Blender right now.", {}, async () => {
      await this.state();
      await this.call("connectStudio").catch(() => {});
      const b = await this.call("checkBlender").catch((e) => ({ error: e.message }));
      const s = await this.state();
      return { studio: { connected: s.studio.status === "connected", windows: s.studios.map((w) => w.name), problem: s.studioError || undefined }, blender: b };
    });

    tool("vyron_submit_review", "When you finish a 3D model, a build, a UI or a set of gamepasses: send the user a picture and a short description and ask if it's OK BEFORE you put it in the game. If the user turned on auto mode for that kind it is approved at once. Make the picture first, e.g. Blender render_viewport_to_path or render_thumbnail_to_path to a .png in the project's reviews folder.", {
      kind: z.enum(["model", "build", "ui", "gamepass"]), title: z.string(), details: z.string().optional().describe("What you made, in a few lines (for gamepasses: names and prices)"),
      image_path: z.string().optional().describe("Full path to a .png/.jpg picture of it"), role: z.string().optional().describe("Your role, e.g. Builder & Modeler"),
    }, async (a) => { await this.state(); return this.call("submitReview", a); });
    tool("vyron_review_wait", "Wait for the user's answer to a review: approved (go ahead and put it in the game) or changes (fix it and submit again).", {
      review_id: z.string(), timeout_seconds: z.number().int().min(5).max(900).optional(),
    }, async ({ review_id, timeout_seconds }) => { await this.state(); return this.call("reviewWait", review_id, timeout_seconds); });

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
          if (out && out.__image) return { content: [{ type: "image", data: out.__image, mimeType: out.mime }, { type: "text", text: out.text }] };
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
          this.seen(req, parsed);
          if (req.method !== "POST") return json(405, { ok: false, error: "Use POST" });
          const server = this.mcpServer();
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
          res.on("close", () => { transport.close(); server.close(); });
          await server.connect(transport);
          await transport.handleRequest(req, res, parsed);
          return;
        }
        const m = url.pathname.match(/^\/rpc\/([a-z_]+)$/);
        if (m) this.seen(req, null);
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

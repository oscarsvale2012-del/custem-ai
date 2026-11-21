// VYRON backend: providers, agents, MCP servers, Roblox projects, the
// task orchestrator, approvals, prompt library and chat. Runs in Electron's
// main process (or in src/devserver.js for browser testing). The renderer only
// ever sees publicState(), which never contains secrets.
const EventEmitter = require("events");
const { Store, uid } = require("./store");
const { makeProvider, ProviderError, PROVIDER_TYPES, CLAUDE_MODELS } = require("./providers");
const { McpManager, PRESETS, slug } = require("./mcp");
const { Workspace } = require("./workspace");
const { lookupGame, parseStudios } = require("./roblox");
const { ROLES, roleNames, systemPrompt, SEED_PROMPTS } = require("./team");
const RA = require("./robloxAccount");
const AN = require("./analytics");

const ACTIVE = ["planning", "in_progress", "testing", "waiting_approval"];
const DONE = ["completed", "failed", "cancelled"];
const PRIORITY = { high: 0, normal: 1, low: 2 };
const now = () => Date.now();
const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");

class Backend extends EventEmitter {
  constructor({ dataDir, encrypt, decrypt, host = {} }) {
    super();
    this.host = host;
    this.store = new Store({ dataDir, encrypt, decrypt }).load();
    this.d = this.store.data;
    this.ws = new Workspace({ dataDir });
    this.mcp = new McpManager({ onChange: () => this.changed(), log: (t, l) => this.log(t, l, "MCP") });
    this.prov = new Map(); // providerId -> { status, kind, error, models }
    this.running = new Map(); // taskId -> { ctrl, agentId }
    this.approvals = new Map();
    this.chatMem = new Map(); // agentId -> neutral messages
    this.studios = [];
    this.studioError = null;
    this.activity = [];
    this._emitT = null;
    this._scheduling = false;
  }

  /* ================= lifecycle ================= */
  async init() {
    if (!this.d.prompts.length) {
      this.d.prompts = SEED_PROMPTS.map(([category, title, body]) => ({ id: uid("prm"), category, title, body, favorite: false, createdAt: now(), updatedAt: now() }));
    }
    this.store.save();
    this.log("VYRON started", "info", "System");
    await Promise.all(this.d.providers.map((p) => this.testProvider(p.id).catch(() => {})));
    for (const s of this.d.mcpServers) if (s.autoConnect) this.connectServer(s.id);
    this._studioTimer = setInterval(() => this.detectStudios(true).catch(() => {}), 15000);
    this._schedTimer = setInterval(() => this.schedule(), 3000);
    this._revTimer = setInterval(() => this.refreshRevenue(false).catch(() => {}), 10 * 60 * 1000);
    this.refreshRevenue(false).catch(() => {});
    this.changed();
  }

  /* ================= Roblox account & revenue ================= */
  async linkRoblox() {
    if (!this.host.robloxLogin) throw new Error("Linking a Roblox account works in the desktop app.");
    await this.host.robloxLogin();
    const me = await RA.whoAmI(this.host.robloxFetch);
    if (!me) throw new Error("Roblox sign-in was not finished.");
    me.avatarUrl = await RA.avatarUrl(me.userId);
    me.linkedAt = now();
    this.d.roblox.account = me;
    this.d.roblox.summaryError = null;
    this.log(`Roblox account @${me.name} linked`, "ok", "Roblox");
    this.save();
    await this.refreshRevenue(true);
    return me;
  }

  async unlinkRoblox() {
    await this.host.robloxLogout?.();
    const name = this.d.roblox.account?.name;
    this.d.roblox = { account: null, history: [], analytics: this.d.roblox.analytics || {}, summary: null, games: [] };
    this.log(`Roblox account${name ? " @" + name : ""} unlinked and signed out`, "info", "Roblox");
    this.save();
  }

  setRobloxApiKey(key) {
    key = String(key || "").trim();
    if (key.length < 20) throw new Error("That doesn't look like an Open Cloud API key");
    this.d.secrets.robloxApiKey = key;
    this.d.roblox.analytics = {};
    this.log("Open Cloud API key saved (encrypted)", "ok", "Roblox");
    this.save();
    this.refreshRevenue(true).catch(() => {});
  }

  clearRobloxApiKey() {
    delete this.d.secrets.robloxApiKey;
    this.d.roblox.analytics = {};
    this.save();
  }

  /** Universes to show analytics for: games of VYRON projects + games the linked account owns. */
  revenueGames() {
    const map = new Map();
    for (const p of this.d.projects) if (p.universeId) map.set(p.universeId, { universeId: p.universeId, name: p.game?.name || p.name, iconUrl: p.game?.iconUrl || null, projectId: p.id });
    for (const g of this.d.roblox.games || []) if (!map.has(g.universeId)) map.set(g.universeId, { ...g, projectId: null });
    return [...map.values()];
  }

  async refreshRevenue(force) {
    if (this._revBusy) return;
    const r = this.d.roblox;
    const key = this.d.secrets.robloxApiKey;
    if (!r.account && !key) return;
    this._revBusy = true;
    this.changed();
    try {
      if (r.account && this.host.robloxFetch) {
        try {
          r.summary = await RA.summary(this.host.robloxFetch, r.account.userId);
          r.summaryError = null;
          r.account.expired = false;
          const day = new Date().toISOString().slice(0, 10);
          r.history = (r.history || []).filter((h) => h.date !== day);
          r.history.push({ date: day, balance: r.summary.balance, pending: r.summary.pending, sales: r.summary.day.sales, incoming: r.summary.day.incoming });
          r.history = r.history.slice(-120);
          r.games = await RA.ownedGames(r.account.userId);
        } catch (e) {
          r.summaryError = e.message;
          if (e.kind === "auth") r.account.expired = true;
          this.log("Robux summary: " + e.message, "warn", "Roblox");
        }
      }
      if (key) {
        r.analytics = r.analytics || {};
        for (const g of this.revenueGames().slice(0, 8)) {
          const old = r.analytics[g.universeId];
          if (!force && old && now() - old.fetchedAt < 15 * 60 * 1000) continue;
          r.analytics[g.universeId] = await AN.gameMetrics(key, g.universeId, 30);
          this.changed();
          if (r.analytics[g.universeId].fatal && /rejected/.test(r.analytics[g.universeId].fatal)) break;
        }
      }
      r.refreshedAt = now();
    } finally {
      this._revBusy = false;
      this.save();
    }
  }

  revenuePublic() {
    const r = this.d.roblox;
    return {
      account: r.account, summary: r.summary || null, summaryError: r.summaryError || null, history: r.history || [],
      games: this.revenueGames(), analytics: r.analytics || {}, hasApiKey: !!this.d.secrets.robloxApiKey,
      busy: !!this._revBusy, refreshedAt: r.refreshedAt || null, canLink: !!this.host.robloxLogin,
    };
  }

  async shutdown() {
    clearInterval(this._studioTimer);
    clearInterval(this._schedTimer);
    clearInterval(this._revTimer);
    for (const r of this.running.values()) r.ctrl.abort();
    for (const a of this.approvals.values()) a.resolve({ approved: false, note: "App closed" });
    await this.mcp.closeAll();
    this.store.saveNow();
  }

  log(text, level = "info", source = "System") {
    this.activity.push({ at: now(), level, source, text: clip(String(text), 600) });
    if (this.activity.length > 300) this.activity.shift();
    this.emit("log", this.activity[this.activity.length - 1]);
    this.changed();
  }

  changed() {
    clearTimeout(this._emitT);
    this._emitT = setTimeout(() => this.emit("state", this.publicState()), 80);
  }

  save() { this.store.save(); this.changed(); }

  /* ================= public state (no secrets) ================= */
  publicState() {
    const s = this.d.settings;
    const active = this.project(s.activeProjectId);
    return {
      settings: s,
      providerTypes: Object.fromEntries(Object.entries(PROVIDER_TYPES).map(([k, v]) => [k, { label: v.label, needsKey: v.needsKey }])),
      roles: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.short])),
      providers: this.d.providers.map((p) => ({ id: p.id, type: p.type, name: p.name, baseURL: p.baseURL, hasKey: !!p.apiKey, ...this.provInfo(p.id) })),
      agents: this.d.agents.map((a) => this.agentPublic(a)),
      mcpServers: this.d.mcpServers.map((m) => this.serverPublic(m)),
      projects: this.d.projects.map((p) => this.projectPublic(p)),
      activeProjectId: active?.id || null,
      studios: this.studios,
      studioError: this.studioError,
      revenue: this.revenuePublic(),
      prompts: this.d.prompts,
      tasks: this.d.tasks.slice(-250).map((t) => ({ ...t, steps: t.steps.slice(-40) })),
      approvals: [...this.approvals.values()].map(({ resolve, ...a }) => a),
      activity: this.activity.slice(-150),
      conversations: Object.fromEntries(Object.entries(this.d.conversations).map(([k, v]) => [k, v.slice(-80)])),
      history: active ? this.ws.history(active, 120).map(({ before, after, ...r }) => ({ ...r, lines: lineDelta(before, after) })) : [],
    };
  }

  provInfo(id) { return this.prov.get(id) || { status: "unknown", error: null, models: [] }; }

  agentStatus(a) {
    if (!a.enabled) return "offline";
    const task = [...this.running.entries()].find(([, r]) => r.agentId === a.id);
    if (task) return "working";
    const p = this.d.providers.find((x) => x.id === a.providerId);
    if (!p) return "disconnected";
    if (a.used >= a.budget || a.outOfCredits) return "tokens";
    const st = this.provInfo(p.id);
    if (st.status === "connected") return "idle";
    if (st.kind === "billing") return "tokens";
    if (st.kind === "connection") return "offline";
    return "disconnected";
  }

  agentPublic(a) {
    const p = this.d.providers.find((x) => x.id === a.providerId);
    const runningTask = [...this.running.entries()].find(([, r]) => r.agentId === a.id)?.[0] || null;
    const st = p ? this.provInfo(p.id) : null;
    return {
      ...a,
      status: this.agentStatus(a),
      providerName: p ? p.name : "(removed)",
      providerType: p?.type || null,
      providerError: st?.status === "error" ? st.error : !p ? "Provider removed" : null,
      currentTaskId: runningTask,
      toolCount: this.toolsFor(null, a, {}).length,
    };
  }

  serverPublic(m) {
    const info = this.mcp.info(m.id);
    return {
      id: m.id, name: m.name, kind: m.kind || "custom", transport: m.transport, command: m.command, args: m.args, url: m.url, cwd: m.cwd || "",
      autoConnect: !!m.autoConnect, description: m.description || "",
      envKeys: Object.keys(m.env || {}), headerKeys: Object.keys(m.headers || {}),
      status: info.status, error: info.error, stderr: info.stderr,
      tools: info.tools.map((t) => ({ name: t.name, title: t.title, description: t.description, readOnly: t.readOnly, destructive: t.destructive, policy: (m.toolPolicies || {})[t.name] || "default", effective: this.toolPolicy(m, t) })),
    };
  }

  projectPublic(p) {
    const studio = this.studioFor(p);
    const tasks = this.d.tasks.filter((t) => t.projectId === p.id);
    const live = tasks.filter((t) => this.running.has(t.id));
    const build = [...tasks].reverse().find((t) => t.kind === "build" && !DONE.includes(t.status)) || [...tasks].reverse().find((t) => t.kind === "build");
    let lastChange = null;
    try { lastChange = this.ws.history(p, 1)[0]?.at || null; } catch { /* no folder */ }
    return {
      ...p,
      studioConnected: !!studio,
      studio,
      activeAgents: [...new Set(live.map((t) => t.agentId).filter(Boolean))],
      currentTask: live[0] ? { id: live[0].id, title: live[0].title, stage: live[0].stage, status: live[0].status } : null,
      build: build ? { id: build.id, title: build.title, status: build.status, progress: build.progress || 0, stage: build.stage } : null,
      lastChange,
    };
  }

  project(id) { return this.d.projects.find((p) => p.id === id) || null; }
  activeProject() { return this.project(this.d.settings.activeProjectId); }

  /* ================= settings ================= */
  saveSettings(patch) {
    const allowed = ["defaultAgentId", "permissionMode", "maxParallel", "animations", "reduceEffects", "accent", "logLevel", "theme"];
    for (const k of allowed) if (k in patch) this.d.settings[k] = patch[k];
    this.d.settings.maxParallel = Math.min(8, Math.max(1, Number(this.d.settings.maxParallel) || 3));
    this.save();
    this.schedule();
  }

  /* ================= providers ================= */
  async addProvider({ type, name, baseURL, apiKey }) {
    if (!PROVIDER_TYPES[type]) throw new Error("Unknown provider type");
    const p = { id: uid("prov"), type, name: (name || PROVIDER_TYPES[type].label).slice(0, 40), baseURL: (baseURL || "").trim(), apiKey: (apiKey || "").trim() };
    this.d.providers.push(p);
    this.log(`Provider "${p.name}" added`, "info", "AI");
    this.save();
    await this.testProvider(p.id);
    if (!this.d.agents.length && this.provInfo(p.id).status === "connected") this.createDefaultTeam(p.id);
    return p.id;
  }

  async updateProvider(id, patch) {
    const p = this.d.providers.find((x) => x.id === id);
    if (!p) throw new Error("Provider not found");
    if (patch.name) p.name = String(patch.name).slice(0, 40);
    if ("baseURL" in patch) p.baseURL = String(patch.baseURL || "").trim();
    if (patch.apiKey) p.apiKey = String(patch.apiKey).trim();
    if (patch.clearKey) p.apiKey = "";
    this.save();
    await this.testProvider(id);
  }

  removeProvider(id) {
    this.d.providers = this.d.providers.filter((p) => p.id !== id);
    this.prov.delete(id);
    this.log("Provider removed — agents using it are now not connected", "warn", "AI");
    this.save();
  }

  async testProvider(id) {
    const p = this.d.providers.find((x) => x.id === id);
    if (!p) throw new Error("Provider not found");
    if (PROVIDER_TYPES[p.type].needsKey && !p.apiKey) {
      this.prov.set(id, { status: "error", kind: "auth", error: "No API key set", models: PROVIDER_TYPES[p.type].defaultModels });
      this.changed();
      return this.prov.get(id);
    }
    this.prov.set(id, { ...this.provInfo(id), status: "checking", error: null });
    this.changed();
    const adapter = makeProvider(p);
    const model = this.d.agents.find((a) => a.providerId === id)?.model;
    try {
      await adapter.test(model);
      const models = await adapter.listModels();
      this.prov.set(id, { status: "connected", kind: null, error: null, models: models.length ? models : PROVIDER_TYPES[p.type].defaultModels, checkedAt: now() });
      for (const a of this.d.agents) if (a.providerId === id) a.outOfCredits = false;
      this.log(`Provider "${p.name}" connected`, "ok", "AI");
    } catch (e) {
      const kind = e instanceof ProviderError ? e.kind : "other";
      this.prov.set(id, { status: "error", kind, error: e.message, models: PROVIDER_TYPES[p.type].defaultModels, checkedAt: now() });
      this.log(`Provider "${p.name}": ${e.message}`, "error", "AI");
    }
    this.save();
    this.schedule();
    return this.prov.get(id);
  }

  /* ================= agents ================= */
  createDefaultTeam(providerId) {
    const p = this.d.providers.find((x) => x.id === providerId);
    const models = this.provInfo(providerId).models;
    const pick = (pref) => (p.type === "anthropic" ? pref : models[0] || "");
    const team = [
      ["Atlas", "Lead Developer", "claude-opus-5-5", 2000000],
      ["Forge", "Luau Developer", "claude-opus-5-5", 2000000],
      ["Iris", "UI/UX Designer", "claude-sonnet-5-5", 1500000],
      ["Nova", "Game Designer", "claude-sonnet-5-5", 800000],
      ["Trace", "Debugger", "claude-sonnet-5-5", 1000000],
      ["Sage", "Code Reviewer", "claude-opus-5-5", 1000000],
    ];
    for (const [name, role, model, budget] of team) this.addAgent({ name, role, providerId, model: pick(model), budget }, true);
    this.log("Created the default team of 6 agents", "ok", "AI");
    this.save();
  }

  addAgent(a, quiet) {
    if (!this.d.providers.some((p) => p.id === a.providerId)) throw new Error("Choose a connected AI provider first");
    const agent = {
      id: uid("agent"),
      name: String(a.name || "Agent").slice(0, 24),
      providerId: a.providerId,
      model: String(a.model || "").trim() || CLAUDE_MODELS[0],
      role: ROLES[a.role] ? a.role : "Luau Developer",
      budget: Math.max(20000, Number(a.budget) || 1000000),
      used: 0,
      enabled: true,
      instructions: String(a.instructions || "").slice(0, 4000),
      tools: { files: true, mcp: {} },
      createdAt: now(),
    };
    this.d.agents.push(agent);
    if (!quiet) { this.log(`Agent ${agent.name} (${agent.role}) added`, "info", "AI"); this.save(); this.schedule(); }
    return agent.id;
  }

  updateAgent(id, patch) {
    const a = this.d.agents.find((x) => x.id === id);
    if (!a) throw new Error("Agent not found");
    if (patch.name) a.name = String(patch.name).slice(0, 24);
    if (patch.role && ROLES[patch.role]) a.role = patch.role;
    if (patch.providerId && this.d.providers.some((p) => p.id === patch.providerId)) a.providerId = patch.providerId;
    if (patch.model) a.model = String(patch.model).trim();
    if (patch.budget) a.budget = Math.max(20000, Number(patch.budget));
    if ("instructions" in patch) a.instructions = String(patch.instructions || "").slice(0, 4000);
    if (patch.tools) a.tools = { files: patch.tools.files !== false, mcp: patch.tools.mcp || {} };
    this.save();
    this.schedule();
  }

  removeAgent(id) {
    for (const [tid, r] of this.running) if (r.agentId === id) this.cancelTask(tid);
    this.d.agents = this.d.agents.filter((a) => a.id !== id);
    if (this.d.settings.defaultAgentId === id) this.d.settings.defaultAgentId = null;
    this.save();
  }

  async agentAction(id, act) {
    const a = this.d.agents.find((x) => x.id === id);
    if (!a) throw new Error("Agent not found");
    if (act === "enable") a.enabled = true;
    if (act === "disable") { a.enabled = false; for (const [tid, r] of this.running) if (r.agentId === id) this.cancelTask(tid); }
    if (act === "reset_budget") { a.used = 0; a.outOfCredits = false; this.log(`${a.name}: token usage reset`, "ok", "AI"); }
    if (act === "reconnect") await this.testProvider(a.providerId);
    this.save();
    this.schedule();
  }

  /* ================= MCP servers ================= */
  async addServer(cfg) {
    const base = cfg.preset ? PRESETS[cfg.preset]?.() : null;
    if (cfg.preset && !base) throw new Error("Unknown preset");
    if (base?.kind === "roblox-studio" && this.d.mcpServers.some((s) => s.kind === "roblox-studio")) throw new Error("Roblox Studio is already added");
    const s = {
      id: uid("mcp"),
      ...(base || {
        name: String(cfg.name || "MCP server").slice(0, 40), kind: "custom", transport: cfg.transport === "http" || cfg.transport === "sse" ? cfg.transport : "stdio",
        command: String(cfg.command || "").trim(), args: parseArgs(cfg.args), url: String(cfg.url || "").trim(), cwd: String(cfg.cwd || "").trim(),
        env: {}, headers: {}, autoConnect: cfg.autoConnect !== false, description: "",
      }),
      toolPolicies: {},
    };
    applySecretEdits(s, cfg);
    this.d.mcpServers.push(s);
    this.log(`MCP server "${s.name}" added`, "info", "MCP");
    this.save();
    await this.connectServer(s.id);
    return s.id;
  }

  async updateServer(id, cfg) {
    const s = this.d.mcpServers.find((x) => x.id === id);
    if (!s) throw new Error("Server not found");
    if (cfg.name) s.name = String(cfg.name).slice(0, 40);
    if (cfg.transport) s.transport = cfg.transport;
    if ("command" in cfg) s.command = String(cfg.command || "").trim();
    if ("args" in cfg) s.args = parseArgs(cfg.args);
    if ("url" in cfg) s.url = String(cfg.url || "").trim();
    if ("cwd" in cfg) s.cwd = String(cfg.cwd || "").trim();
    if ("autoConnect" in cfg) s.autoConnect = !!cfg.autoConnect;
    applySecretEdits(s, cfg);
    this.save();
    await this.connectServer(id);
  }

  async removeServer(id) {
    await this.mcp.disconnect(id);
    this.d.mcpServers = this.d.mcpServers.filter((s) => s.id !== id);
    for (const a of this.d.agents) if (a.tools?.mcp) delete a.tools.mcp[id];
    this.save();
  }

  async connectServer(id) {
    const s = this.d.mcpServers.find((x) => x.id === id);
    if (!s) throw new Error("Server not found");
    const r = await this.mcp.connect(s);
    if (s.kind === "roblox-studio" && r.status === "connected") this.detectStudios(true).catch(() => {});
    return r;
  }
  async disconnectServer(id) { await this.mcp.disconnect(id); this.changed(); }
  async refreshServer(id) { const s = this.d.mcpServers.find((x) => x.id === id); if (!s) throw new Error("Server not found"); return this.mcp.refresh(s); }

  setToolPolicy(serverId, tool, policy) {
    const s = this.d.mcpServers.find((x) => x.id === serverId);
    if (!s) throw new Error("Server not found");
    s.toolPolicies = s.toolPolicies || {};
    if (policy === "default") delete s.toolPolicies[tool];
    else if (["auto", "ask", "off"].includes(policy)) s.toolPolicies[tool] = policy;
    this.save();
  }

  /** auto = runs without asking, ask = needs approval, off = hidden from agents. */
  toolPolicy(server, tool) {
    const o = (server.toolPolicies || {})[tool.name];
    if (o) return o;
    const mode = this.d.settings.permissionMode;
    if (tool.readOnly) return "auto";
    if (mode === "autonomous" && !tool.destructive) return "auto";
    return "ask";
  }

  /* ================= Roblox Studio + projects ================= */
  studioServer() {
    const s = this.d.mcpServers.find((x) => x.kind === "roblox-studio") ||
      this.d.mcpServers.find((x) => this.mcp.info(x.id).tools.some((t) => t.name === "list_roblox_studios"));
    return s && this.mcp.info(s.id).status === "connected" ? s : null;
  }

  studioFor(p) {
    if (!p) return null;
    return this.studios.find((s) => (p.studioId && s.id === p.studioId) || (p.universeId && s.universeId && s.universeId === p.universeId) || (p.placeId && s.placeId && s.placeId === p.placeId && p.placeId !== "0")) || null;
  }

  async detectStudios(quiet) {
    const s = this.studioServer();
    if (!s) {
      this.studios = [];
      this.studioError = this.d.mcpServers.some((x) => x.kind === "roblox-studio") ? "Roblox Studio MCP server is not connected" : "Add the Roblox Studio MCP server on the MCP Servers page";
      this.changed();
      if (!quiet) throw new Error(this.studioError);
      return [];
    }
    try {
      const r = await this.mcp.call(s.id, "list_roblox_studios", {});
      if (r.isError) throw new Error(r.text);
      this.studios = parseStudios(r.text);
      this.studioError = this.studios.length ? null : "No Roblox Studio window is connected. Open your place in Studio and turn on its MCP connection.";
      // keep linked projects pointing at the right Studio window
      for (const p of this.d.projects) { const st = this.studioFor(p); if (st) p.studioId = st.id; }
    } catch (e) {
      this.studioError = e.message;
      if (!quiet) throw e;
    }
    this.changed();
    return this.studios;
  }

  async addProject({ name, rojoDir, placeId, universeId, studioId }) {
    const studio = studioId ? this.studios.find((s) => s.id === studioId) : null;
    const p = {
      id: uid("proj"), name: String(name || studio?.name || "My Roblox game").slice(0, 60), rojoDir: String(rojoDir || "").trim(),
      placeId: String(placeId || studio?.placeId || "").trim(), universeId: String(universeId || studio?.universeId || "").trim(),
      studioId: studio?.id || null, game: null, gameError: null, createdAt: now(), lastActivity: null,
    };
    this.d.projects.push(p);
    if (!this.d.settings.activeProjectId) this.d.settings.activeProjectId = p.id;
    this.save();
    await this.refreshGame(p.id);
    return p.id;
  }

  async updateProject(id, patch) {
    const p = this.project(id);
    if (!p) throw new Error("Project not found");
    if (patch.name) p.name = String(patch.name).slice(0, 60);
    if ("rojoDir" in patch) p.rojoDir = String(patch.rojoDir || "").trim();
    const idChanged = ("placeId" in patch && patch.placeId !== p.placeId) || ("universeId" in patch && patch.universeId !== p.universeId);
    if ("placeId" in patch) p.placeId = String(patch.placeId || "").trim();
    if ("universeId" in patch) p.universeId = String(patch.universeId || "").trim();
    if ("studioId" in patch) {
      const st = this.studios.find((s) => s.id === patch.studioId);
      p.studioId = st?.id || null;
      if (st) { if (st.placeId) p.placeId = st.placeId; if (st.universeId) p.universeId = st.universeId; }
    }
    this.save();
    if (idChanged || "studioId" in patch) await this.refreshGame(id);
  }

  removeProject(id) {
    this.d.projects = this.d.projects.filter((p) => p.id !== id);
    if (this.d.settings.activeProjectId === id) this.d.settings.activeProjectId = this.d.projects[0]?.id || null;
    this.save();
  }

  setActiveProject(id) {
    if (!this.project(id)) throw new Error("Project not found");
    this.d.settings.activeProjectId = id;
    this.log(`Switched to project "${this.project(id).name}"`, "info", "Projects");
    this.save();
  }

  async refreshGame(id) {
    const p = this.project(id);
    if (!p) return;
    if (!p.placeId && !p.universeId) { p.game = null; p.gameError = null; this.save(); return; }
    try {
      p.game = await lookupGame({ universeId: p.universeId, placeId: p.placeId });
      p.universeId = p.game.universeId;
      if (!p.placeId) p.placeId = p.game.placeId;
      p.gameError = null;
      if (!p.name || p.name === "My Roblox game") p.name = p.game.name;
      this.log(`Loaded game info for "${p.game.name}"`, "ok", "Roblox");
    } catch (e) {
      p.gameError = e.message;
      this.log(`Game info: ${e.message}`, "warn", "Roblox");
    }
    this.save();
  }

  listFiles(projectId) { const p = this.project(projectId); if (!p) throw new Error("Project not found"); return this.ws.list(p); }
  readFile(projectId, rel) { const p = this.project(projectId); if (!p) throw new Error("Project not found"); return this.ws.read(p, rel); }
  getChange(projectId, changeId) { const p = this.project(projectId); return p ? this.ws.history(p, 100000).find((r) => r.id === changeId) || null : null; }
  undoChange(projectId, changeId) {
    const p = this.project(projectId);
    if (!p) throw new Error("Project not found");
    const rec = this.ws.undo(p, changeId);
    this.log(`Undid change to ${rec.path}`, "ok", "History");
    this.changed();
  }
  snapshotProject(projectId) {
    const p = this.project(projectId);
    if (!p) throw new Error("Project not found");
    const r = this.ws.snapshot(p, "manual");
    this.log(`Snapshot saved (${r.files} files)`, "ok", "History");
    return r;
  }

  /* ================= prompts ================= */
  savePrompt(p) {
    if (p.id) {
      const x = this.d.prompts.find((q) => q.id === p.id);
      if (!x) throw new Error("Prompt not found");
      Object.assign(x, { title: String(p.title || x.title).slice(0, 120), body: String(p.body ?? x.body), category: p.category || x.category, updatedAt: now() });
    } else {
      this.d.prompts.unshift({ id: uid("prm"), title: String(p.title || "Untitled").slice(0, 120), body: String(p.body || ""), category: p.category || "Scripting", favorite: false, createdAt: now(), updatedAt: now() });
    }
    this.save();
  }
  deletePrompt(id) { this.d.prompts = this.d.prompts.filter((p) => p.id !== id); this.save(); }
  toggleFavorite(id) { const p = this.d.prompts.find((q) => q.id === id); if (p) p.favorite = !p.favorite; this.save(); }

  /** Expand a short idea into a detailed development prompt using a connected agent. */
  async improvePrompt(text, agentId, research) {
    const agent = this.pickAgentForUtility(agentId);
    const p = this.d.providers.find((x) => x.id === agent.providerId);
    const adapter = makeProvider(p);
    const project = this.activeProject();
    const system = `You turn short Roblox game ideas into detailed, well-structured development prompts for a team of AI developers.
Write the prompt with these sections: Goal, Features, Systems (name each script/module and where it goes: ServerScriptService, ReplicatedStorage, StarterPlayerScripts, StarterGui, ServerStorage), UI requirements (premium, clean, consistent; animations), Data & security (server validation, DataStore), Acceptance criteria, Implementation steps.
${research ? "Use web search to check current Roblox documentation (create.roblox.com/docs) for the APIs involved. Mark facts you verified as 'Verified:' with the source URL, and your own ideas as 'Suggestion:'." : "Mark anything that is your own idea rather than something the user said as 'Suggestion:'."}
${project?.game ? `The game is "${project.game.name}".` : ""}
Reply with the finished prompt only.`;
    const tools = research && p.type === "anthropic" ? [{ server: { type: "web_search_20260209", name: "web_search", max_uses: 5 } }] : [];
    const messages = [{ role: "user", content: [{ type: "text", text }] }];
    let out = "";
    for (let i = 0; i < 4; i++) {
      const res = await adapter.chat({ model: agent.model, system, messages, tools: tools.map((t) => t.server ? { ...t } : t), effort: "medium" });
      this.addUsage(agent, res.usage);
      out += res.blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
      if (res.stop !== "pause") break;
      messages.push({ role: "assistant", content: res.blocks, raw: res.raw, rawProvider: res.rawProvider });
    }
    return out.trim();
  }

  pickAgentForUtility(agentId) {
    const usable = (a) => a && ["idle", "working"].includes(this.agentStatus(a));
    const a = this.d.agents.find((x) => x.id === agentId);
    if (usable(a)) return a;
    const d = this.d.agents.find((x) => x.id === this.d.settings.defaultAgentId);
    if (usable(d)) return d;
    const any = this.d.agents.find(usable);
    if (!any) throw new Error("No connected agent is available. Connect a provider on the AI Agents page.");
    return any;
  }

  addUsage(agent, u) {
    agent.used += (u?.input || 0) + (u?.output || 0);
    this.store.save();
  }

  /* ================= tasks ================= */
  newTask(t) {
    const task = {
      id: uid("task"), kind: "task", title: "Task", description: "", agentId: null, role: null, status: "pending", priority: "normal",
      deps: [], parentId: null, projectId: this.d.settings.activeProjectId, result: null, error: null, notes: [], steps: [], changes: [],
      stage: "", progress: 0, createdAt: now(), startedAt: null, finishedAt: null, agentPool: null, ...t,
    };
    this.d.tasks.push(task);
    return task;
  }

  /** Big request → planning by the Lead Developer → sub-tasks → review. */
  build(request, opts = {}) {
    request = String(request || "").trim();
    if (!request) throw new Error("Describe what you want to build");
    if (!this.activeProject()) throw new Error("Select or create a project first (Projects page)");
    const t = this.newTask({ kind: "build", title: clip(request.split("\n")[0], 90), description: request, role: "Lead Developer", priority: opts.priority || "normal", agentPool: opts.agentIds?.length ? opts.agentIds : null, stage: "Waiting for the Lead Developer" });
    this.log(`New build: ${t.title}`, "info", "Tasks");
    this.save();
    this.schedule();
    return t.id;
  }

  createTask({ title, description, agentId, role, priority, deps }) {
    if (!String(description || "").trim()) throw new Error("Describe the task");
    const t = this.newTask({ title: clip(title || description.split("\n")[0], 90), description, agentId: agentId || null, role: role || null, priority: priority || "normal", deps: deps || [] });
    this.log(`New task: ${t.title}`, "info", "Tasks");
    this.save();
    this.schedule();
    return t.id;
  }

  cancelTask(id) {
    const t = this.d.tasks.find((x) => x.id === id);
    if (!t) return;
    const kids = this.d.tasks.filter((x) => x.parentId === id);
    for (const k of kids) this.cancelTask(k.id);
    this.running.get(id)?.ctrl.abort();
    for (const a of this.approvals.values()) if (a.taskId === id) a.resolve({ approved: false, note: "Task cancelled" });
    if (!DONE.includes(t.status) && !this.running.has(id)) { t.status = "cancelled"; t.finishedAt = now(); t.error = "Cancelled by you"; }
    this.save();
  }

  retryTask(id) {
    const t = this.d.tasks.find((x) => x.id === id);
    if (!t || !DONE.includes(t.status)) throw new Error("Only finished, failed or cancelled tasks can be retried");
    if (t.kind === "build" && this.d.tasks.some((x) => x.parentId === id)) {
      // retry the failed parts of the build, keep what was completed
      for (const k of this.d.tasks.filter((x) => x.parentId === id && ["failed", "cancelled"].includes(x.status))) Object.assign(k, { status: "pending", error: null, finishedAt: null, stage: "Retrying" });
      Object.assign(t, { status: "in_progress", error: null, finishedAt: null });
    } else Object.assign(t, { status: "pending", error: null, result: null, finishedAt: null, stage: "Retrying" });
    this.log(`Retrying: ${t.title}`, "info", "Tasks");
    this.save();
    this.schedule();
  }

  clearFinishedTasks() {
    const keep = new Set(this.d.tasks.filter((t) => !DONE.includes(t.status)).map((t) => t.parentId).filter(Boolean));
    this.d.tasks = this.d.tasks.filter((t) => !DONE.includes(t.status) || keep.has(t.id) || keep.has(t.parentId));
    this.save();
  }

  resolveApproval(id, approved, note) {
    const a = this.approvals.get(id);
    if (!a) throw new Error("This approval is no longer waiting");
    a.resolve({ approved: !!approved, note: note || "" });
  }

  isAvailable(a) { return a.enabled && this.agentStatus(a) === "idle"; }

  chooseAgent(task) {
    const pool = task.agentPool ? this.d.agents.filter((a) => task.agentPool.includes(a.id)) : this.d.agents;
    const free = pool.filter((a) => this.isAvailable(a));
    if (task.agentId) return free.find((a) => a.id === task.agentId) || null;
    return free.find((a) => a.role === task.role) || free.find((a) => a.role === "Lead Developer" && task.role !== "Lead Developer") || (task.role ? free[0] : free.find((a) => a.id === this.d.settings.defaultAgentId) || free[0]) || null;
  }

  schedule() {
    if (this._scheduling) return;
    this._scheduling = true;
    try {
      const limit = this.d.settings.maxParallel || 3;
      const pending = this.d.tasks.filter((t) => t.status === "pending").sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || a.createdAt - b.createdAt);
      for (const t of pending) {
        if (this.running.size >= limit) break;
        const deps = t.deps.map((d) => this.d.tasks.find((x) => x.id === d)).filter(Boolean);
        if (deps.some((d) => d.status !== "completed")) {
          const bad = deps.find((d) => ["failed", "cancelled"].includes(d.status));
          t.stage = bad ? `Blocked: "${clip(bad.title, 40)}" ${bad.status}` : "Waiting for earlier tasks";
          continue;
        }
        const agent = this.chooseAgent(t);
        if (!agent) { t.stage = t.agentId ? "Waiting for the chosen agent" : "Waiting for a free, connected agent"; continue; }
        this.startTask(t, agent);
      }
    } finally {
      this._scheduling = false;
      this.changed();
    }
  }

  startTask(task, agent) {
    const ctrl = new AbortController();
    this.running.set(task.id, { ctrl, agentId: agent.id });
    task.agentId = agent.id;
    task.status = task.kind === "build" ? "planning" : task.kind === "review" ? "testing" : "in_progress";
    task.startedAt = now();
    task.stage = task.kind === "build" ? "Analyzing the request and the project" : "Starting";
    const project = this.project(task.projectId);
    if (project) project.lastActivity = now();
    this.log(`${agent.name} started: ${task.title}`, "info", agent.name);
    this.changed();
    this.execute(task, agent, ctrl).catch((e) => this.log("Internal error: " + e.message, "error", "System"));
  }

  async execute(task, agent, ctrl) {
    const project = this.project(task.projectId);
    let plan = null;
    try {
      const planning = task.kind === "build";
      const tools = this.toolsFor(task, agent, { planning, onPlan: (p) => (plan = p), signal: ctrl.signal });
      const system = systemPrompt({ agent, project, studio: this.studioFor(project), toolsNote: this.toolsNote(tools) });
      let messages;
      if (task.kind === "chat") {
        messages = this.chatMem.get(agent.id) || [];
        messages.push({ role: "user", content: [{ type: "text", text: task.description }] });
        this.chatMem.set(agent.id, messages);
      } else messages = [{ role: "user", content: [{ type: "text", text: this.taskBrief(task, planning) }] }];

      const text = await this.loop({ task, agent, system, messages, tools, signal: ctrl.signal, stopWhen: () => planning && plan });
      if (planning) {
        if (plan) this.applyPlan(task, plan);
        else {
          // No plan submitted: the lead handled it directly.
          task.result = text; task.status = "completed"; task.progress = 1;
        }
      } else {
        task.result = text || "(no report)";
        task.status = "completed";
        task.progress = 1;
      }
      if (task.kind === "chat") this.pushChat(agent.id, { role: "assistant", text: text || "(done)", taskId: task.id, changes: task.changes });
      this.log(`${agent.name} finished: ${task.title}`, "ok", agent.name);
    } catch (e) {
      const aborted = ctrl.signal.aborted || e?.kind === "aborted";
      task.status = aborted ? "cancelled" : "failed";
      task.error = aborted ? "Cancelled by you" : e.message;
      if (e instanceof ProviderError) this.noteProviderError(agent, e);
      if (task.kind === "chat") this.pushChat(agent.id, { role: "error", text: task.error, taskId: task.id });
      this.log(`${agent.name}: ${task.title} — ${task.error}`, aborted ? "warn" : "error", agent.name);
    } finally {
      task.finishedAt = now();
      if (!["planning"].includes(task.status)) task.stage = task.status === "completed" ? "Done" : task.stage;
      this.running.delete(task.id);
      this.ws.releaseTask(task.id);
      if (task.parentId) this.updateParent(task.parentId);
      this.save();
      this.schedule();
    }
  }

  noteProviderError(agent, e) {
    const p = this.d.providers.find((x) => x.id === agent.providerId);
    if (!p) return;
    if (e.kind === "billing") agent.outOfCredits = true;
    if (["auth", "connection", "billing", "not_found"].includes(e.kind)) this.prov.set(p.id, { ...this.provInfo(p.id), status: e.kind === "billing" ? "connected" : "error", kind: e.kind, error: e.message });
  }

  taskBrief(task, planning) {
    const parent = task.parentId ? this.d.tasks.find((t) => t.id === task.parentId) : null;
    const deps = task.deps.map((id) => this.d.tasks.find((t) => t.id === id)).filter(Boolean);
    const parts = [];
    if (planning) {
      parts.push(
        "The user wants this built in their Roblox game:",
        task.description,
        "",
        "Plan it:",
        "1. Inspect the project first (files, and Studio if connected) and look for systems you can reuse.",
        "2. Work out which systems are needed and how they connect (module names, RemoteEvents, data).",
        "3. Call submit_plan with focused tasks for the specialists. Each task must say exactly which files/instances to create or change and which interfaces to use, so agents working in parallel don't collide. Use depends_on when a task needs another one's result. Keep it to the tasks that are really needed (usually 3–8).",
        "Do not write game code yourself in this step."
      );
    } else {
      if (parent) parts.push(`This task is part of a bigger request: "${clip(parent.description, 1500)}"`, parent.notes.length ? "Team notes so far:\n" + parent.notes.map((n) => `- ${n.agent}: ${n.text}`).join("\n") : "", "");
      parts.push(`Your task: ${task.title}`, task.description);
      if (deps.length) parts.push("", "Results from the tasks this depends on:", ...deps.map((d) => `### ${d.title} (by ${this.agentName(d.agentId)})\n${clip(d.result, 3000)}`));
      if (task.kind === "review") {
        const changes = this.d.tasks.filter((t) => t.parentId === task.parentId).flatMap((t) => t.changes.map((c) => c.path));
        parts.push("", "Files changed in this build:", [...new Set(changes)].join("\n") || "(none recorded)",
          "Review them: read each one, check they work together, fix clear bugs. If Roblox Studio is connected, test: start play mode, read the console output for errors, stop play mode, and fix problems you find. Then write the final report for the user: what was built, the files, how to test it, and anything left.");
      }
    }
    return parts.filter((x) => x !== "").join("\n");
  }

  applyPlan(parent, plan) {
    const keyToId = {};
    const kids = [];
    for (const p of plan.tasks) {
      const t = this.newTask({ parentId: parent.id, projectId: parent.projectId, title: clip(p.title, 90), description: p.description, role: ROLES[p.role] ? p.role : "Luau Developer", priority: ["low", "normal", "high"].includes(p.priority) ? p.priority : "normal", agentPool: parent.agentPool });
      keyToId[p.key] = t.id;
      kids.push([t, p]);
    }
    for (const [t, p] of kids) t.deps = (p.depends_on || []).map((k) => keyToId[k]).filter(Boolean);
    const hasReviewer = this.d.agents.some((a) => a.role === "Code Reviewer" && a.enabled);
    this.newTask({ parentId: parent.id, projectId: parent.projectId, kind: "review", title: "Review, test and report", description: "Review all work from this build, test it where possible, fix problems and report to the user.", role: hasReviewer ? "Code Reviewer" : "Lead Developer", deps: kids.map(([t]) => t.id), agentPool: parent.agentPool });
    parent.plan = plan.summary;
    parent.status = "in_progress";
    parent.stage = `Plan ready: ${kids.length} tasks + review`;
    parent.progress = 0.05;
    this.log(`Plan for "${parent.title}": ${kids.length} tasks`, "ok", this.agentName(parent.agentId));
  }

  updateParent(id) {
    const p = this.d.tasks.find((t) => t.id === id);
    if (!p) return;
    const kids = this.d.tasks.filter((t) => t.parentId === id);
    if (!kids.length) return;
    const done = kids.filter((k) => k.status === "completed").length;
    p.progress = 0.05 + 0.95 * (done / kids.length);
    const live = kids.filter((k) => ACTIVE.includes(k.status));
    p.stage = live.length ? live.map((k) => `${this.agentName(k.agentId)}: ${k.title}`).join(" · ") : `${done}/${kids.length} tasks done`;
    if (done === kids.length) {
      p.status = "completed";
      p.result = kids.find((k) => k.kind === "review")?.result || kids.map((k) => `${k.title}: ${clip(k.result, 300)}`).join("\n");
      p.finishedAt = now();
      p.stage = "Done";
      this.log(`Build finished: ${p.title}`, "ok", "Tasks");
    } else if (!kids.some((k) => k.status === "pending" || ACTIVE.includes(k.status))) {
      p.status = "failed";
      p.error = kids.filter((k) => k.status !== "completed").map((k) => `${k.title}: ${k.error || k.status}`).join("\n");
      p.finishedAt = now();
    } else if (p.status !== "in_progress") p.status = "in_progress";
    p.changes = kids.flatMap((k) => k.changes);
  }

  agentName(id) { return this.d.agents.find((a) => a.id === id)?.name || "Agent"; }

  /* ================= agent loop ================= */
  async loop({ task, agent, system, messages, tools, signal, stopWhen }) {
    const provider = this.d.providers.find((p) => p.id === agent.providerId);
    if (!provider) throw new ProviderError("auth", "This agent's provider was removed");
    const adapter = makeProvider(provider);
    const byName = new Map(tools.map((t) => [t.name, t]));
    let lastText = "";
    for (let step = 0; step < 50; step++) {
      if (signal.aborted) throw new ProviderError("aborted", "stopped");
      if (agent.used >= agent.budget) throw new ProviderError("budget", `${agent.name} used up its token budget`);
      const res = await adapter.chat({ model: agent.model, system, messages, tools: tools.map(({ name, description, schema }) => ({ name, description, schema })), signal });
      this.addUsage(agent, res.usage);
      messages.push({ role: "assistant", content: res.blocks, raw: res.raw, rawProvider: res.rawProvider });
      const text = res.blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (text) { lastText = text; this.step(task, text); }
      if (res.stop === "refusal") throw new Error("The model declined this request");
      if (res.stop === "pause") continue;
      const uses = res.blocks.filter((b) => b.type === "tool_use");
      if (!uses.length) {
        if (res.stop === "max_tokens") throw new Error("The reply was cut off because it was too long. Split the task into smaller parts.");
        return lastText;
      }
      if (res.stop === "max_tokens") throw new Error("A tool call was cut off because the reply was too long. Retry with a smaller task.");
      const results = [];
      for (const u of uses) {
        const tool = byName.get(u.name);
        let content, isError = false;
        if (!tool) { content = `Unknown tool ${u.name}`; isError = true; }
        else if (!u.input || typeof u.input !== "object" || u.input.__invalid_json !== undefined) { content = "Invalid tool input (not a JSON object). Try again."; isError = true; }
        else {
          try { content = await tool.run(u.input); } catch (e) { content = String(e.message || e); isError = true; }
        }
        if (isError) this.step(task, `⚠ ${u.name}: ${clip(content, 160)}`);
        results.push({ type: "tool_result", tool_use_id: u.id, content: String(content ?? ""), ...(isError ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
      if (stopWhen && stopWhen()) return lastText;
    }
    throw new Error("Stopped after 50 steps without finishing");
  }

  step(task, text) {
    task.steps.push({ at: now(), text: clip(text, 1200) });
    if (task.steps.length > 200) task.steps.shift();
    this.changed();
  }

  pushChat(agentId, m) {
    const c = (this.d.conversations[agentId] = this.d.conversations[agentId] || []);
    c.push({ at: now(), ...m });
    if (c.length > 200) c.splice(0, c.length - 200);
    this.save();
  }

  sendChat({ agentIds, text }) {
    text = String(text || "").trim();
    if (!text) return;
    const ids = (agentIds || []).filter((id) => this.d.agents.some((a) => a.id === id));
    if (!ids.length) throw new Error("Select an agent to talk to");
    for (const id of ids) {
      this.pushChat(id, { role: "user", text });
      this.newTask({ kind: "chat", title: "Chat: " + clip(text, 70), description: text, agentId: id, priority: "high" });
    }
    this.save();
    this.schedule();
  }

  clearChat(agentId) { delete this.d.conversations[agentId]; this.chatMem.delete(agentId); this.save(); }

  /* ================= tools ================= */
  async approve(task, agent, kind, title, detail) {
    const id = uid("apr");
    const prev = task.status;
    task.status = "waiting_approval";
    task.stage = "Waiting for your approval: " + title;
    this.log(`${agent.name} asks to: ${title}`, "warn", agent.name);
    const result = await new Promise((resolve) => {
      this.approvals.set(id, { id, taskId: task.id, agentId: agent.id, agentName: agent.name, kind, title, detail, at: now(), projectId: task.projectId, resolve });
      this.changed();
    });
    this.approvals.delete(id);
    if (task.status === "waiting_approval") task.status = prev;
    task.stage = result.approved ? "Approved: " + title : "Rejected: " + title;
    this.log(`${result.approved ? "Approved" : "Rejected"}: ${title}`, result.approved ? "ok" : "warn", "You");
    this.changed();
    return result;
  }

  toolsNote(tools) {
    const mcp = tools.filter((t) => t.mcp).map((t) => t.name);
    return mcp.length ? `\nMCP tools available to you: ${mcp.join(", ")}` : "";
  }

  /** Tools an agent can use for a task. With task=null returns the list for display only. */
  toolsFor(task, agent, { planning, onPlan, signal } = {}) {
    const tools = [];
    const project = task ? this.project(task.projectId) : this.activeProject();
    const mode = this.d.settings.permissionMode;
    const ctx = () => ({ taskId: task?.id, agent: agent.name, task: task?.title });
    const obj = (props, req) => ({ type: "object", properties: props, required: req || Object.keys(props), additionalProperties: false });

    if (project?.rojoDir && agent.tools?.files !== false) {
      tools.push(
        { name: "list_project_files", description: "List files in the Rojo project folder (optionally a subfolder).", schema: obj({ dir: { type: "string", description: "Subfolder, e.g. 'src' or '.'" } }, []),
          run: async (i) => this.ws.list(project, i.dir || ".").map((f) => f.path).join("\n") || "(no files yet)" },
        { name: "read_file", description: "Read a file from the project folder.", schema: obj({ path: { type: "string" } }),
          run: async (i) => { const c = this.ws.read(project, i.path); return c === null ? "File does not exist." : c; } },
        { name: "search_project", description: "Search all project scripts for text (case-insensitive). Returns file:line matches.", schema: obj({ query: { type: "string" } }),
          run: async (i) => this.ws.search(project, i.query).join("\n") || "No matches." },
      );
      if (!planning) {
        tools.push(
          { name: "write_file", description: "Create or overwrite a file in the project folder (whole file contents). Read existing files first.", schema: obj({ path: { type: "string" }, content: { type: "string" } }),
            run: async (i) => {
              if (typeof i.content !== "string" || !i.path) throw new Error("path and content are required");
              this.ws.lock(project, i.path, task.id, agent.name);
              const before = this.ws.read(project, i.path);
              if (before === i.content) return "No change (file already has this content).";
              if (mode === "ask_all") {
                const r = await this.approve(task, agent, "write", `${before === null ? "Create" : "Edit"} ${i.path}`, { path: i.path, before, after: i.content });
                if (!r.approved) return `The user rejected this change.${r.note ? " Their note: " + r.note : ""} Do not retry the same change.`;
              }
              const rec = this.ws.write(project, i.path, i.content, ctx());
              task.changes.push({ id: rec.id, path: rec.path, op: before === null ? "create" : "edit" });
              this.step(task, `${before === null ? "Created" : "Edited"} ${i.path}`);
              return before === null ? "Created." : "Saved (previous version kept in history).";
            } },
          { name: "delete_file", description: "Delete a file from the project folder. Always asks the user first.", schema: obj({ path: { type: "string" }, reason: { type: "string" } }),
            run: async (i) => {
              this.ws.lock(project, i.path, task.id, agent.name);
              const before = this.ws.read(project, i.path);
              if (before === null) return "File does not exist.";
              const r = await this.approve(task, agent, "delete", `Delete ${i.path}`, { path: i.path, before, after: null, reason: i.reason });
              if (!r.approved) return "The user rejected deleting this file.";
              const rec = this.ws.remove(project, i.path, ctx());
              task.changes.push({ id: rec.id, path: rec.path, op: "delete" });
              return "Deleted (a backup is kept in history).";
            } },
        );
      }
    }

    if (task) {
      tools.push(
        { name: "read_task_board", description: "See what the other agents on this request are doing, their results and team notes.", schema: obj({}, []),
          run: async () => {
            const sib = task.parentId ? this.d.tasks.filter((t) => t.parentId === task.parentId) : this.d.tasks.filter((t) => ACTIVE.includes(t.status));
            const parent = task.parentId ? this.d.tasks.find((t) => t.id === task.parentId) : null;
            return [
              ...sib.map((t) => `[${t.status}] ${t.title} — ${this.agentName(t.agentId)}${t.result ? "\n  result: " + clip(t.result, 400) : ""}`),
              parent?.notes.length ? "\nNotes:\n" + parent.notes.map((n) => `- ${n.agent}: ${n.text}`).join("\n") : "",
            ].join("\n") || "No other tasks.";
          } },
        { name: "post_note", description: "Share information with the other agents (e.g. the API of a module you made, RemoteEvent names).", schema: obj({ text: { type: "string" } }),
          run: async (i) => {
            const target = task.parentId ? this.d.tasks.find((t) => t.id === task.parentId) : task;
            target.notes.push({ at: now(), agent: agent.name, text: clip(i.text, 2000) });
            this.log(`📝 ${clip(i.text, 200)}`, "info", agent.name);
            return "Note posted.";
          } },
        { name: "report_progress", description: "Tell the user in one short sentence what you are doing now.", schema: obj({ message: { type: "string" } }),
          run: async (i) => { task.stage = clip(i.message, 160); this.step(task, "→ " + i.message); return "ok"; } },
      );
    }

    if (planning && task) {
      tools.push({
        name: "submit_plan",
        description: "Submit the development plan. Creates the tasks for the team.",
        schema: {
          type: "object", additionalProperties: false, required: ["summary", "tasks"],
          properties: {
            summary: { type: "string", description: "Short overview of the plan and how the systems connect" },
            tasks: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "title", "description", "role", "priority", "depends_on"], properties: {
              key: { type: "string", description: "Short unique id like 'data' or 'shop_ui'" },
              title: { type: "string" },
              description: { type: "string", description: "Exact work: files/instances, interfaces, acceptance criteria" },
              role: { type: "string", enum: roleNames() },
              priority: { type: "string", enum: ["low", "normal", "high"] },
              depends_on: { type: "array", items: { type: "string" } },
            } } },
          },
        },
        run: async (i) => {
          if (!Array.isArray(i.tasks) || !i.tasks.length) throw new Error("The plan needs at least one task");
          onPlan({ summary: String(i.summary || ""), tasks: i.tasks.slice(0, 15) });
          return "Plan accepted. The team is starting.";
        },
      });
    }

    // MCP tools
    for (const s of this.d.mcpServers) {
      const info = this.mcp.info(s.id);
      if (info.status !== "connected") continue;
      const allow = agent.tools?.mcp?.[s.id] ?? "all";
      if (allow === "none") continue;
      for (const t of info.tools) {
        if (Array.isArray(allow) && !allow.includes(t.name)) continue;
        const policy = this.toolPolicy(s, t);
        if (policy === "off") continue;
        const name = (slug(s.name) + "__" + t.name).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
        tools.push({
          name, mcp: true,
          description: `[${s.name}] ${t.description || t.title}`.slice(0, 1000),
          schema: t.inputSchema?.type === "object" ? t.inputSchema : { type: "object", properties: {} },
          run: async (input) => {
            if (policy === "ask") {
              const r = await this.approve(task, agent, "tool", `Use ${s.name} → ${t.title}`, { server: s.name, tool: t.name, args: input });
              if (!r.approved) return `The user rejected this action.${r.note ? " Note: " + r.note : ""}`;
            }
            this.step(task, `🔧 ${s.name}: ${t.name}`);
            const r = await this.mcp.call(s.id, t.name, input, signal);
            if (r.isError) throw new Error(r.text);
            return r.text;
          },
        });
      }
    }
    return tools;
  }
}

function parseArgs(a) {
  if (Array.isArray(a)) return a.map(String);
  const out = [];
  String(a || "").replace(/"([^"]*)"|(\S+)/g, (_, q, w) => { out.push(q ?? w); });
  return out;
}

/** cfg.envSet / headersSet: {KEY: value} to set; cfg.envRemove / headersRemove: [KEY]. */
function applySecretEdits(s, cfg) {
  s.env = s.env || {};
  s.headers = s.headers || {};
  for (const [k, v] of Object.entries(cfg.envSet || {})) if (k && v) s.env[k] = String(v);
  for (const k of cfg.envRemove || []) delete s.env[k];
  for (const [k, v] of Object.entries(cfg.headersSet || {})) if (k && v) s.headers[k] = String(v);
  for (const k of cfg.headersRemove || []) delete s.headers[k];
}

function lineDelta(before, after) {
  const b = before ? before.split("\n").length : 0;
  const a = after ? after.split("\n").length : 0;
  return { before: b, after: a };
}

module.exports = { Backend };

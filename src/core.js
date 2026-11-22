// VYRON backend: a companion app for Claude. Holds projects, Roblox Studio
// status, game ideas, revenue (with DevEx kroner) and the Claude chat.
const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const { Store, uid } = require("./store");
const { McpManager, PRESETS } = require("./mcp");
const { lookupGame, parseStudios } = require("./roblox");
const { ClaudeRunner } = require("./claude");
const { PcDriver } = require("./pc");
const { IDEAS, CATEGORIES } = require("./ideas");
const DX = require("./devex");
const RA = require("./robloxAccount");
const AN = require("./analytics");

const now = () => Date.now();
const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");
const STUDIO_ID = "studio";

class Backend extends EventEmitter {
  constructor({ dataDir, encrypt, decrypt, host = {}, fetchImpl, claude, studio = true, pc }) {
    super();
    this.useStudio = studio;
    this.pc = pc || new PcDriver();
    this.pcAsks = []; // waiting for the user's OK
    this.pcUntil = 0; // "Allow 10 min" ends at
    this.pcLast = 0;
    this.dataDir = dataDir;
    this.host = host;
    this.fetch = fetchImpl || globalThis.fetch;
    this.store = new Store({ dataDir, encrypt, decrypt }).load();
    this.d = this.store.data;
    this.d.customIdeas = this.d.customIdeas || [];
    this.d.picked = this.d.picked || [];
    this.d.rates = this.d.rates || null;
    this.mcp = new McpManager({ onChange: () => this.changed(), log: (t, l) => this.log(t, l, "Studio") });
    this.studios = [];
    this.studioError = null;
    this.activity = [];
    this.notes = [];
    this.controlInfo = null;
    this.claude = new ClaudeRunner({
      dataDir, log: (t, l) => this.log(t, l, "Claude"),
      control: () => (this.controlInfo ? this.controlInfo(true) : null),
      settings: () => ({ access: this.d.settings.claudeAccess || "safe", model: this.d.settings.claudeModel || "", parallel: this.d.settings.claudeParallel || 3, pc: this.d.settings.pcControl || "off" }),
      ...(claude || {}),
    });
    this.claude.on("change", () => this.changed());
  }

  /* ================= lifecycle ================= */
  async init() {
    this.log("VYRON started", "info", "System");
    if (this.useStudio) {
      this.connectStudio().catch(() => {});
      this._studioTimer = setInterval(() => this.detectStudios(true).catch(() => {}), 15000);
    }
    this._revTimer = setInterval(() => this.refreshRevenue(false).catch(() => {}), 10 * 60 * 1000);
    this._rateTimer = setInterval(() => this.refreshRates().catch(() => {}), 6 * 3600 * 1000);
    this.refreshRates().catch(() => {});
    this.refreshRevenue(false).catch(() => {});
    this.claude.checkAuth().catch(() => {});
    this.changed();
  }

  async shutdown() {
    clearInterval(this._studioTimer); clearInterval(this._revTimer); clearInterval(this._rateTimer);
    this.claude.shutdown();
    await this.mcp.closeAll();
    this.store.saveNow();
  }

  log(text, level = "info", source = "System") {
    this.activity.push({ at: now(), level, source, text: clip(String(text), 600) });
    if (this.activity.length > 300) this.activity.shift();
    this.emit("log", this.activity[this.activity.length - 1]);
    this.changed();
  }
  changed() { clearTimeout(this._emitT); this._emitT = setTimeout(() => this.emit("state", this.publicState()), 80); }
  save() { this.store.save(); this.changed(); }

  publicState() {
    const s = this.d.settings;
    const active = this.project(s.activeProjectId);
    const si = this.mcp.info(STUDIO_ID);
    return {
      settings: s,
      projects: this.d.projects.map((p) => this.projectPublic(p)),
      activeProjectId: active?.id || null,
      studio: { status: si.status, error: si.error, tools: si.tools.length },
      studios: this.studios,
      studioError: this.studioError,
      revenue: this.revenuePublic(),
      rates: this.d.rates,
      ideas: { categories: CATEGORIES, count: IDEAS.length, custom: this.d.customIdeas, picked: this.d.picked },
      claude: this.claude.public(),
      pc: { mode: this.d.settings.pcControl || "off", asks: this.pcAsks.map(({ resolve, reject, timer, ...a }) => a), allowedUntil: this.pcUntil > now() ? this.pcUntil : 0, activeAt: this.pcLast },
      workDir: this.workDir(),
      notes: this.notes.slice(-20),
      auth: this.authInfo ? this.authInfo() : null,
      control: this.controlInfo ? this.controlInfo() : null,
      activity: this.activity.slice(-150),
    };
  }

  saveSettings(patch) {
    for (const k of ["animations", "reduceEffects", "theme", "claudeAccess", "claudeModel", "claudeParallel", "pcControl"]) if (k in patch) this.d.settings[k] = patch[k];
    if (!["off", "ask", "on"].includes(this.d.settings.pcControl)) this.d.settings.pcControl = "off";
    if (this.d.settings.pcControl !== "on") this.pcUntil = 0;
    if (!["safe", "full"].includes(this.d.settings.claudeAccess)) this.d.settings.claudeAccess = "safe";
    this.d.settings.claudeParallel = Math.min(20, Math.max(1, Math.round(Number(this.d.settings.claudeParallel) || 3)));
    this.claude.pump();
    this.d.settings.claudeModel = String(this.d.settings.claudeModel || "").replace(/[^\w.:\-[\]]/g, "").slice(0, 60);
    this.save();
  }

  /* ================= Claude ================= */
  /** Claude works in the active project's folder, or VYRON's own Games folder. */
  workDir() {
    const p = this.activeProject();
    if (p?.rojoDir && fs.existsSync(p.rojoDir)) return p.rojoDir;
    const d = path.join(this.dataDir, "Games");
    fs.mkdirSync(d, { recursive: true });
    return d;
  }
  /** Send to a task (default: the newest). Returns the task id. */
  claudeSend(text, taskId) {
    const p = this.activeProject();
    const ctx = p ? `[Active VYRON project: ${p.game?.name || p.name}${p.placeId ? `, place ${p.placeId}` : ""}${this.studioFor(p) ? ", open in Studio" : ""}]\n` : "";
    return this.claude.send(ctx + text, this.workDir(), taskId || null);
  }
  claudeStop(taskId) { this.claude.stop(taskId || null); }
  claudeNewChat(taskId) { this.claude.newChat(taskId || null); }
  claudeNewTask(title) { return this.claude.newTask(title); }
  claudeRemoveTask(taskId) { this.claude.removeTask(taskId); }
  /** Start a new parallel task with a message. */
  claudeStartTask(text, title) { return this.claudeSend(text, this.claude.newTask(title || "New task")); }
  claudeLogin() { this.claude.login(); }
  claudeCheck() { return this.claude.checkAuth(); }

  /** Claude (through the connector) can put a message in front of the user. */
  notify(text) {
    this.notes.push({ id: uid("n"), at: now(), text: clip(String(text || ""), 500) });
    this.notes = this.notes.slice(-20);
    this.emit("notify", this.notes[this.notes.length - 1]);
    this.changed();
  }

  /* ================= PC control ================= */
  /** Claude asks (through the connector) to see or use the PC. Off / ask the user / allowed. */
  async pcAction(kind, args = {}) {
    const mode = this.d.settings.pcControl || "off";
    if (mode === "off") throw new Error("PC control is off. The user can turn it on in VYRON → Settings → PC control.");
    const what = pcDescribe(kind, args);
    if (mode === "ask" && now() > this.pcUntil) await this.pcApproval(kind, what);
    this.pcLast = now();
    this.log("Claude: " + what, "info", "PC control");
    const P = this.pc;
    if (kind === "screenshot") return P.screenshot();
    if (kind === "click") return P.click(args.x, args.y, args.button || "left", !!args.double);
    if (kind === "move") return P.move(args.x, args.y);
    if (kind === "scroll") return P.scroll(args.x, args.y, args.amount);
    if (kind === "type") return P.type(args.text);
    if (kind === "key") return P.key(args.keys);
    throw new Error("Unknown PC action " + kind);
  }
  pcApproval(kind, what) {
    return new Promise((resolve, reject) => {
      const a = { id: uid("pc"), kind, what, at: now(), resolve, reject };
      a.timer = setTimeout(() => this.pcAnswer(a.id, "timeout"), 120000);
      this.pcAsks.push(a);
      this.emit("notify", { id: a.id, at: now(), text: "Claude wants to " + what.charAt(0).toLowerCase() + what.slice(1) + " — answer in VYRON" });
      this.changed();
    });
  }
  /** answer: "allow" | "allow10" | "deny" */
  pcAnswer(id, answer) {
    const a = this.pcAsks.find((x) => x.id === id);
    if (!a) return;
    clearTimeout(a.timer);
    this.pcAsks = this.pcAsks.filter((x) => x !== a);
    if (answer === "allow10") { this.pcUntil = now() + 10 * 60 * 1000; for (const o of [...this.pcAsks]) this.pcAnswer(o.id, "allow"); }
    if (answer === "allow" || answer === "allow10") a.resolve();
    else a.reject(new Error(answer === "timeout" ? "The user didn't answer in time, so this wasn't done." : "The user said no to this PC action. Don't retry it; find another way or ask the user."));
    this.changed();
  }
  /** Stop button: take back "Allow 10 min", refuse anything waiting and stop all Claude tasks. */
  pcRevoke() {
    this.pcUntil = 0;
    for (const a of [...this.pcAsks]) this.pcAnswer(a.id, "deny");
    this.claude.stop();
    this.log("PC control stopped by you", "warn", "PC control");
    this.changed();
  }

  /* ================= ideas ================= */
  listIdeas(category) { return category ? IDEAS.filter((i) => i.category.toLowerCase() === String(category).toLowerCase()) : IDEAS; }
  allIdeas() { return [...IDEAS, ...this.d.customIdeas]; }
  idea(id) { return this.allIdeas().find((i) => i.id === id) || null; }
  setPicked(ids) { this.d.picked = [...new Set((ids || []).filter((id) => this.idea(id)))].slice(0, 50); this.save(); }
  addCustomIdea({ title, pitch, features, category }) {
    title = String(title || "").trim().slice(0, 80);
    pitch = String(pitch || "").trim().slice(0, 4000);
    if (!title && !pitch) throw new Error("Write your idea first");
    const i = { id: uid("my"), category: String(category || "My ideas").slice(0, 40), title: title || clip(pitch, 50), pitch, features: String(features || "").slice(0, 600), custom: true, at: now() };
    this.d.customIdeas.unshift(i);
    this.save();
    return i.id;
  }
  removeCustomIdea(id) { this.d.customIdeas = this.d.customIdeas.filter((i) => i.id !== id); this.d.picked = this.d.picked.filter((x) => x !== id); this.save(); }
  ideaPrompt(ids, extra) {
    const list = (ids || []).map((id) => this.idea(id)).filter(Boolean);
    if (!list.length) throw new Error("Pick at least one idea");
    const lines = list.map((i, n) => `${n + 1}. ${i.title} (${i.category}): ${i.pitch}${i.features ? ` Key features: ${i.features}.` : ""}`);
    return (list.length > 1 ? "Build one Roblox game that combines these ideas:\n" : "Build this Roblox game:\n") + lines.join("\n") +
      (extra ? `\n\nExtra wishes: ${String(extra).slice(0, 2000)}` : "") +
      "\n\nBuild it in my open Roblox Studio place: map, scripts, UI and monetization (game passes / developer products). Start with a short plan, then build it step by step and test it.";
  }
  /** Each Build starts its own task, so several builds can run at once. */
  buildIdeas(ids, extra) {
    const names = (ids || []).map((id) => this.idea(id)?.title).filter(Boolean);
    return this.claudeStartTask(this.ideaPrompt(ids, extra), "Build: " + names.slice(0, 3).join(" + ") + (names.length > 3 ? " +" + (names.length - 3) : ""));
  }

  /* ================= Roblox Studio ================= */
  async connectStudio() {
    const cfg = { id: STUDIO_ID, ...PRESETS["roblox-studio"]() };
    const r = await this.mcp.connect(cfg);
    if (r.status === "connected") await this.detectStudios(true);
    else { this.studioError = "Roblox Studio's AI connection isn't running. Open Studio and turn on its MCP / Assistant connection."; this.changed(); }
    return r.status;
  }
  async detectStudios(quiet) {
    if (this.mcp.info(STUDIO_ID).status !== "connected") {
      this.studios = [];
      this.studioError = "Roblox Studio isn't connected. Press Reconnect after opening Studio.";
      this.changed();
      if (!quiet) throw new Error(this.studioError);
      return [];
    }
    try {
      const r = await this.mcp.call(STUDIO_ID, "list_roblox_studios", {});
      if (r.isError) throw new Error(r.text);
      this.studios = parseStudios(r.text);
      this.studioError = this.studios.length ? null : "No Studio window found. Open your place in Roblox Studio.";
      for (const p of this.d.projects) { const st = this.studioFor(p); if (st) p.studioId = st.id; }
    } catch (e) { this.studioError = e.message; if (!quiet) throw e; }
    this.changed();
    return this.studios;
  }
  studioFor(p) {
    if (!p) return null;
    return this.studios.find((s) => (p.studioId && s.id === p.studioId) || (p.universeId && s.universeId && s.universeId === p.universeId) || (p.placeId && s.placeId && s.placeId === p.placeId && p.placeId !== "0")) || null;
  }

  /* ================= projects ================= */
  project(id) { return this.d.projects.find((p) => p.id === id) || null; }
  activeProject() { return this.project(this.d.settings.activeProjectId); }
  projectPublic(p) { return { ...p, studioConnected: !!this.studioFor(p), studio: this.studioFor(p) }; }
  async addProject({ name, rojoDir, placeId, universeId, studioId }) {
    const studio = studioId ? this.studios.find((s) => s.id === studioId) : null;
    const p = {
      id: uid("proj"), name: String(name || studio?.name || "My Roblox game").slice(0, 60), rojoDir: String(rojoDir || "").trim(),
      placeId: String(placeId || studio?.placeId || "").trim(), universeId: String(universeId || studio?.universeId || "").trim(),
      studioId: studio?.id || null, game: null, gameError: null, createdAt: now(),
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
    } catch (e) { p.gameError = e.message; }
    this.save();
  }

  /* ================= revenue & DevEx ================= */
  async refreshRates() {
    this.d.rates = await DX.fetchRates(this.fetch, this.d.rates);
    if (this.d.rates.errors.length) this.log("Exchange rates: " + this.d.rates.errors.join("; "), "warn", "Revenue");
    this.save();
    return this.d.rates;
  }
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
    this.d.roblox = { account: null, history: [], analytics: this.d.roblox.analytics || {}, summary: null, games: [] };
    this.save();
  }
  setRobloxApiKey(key) {
    key = String(key || "").trim();
    if (key.length < 20) throw new Error("That doesn't look like an Open Cloud API key");
    this.d.secrets.robloxApiKey = key;
    this.d.roblox.analytics = {};
    this.save();
    this.refreshRevenue(true).catch(() => {});
  }
  clearRobloxApiKey() { delete this.d.secrets.robloxApiKey; this.d.roblox.analytics = {}; this.save(); }
  revenueGames() {
    const map = new Map();
    for (const p of this.d.projects) if (p.universeId) map.set(p.universeId, { universeId: p.universeId, name: p.game?.name || p.name, iconUrl: p.game?.iconUrl || null, projectId: p.id });
    for (const g of this.d.roblox.games || []) if (!map.has(g.universeId)) map.set(g.universeId, { ...g, projectId: null });
    return [...map.values()];
  }
  async refreshRevenue(force) {
    if (force) this.refreshRates().catch(() => {});
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
    } finally { this._revBusy = false; this.save(); }
  }
  revenuePublic() {
    const r = this.d.roblox;
    return {
      account: r.account, summary: r.summary || null, summaryError: r.summaryError || null, history: r.history || [],
      games: this.revenueGames(), analytics: r.analytics || {}, hasApiKey: !!this.d.secrets.robloxApiKey,
      busy: !!this._revBusy, refreshedAt: r.refreshedAt || null, canLink: !!this.host.robloxLogin,
    };
  }
  /** Robux numbers with kroner next to them (for the connector). */
  revenueKr() {
    const r = this.d.roblox.summary, x = this.d.rates;
    const kr = (n) => Math.round(DX.toDkk(n, x) * 100) / 100;
    return {
      rate: x ? { usdPerRobux: x.usdPerRobux, dkkPerUsd: Math.round(x.dkkPerUsd * 10000) / 10000, krPerRobux: Math.round(x.dkkPerRobux * 100000) / 100000, ecbDate: x.ecbDate, sources: x.sources } : null,
      robux: r ? { balance: r.balance, balanceKr: kr(r.balance), pending: r.pending, pendingKr: kr(r.pending), salesToday: r.day?.sales, salesTodayKr: kr(r.day?.sales) } : null,
      canCashOut: r ? r.balance >= DX.MIN_ROBUX : null, minRobux: DX.MIN_ROBUX, minKr: kr(DX.MIN_ROBUX),
    };
  }
}

function pcDescribe(kind, a) {
  const at = a.x !== undefined ? ` at (${Math.round(a.x)}, ${Math.round(a.y)})` : "";
  if (kind === "screenshot") return "Take a screenshot of your screen";
  if (kind === "click") return `${a.double ? "Double-click" : "Click"}${a.button && a.button !== "left" ? " (" + a.button + " button)" : ""}${at}`;
  if (kind === "move") return "Move the mouse" + at;
  if (kind === "scroll") return `Scroll ${a.amount > 0 ? "down" : "up"}${at}`;
  if (kind === "type") return `Type “${clip(String(a.text || ""), 120)}”`;
  if (kind === "key") return `Press ${String(a.keys || "")}`;
  return kind;
}

module.exports = { Backend };

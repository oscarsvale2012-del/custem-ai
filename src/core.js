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
const R = require("./roles");
const { blenderServer } = require("./claude");
const { IDEAS, CATEGORIES } = require("./ideas");
const DX = require("./devex");
const RA = require("./robloxAccount");
const AN = require("./analytics");

const now = () => Date.now();
const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");
const STUDIO_ID = "studio";
const REVIEW_KINDS = ["model", "build", "ui", "gamepass"];
const REVIEW_NAME = { model: "3D model", build: "Build", ui: "UI", gamepass: "Gamepasses" };
const BLENDER_ID = "blender";

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
    this.d.teams = this.d.teams || [];
    this.d.reviews = this.d.reviews || [];
    this.d.settings.autoApprove = Object.fromEntries(REVIEW_KINDS.map((k) => [k, this.d.settings.autoApprove?.[k] === true]));
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
      settings: () => ({ access: this.d.settings.claudeAccess || "safe", model: this.d.settings.claudeModel || "", parallel: this.d.settings.claudeParallel || 3, blender: this.d.settings.blender !== false, pc: this.d.settings.pcControl || "off" }),
      ...(claude || {}),
    });
    this.claude.on("change", () => this.changed());
    this.claude.on("finished", (f) => this.teamTaskFinished(f.id));
    // Tell the user (sound + Windows notification) when a task ends.
    this.claude.on("finished", (f) => {
      const msg = {
        done: ["Claude finished", f.title + (f.text ? " — " + f.text : "")],
        failed: ["Claude couldn't finish", f.title + (f.why ? " — " + f.why : "")],
        usage: ["Out of Claude usage", "“" + f.title + "” stopped: your Claude usage limit is reached. It resets later — check claude.ai."],
        login: ["Sign in to Claude", "Claude isn't signed in, so “" + f.title + "” couldn't start."],
      }[f.outcome];
      if (!msg) return; // stopped by the user
      this.log(msg[0] + ": " + f.title, f.outcome === "done" ? "ok" : "warn", "Claude");
      this.emit("alert", { kind: f.outcome, title: msg[0], body: clip(msg[1], 240), taskId: f.id, at: now() });
      const hook = this.d.secrets.discordWebhook;
      if (hook) this.discordPost(hook, `${{ done: "✅", failed: "❌", usage: "⛽", login: "🔑" }[f.outcome] || "ℹ️"} **${msg[0]}** — ${clip(msg[1], 400)}`).then(() => (this.discordError = null)).catch((e) => { this.discordError = e.message; this.changed(); });
    });
  }

  /* ================= lifecycle ================= */
  async init() {
    this.log("VYRON started", "info", "System");
    if (this.useStudio) {
      this.connectStudio().catch(() => {});
      setTimeout(() => this.checkBlender().catch(() => {}), 3000);
      this._blenderTimer = setInterval(() => { this.checkBlender().catch(() => {}); this.scanWindows().catch(() => {}); }, 20000);
      this.scanWindows().catch(() => {});
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
    clearInterval(this._studioTimer); clearInterval(this._blenderTimer); clearInterval(this._revTimer); clearInterval(this._rateTimer); clearInterval(this._syncT);
    if (this._dirty) await this.accountPush().catch(() => {});
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
  save() { this.store.save(); this._dirty = true; this.changed(); }

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
      windows: this.windows || { studio: [], blender: [] },
      setup: this.setupStatus(),
      reviews: this.d.reviews.slice(-60).reverse().map(({ file, ...r }) => ({ ...r, hasImage: !!file })),
      discord: { set: !!this.d.secrets.discordWebhook, lastError: this.discordError || null },
      studioError: this.studioError,
      revenue: this.revenuePublic(),
      rates: this.d.rates,
      ideas: { categories: CATEGORIES, count: IDEAS.length, custom: this.d.customIdeas, picked: this.d.picked },
      claude: this.claude.public(),
      teams: this.teamsPublic(),
      roles: Object.fromEntries(R.ROLE_IDS.map((r) => [r, { name: R.ROLES[r].name, short: R.ROLES[r].short }])),
      blender: { found: !!blenderServer(), on: this.d.settings.blender !== false, ...(this.blenderInfo || {}) },
      pc: { mode: this.d.settings.pcControl || "off", asks: this.pcAsks.map(({ resolve, reject, timer, ...a }) => a), allowedUntil: this.pcUntil > now() ? this.pcUntil : 0, activeAt: this.pcLast },
      workDir: this.workDir(),
      notes: this.notes.slice(-20),
      auth: this.authInfo ? this.authInfo() : null,
      control: this.controlInfo ? this.controlInfo() : null,
      activity: this.activity.slice(-150),
    };
  }

  saveSettings(patch) {
    for (const k of ["animations", "reduceEffects", "theme", "claudeAccess", "claudeModel", "claudeParallel", "pcControl", "keepRunning", "notifyStyle", "sounds", "volume", "soundMap", "themeId", "themeLook", "uiSounds", "uiHover", "uiPack", "blender", "autoApprove", "usageStyle"]) if (k in patch) this.d.settings[k] = patch[k];
    const S = this.d.settings;
    if (!["vyron", "windows", "off"].includes(S.notifyStyle)) S.notifyStyle = "vyron";
    S.keepRunning = S.keepRunning !== false;
    S.sounds = S.sounds !== false;
    if (!["circle", "bar", "off"].includes(S.usageStyle)) S.usageStyle = "circle";
    const AA = S.autoApprove && typeof S.autoApprove === "object" ? S.autoApprove : {};
    S.autoApprove = Object.fromEntries(REVIEW_KINDS.map((k) => [k, AA[k] === true]));
    S.uiSounds = S.uiSounds !== false;
    S.uiHover = S.uiHover === true; // off unless turned on
    if (!["soft", "crisp", "space", "retro", "bubble"].includes(S.uiPack)) S.uiPack = "soft";
    S.volume = Math.min(1, Math.max(0, Number(S.volume ?? 0.7)));
    S.soundMap = Object.fromEntries(Object.entries(S.soundMap && typeof S.soundMap === "object" ? S.soundMap : {}).filter(([k, v]) => /^[a-z]{2,12}$/.test(k) && /^[a-z0-9-]{1,30}$/.test(v)).slice(0, 10));
    S.themeId = /^[a-z0-9-]{1,40}$/.test(S.themeId || "") ? S.themeId : null;
    const L = S.themeLook && typeof S.themeLook === "object" ? S.themeLook : {};
    S.themeLook = { bg: /^#[0-9a-f]{6}$/i.test(L.bg) ? L.bg : null, accent: /^#[0-9a-f]{6}$/i.test(L.accent) ? L.accent : null, light: !!L.light };
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

  /* ================= account sync ================= */
  /** What is saved to your VYRON account. No secrets: Roblox key and Claude/Roblox sign-ins stay on this PC. */
  exportForAccount() {
    const d = this.d;
    const { activeProjectId, ...settings } = d.settings;
    return {
      v: 1, at: now(), settings: { ...settings, activeProjectId },
      projects: d.projects.map(({ studioId, ...p }) => p), customIdeas: d.customIdeas, picked: d.picked,
      teams: d.teams.slice(-10), claudeTasks: this.claude.exportTasks(), revenueHistory: (d.roblox.history || []).slice(-120),
    };
  }
  importFromAccount(x) {
    if (!x || x.v !== 1) return;
    const d = this.d;
    if (x.settings && typeof x.settings === "object") { d.settings = { ...d.settings, ...x.settings }; this.saveSettings({}); }
    if (Array.isArray(x.projects)) d.projects = x.projects.map((p) => ({ ...p, studioId: null }));
    if (Array.isArray(x.customIdeas)) d.customIdeas = x.customIdeas;
    if (Array.isArray(x.picked)) d.picked = x.picked;
    if (Array.isArray(x.teams)) d.teams = x.teams.map((t) => (t.status === "planning" || t.status === "revising" ? { ...t, status: t.plan ? "proposed" : "failed" } : t));
    if (Array.isArray(x.revenueHistory)) d.roblox.history = x.revenueHistory;
    if (Array.isArray(x.claudeTasks)) this.claude.importTasks(x.claudeTasks);
    this.save();
  }
  /** Data that belongs to someone else is cleared before another person signs in on this PC. */
  resetUserData() {
    const d = this.d;
    d.projects = []; d.customIdeas = []; d.picked = []; d.settings.activeProjectId = null;
    d.roblox = { account: null, history: [], analytics: {}, summary: null, games: [] };
    delete d.secrets.robloxApiKey;
    delete d.secrets.discordWebhook;
    this.claude.importTasks([]);
    this.host.robloxLogout?.();
    this.save();
  }
  /** After signing in: bring the account's data here (or save this PC's data to a new account). */
  async accountSignedIn(acc) {
    this.account = acc;
    const d = this.d;
    d.account = d.account || {};
    const changedUser = d.account.owner && d.account.owner !== acc.user.id;
    if (changedUser) { this.resetUserData(); d.account.syncedAt = 0; }
    d.account.owner = acc.user.id;
    this.save();
    try {
      acc.sync.busy = true; acc.emit("change");
      const cloud = await acc.pull();
      if (cloud?.data && (changedUser || !d.account.syncedAt || cloud.updatedAt > d.account.syncedAt)) {
        this.importFromAccount(cloud.data);
        this.log("Your data was loaded from your VYRON account", "ok", "Account");
      } else await acc.push(this.exportForAccount());
      d.account.syncedAt = now(); acc.sync = { at: now(), error: null, busy: false };
    } catch (e) {
      acc.sync = { at: acc.sync.at, error: e.message, busy: false };
      this.log("Account sync: " + e.message, "warn", "Account");
    }
    this.save(); acc.emit("change");
    clearInterval(this._syncT);
    this._syncT = setInterval(() => this._dirty && this.accountPush().catch(() => {}), 60000);
  }
  /** Save to the account now (also before signing out and when VYRON quits). */
  async accountPush() {
    const acc = this.account;
    if (!acc?.signedIn || acc.offline) return;
    acc.sync.busy = true; acc.emit("change");
    try { await acc.push(this.exportForAccount()); this._dirty = false; this.d.account.syncedAt = now(); acc.sync = { at: now(), error: null, busy: false }; this.store.save(); }
    catch (e) { acc.sync = { ...acc.sync, error: e.message, busy: false }; throw e; }
    finally { acc.emit("change"); }
  }
  accountSyncNow() { return this.accountPush(); }

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
      this.emit("alert", { kind: "approval", title: "Claude needs your OK", body: what + " — answer in VYRON", at: now() });
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

  /* ================= studio team (Co-Founder + 4 roles) ================= */
  team(id) { const t = id ? this.d.teams.find((x) => x.id === id) : [...this.d.teams].reverse().find((x) => x.status === "building"); if (!t) throw new Error(id ? "Team not found" : "No team is building right now"); return t; }
  roleId(r) { const k = String(r || "").toLowerCase().replace(/[^a-z]/g, ""); const id = R.ROLE_IDS.find((x) => x === k || R.ROLES[x].name.toLowerCase().replace(/[^a-z]/g, "").startsWith(k) || (k === "modeler" && x === "builder") || (k === "uimaker" && x === "ui") || (k === "moneymaker" && x === "money")); if (!id) throw new Error("Unknown role " + r + ". Roles: " + R.ROLE_IDS.join(", ")); return id; }
  roleState(team, r) {
    const ro = team.roles[r];
    if (!ro?.enabled) return "off";
    const t = ro.taskId && this.claude.tasks.find((x) => x.id === ro.taskId);
    if (!t) return team.status === "building" ? "not started" : "ready";
    return t.busy ? "working" : t.queued ? "waiting" : t.outcome === "failed" || t.outcome === "usage" ? "problem" : "done";
  }
  teamsPublic() {
    const pid = this.d.settings.activeProjectId;
    return this.d.teams.filter((t) => !pid || t.projectId === pid || !t.projectId).slice(-10).reverse().map((t) => ({
      id: t.id, status: t.status, error: t.error || null, idea: t.idea, plan: t.plan, createdAt: t.createdAt, cofounderTaskId: t.roles.cofounder?.taskId || null,
      roles: Object.fromEntries(R.ROLE_IDS.map((r) => [r, { enabled: !!t.roles[r]?.enabled, taskId: t.roles[r]?.taskId || null, state: this.roleState(t, r) }])),
    }));
  }
  /** Ideas tab: the Co-Founder makes a plan (nothing is built until you press Accept). */
  teamPlan(text, ideaIds) {
    text = String(text || "").trim();
    const ideas = (ideaIds || []).map((id) => this.idea(id)).filter(Boolean);
    if (!text && !ideas.length) throw new Error("Tell the Co-Founder your idea, or pick some ideas");
    const idea = [text, ideas.length ? "Ideas to use:\n" + ideas.map((i) => `- ${i.title} (${i.category}): ${i.pitch} Features: ${i.features}`).join("\n") : ""].filter(Boolean).join("\n\n");
    const team = { id: uid("team"), projectId: this.d.settings.activeProjectId, status: "planning", idea: clip(idea, 3000), plan: null, createdAt: now(), roles: Object.fromEntries(R.ROLE_IDS.map((r) => [r, { enabled: true, taskId: null }])) };
    const taskId = this.claude.newTask("Co-Founder: " + clip(text || ideas.map((i) => i.title).join(" + "), 44), { role: "cofounder", teamId: team.id });
    team.roles.cofounder.taskId = taskId;
    this.d.teams.push(team);
    this.d.teams = this.d.teams.slice(-30);
    this.save();
    this.claudeSend(R.planPrompt(idea), taskId);
    this.log("Co-Founder is planning a game", "info", "Team");
    return team.id;
  }
  /** A role's Claude finished a step: read the Co-Founder's plan when it was planning. */
  teamTaskFinished(taskId) {
    const team = this.d.teams.find((t) => t.roles.cofounder?.taskId === taskId && (t.status === "planning" || t.status === "revising"));
    if (!team) return this.changed();
    const t = this.claude.tasks.find((x) => x.id === taskId);
    const lastUser = t ? t.messages.map((m) => m.role).lastIndexOf("user") : -1;
    const answer = t ? t.messages.slice(lastUser + 1).filter((m) => m.role === "assistant").map((m) => m.text).join("\n") : "";
    const plan = R.parsePlan(answer);
    if (plan) { team.plan = plan; team.status = "proposed"; team.error = null; this.log(`Co-Founder's plan is ready: ${plan.title}`, "ok", "Team"); this.emit("alert", { kind: "done", title: "The Co-Founder's plan is ready", body: plan.title + " — open Game Ideas to accept or change it.", at: now() }); }
    else { team.status = team.plan ? "proposed" : "failed"; team.error = t?.outcome === "usage" ? "Out of Claude usage." : "The Co-Founder's answer had no plan I could read. Press Change and ask again."; }
    this.save();
  }
  teamRevise(id, feedback) {
    const team = this.team(id);
    if (!["proposed", "failed"].includes(team.status)) throw new Error("The plan can only be changed before you accept it");
    if (!String(feedback || "").trim()) throw new Error("Write what to change");
    team.status = "revising"; team.error = null; this.save();
    this.claude.followUp(team.roles.cofounder.taskId, `Change the plan: ${String(feedback).slice(0, 3000)}\nAnswer with a short summary and the full updated JSON block in the same format.`, this.workDir(), "you");
  }
  /** Accept: every switched-on role gets its jobs; the Co-Founder starts directing. */
  teamAccept(id) {
    const team = this.team(id);
    if (team.status !== "proposed") throw new Error("There's no plan to accept yet");
    team.status = "building"; team.acceptedAt = now(); this.save();
    for (const r of R.WORKERS) if (team.roles[r].enabled) this.teamStartRole(team, r);
    if (team.roles.cofounder.enabled) this.claude.followUp(team.roles.cofounder.taskId, R.directorBrief(team), this.workDir(), "you");
    this.log(`Team started building ${team.plan.title}`, "ok", "Team");
    this.save();
  }
  teamStartRole(team, r) {
    if (team.roles[r].taskId && this.claude.tasks.some((x) => x.id === team.roles[r].taskId)) return;
    const taskId = this.claude.newTask(`${R.ROLES[r].name}: ${team.plan?.title || "game"}`, { role: r, teamId: team.id });
    team.roles[r].taskId = taskId;
    this.claudeSend(R.workerBrief(team, r), taskId);
  }
  /** The on/off switch for a role in a project's team. */
  teamSetRole(id, role, on) {
    const team = this.team(id), r = this.roleId(role), ro = team.roles[r];
    ro.enabled = !!on;
    if (!on && ro.taskId && this.claude.tasks.some((x) => x.id === ro.taskId)) this.claude.stop(ro.taskId);
    if (on && team.status === "building") {
      if (r !== "cofounder" && !ro.taskId) this.teamStartRole(team, r);
      else if (ro.taskId) { const t = this.claude.tasks.find((x) => x.id === ro.taskId); if (t && !t.busy && !t.queued) this.claude.followUp(ro.taskId, "[From the Co-Founder] You're switched on again — check vyron_team_status and continue your jobs.", this.workDir(), "you"); }
    }
    this.log(`${R.ROLES[r].name} switched ${on ? "on" : "off"}`, "info", "Team");
    this.save();
  }
  teamDiscard(id) {
    const team = this.team(id);
    for (const r of R.ROLE_IDS) if (team.roles[r].taskId && this.claude.tasks.some((x) => x.id === team.roles[r].taskId)) this.claude.stop(team.roles[r].taskId);
    this.d.teams = this.d.teams.filter((t) => t !== team);
    this.save();
  }
  /* --- tools the Co-Founder (and the roles) use through the connector --- */
  teamStatus(id) {
    const team = this.team(id);
    return {
      team: team.id, game: team.plan?.title, status: team.status,
      roles: R.ROLE_IDS.map((r) => {
        const t = team.roles[r].taskId && this.claude.tasks.find((x) => x.id === team.roles[r].taskId);
        const last = t ? [...t.messages].reverse().find((m) => m.role === "assistant") : null;
        return { role: r, name: R.ROLES[r].name, state: this.roleState(team, r), waitingMessages: (t?.inbox || []).length, lastUpdate: last ? clip(last.text, 600) : null, jobs: (team.plan?.work[r] || []).map((w) => w.title) };
      }),
    };
  }
  teamMessage(id, role, text, from) {
    const team = this.team(id), r = this.roleId(role), ro = team.roles[r];
    if (!ro.enabled) throw new Error(`${R.ROLES[r].name} is switched off by the user.`);
    if (!String(text || "").trim()) throw new Error("Empty message");
    if (!ro.taskId) { if (r === "cofounder" || team.status !== "building") throw new Error(`${R.ROLES[r].name} hasn't started.`); this.teamStartRole(team, r); }
    this.claude.followUp(ro.taskId, `[From ${String(from || "the Co-Founder").slice(0, 40)}] ${String(text).slice(0, 6000)}`, this.workDir(), from || "cofounder");
    this.save();
    return `Sent to ${R.ROLES[r].name}.`;
  }
  async teamWait(id, roles, seconds = 300) {
    const team = this.team(id);
    const want = (roles && roles.length ? roles.map((x) => this.roleId(x)) : R.WORKERS).filter((r) => team.roles[r].enabled && r !== "cofounder");
    const end = now() + Math.min(900, Math.max(10, seconds)) * 1000;
    while (now() < end && want.some((r) => ["working", "waiting"].includes(this.roleState(team, r)))) await new Promise((res) => setTimeout(res, 2000));
    return this.teamStatus(team.id);
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

  /* ================= reviews (send a picture, wait for OK) ================= */
  /** An agent finished something: it waits here for the user's OK, unless auto mode is on for that kind. */
  submitReview({ kind, title, details, image_path, role, task_id }) {
    kind = REVIEW_KINDS.includes(kind) ? kind : "build";
    const r = { id: uid("rev"), kind, title: clip(String(title || REVIEW_NAME[kind]), 100), details: clip(String(details || ""), 3000), role: role || null, taskId: task_id || null, at: now(), status: "pending", feedback: null, file: null };
    if (image_path) {
      const p = path.resolve(String(image_path));
      if (!/\.(png|jpe?g|webp)$/i.test(p)) throw new Error("The picture must be a .png, .jpg or .webp file");
      let st; try { st = fs.statSync(p); } catch { throw new Error("Picture not found: " + p); }
      if (!st.isFile() || st.size > 15 * 1024 * 1024) throw new Error("The picture is missing or too big (max 15 MB)");
      const dir = path.join(this.dataDir, "reviews"); fs.mkdirSync(dir, { recursive: true });
      r.file = path.join(dir, r.id + path.extname(p).toLowerCase());
      fs.copyFileSync(p, r.file);
    }
    const auto = this.d.settings.autoApprove?.[kind];
    if (auto) { r.status = "approved"; r.auto = true; r.decidedAt = now(); }
    this.d.reviews.push(r);
    this.d.reviews = this.d.reviews.slice(-200);
    this.save();
    if (auto) this.log(`Auto mode approved ${REVIEW_NAME[kind]}: ${r.title}`, "ok", "Reviews");
    else this.emit("alert", { kind: "approval", title: `Check this ${REVIEW_NAME[kind].toLowerCase()}: ${r.title}`, body: "Open Blender & Builds to approve it or ask for changes.", at: now() });
    return { review_id: r.id, decision: r.status, auto: !!auto, next: auto ? "Auto mode is on: go ahead and put it in the game." : "Call vyron_review_wait with this review_id and wait for the user's answer. Don't put it in the game before it's approved." };
  }
  reviewDecide(id, approve, feedback) {
    const r = this.d.reviews.find((x) => x.id === id);
    if (!r) throw new Error("Review not found");
    if (r.status !== "pending") throw new Error("This was already answered");
    r.status = approve ? "approved" : "changes";
    r.feedback = approve ? null : clip(String(feedback || "Please improve it."), 2000);
    r.decidedAt = now();
    this.save();
    this.log(`${approve ? "Approved" : "Asked for changes to"} ${REVIEW_NAME[r.kind]}: ${r.title}`, "info", "Reviews");
    return r.status;
  }
  /** Turn auto mode on/off for one kind, or for all with kind "all". Pending ones of that kind are approved right away. */
  setAuto(kind, on) {
    const kinds = kind === "all" ? REVIEW_KINDS : [kind];
    if (!kinds.every((k) => REVIEW_KINDS.includes(k))) throw new Error("Unknown kind");
    for (const k of kinds) this.d.settings.autoApprove[k] = !!on;
    if (on) for (const r of this.d.reviews) if (r.status === "pending" && kinds.includes(r.kind)) { r.status = "approved"; r.auto = true; r.decidedAt = now(); }
    this.save();
  }
  async reviewWait(id, seconds = 300) {
    const end = now() + Math.min(900, Math.max(5, seconds)) * 1000;
    for (;;) {
      const r = this.d.reviews.find((x) => x.id === id);
      if (!r) throw new Error("Review not found");
      if (r.status !== "pending") return { review_id: id, decision: r.status, feedback: r.feedback || undefined, auto: !!r.auto, next: r.status === "approved" ? "Approved: put it in the game now." : "The user wants changes: fix it, then send a new picture with vyron_submit_review." };
      if (now() > end) return { review_id: id, decision: "pending", next: "Still waiting for the user. Call vyron_review_wait again." };
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
  reviewImage(id) {
    const r = this.d.reviews.find((x) => x.id === id);
    if (!r?.file || !fs.existsSync(r.file)) return null;
    const ext = path.extname(r.file).slice(1).replace("jpg", "jpeg");
    return `data:image/${ext};base64,${fs.readFileSync(r.file).toString("base64")}`;
  }
  clearReviews() { this.d.reviews = this.d.reviews.filter((r) => r.status === "pending"); this.save(); }

  /* ================= first-run setup ================= */
  /** Every blender.exe on this PC (installed or portable zip), with its version from the folder name. */
  findBlenders(env = process.env) {
    const ls = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
    const home = env.USERPROFILE || "", la = env.LOCALAPPDATA || "";
    const out = [];
    const add = (dir) => { const exe = path.join(dir, "blender.exe"); if (fs.existsSync(exe)) { const m = dir.match(/blender[ -]?(\d+)\.(\d+)(?:\.(\d+))?/i); out.push({ exe, version: m ? `${m[1]}.${m[2]}${m[3] ? "." + m[3] : ""}` : null }); } };
    for (const pf of [env.ProgramFiles, env["ProgramFiles(x86)"]].filter(Boolean)) for (const v of ls(path.join(pf, "Blender Foundation"))) add(path.join(pf, "Blender Foundation", v));
    if (la) for (const v of ls(path.join(la, "Programs")).filter((x) => /blender/i.test(x))) add(path.join(la, "Programs", v));
    for (const steam of [env["ProgramFiles(x86)"], env.ProgramFiles].filter(Boolean)) add(path.join(steam, "Steam", "steamapps", "common", "Blender"));
    // portable zips (folder inside a folder, like blender-5.2.4-…/blender-5.2.4-…/blender.exe)
    for (const base of ["Downloads", "Desktop", "Documents"].map((d) => path.join(home, d))) for (const a of ls(base).filter((x) => /blender/i.test(x))) { add(path.join(base, a)); for (const b of ls(path.join(base, a))) add(path.join(base, a, b)); }
    return out;
  }
  blenderOk(v) { if (!v) return true; const [a, b] = v.split(".").map(Number); return a > 5 || (a === 5 && b >= 1); }

  /** Which apps are installed on this PC (official download links for the missing ones). */
  installedApps(env = process.env) {
    if (this._apps && now() - this._apps.at < 30000) return this._apps;
    const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
    const la = env.LOCALAPPDATA || "", pf = [env.ProgramFiles, env["ProgramFiles(x86)"], la && path.join(la, "Programs")].filter(Boolean);
    const studio = !!la && (fs.existsSync(path.join(la, "Roblox", "mcp.bat")) || ls(path.join(la, "Roblox", "Versions")).some((v) => fs.existsSync(path.join(la, "Roblox", "Versions", v, "RobloxStudioBeta.exe"))));
    const blenders = this.findBlenders(env);
    const good = blenders.filter((x) => this.blenderOk(x.version));
    const blender = good.length > 0;
    const blenderOld = !blender && blenders.length > 0 ? blenders.map((x) => x.version).filter(Boolean).sort().pop() || "old" : null;
    this._apps = { at: now(), claude: !!this.claude.exe, studio, blender, blenderOld, blenders: blenders.map((x) => ({ version: x.version, exe: x.exe })), blenderMcp: !!blenderServer() };
    return this._apps;
  }

  /** What is connected, for the welcome checklist and the setup prompt. */
  setupStatus() {
    const C = this.claude.public(), X = this.controlInfo ? this.controlInfo() : null, b = this.blenderInfo || {};
    const fresh = (k) => (X?.clients || []).some((c) => c.kind === k && now() - c.last < 15 * 60 * 1000);
    const studioOn = this.mcp.info(STUDIO_ID).status === "connected";
    const A = this.installedApps();
    const dl = (name, url) => ({ downloadName: name, download: url });
    const items = [
      { id: "claude", name: "Claude", installed: A.claude, ...dl("Claude desktop", "https://claude.ai/download"), ok: !!(C.found && C.auth?.loggedIn), how: C.found ? "Sign in to Claude (button below)." : "Install the Claude desktop app (it includes Claude Code)." },
      { id: "desktop", name: "Claude desktop", installed: A.claude, ...dl("Claude desktop", "https://claude.ai/download"), ok: !!(X?.desktop?.connected), active: fresh("desktop"), how: "Press Connect, then quit and reopen the Claude desktop app." },
      { id: "code", name: "Claude Code / web", installed: A.claude, ...dl("Claude desktop", "https://claude.ai/download"), ok: fresh("code"), how: "Paste the setup prompt into the Claude desktop app's Code tab — it connects to VYRON while it sets everything up." },
      { id: "studio", name: "Roblox Studio", installed: A.studio, ...dl("Roblox Studio", "https://create.roblox.com/landing"), ok: studioOn && this.studios.length > 0, how: studioOn ? "Open your place in Roblox Studio." : "Open Roblox Studio and turn on its AI / MCP connection (Assistant settings)." },
      { id: "blender", name: "Blender", installed: A.blender && A.blenderMcp, ...(A.blender ? dl("Blender MCP add-on", "https://www.blender.org/lab/mcp-server/") : dl("Blender (free)", "https://www.blender.org/download/")), ...(A.blenderOld ? { tooOld: A.blenderOld } : {}), ok: !!b.open, how: !A.blender ? (A.blenderOld ? `Your Blender ${A.blenderOld} is too old for the MCP add-on — it needs Blender 5.1 or newer (free).` : "Blender isn't installed. Get the free Blender 5.1 or newer.") : b.found ? "Open Blender 5.1+ and turn on its MCP add-on (Edit → Preferences → Get Extensions → search “MCP” → Install, then enable it)." : "Install Blender's MCP: Claude desktop → Settings → Extensions → Blender, plus the MCP add-on in Blender (Edit → Preferences → Get Extensions → search “MCP”)." },
      { id: "roblox", name: "Roblox account", ok: !!this.d.roblox.account, how: "Sign in with Roblox (you type your own password on roblox.com)." },
      { id: "discord", name: "Discord", optional: true, skipped: !!this.d.discordSkipped, ok: !!this.d.secrets.discordWebhook, how: "Paste a Discord channel webhook link (Channel settings → Integrations → Webhooks → New Webhook → Copy URL)." },
    ];
    const need = items.filter((i) => !i.optional);
    return { apps: A, items, done: need.filter((i) => i.ok).length, total: need.length, ready: need.every((i) => i.ok), onboarded: (this.d.setupDoneFor || []).includes(this.setupKey()) };
  }
  /** Setup is done per account on each device: this PC's data folder + the signed-in account. */
  setupKey() { return this.account?.user?.id || this.d.account?.owner || "local"; }
  skipDiscord() { this.d.discordSkipped = true; this.save(); }
  finishSetup() {
    const s = this.setupStatus();
    if (!s.ready) throw new Error("Connect these first: " + s.items.filter((i) => !i.optional && !i.ok).map((i) => i.name).join(", "));
    const k = this.setupKey();
    this.d.setupDoneFor = [...new Set([...(this.d.setupDoneFor || []), k])].slice(-20);
    this.save(); this.log("Setup finished", "ok", "System"); }

  /* --- Discord: VYRON posts task news to a channel through a webhook --- */
  async setDiscord(url) {
    url = String(url || "").trim();
    if (!/^https:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url)) throw new Error("That isn't a Discord webhook link. It looks like https://discord.com/api/webhooks/123…/abc…");
    await this.discordPost(url, "✅ **VYRON is connected!** I'll post here when Claude finishes a task, fails, or runs out of usage.");
    this.d.secrets.discordWebhook = url;
    this.discordError = null;
    this.save();
  }
  clearDiscord() { delete this.d.secrets.discordWebhook; this.save(); }
  async discordPost(url, content) {
    const r = await this.fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "VYRON", content: clip(content, 1900), allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(15000) })
      .catch(() => { throw new Error("Couldn't reach Discord."); });
    if (!r.ok) throw new Error(r.status === 404 || r.status === 401 ? "Discord says this webhook doesn't exist (it may have been deleted)." : "Discord answered " + r.status);
  }
  testDiscord() { if (!this.d.secrets.discordWebhook) throw new Error("Connect Discord first"); return this.discordPost(this.d.secrets.discordWebhook, "🔔 Test message from VYRON."); }

  /* ================= open windows ================= */
  /** Windows of a program running on this PC (tasklist), e.g. RobloxStudioBeta.exe or blender.exe. */
  listWindows(image) {
    if (process.platform !== "win32" || this.noTasklist) return Promise.resolve([]);
    return new Promise((resolve) => {
      require("child_process").execFile("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/V", "/FO", "CSV", "/NH"], { windowsHide: true, timeout: 8000 }, (err, out) => {
        if (err) return resolve([]);
        const rows = String(out).split(/\r?\n/).filter((l) => l.startsWith('"'));
        resolve(rows.map((l) => { const c = l.slice(1, -1).split('","'); return { pid: Number(c[1]), title: c[8] && c[8] !== "N/A" ? c[8] : "" }; }));
      });
    });
  }
  async scanWindows() {
    const [studio, blender] = await Promise.all([this.listWindows("RobloxStudioBeta.exe"), this.listWindows("blender.exe")]);
    this.windows = { studio: studio.filter((w) => w.title), blender: blender.filter((w) => w.title || blender.length === 1), at: now() };
    this.changed();
    return this.windows;
  }

  /* ================= Blender ================= */
  /** Is Blender open with its MCP add-on? VYRON asks Blender's own MCP server. */
  async checkBlender() {
    const srv = blenderServer();
    if (!srv) { this.blenderInfo = { found: false, open: false, file: null, error: "Blender's MCP server isn't installed (Claude desktop → Settings → Extensions → Blender)." }; this.changed(); return this.blenderInfo; }
    try {
      if (this.mcp.info(BLENDER_ID).status !== "connected") await this.mcp.connect({ id: BLENDER_ID, name: "Blender", transport: "stdio", command: srv.command, args: srv.args });
      if (this.mcp.info(BLENDER_ID).status !== "connected") throw new Error(this.mcp.info(BLENDER_ID).error || "Couldn't start Blender's MCP server");
      const r = await this.mcp.call(BLENDER_ID, "get_blendfile_summary_path_info", {});
      if (r.isError) throw new Error(r.text);
      const file = (String(r.text).match(/[A-Za-z]:\\[^"\n]+?\.blend/) || [])[0] || null;
      this.blenderInfo = { found: true, open: true, file, error: null };
    } catch (e) {
      this.blenderInfo = { found: true, open: false, file: null, error: /connect|refused|ECONN|not running|timed out|socket/i.test(e.message) ? "Blender isn't open, or its MCP add-on is off. Open Blender and turn the add-on on." : String(e.message).slice(0, 300) };
    }
    this.changed();
    return this.blenderInfo;
  }
  /** "Make a 3D model": a Builder & Modeler Claude makes it in Blender. */
  makeModel(text) {
    text = String(text || "").trim();
    if (!text) throw new Error("Describe the model first");
    if (!blenderServer()) throw new Error("Blender's MCP server isn't installed yet (Claude desktop → Settings → Extensions → Blender).");
    const id = this.claude.newTask("Model: " + clip(text, 48), { role: "builder" });
    this.claudeSend(`Make this 3D model in Blender: ${text}

Work in the open Blender file: build it step by step with clean, named objects and simple materials, check it with a viewport screenshot, keep it low-poly and Roblox-friendly. When it's done, render a picture (render_viewport_to_path to a .png in the project's reviews folder) and send it to me with vyron_submit_review (kind "model"), then vyron_review_wait. Only after it's approved, export it as .fbx into the "models" folder of the project folder and tell me the file name and how to import it into Roblox Studio (3D Importer). If I ask for changes, fix it and send a new picture.`, id);
    return id;
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

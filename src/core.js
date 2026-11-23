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
const BLENDER_MCP_MIN = "5.1"; // used until the MCP add-on is installed and its manifest says otherwise
/** Compare version strings like "5.2.4" and "5.10" by number. */
const cmpVer = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
/** Keyboard shortcuts that open apps from anywhere in Windows (Electron accelerator format). */
const HOTKEY_APPS = ["vyron", "studio", "claude", "blender"];
const HOTKEY_DEFAULTS = { vyron: "Ctrl+Alt+V", studio: "Ctrl+Alt+R", claude: "Ctrl+Alt+C", blender: "Ctrl+Alt+B" };
const HOTKEY_RE = /^(?:(?:Ctrl|Alt|Shift|Super)\+)*(?:[A-Z0-9]|F(?:[1-9]|1[0-2]))$/;
const HOTKEY_NAMES = { vyron: "VYRON", studio: "Roblox Studio", claude: "Claude desktop", blender: "Blender" };
const validHotkey = (k) => typeof k === "string" && HOTKEY_RE.test(k) && /(?:Ctrl|Alt|Super)\+/.test(k);
/** Bring another program's window to the front (restore it if minimized). */
function focusWindow(pid) {
  if (process.platform !== "win32") return Promise.resolve();
  const ps = `Add-Type @"
using System; using System.Runtime.InteropServices;
public class VyWin { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int n); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e); }
"@
$h = (Get-Process -Id ${Number(pid) | 0}).MainWindowHandle
if ($h -ne 0) { if ([VyWin]::IsIconic($h)) { [VyWin]::ShowWindowAsync($h, 9) | Out-Null }; [VyWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [VyWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero); [VyWin]::SetForegroundWindow($h) | Out-Null }`;
  return new Promise((resolve) => require("child_process").execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")], { windowsHide: true, timeout: 10000 }, () => resolve()));
}

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
    // The "Connect Blender for me" task is done → the glow goes away and VYRON checks Blender again.
    this.claude.on("finished", (f) => { if (f.id && f.id === this._doItTask) { this._doItTask = null; this.glow("doit-task", false); this.checkBlender().catch(() => {}); } });
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
      setTimeout(() => this.autoConnectBlender().catch(() => {}).then(() => this.blenderInfo || this.checkBlender()).catch(() => {}), 3000);
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
      blender: { found: !!blenderServer(), on: this.d.settings.blender !== false, ...(this.blenderInfo || {}), checked: !!this.blenderInfo, connecting: !!this._openingBlender },
      pc: { mode: this.d.settings.pcControl || "off", asks: this.pcAsks.map(({ resolve, reject, timer, ...a }) => a), allowedUntil: this.pcUntil > now() ? this.pcUntil : 0, activeAt: this.pcLast, glow: this.glowOn(), doIt: this._doIt || null, doItTask: this._doItTask || null },
      hotkeys: { on: this.d.settings.hotkeysOn !== false, keys: { ...HOTKEY_DEFAULTS, ...(this.d.settings.hotkeys || {}) }, defaults: HOTKEY_DEFAULTS, names: HOTKEY_NAMES, errors: this.hotkeyErrors || {}, live: !!this.hotkeysLive },
      workDir: this.workDir(),
      notes: this.notes.slice(-20),
      auth: this.authInfo ? this.authInfo() : null,
      control: this.controlInfo ? this.controlInfo() : null,
      activity: this.activity.slice(-150),
    };
  }

  saveSettings(patch) {
    for (const k of ["animations", "reduceEffects", "theme", "claudeAccess", "claudeModel", "claudeParallel", "pcControl", "keepRunning", "notifyStyle", "sounds", "volume", "soundMap", "themeId", "themeLook", "uiSounds", "uiHover", "uiPack", "blender", "autoApprove", "usageStyle", "autoOpenBlender", "autoConnectBlender", "blenderStartPrompt", "blenderExe", "hotkeysOn"]) if (k in patch) this.d.settings[k] = patch[k];
    const S = this.d.settings;
    const hk0 = JSON.stringify([S.hotkeysOn, S.hotkeys]);
    if (patch.hotkeys && typeof patch.hotkeys === "object") {
      for (const [id, k] of Object.entries(patch.hotkeys)) {
        if (!HOTKEY_APPS.includes(id)) continue;
        if (k !== "" && !validHotkey(k)) throw new Error(`“${k}” can't be a shortcut. Use Ctrl or Alt with a letter, number or F-key, like Ctrl+Alt+B.`);
        const clash = Object.entries({ ...this.hotkeys(), [id]: k }).find(([o, v]) => o !== id && v && v === k);
        if (clash) throw new Error(`${k} is already the shortcut for ${HOTKEY_NAMES[clash[0]]}.`);
        S.hotkeys = { ...(S.hotkeys || {}), [id]: k };
      }
    }
    if (patch.hotkeysReset) delete S.hotkeys;
    S.hotkeysOn = S.hotkeysOn !== false;
    if (JSON.stringify([S.hotkeysOn, S.hotkeys]) !== hk0) this.emit("hotkeys", this.hotkeys());
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

  /** The keyboard shortcuts in use: { vyron: "Ctrl+Alt+V", … } ("" = none). Empty when turned off. */
  hotkeys() {
    if (this.d.settings.hotkeysOn === false) return {};
    const own = this.d.settings.hotkeys || {};
    return Object.fromEntries(HOTKEY_APPS.map((id) => [id, id in own ? own[id] : HOTKEY_DEFAULTS[id]]));
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
    const glowBefore = this.glowOn();
    this.pcLast = now();
    this.glowChanged(glowBefore);
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
    const before = this.glowOn();
    this.pcLast = 0; this._doItTask = null;
    (this._glow || new Set()).clear();
    this.glowChanged(before);
    for (const a of [...this.pcAsks]) this.pcAnswer(a.id, "deny");
    this.claude.stop();
    this.log("PC control stopped by you", "warn", "PC control");
    this.changed();
  }

  /* ================= studio team (Co-Founder + 4 roles) ================= */
  team(id) {
    const t = id ? this.d.teams.find((x) => x.id === id) : [...this.d.teams].reverse().find((x) => x.status === "building");
    if (!t) throw new Error(id ? "Team not found" : "No team is building right now");
    for (const r of R.ROLE_IDS) t.roles[r] = t.roles[r] || { enabled: false, taskId: null }; // teams from before a role existed
    return t;
  }
  roleId(r) {
    const k = String(r || "").toLowerCase().replace(/[^a-z]/g, "");
    const alias = { modeler: "builder", uimaker: "ui", moneymaker: "money", sounds: "sound", music: "sound", audio: "sound", sfx: "sound", animation: "animator", animations: "animator", animate: "animator" };
    const id = k && R.ROLE_IDS.find((x) => x === k || alias[k] === x || R.ROLES[x].name.toLowerCase().replace(/[^a-z]/g, "").startsWith(k)); if (!id) throw new Error("Unknown role " + r + ". Roles: " + R.ROLE_IDS.join(", ")); return id; }
  /** The roles the user added to the team (the Co-Founder is always there and isn't in this list). */
  teamRoster() { return (Array.isArray(this.d.settings.teamRoles) ? this.d.settings.teamRoles : []).filter((r) => R.WORKERS.includes(r)); }
  /**
   * "+" in the Team list: which roles are in the team. A team that is building right now gets the change too:
   * added roles start (the Co-Founder is told to give them jobs), removed roles stop.
   */
  setTeamRoles(ids) {
    const want = [...new Set((Array.isArray(ids) ? ids : []).map((x) => this.roleId(x)))].filter((r) => R.WORKERS.includes(r));
    const before = this.teamRoster();
    this.d.settings.teamRoles = R.WORKERS.filter((r) => want.includes(r)); // keep the team's order
    const pid = this.d.settings.activeProjectId;
    const team = [...this.d.teams].reverse().find((t) => t.status === "building" && (!pid || t.projectId === pid || !t.projectId));
    if (team) {
      const added = want.filter((r) => !before.includes(r) && !team.roles[r]?.enabled), removed = before.filter((r) => !want.includes(r));
      for (const r of removed) if (team.roles[r]?.enabled) this.teamSetRole(team.id, r, false);
      for (const r of added) this.teamSetRole(team.id, r, true);
      if (added.length && team.roles.cofounder?.taskId) this.claude.followUp(team.roles.cofounder.taskId, `[From the user] I added ${added.map((r) => R.ROLES[r].name).join(", ")} to the team. Give ${added.length > 1 ? "them" : "it"} detailed jobs for this game with vyron_team_message.`, this.workDir(), "you");
    }
    this.log(`Team: Co-Founder${this.d.settings.teamRoles.length ? ", " + this.d.settings.teamRoles.map((r) => R.ROLES[r].name).join(", ") : " only"}`, "info", "Team");
    this.save();
    return this.d.settings.teamRoles;
  }
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
    const roster = this.teamRoster();
    const team = { id: uid("team"), projectId: this.d.settings.activeProjectId, status: "planning", idea: clip(idea, 3000), plan: null, createdAt: now(), roles: Object.fromEntries(R.ROLE_IDS.map((r) => [r, { enabled: r === "cofounder" || roster.includes(r), taskId: null }])) };
    const taskId = this.claude.newTask("Co-Founder: " + clip(text || ideas.map((i) => i.title).join(" + "), 44), { role: "cofounder", teamId: team.id });
    team.roles.cofounder.taskId = taskId;
    this.d.teams.push(team);
    this.d.teams = this.d.teams.slice(-30);
    this.save();
    this.claudeSend(R.planPrompt(idea, roster), taskId);
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
    if (r === "builder" && blenderServer()) this.ensureBlender();
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
    const add = (dir) => {
      const exe = path.join(dir, "blender.exe");
      if (!fs.existsSync(exe) || out.some((o) => o.exe.toLowerCase() === exe.toLowerCase())) return;
      const m = dir.match(/blender[ -]?(\d+)\.(\d+)(?:\.(\d+))?/i);
      // Folder without a version (Steam, "Blender", custom names): Blender keeps its files in a "<major>.<minor>" folder next to blender.exe.
      const inner = ls(dir).filter((x) => /^\d+\.\d+$/.test(x)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
      out.push({ exe, version: m ? `${m[1]}.${m[2]}${m[3] ? "." + m[3] : ""}` : inner || null });
    };
    for (const pf of [env.ProgramFiles, env["ProgramFiles(x86)"]].filter(Boolean)) for (const v of ls(path.join(pf, "Blender Foundation"))) add(path.join(pf, "Blender Foundation", v));
    if (la) for (const v of ls(path.join(la, "Programs")).filter((x) => /blender/i.test(x))) add(path.join(la, "Programs", v));
    for (const steam of [env["ProgramFiles(x86)"], env.ProgramFiles].filter(Boolean)) add(path.join(steam, "Steam", "steamapps", "common", "Blender"));
    // portable zips (folder inside a folder, like blender-5.2.4-…/blender-5.2.4-…/blender.exe)
    for (const base of ["Downloads", "Desktop", "Documents"].map((d) => path.join(home, d))) for (const a of ls(base).filter((x) => /blender/i.test(x))) { add(path.join(base, a)); for (const b of ls(path.join(base, a))) add(path.join(base, a, b)); }
    return out;
  }
  /** Where the MCP add-on is installed for a Blender version: returns the add-on module, e.g. bl_ext.user_default.mcp. */
  blenderAddon(version, env = process.env, exe = null) {
    if (!version) return null;
    for (const dir of this.blenderConfigDirs(version, env, exe)) {
      const ext = path.join(dir, "extensions");
      let repos = []; try { repos = fs.readdirSync(ext); } catch { /* none */ }
      for (const r of repos) if (fs.existsSync(path.join(ext, r, "mcp", "__init__.py"))) return `bl_ext.${r}.mcp`;
      if (fs.existsSync(path.join(dir, "scripts", "addons", "mcp", "__init__.py"))) return "mcp"; // installed as a legacy add-on
    }
    return null;
  }
  /** Blender's user folders for a version: the normal one in AppData, and a portable copy's own "portable" folder. */
  blenderConfigDirs(version, env = process.env, exe = null) {
    const mm = String(version).split(".").slice(0, 2).join(".");
    const dirs = [];
    if (exe) dirs.push(path.join(path.dirname(exe), "portable"));
    dirs.push(path.join(env.APPDATA || "", "Blender Foundation", "Blender", mm));
    return dirs;
  }
  /**
   * Which Blender versions the MCP add-on supports. Read from the add-on's own blender_manifest.toml
   * (blender_version_min / _max), so a newer add-on that supports other versions works without a VYRON update.
   */
  blenderMcpRange(env = process.env) {
    if (this._mcpRange && this._mcpRange.env === env && now() - this._mcpRange.at < 30000) return this._mcpRange.r;
    const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
    const base = path.join(env.APPDATA || "", "Blender Foundation", "Blender");
    let min = null, max = null;
    for (const v of ls(base)) for (const repo of ls(path.join(base, v, "extensions"))) {
      let toml = ""; try { toml = fs.readFileSync(path.join(base, v, "extensions", repo, "mcp", "blender_manifest.toml"), "utf8"); } catch { continue; }
      const lo = (toml.match(/^\s*blender_version_min\s*=\s*"([\d.]+)"/m) || [])[1], hi = (toml.match(/^\s*blender_version_max\s*=\s*"([\d.]+)"/m) || [])[1];
      if (lo && (!min || cmpVer(lo, min) < 0)) min = lo;
      if (hi && (!max || cmpVer(hi, max) > 0)) max = hi;
    }
    const mm = (v) => v.split(".").slice(0, 2).join(".");
    const r = { min: mm(min || BLENDER_MCP_MIN), max: max ? mm(max) : null }; // max is the first version NOT supported
    this._mcpRange = { env, at: now(), r };
    return r;
  }
  /** All Blenders on this PC, newest first, with whether the MCP add-on supports them and is installed. */
  blenderChoices(env) {
    const range = this.blenderMcpRange(env);
    return this.findBlenders(env)
      .map((b) => ({ ...b, supported: this.blenderOk(b.version, env), addon: !!this.blenderAddon(b.version, env, b.exe) }))
      .sort((a, b) => cmpVer(b.version || "0", a.version || "0"))
      .map((b) => ({ ...b, min: range.min }));
  }
  /** The Blender to use: the one picked in VYRON (if still there and supported), else the newest with the add-on, else the newest supported. */
  pickBlender() {
    const good = this.blenderChoices().filter((b) => b.supported);
    const want = this.d.settings.blenderExe;
    return good.find((b) => want && b.exe.toLowerCase() === String(want).toLowerCase()) || good.find((b) => b.addon) || good[0] || null;
  }
  /** Blender's MCP server (from the Claude desktop Blender extension). Separate so tests can swap it. */
  blenderMcpServer() { return blenderServer(); }
  /**
   * Open Blender (5.1+) with the MCP add-on turned on and online access allowed for this session,
   * so the add-on starts its server by itself, then wait until VYRON can reach it.
   */
  async openBlender({ wait = 45 } = {}) {
    const cur = await this.checkBlender().catch(() => null);
    if (cur?.open) return { ok: true, already: true, message: "Blender is already open and connected." };
    const pick = this.pickBlender();
    if (!pick) throw new Error(`No Blender ${this.blenderNeeds()} on this PC. Get it free at https://www.blender.org/download/`);
    const addon = this.blenderAddon(pick.version, undefined, pick.exe);
    if (!addon) throw new Error(`The MCP add-on isn't installed in Blender ${pick.version}. In Blender: Edit → Preferences → Get Extensions → search "MCP" → Install (see https://www.blender.org/lab/mcp-server/), then try again.`);
    if (!this.d.blenderMcpEnabled) await this.enableBlenderMcp().catch(() => null);
    const running = await this.listWindows("blender.exe");
    if (running.length) return { ok: false, running: true, message: "Blender is already open but its MCP isn't connected. In Blender: Edit → Preferences → Add-ons → MCP → press Start (and allow online access). Or close Blender and press Open Blender." };
    const args = ["--online-mode", "--addons", addon];
    (this.spawnImpl || require("child_process").spawn)(pick.exe, args, { detached: true, stdio: "ignore", cwd: path.dirname(pick.exe) }).unref?.();
    this.log(`Opening Blender ${pick.version} with MCP on`, "info", "Blender");
    const end = now() + wait * 1000;
    while (now() < end) {
      await new Promise((r) => setTimeout(r, 2500));
      const b = await this.checkBlender().catch(() => null);
      if (b?.open) { this.log("Blender connected", "ok", "Blender"); return { ok: true, version: pick.version, message: `Blender ${pick.version} is open and connected.` }; }
    }
    return { ok: false, version: pick.version, message: `Blender ${pick.version} was started but isn't connected yet. If Blender shows the MCP add-on's settings, press "Start", or check Edit → Preferences → Add-ons → MCP.` };
  }
  /**
   * Turn on Blender's MCP server for good: allow online access, enable the add-on, switch on its Auto Start,
   * save Blender's preferences. Runs Blender invisibly in the background (src/blender-enable-mcp.py).
   */
  async enableBlenderMcp() {
    const pick = this.pickBlender();
    if (!pick) throw new Error(`No Blender ${this.blenderNeeds()} on this PC. Get it free at https://www.blender.org/download/`);
    const module = this.blenderAddon(pick.version, undefined, pick.exe);
    if (!module) return { ok: false, needsInstall: true, version: pick.version, message: `The MCP add-on isn't installed in Blender ${pick.version} yet. Install it in Blender: Edit → Preferences → Get Extensions → search "MCP" → Install (or from https://www.blender.org/lab/mcp-server/), then run this again.` };
    let script = path.join(__dirname, "blender-enable-mcp.py");
    if (script.includes(".asar" + path.sep)) script = script.replace(".asar" + path.sep, ".asar.unpacked" + path.sep);
    const out = await new Promise((resolve) => {
      (this.execFileImpl || require("child_process").execFile)(pick.exe, ["-b", "--python", script, "--", module], { windowsHide: true, timeout: 120000, cwd: path.dirname(pick.exe) }, (err, stdout) => resolve(String(stdout || "") + (err && !stdout ? String(err.message) : "")));
    });
    const line = out.split(/\r?\n/).find((l) => l.startsWith("VYRON_RESULT "));
    let r; try { r = JSON.parse(line.slice(13)); } catch { r = { ok: false, error: "Blender didn't answer (" + clip(out.trim().split(/\r?\n/).pop() || "no output", 200) + ")" }; }
    if (!r.ok) return { ok: false, version: pick.version, message: "Couldn't turn on the MCP server in Blender: " + r.error };
    this.log(`Blender ${pick.version}: MCP add-on on, Auto Start on, online access allowed`, "ok", "Blender");
    this.d.blenderMcpEnabled = { version: pick.version, at: now() };
    this.save();
    return { ok: true, version: pick.version, module, message: `Turned on the MCP server in Blender ${pick.version} for good (add-on enabled, Auto Start on, online access allowed). Blender starts it by itself from now on.${(await this.listWindows("blender.exe")).length ? " Blender is open right now — close and reopen it (or press Open Blender) so it picks this up." : ""}` };
  }

  /**
   * One-click "Connect Blender": find a Blender the MCP add-on supports, turn on its MCP server for good, open Blender and wait
   * until VYRON can reach it. Returns { ok, step, message } — step says what the user must do if it stops:
   * "install" (no supported Blender), "addon" (MCP add-on missing), "extension" (Claude's Blender extension missing),
   * "restart" (Blender open without MCP), "start" (press Start).
   * `exe` picks a specific Blender (remembered for next time).
   */
  async connectBlender({ wait = 45, exe = null } = {}) {
    if (exe) {
      const c = this.blenderChoices().find((b) => b.exe.toLowerCase() === String(exe).toLowerCase());
      if (!c) return { ok: false, step: "install", message: "That Blender isn't on this PC any more. Pick another one." };
      if (!c.supported) return { ok: false, step: "install", message: `Blender ${c.version} doesn't work with the MCP add-on — it needs Blender ${this.blenderNeeds()}. Pick another Blender or get the free newest one.` };
      if (this.d.settings.blenderExe !== c.exe) { this.d.settings.blenderExe = c.exe; this.save(); }
    }
    const cur = await this.checkBlender().catch(() => null);
    if (cur?.open) return { ok: true, step: "done", message: "Blender is already connected." };
    if (cur?.broken) return { ok: false, step: "extension", message: cur.error };
    const all = this.findBlenders();
    if (!all.some((b) => this.blenderOk(b.version))) {
      const old = all.map((b) => b.version).filter(Boolean).sort(cmpVer).pop();
      return { ok: false, step: "install", message: old ? `Your Blender ${old} doesn't work with the MCP add-on — it needs Blender ${this.blenderNeeds()}. Get the free newest Blender, then press Connect again.` : `Blender isn't installed. Get the free Blender (${this.blenderNeeds()}), then press Connect again.` };
    }
    const en = await this.enableBlenderMcp().catch((e) => ({ ok: false, message: e.message }));
    if (!en.needsInstall && !this.blenderMcpServer()) return { ok: false, step: "extension", message: "Turn on the Blender extension in the Claude desktop app (Settings → Extensions → Blender), then press Connect again." };
    if (en.needsInstall) return { ok: false, step: "addon", message: en.message };
    let r;
    try { r = await this.openBlender({ wait }); } catch (e) { return { ok: false, step: /add-on isn't installed/.test(e.message) ? "addon" : "install", message: e.message }; }
    if (r.ok) return { ok: true, step: "done", message: r.message };
    return { ok: false, step: r.running ? "restart" : "start", message: r.running ? "Blender is open, but without its MCP server. Close Blender (save your work first), then press Connect again." : r.message };
  }

  /** Before a Builder or "Make a 3D model" works: open Blender if it's closed (setting, on by default). */
  ensureBlender() {
    if (this.d.settings.autoOpenBlender === false || this.blenderInfo?.open || this._openingBlender) return;
    this._openingBlender = true;
    this.openBlender().catch((e) => this.log("Couldn't open Blender: " + e.message, "warn", "Blender")).finally(() => (this._openingBlender = false));
  }

  /** Does the MCP add-on support this Blender version? (Unknown version: let it try.) */
  blenderOk(v, env) {
    if (!v) return true;
    const { min, max } = this.blenderMcpRange(env);
    const mm = v.split(".").slice(0, 2).join(".");
    return cmpVer(mm, min) >= 0 && (!max || cmpVer(mm, max) < 0);
  }
  /** "5.1 or newer" (or "5.1 to 6.0" if the add-on has a top version). */
  blenderNeeds(env) { const { min, max } = this.blenderMcpRange(env); return max ? `${min} or newer, below ${max}` : `${min} or newer`; }

  /**
   * "Do it for me": VYRON connects Blender all by itself, even from nothing.
   *  1. Checks the Blender versions — with no Blender the MCP add-on supports, it downloads the newest Blender
   *     from download.blender.org (checksum-verified) and unpacks it (no installer, no admin rights needed).
   *  2. Downloads the official MCP add-on (projects.blender.org/lab/blender_mcp) and installs + enables it in that Blender.
   *  3. Turns on the MCP server for good, opens Blender and connects it.
   *  4. Missing Claude desktop Blender extension: downloads it and opens its installer in Claude desktop.
   *  5. Anything that needs clicks (Install in Claude desktop, closing Blender, pressing Start) → a Claude task does it
   *     by controlling the PC (PC control "Ask me each time" at least).
   * While VYRON works, the screen glows purple ("VYRON is using your computer").
   */
  async blenderDoItForMe() {
    if (this._doIt) return { ok: true, started: false, busy: true, message: "VYRON is already connecting Blender." };
    const cur = await this.checkBlender().catch(() => null);
    if (cur?.open) return { ok: true, started: false, step: "done", message: "Blender is already connected." };
    const all = this.blenderChoices();
    let pick = this.pickBlender();
    this._doIt = { step: "check", text: pick ? `Blender ${pick.version} works with the MCP add-on` : "Getting Blender…", at: now() };
    this.glow("doit", true);
    const progress = (step, text, quiet) => { this._doIt = { step, text, at: now() }; if (!quiet) this.log(text, "info", "Blender"); this.changed(); };
    let handedOff = false;
    try {
      // 1. no Blender that works with the MCP add-on → get the newest one
      if (!pick) {
        const old = all.map((b) => b.version).filter(Boolean).sort(cmpVer).pop();
        progress("blender", old ? `Blender ${old} can't run the MCP add-on (needs ${this.blenderNeeds()}) — getting the newest Blender…` : "No Blender yet — getting the newest Blender from blender.org…");
        const got = await this.installBlender(progress);
        pick = this.pickBlender();
        if (!pick) throw new Error(`Blender ${got.version} was unpacked, but VYRON can't find it.`);
      }
      // 2. the MCP add-on in Blender
      let addonZip = null;
      if (!this.blenderAddon(pick.version, undefined, pick.exe)) {
        progress("addon", "Downloading Blender's MCP add-on from projects.blender.org…");
        addonZip = await this.downloadBlenderMcp("addon");
        progress("addon", `Installing the MCP add-on in Blender ${pick.version}…`);
        const ins = await this.installBlenderAddon(pick, addonZip);
        if (!ins.ok) this.log("Couldn't install the add-on by itself: " + ins.message, "warn", "Blender");
      }
      // 3 + 4. extension, MCP server on, open Blender, connect
      let mcpb = null;
      if (!this.blenderMcpServer() || this.blenderInfo?.broken) {
        progress("extension", "Downloading the Blender extension for Claude desktop…");
        mcpb = await this.downloadBlenderMcp("extension").catch((e) => { this.log(e.message, "warn", "Blender"); return null; });
        if (mcpb && this.host.openPath) { progress("extension", "Opening the Blender extension in Claude desktop…"); await this.host.openPath(mcpb); }
      }
      progress("connect", `Opening Blender ${pick.version} and connecting it…`);
      const r = await this.connectBlender({ wait: 40 });
      if (r.ok) { this.log("Blender connected — all done", "ok", "Blender"); return { ok: true, started: false, step: "done", message: "Done! Blender is connected. " + r.message }; }
      if (r.step === "install") return { ...r, started: false };
      // 5. the rest needs clicks: Claude does it
      if ((this.d.settings.pcControl || "off") === "off") {
        this.d.settings.pcControl = "ask"; this.save();
        this.log("PC control set to “Ask me each time” so Claude can finish connecting Blender", "info", "PC control");
      }
      progress("claude", "Claude is doing the last steps on your screen…");
      const id = this.claude.newTask("Connect Blender for me");
      this._doItTask = id;
      this.glow("doit-task", true);
      handedOff = true;
      this.claudeSend(this.blenderHelpPrompt(pick, r, { addonZip, mcpb }), id);
      return { ok: true, started: true, taskId: id, step: r.step, message: `Almost there — Claude is doing the last step on your screen (${{ addon: "install the MCP add-on", extension: "install the Blender extension in Claude desktop", restart: "close Blender", start: "start the MCP server" }[r.step] || r.step}). It asks before each click — answer in VYRON.` };
    } catch (e) {
      return { ok: false, started: false, step: "error", message: "Couldn't connect Blender: " + e.message };
    } finally {
      this._doIt = null;
      this.glow("doit", false);
      if (!handedOff) this.changed();
    }
  }

  /** The newest Blender for Windows on download.blender.org that the MCP add-on supports, with its SHA-256. */
  async blenderLatestDownload() {
    const base = "https://download.blender.org/release/";
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    const text = async (url) => {
      const r = await this.fetch(url, { signal: AbortSignal.timeout(20000) }).catch(() => null);
      if (!r?.ok) throw new Error("Couldn't reach download.blender.org.");
      return r.text();
    };
    const dirs = [...(await text(base)).matchAll(/href="(Blender(\d+\.\d+))\/"/g)].map((m) => ({ dir: m[1], v: m[2] }))
      .filter((d) => this.blenderOk(d.v)).sort((a, b) => cmpVer(b.v, a.v));
    for (const d of dirs.slice(0, 3)) {
      const zips = [...(await text(base + d.dir + "/")).matchAll(new RegExp(`href="(blender-(\\d+\\.\\d+\\.\\d+)-windows-${arch}\\.zip)"`, "g"))]
        .map((m) => ({ file: m[1], version: m[2] })).sort((a, b) => cmpVer(b.version, a.version));
      if (!zips.length) continue;
      const z = zips[0];
      const sums = await text(`${base}${d.dir}/blender-${z.version}.sha256`);
      const sha = (sums.split(/\r?\n/).map((l) => l.trim().split(/\s+/)).find((p) => p[1] === z.file) || [])[0];
      if (!/^[0-9a-f]{64}$/i.test(sha || "")) throw new Error(`No checksum for ${z.file} on download.blender.org.`);
      return { version: z.version, file: z.file, url: base + d.dir + "/" + z.file, sha256: sha.toLowerCase() };
    }
    throw new Error("Couldn't find a Blender for Windows on download.blender.org.");
  }
  /**
   * Download the newest Blender (.zip, checksum-checked) and unpack it to %LOCALAPPDATA%\Programs — like a portable
   * Blender: no installer, no admin rights. VYRON then finds it like any other Blender and uses it from now on.
   */
  async installBlender(progress = () => {}, env = process.env) {
    const rel = await this.blenderLatestDownload();
    const programs = path.join(env.LOCALAPPDATA || path.join(this.dataDir, "apps"), "Programs");
    const folder = path.join(programs, rel.file.replace(/\.zip$/, ""));
    const exe = path.join(folder, "blender.exe");
    if (!fs.existsSync(exe)) {
      const dl = path.join(this.dataDir, "downloads");
      fs.mkdirSync(dl, { recursive: true }); fs.mkdirSync(programs, { recursive: true });
      const zip = path.join(dl, rel.file);
      progress("blender", `Downloading Blender ${rel.version} from blender.org…`);
      const res = await this.fetch(rel.url, { signal: AbortSignal.timeout(60 * 60 * 1000) }).catch(() => null);
      if (!res?.ok) throw new Error(`Couldn't download Blender ${rel.version} from blender.org.`);
      const total = Number(res.headers?.get?.("content-length")) || 0;
      const hash = require("crypto").createHash("sha256");
      const out = fs.createWriteStream(zip);
      let got = 0, shown = -1;
      try {
        const body = res.body && res.body[Symbol.asyncIterator] ? res.body : [Buffer.from(await res.arrayBuffer())];
        for await (const chunk of body) {
          const b = Buffer.from(chunk);
          hash.update(b); got += b.length;
          if (!out.write(b)) await new Promise((r) => out.once("drain", r));
          const pct = total ? Math.floor((got / total) * 100) : -1;
          if (pct >= 0 && (pct >= shown + 5 || (pct === 100 && shown !== 100))) { shown = pct; progress("blender", `Downloading Blender ${rel.version}… ${pct}% of ${Math.round(total / 1048576)} MB`, true); }
        }
      } finally { await new Promise((r) => out.end(r)); }
      if (hash.digest("hex") !== rel.sha256) { fs.rmSync(zip, { force: true }); throw new Error("The Blender download didn't match blender.org's checksum, so VYRON didn't use it. Try again."); }
      progress("blender", `Unpacking Blender ${rel.version}…`);
      await new Promise((resolve, reject) => (this.execFileImpl || require("child_process").execFile)("tar.exe", ["-xf", zip, "-C", programs], { windowsHide: true, timeout: 15 * 60 * 1000 }, (err) => (err ? reject(new Error("Couldn't unpack Blender: " + err.message)) : resolve())));
      fs.rmSync(zip, { force: true });
      if (!fs.existsSync(exe)) throw new Error(`Blender ${rel.version} was unpacked, but blender.exe isn't where it should be.`);
      this.log(`Blender ${rel.version} downloaded from blender.org and set up in ${folder}`, "ok", "Blender");
    }
    this._apps = null; this._mcpRange = null;
    this.d.settings.blenderExe = exe; this.save();
    return { version: rel.version, exe };
  }

  /** Where VYRON gets Blender's official MCP pieces: the Blender Lab repository's newest release. */
  async blenderMcpRelease() {
    const api = "https://projects.blender.org/api/v1/repos/lab/blender_mcp/releases/latest";
    const res = await this.fetch(api, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (!res?.ok) throw new Error("Couldn't reach projects.blender.org to get the MCP add-on.");
    const rel = await res.json();
    const asset = (re) => (rel.assets || []).find((a) => re.test(a.name) && /^https:\/\/projects\.blender\.org\/lab\/blender_mcp\/releases\/download\//.test(a.browser_download_url || ""));
    return { tag: rel.tag_name, addon: asset(/^mcp-[\d.]+\.zip$/), extension: asset(/^blender-[\d.]+\.mcpb$/) };
  }
  /** Download the add-on (.zip, for Blender) or the extension (.mcpb, for Claude desktop) into VYRON's folder. */
  async downloadBlenderMcp(kind) {
    const rel = await this.blenderMcpRelease();
    const a = rel[kind];
    if (!a) throw new Error(`The newest MCP release (${rel.tag}) has no ${kind === "addon" ? "add-on" : "Claude extension"} file.`);
    const dir = path.join(this.dataDir, "downloads");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, path.basename(a.name));
    if (fs.existsSync(file) && fs.statSync(file).size === a.size) return file;
    const res = await this.fetch(a.browser_download_url, { signal: AbortSignal.timeout(180000) }).catch(() => null);
    if (!res?.ok) throw new Error("Couldn't download " + a.name + " from projects.blender.org.");
    const buf = Buffer.from(await res.arrayBuffer());
    if (a.size && buf.length !== a.size) throw new Error(`The download of ${a.name} was incomplete. Try again.`);
    fs.writeFileSync(file, buf);
    this.log(`Downloaded ${a.name} (${rel.tag}) from projects.blender.org`, "ok", "Blender");
    return file;
  }
  /** Install + enable the add-on .zip in a Blender with Blender's own command line (works while Blender is closed or open). */
  async installBlenderAddon(pick, zip) {
    const out = await new Promise((resolve) => {
      (this.execFileImpl || require("child_process").execFile)(pick.exe, ["--command", "extension", "install-file", "-r", "user_default", "-e", zip], { windowsHide: true, timeout: 120000, cwd: path.dirname(pick.exe) }, (err, stdout, stderr) => resolve({ err, text: String(stdout || "") + String(stderr || "") }));
    });
    this._apps = null; this._mcpRange = null;
    const module = this.blenderAddon(pick.version, undefined, pick.exe);
    if (!module) return { ok: false, message: clip((out.text.trim().split(/\r?\n/).filter(Boolean).pop() || out.err?.message || "Blender didn't install it"), 300) };
    this.log(`MCP add-on installed in Blender ${pick.version}`, "ok", "Blender");
    return { ok: true, module };
  }

  /** Purple glow around the screen while VYRON (or Claude through PC control) uses the computer. */
  glow(reason, on) {
    this._glow = this._glow || new Set();
    const before = this.glowOn();
    if (on) this._glow.add(reason); else this._glow.delete(reason);
    this.glowChanged(before);
  }
  glowOn() { return !!((this._glow && this._glow.size) || (this.pcLast && now() - this.pcLast < 15000)); }
  glowChanged(before) {
    const on = this.glowOn();
    if (on !== before) { this.emit("glow", { on }); this.changed(); }
    clearTimeout(this._glowT);
    if (on && this.pcLast && now() - this.pcLast < 15000) this._glowT = setTimeout(() => this.glowChanged(true), 15500 - (now() - this.pcLast));
  }

  blenderHelpPrompt(pick, r, files = {}) {
    const steps = {
      addon: `The MCP add-on isn't installed in this Blender yet${files.addonZip ? `, and installing it automatically didn't work. VYRON already downloaded it here: ${files.addonZip}` : ""}. Open Blender with vyron_open_app (app "blender"). In Blender: Edit → Preferences → Get Extensions. If Blender asks to allow online access, allow it. ${files.addonZip ? `Use the ▾ menu at the top right → "Install from Disk…", paste the path above into the file name box and press Install from Disk.` : `Search "MCP" and install "MCP" by Blender Lab.`} When it's installed, close Blender (File → Quit) and call vyron_connect_blender.`,
      extension: `The Blender extension isn't installed in the Claude desktop app yet. ${files.mcpb ? `VYRON downloaded the official one (${files.mcpb}) and opened it in Claude desktop, so an install window should be showing. The user asked VYRON to install it: press "Install" in that window.` : `Open Claude desktop with vyron_open_app (app "claude"), go to Settings → Extensions, search "Blender" and press Install.`} Make sure it's switched on. If anything asks for a password, a sign-in or other terms, stop and ask the user (vyron_notify). Then call vyron_connect_blender.`,
      restart: `Blender is open without its MCP server. Don't close Blender — start the server inside the open Blender instead. Bring Blender to the front (vyron_open_app "blender"). Edit → Preferences → System: tick "Allow Online Access". Then Add-ons: search "MCP", make sure it's ticked, tick "Auto Start" and press "Start" (it should say "Server is running"). Save Preferences (☰ menu, bottom left), close the Preferences window and call vyron_connect_blender. Only if that's impossible, ask the user (vyron_notify) to save their work and close Blender themselves — never choose "Don't Save".`,
      start: `Blender opened but its MCP server didn't start. Bring Blender to the front (vyron_open_app "blender"): Edit → Preferences → Add-ons → search "MCP" → tick it, tick "Auto Start", press "Start", then Save Preferences (☰ menu, bottom left). Then call vyron_connect_blender.`,
    };
    return `Connect Blender to VYRON for the user, by controlling their PC — the user asked VYRON to do everything for them. VYRON already checked the versions: Blender ${pick.version} (${pick.exe}) is supported by the MCP add-on (needs ${this.blenderNeeds()}). Don't use any other Blender.

VYRON did what it could by itself and stopped at step "${r.step}": ${r.message}

What to do:
${steps[r.step] || steps.start}

How:
- See the screen with vyron_pc_screenshot, then use vyron_pc_click / vyron_pc_type / vyron_pc_key / vyron_pc_scroll. Take a new screenshot after each step to check it worked.
- vyron_connect_blender tells you the next step; repeat until it says connected (at most 5 rounds), handling each step the same way (add-on, extension, restart, start). If it keeps stopping at the same step, tell the user what's wrong with vyron_notify and stop.
- Never type passwords, never sign in for the user, never discard the user's unsaved work, never download or install anything except the official Blender MCP files named above.
- When it's connected, say so in one short sentence.`;
  }

  /* ================= open apps (keyboard shortcuts) ================= */
  /** Open (or bring to the front) VYRON's apps: Roblox Studio, Claude desktop, Blender. */
  async openApp(id, env = process.env) {
    const front = async (image, titled) => {
      const w = (await this.listWindows(image)).filter((x) => !titled || x.title);
      if (!w.length) return false;
      await (this.focusImpl || focusWindow)(w[0].pid);
      return true;
    };
    const run = (cmd, args = []) => (this.spawnImpl || require("child_process").spawn)(cmd, args, { detached: true, stdio: "ignore" }).unref?.();
    if (typeof env !== "object" || !env) env = process.env;
    if (id === "vyron") { this.host.showWindow?.(); return { ok: true, message: "VYRON is in front." }; }
    if (id === "studio") {
      if (await front("RobloxStudioBeta.exe")) return { ok: true, message: "Roblox Studio is in front." };
      const la = env.LOCALAPPDATA || "", vdir = path.join(la, "Roblox", "Versions");
      let exe = null; try { exe = fs.readdirSync(vdir).map((v) => path.join(vdir, v, "RobloxStudioBeta.exe")).filter((f) => fs.existsSync(f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]; } catch { /* none */ }
      if (exe) { run(exe); return { ok: true, message: "Opening Roblox Studio…" }; }
      if (this.host.openExternal) { await this.host.openExternal("roblox-studio:"); return { ok: true, message: "Opening Roblox Studio…" }; }
      return { ok: false, message: "Roblox Studio isn't installed. Get it at https://create.roblox.com/landing" };
    }
    if (id === "claude") {
      if (await front("claude.exe", true)) return { ok: true, message: "Claude is in front." };
      const la = env.LOCALAPPDATA || "";
      let pkg = null; try { pkg = fs.readdirSync(path.join(la, "Packages")).find((x) => /^Claude_[a-z0-9]+$/i.test(x)); } catch { /* none */ }
      if (pkg) { run("explorer.exe", [`shell:AppsFolder\\${pkg}!Claude`]); return { ok: true, message: "Opening Claude…" }; }
      const exe = [path.join(la, "AnthropicClaude", "claude.exe"), path.join(la, "Programs", "Claude", "Claude.exe")].find((f) => fs.existsSync(f));
      if (exe) { run(exe); return { ok: true, message: "Opening Claude…" }; }
      return { ok: false, message: "The Claude desktop app isn't installed. Get it at https://claude.ai/download" };
    }
    if (id === "blender") {
      if (await front("blender.exe")) return { ok: true, message: "Blender is in front." };
      const pick = this.pickBlender();
      if (!pick) return { ok: false, message: `No Blender that works with the MCP add-on (${this.blenderNeeds()}). Get the free newest Blender at blender.org.` };
      if (this.blenderAddon(pick.version, undefined, pick.exe)) { this.openBlender({ wait: 45 }).catch(() => {}); return { ok: true, message: `Opening Blender ${pick.version} with MCP on…` }; }
      (this.spawnImpl || require("child_process").spawn)(pick.exe, ["--online-mode"], { detached: true, stdio: "ignore", cwd: path.dirname(pick.exe) }).unref?.();
      return { ok: true, message: `Opening Blender ${pick.version}…` };
    }
    throw new Error("Unknown app " + id);
  }

  /** On start: connect Blender by itself if the user turned that on. */
  async autoConnectBlender() {
    if (this.d.settings.autoConnectBlender !== true || this.d.settings.blender === false) return;
    const b = await this.checkBlender().catch(() => null);
    if (b?.open || this._openingBlender) return;
    this._openingBlender = true; this.changed();
    try {
      const r = await this.connectBlender();
      this.log(r.ok ? r.message : "Couldn't connect Blender at start: " + r.message, r.ok ? "ok" : "warn", "Blender");
    } finally { this._openingBlender = false; }
  }

  /** Which apps are installed on this PC (official download links for the missing ones). */
  installedApps(env = process.env) {
    if (this._apps && now() - this._apps.at < 30000) return this._apps;
    const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
    const la = env.LOCALAPPDATA || "", pf = [env.ProgramFiles, env["ProgramFiles(x86)"], la && path.join(la, "Programs")].filter(Boolean);
    const studio = !!la && (fs.existsSync(path.join(la, "Roblox", "mcp.bat")) || ls(path.join(la, "Roblox", "Versions")).some((v) => fs.existsSync(path.join(la, "Roblox", "Versions", v, "RobloxStudioBeta.exe"))));
    const blenders = this.findBlenders(env);
    const good = blenders.filter((x) => this.blenderOk(x.version, env));
    const blender = good.length > 0;
    const blenderOld = !blender && blenders.length > 0 ? blenders.map((x) => x.version).filter(Boolean).sort(cmpVer).pop() || "old" : null;
    const choices = this.blenderChoices(env).map(({ exe, version, supported, addon }) => ({ exe, version, supported, addon }));
    this._apps = { at: now(), claude: !!this.claude.exe, studio, blender, blenderOld, blenderNeeds: this.blenderNeeds(env), blenders: choices, blenderMcp: !!this.blenderMcpServer() };
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
      { id: "code", name: "Claude Code / web", optional: true, skipped: !!this.d.codeSkipped, installed: A.claude, ...dl("Claude desktop", "https://claude.ai/download"), ok: fresh("code"), how: "Optional. Paste the setup prompt into the Claude desktop app's Code tab — it connects to VYRON while it sets everything up. You can skip this and connect things yourself." },
      { id: "studio", name: "Roblox Studio", installed: A.studio, ...dl("Roblox Studio", "https://create.roblox.com/landing"), ok: studioOn && this.studios.length > 0, how: studioOn ? "Open your place in Roblox Studio." : "Open Roblox Studio and turn on its AI / MCP connection (Assistant settings)." },
      { id: "blender", name: "Blender", installed: A.blender && A.blenderMcp, ...(A.blender ? dl("Blender MCP add-on", "https://www.blender.org/lab/mcp-server/") : dl("Blender (free)", "https://www.blender.org/download/")), ...(A.blenderOld ? { tooOld: A.blenderOld } : {}), ok: !!b.open, how: !A.blender ? (A.blenderOld ? `Your Blender ${A.blenderOld} is too old for the MCP add-on — it needs Blender ${A.blenderNeeds} (free).` : `Blender isn't installed. Get the free Blender (${A.blenderNeeds}).`) : b.found ? "Press Connect — VYRON turns on Blender's MCP add-on, opens Blender and connects it. (The add-on itself: Edit → Preferences → Get Extensions → search “MCP” → Install.)" :"Install Blender's MCP: Claude desktop → Settings → Extensions → Blender, plus the MCP add-on in Blender (Edit → Preferences → Get Extensions → search “MCP”)." },
      { id: "roblox", name: "Roblox account", ok: !!this.d.roblox.account, how: "Sign in with Roblox (you type your own password on roblox.com)." },
      { id: "discord", name: "Discord", optional: true, skipped: !!this.d.discordSkipped, ok: !!this.d.secrets.discordWebhook, how: "Paste a Discord channel webhook link (Channel settings → Integrations → Webhooks → New Webhook → Copy URL)." },
    ];
    const need = items.filter((i) => !i.optional);
    return { apps: A, items, done: need.filter((i) => i.ok).length, total: need.length, ready: need.every((i) => i.ok), onboarded: (this.d.setupDoneFor || []).includes(this.setupKey()) };
  }
  /** Setup is done per account on each device: this PC's data folder + the signed-in account. */
  setupKey() { return this.account?.user?.id || this.d.account?.owner || "local"; }
  skipDiscord() { this.d.discordSkipped = true; this.save(); }
  /** Skip an optional setup step (Claude Code / web, Discord). */
  skipSetup(id) {
    if (id === "discord") return this.skipDiscord();
    if (id === "code") { this.d.codeSkipped = true; this.save(); return; }
    throw new Error("That step can't be skipped");
  }
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
      if (this.mcp.info(BLENDER_ID).status !== "connected") await this.mcp.connect({ id: BLENDER_ID, name: "Blender", transport: "stdio", command: srv.command, args: srv.args, env: srv.env });
      if (this.mcp.info(BLENDER_ID).status !== "connected") throw new Error(this.mcp.info(BLENDER_ID).error || "Couldn't start Blender's MCP server");
      const r = await this.mcp.call(BLENDER_ID, "get_blendfile_summary_path_info", {});
      if (r.isError) throw new Error(r.text);
      const file = (String(r.text).match(/[A-Za-z]:\\[^"\n]+?\.blend/) || [])[0] || null;
      this.blenderInfo = { found: true, open: true, file, error: null };
    } catch (e) {
      const msg = String(e.message);
      this.blenderInfo = { found: true, open: false, file: null, broken: /did not find executable|ENOENT|not recognized|cannot find the (path|file)/i.test(msg),
        error: /did not find executable|ENOENT|cannot find the (path|file)/i.test(msg) ? "The Blender MCP program from Claude desktop can't start (" + clip(msg.replace(/^.*did not find executable at /i, "missing "), 160) + "). Reinstall the Blender extension in Claude desktop (Settings → Extensions)."
          : /connect|refused|ECONN|not running|timed out|socket/i.test(msg) ? "Blender isn't open, or its MCP add-on is off. Open Blender and turn the add-on on." : msg.slice(0, 300) };
    }
    this.changed();
    return this.blenderInfo;
  }
  /** "Make a 3D model": a Builder & Modeler Claude makes it in Blender. */
  makeModel(text) {
    text = String(text || "").trim();
    if (!text) throw new Error("Describe the model first");
    if (!blenderServer()) throw new Error("Blender's MCP server isn't installed yet (Claude desktop → Settings → Extensions → Blender).");
    this.ensureBlender();
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

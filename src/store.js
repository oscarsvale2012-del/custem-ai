// Persistent app data. Secrets (API keys, MCP env/header values) are encrypted
// with the adapter the host provides (Electron safeStorage in the app) and are
// never sent to the renderer: publicState() strips them.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const uid = (p) => p + "_" + crypto.randomBytes(5).toString("hex");

const DEFAULTS = () => ({
  version: 2,
  settings: {
    activeProjectId: null,
    defaultAgentId: null,
    permissionMode: "ask_destructive", // ask_all | ask_destructive | autonomous
    maxParallel: 3,
    animations: true,
    reduceEffects: false,
    accent: "#9db8ff",
    logLevel: "info",
  },
  providers: [],
  agents: [],
  mcpServers: [],
  projects: [],
  prompts: [],
  tasks: [],
  conversations: {}, // agentId -> [{role, text, at, blocks?}]
});

class Store {
  constructor({ dataDir, encrypt, decrypt }) {
    this.file = path.join(dataDir, "agentforge-data.json");
    this.legacyFile = path.join(dataDir, "agentforge.json");
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.data = DEFAULTS();
    this._timer = null;
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.data = { ...DEFAULTS(), ...raw, settings: { ...DEFAULTS().settings, ...(raw.settings || {}) } };
      for (const p of this.data.providers) p.apiKey = this._dec(p.apiKey);
      for (const s of this.data.mcpServers) {
        s.env = this._decMap(s.env);
        s.headers = this._decMap(s.headers);
      }
    } catch {
      this.data = DEFAULTS();
      this._migrateLegacy();
    }
    // Tasks that were running when the app closed cannot continue.
    for (const t of this.data.tasks) {
      if (["planning", "in_progress", "testing", "waiting_approval"].includes(t.status)) {
        t.status = "failed";
        t.error = "Interrupted when the app closed. Use Retry.";
      }
    }
    return this;
  }

  // v0.1 stored one global Claude key and a flat agent list.
  _migrateLegacy() {
    try {
      const old = JSON.parse(fs.readFileSync(this.legacyFile, "utf8"));
      const key = this._dec(old.settings?.apiKey);
      if (key) {
        const prov = { id: uid("prov"), type: "anthropic", name: "Claude", baseURL: "", apiKey: key };
        this.data.providers.push(prov);
        for (const a of old.agents || []) {
          this.data.agents.push({
            id: uid("agent"), name: a.name, providerId: prov.id, model: a.model, role: mapLegacyRole(a.role),
            budget: a.budget || 500000, used: a.used || 0, enabled: !a.offline, instructions: "", tools: { files: true, mcp: {} },
          });
        }
      }
      if (old.settings?.projectDir) {
        const pr = { id: uid("proj"), name: path.basename(old.settings.projectDir), rojoDir: old.settings.projectDir, placeId: "", universeId: "", game: null, studioId: null, createdAt: Date.now(), lastActivity: null };
        this.data.projects.push(pr);
        this.data.settings.activeProjectId = pr.id;
      }
    } catch { /* no legacy data */ }
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.saveNow(), 250);
  }

  saveNow() {
    clearTimeout(this._timer);
    const d = this.data;
    const out = {
      ...d,
      providers: d.providers.map((p) => ({ ...p, apiKey: this._enc(p.apiKey) })),
      mcpServers: d.mcpServers.map((s) => ({ ...s, env: this._encMap(s.env), headers: this._encMap(s.headers) })),
      tasks: d.tasks.slice(-400),
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
    fs.renameSync(tmp, this.file);
  }

  _enc(v) { return v ? this.encrypt(v) : ""; }
  _dec(v) { try { return v ? this.decrypt(v) : ""; } catch { return ""; } }
  _encMap(m) { const o = {}; for (const [k, v] of Object.entries(m || {})) o[k] = this._enc(v); return o; }
  _decMap(m) { const o = {}; for (const [k, v] of Object.entries(m || {})) o[k] = this._dec(v); return o; }
}

function mapLegacyRole(r) {
  return { Scripter: "Luau Developer", Builder: "Luau Developer", "UI Designer": "UI/UX Designer", Tester: "Debugger", Animator: "UI/UX Designer", "Sound Designer": "Game Designer" }[r] || "Luau Developer";
}

module.exports = { Store, uid };

// File access to a Rojo project folder, with change history (backups),
// undo, and per-file locks so two agents never edit the same file at once.
const fs = require("fs");
const path = require("path");
const { uid } = require("./store");

const SKIP = new Set(["node_modules", ".git", ".agentforge", "Packages", "DevPackages"]);

class Workspace {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.locks = new Map(); // abs path -> { taskId, agentName }
  }

  root(project) {
    if (!project?.rojoDir) throw new Error("This project has no Rojo folder. Set one on the Projects page.");
    const r = path.resolve(project.rojoDir);
    if (!fs.existsSync(r)) throw new Error("Project folder does not exist: " + r);
    return r;
  }

  resolve(project, rel) {
    const root = this.root(project);
    const target = path.resolve(root, rel || ".");
    const r = path.relative(root, target);
    if (r === ".." || r.startsWith(".." + path.sep) || path.isAbsolute(r)) throw new Error("Path escapes the project folder");
    return { root, target, rel: r.split(path.sep).join("/") || "." };
  }

  list(project, dir = ".") {
    const { root, target } = this.resolve(project, dir);
    if (!fs.existsSync(target)) return [];
    const out = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (out.length >= 600) return;
        if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else out.push({ path: path.relative(root, full).split(path.sep).join("/"), size: fs.statSync(full).size });
      }
    };
    walk(target);
    return out;
  }

  read(project, rel) {
    const { target } = this.resolve(project, rel);
    if (!fs.existsSync(target)) return null;
    if (fs.statSync(target).size > 1024 * 1024) throw new Error("File is larger than 1 MB");
    return fs.readFileSync(target, "utf8");
  }

  search(project, query, max = 60) {
    const q = String(query || "").toLowerCase();
    if (!q) return [];
    const hits = [];
    for (const f of this.list(project)) {
      if (!/\.(luau?|json|txt|md|toml|model\.json|meta\.json)$/i.test(f.path) || f.size > 400000) continue;
      const lines = this.read(project, f.path).split(/\r?\n/);
      lines.forEach((ln, i) => { if (hits.length < max && ln.toLowerCase().includes(q)) hits.push(`${f.path}:${i + 1}: ${ln.trim().slice(0, 160)}`); });
      if (hits.length >= max) break;
    }
    return hits;
  }

  lock(project, rel, taskId, agentName) {
    const { target } = this.resolve(project, rel);
    const l = this.locks.get(target);
    if (l && l.taskId !== taskId) throw new Error(`${rel} is being edited by ${l.agentName} right now. Work on another file or wait for their task to finish.`);
    this.locks.set(target, { taskId, agentName });
  }

  releaseTask(taskId) {
    for (const [k, v] of this.locks) if (v.taskId === taskId) this.locks.delete(k);
  }

  lockedBy(project, rel) {
    try { return this.locks.get(this.resolve(project, rel).target) || null; } catch { return null; }
  }

  /** Write a file, keeping the previous version in history. Returns the change record. */
  write(project, rel, content, meta) {
    const { target, rel: clean } = this.resolve(project, rel);
    const before = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
    return this._record(project, { op: "write", path: clean, before, after: content, ...meta });
  }

  remove(project, rel, meta) {
    const { target, rel: clean } = this.resolve(project, rel);
    if (!fs.existsSync(target)) throw new Error("File does not exist");
    const before = fs.readFileSync(target, "utf8");
    fs.unlinkSync(target);
    return this._record(project, { op: "delete", path: clean, before, after: null, ...meta });
  }

  _histFile(project) { return path.join(this.dataDir, "history", project.id + ".jsonl"); }

  _record(project, c) {
    const rec = { id: uid("chg"), at: Date.now(), status: "applied", ...c };
    const f = this._histFile(project);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, JSON.stringify(rec) + "\n");
    return rec;
  }

  history(project, limit = 200) {
    try {
      const lines = fs.readFileSync(this._histFile(project), "utf8").trim().split("\n").filter(Boolean);
      const map = new Map();
      for (const l of lines) { const r = JSON.parse(l); map.set(r.id, { ...(map.get(r.id) || {}), ...r }); }
      return [...map.values()].sort((a, b) => b.at - a.at).slice(0, limit);
    } catch { return []; }
  }

  /** Restore the file to how it was before this change. */
  undo(project, changeId) {
    const rec = this.history(project, 100000).find((r) => r.id === changeId);
    if (!rec) throw new Error("Change not found");
    if (rec.status === "undone") throw new Error("Already undone");
    const { target } = this.resolve(project, rec.path);
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
    if (current !== rec.after) throw new Error(`${rec.path} was changed again after this edit. Undo the newer change first.`);
    if (rec.before === null) fs.unlinkSync(target);
    else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, rec.before, "utf8"); }
    fs.appendFileSync(this._histFile(project), JSON.stringify({ id: rec.id, status: "undone", undoneAt: Date.now() }) + "\n");
    return rec;
  }

  /** Zip-free snapshot: copy the whole src tree into app data. */
  snapshot(project, label) {
    const root = this.root(project);
    const dest = path.join(this.dataDir, "snapshots", project.id, `${Date.now()}-${String(label || "snapshot").replace(/[^a-z0-9-]+/gi, "_").slice(0, 40)}`);
    let n = 0;
    for (const f of this.list(project)) {
      const to = path.join(dest, f.path);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(root, f.path), to);
      n++;
    }
    return { dir: dest, files: n };
  }
}

module.exports = { Workspace };

/* VYRON renderer. All data comes from the backend (Electron main
   process, or src/devserver.js in a browser). Nothing here is simulated. */
"use strict";

/* ---------------- bridge ---------------- */
const B = window.forgeBridge || (() => {
  const ls = [];
  const es = new EventSource("/events");
  es.onmessage = (e) => { const m = JSON.parse(e.data); ls.forEach((f) => f(m.type, m.payload)); };
  return {
    call: async (method, ...args) => {
      const r = await fetch("/api/" + method, { method: "POST", body: JSON.stringify(args) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      return j.value;
    },
    host: async (cmd) => (cmd === "isDesktop" ? false : null),
    on: (f) => ls.push(f),
  };
})();

/* ---------------- helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtN = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n || 0)));
const time = (t) => (t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const ago = (t) => {
  if (!t) return "never";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return new Date(t).toLocaleDateString();
};
const initials = (n) => String(n || "?").replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

const ICON = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  workspace: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  agents: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 6 4.8"/>',
  mcp: '<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0z"/><path d="M12 16v5"/>',
  roblox: '<path d="m6.5 3 14.5 3.9-3.9 14.6L2.5 17.6z"/><path d="m10.6 9.4 3.9 1-1 3.9-3.9-1z"/>',
  projects: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  prompts: '<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 9h8M8 13h6"/>',
  tasks: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>', sparkle: '<path d="M12 3l1.9 5.6L19.5 10.5 13.9 12.4 12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>', star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', play: '<path d="m6 4 14 8-14 8z"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  revenue: '<path d="M12 2.5 20.2 7.2v9.6L12 21.5l-8.2-4.7V7.2z"/><path d="M12 7.5 16.1 9.8v4.4L12 16.5l-4.1-2.3V9.8z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M17 6l3 3M14.5 8.5l2 2"/>', link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
};
const ic = (n, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[n] || ""}</svg>`;

const PAGES = [
  ["dashboard", "Dashboard"], ["workspace", "AI Workspace"], ["agents", "AI Agents"], ["mcp", "MCP Servers"],
  ["roblox", "Roblox Studio"], ["projects", "Projects"], ["revenue", "Revenue"], ["prompts", "Prompt Library"], ["tasks", "Task Manager"], ["settings", "Settings"],
];
const SUB = {
  dashboard: "Your AI team at a glance", workspace: "Talk to agents and send instructions", agents: "Providers, models and team roles",
  mcp: "External tools for your agents", roblox: "Studio connection and project files", projects: "Your Roblox games", revenue: "Robux, pending earnings and game revenue",
  prompts: "Save, improve and reuse prompts", tasks: "Everything the agents are working on", settings: "Preferences, permissions and diagnostics",
};
const AGENT_ST = { working: ["Working", "ok"], idle: ["Idle", "idle"], disconnected: ["Not connected", "warn"], offline: ["Offline", ""], tokens: ["Out of tokens", "bad"] };
const TASK_ST = { pending: "Pending", planning: "Planning", in_progress: "In progress", waiting_approval: "Waiting for approval", testing: "Testing", completed: "Completed", failed: "Failed", cancelled: "Cancelled" };
const CATEGORIES = ["Roblox UI", "Game Mechanics", "Simulator Systems", "Tycoon Systems", "Combat Systems", "Inventory Systems", "Pet Systems", "Animation", "Optimization", "Bug Fixes", "Game Design", "Scripting"];
const OPENAI_PRESETS = [["OpenAI", "https://api.openai.com/v1"], ["OpenRouter", "https://openrouter.ai/api/v1"], ["Groq", "https://api.groq.com/openai/v1"], ["Ollama (local)", "http://localhost:11434/v1"], ["LM Studio (local)", "http://localhost:1234/v1"]];

/* ---------------- state ---------------- */
let S = null;
let desktop = false;
const ui = {
  route: lsGet("route") || "dashboard",
  wsSel: [], wsFocus: null, taskSel: null, taskFilter: "active", promptCat: "All", promptQ: "",
  mcpOpen: {}, fileSel: null, fileContent: null, files: null, filesFor: null, drawer: null,
};
function lsGet(k) { try { return localStorage.getItem("af." + k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem("af." + k, v); } catch { /* ignore */ } }

const agentById = (id) => S.agents.find((a) => a.id === id);
const activeProject = () => S.projects.find((p) => p.id === S.activeProjectId) || null;

async function call(method, ...args) {
  try { return await B.call(method, ...args); }
  catch (e) { toast(e.message, "error"); throw e; }
}
function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.innerHTML = `<span class="dot ${kind === "error" ? "error" : "connected"}"></span><span>${esc(msg)}</span>`;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.style.transition = "opacity .3s"; t.style.opacity = 0; setTimeout(() => t.remove(), 300); }, kind === "error" ? 6000 : 3000);
}

/* ---------------- render loop (keeps inputs, focus and scroll) ---------------- */
let rq = false;
function render() { if (!rq) { rq = true; requestAnimationFrame(() => { rq = false; draw(); }); } }

function preserve(root) {
  const keep = {};
  $$("[id]", root).forEach((el) => {
    const k = { scroll: el.scrollTop };
    if ("value" in el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) {
      k.value = el.value; k.focus = document.activeElement === el;
      try { k.ss = el.selectionStart; k.se = el.selectionEnd; } catch { /* select */ }
    }
    keep[el.id] = k;
  });
  return keep;
}
function restore(root, keep) {
  for (const [id, k] of Object.entries(keep)) {
    const el = root.querySelector("#" + CSS.escape(id));
    if (!el) continue;
    if (k.value !== undefined && el.dataset.fresh === undefined) el.value = k.value;
    if (k.scroll && !el.dataset.stick) el.scrollTop = k.scroll;
    if (k.focus) { el.focus(); try { el.setSelectionRange(k.ss, k.se); } catch { /* ignore */ } }
  }
}

let lastRoute = null;
function draw() {
  if (!S) return;
  if (S.locked) { document.body.classList.add("locked"); drawLock(); return; }
  if (document.body.classList.contains("locked")) { document.body.classList.remove("locked"); $("#lockRoot").innerHTML = ""; lastRoute = null; }
  document.documentElement.dataset.theme = S.settings.theme === "light" ? "light" : "dark";
  document.body.classList.toggle("noanim", S.settings.animations === false);
  document.body.classList.toggle("reduce", !!S.settings.reduceEffects);
  drawNav();
  const page = $("#page");
  const keep = preserve(page);
  const sticky = $("#thread") ? $("#thread").scrollHeight - $("#thread").scrollTop - $("#thread").clientHeight < 60 : true;
  const pageScroll = page.scrollTop;
  page.innerHTML = (VIEWS[ui.route] || VIEWS.dashboard)();
  page.scrollTop = pageScroll;
  const projChanged = ui.lastProj !== S.activeProjectId;
  ui.lastProj = S.activeProjectId;
  page.classList.toggle("settled", lastRoute === ui.route && !projChanged);
  if (lastRoute !== ui.route) { page.classList.remove("page-in"); void page.offsetWidth; page.classList.add("page-in"); page.scrollTop = 0; lastRoute = ui.route; }
  else restore(page, keep);
  const th = $("#thread"); if (th && sticky) th.scrollTop = th.scrollHeight;
  $("#title").textContent = PAGES.find((p) => p[0] === ui.route)?.[1] || "";
  $("#subtitle").textContent = SUB[ui.route] || "";
  $("#topActions").innerHTML = `<button class="btn sm ${S.approvals.length ? "" : "ghost"}" data-act="openApprovals" title="Approvals">${ic("bell")}${S.approvals.length ? `<b>${S.approvals.length}</b> waiting` : ""}</button>`;
  const dr = $("#drawerRoot"), dk = preserve(dr);
  const drawerKey = ui.drawer + ":" + (ui.drawer === "task" ? ui.taskSel : "");
  dr.innerHTML = drawDrawer();
  dr.classList.toggle("settled", dr.dataset.key === drawerKey);
  dr.dataset.key = drawerKey;
  restore(dr, dk);
  // Keep looping animations in phase across re-renders so nothing jumps.
  const t = performance.now();
  $$(".spinner").forEach((e) => (e.style.animationDelay = -(t % 800) + "ms"));
  $$(".dot.working,.st-working .dot").forEach((e) => (e.style.animationDelay = -(t % 1800) + "ms"));
  $$(".dot.connecting,.dot.checking").forEach((e) => (e.style.animationDelay = -(t % 1000) + "ms"));
  $$(".bar.live i").forEach((e) => (e.style.animationDelay = -(t % 1800) + "ms"));
  $$(".typing i").forEach((e, i) => (e.style.animationDelay = -(t % 1200) + i * 150 + "ms"));
  afterDraw();
}

function drawNav() {
  const counts = {
    workspace: S.tasks.filter((t) => t.kind === "chat" && ["in_progress", "waiting_approval"].includes(t.status)).length,
    agents: S.agents.filter((a) => a.status === "working").length,
    tasks: S.tasks.filter((t) => ["pending", "planning", "in_progress", "testing", "waiting_approval"].includes(t.status) && t.kind !== "chat").length,
    mcp: S.mcpServers.filter((m) => m.status === "error").length,
  };
  $("#nav").innerHTML = PAGES.map(([k, label]) => `<div class="nav ${ui.route === k ? "on" : ""}" data-go="${k}">${ic(k === "workspace" ? "workspace" : k)}${label}${counts[k] ? `<span class="count ${k === "mcp" ? "alert" : ""}">${counts[k]}</span>` : ""}</div>`).join("");
  const p = activeProject();
  const conn = S.providers.filter((x) => x.status === "connected").length;
  $("#sideFoot").innerHTML = `
    ${p ? `<div class="mini-proj" data-go="projects">${gameIcon(p, "sm")}<div class="grow"><div class="ell" style="font-weight:600;font-size:13px">${esc(p.game?.name || p.name)}</div><div class="faint" style="font-size:11.5px"><span class="dot ${p.studioConnected ? "connected" : "unknown"}" style="display:inline-block;width:6px;height:6px;margin-right:5px"></span>${p.studioConnected ? "Studio connected" : "Studio not linked"}</div></div></div>`
      : `<div class="mini-proj" data-go="projects"><div class="gicon sm"><div class="fallback">+</div></div><div class="faint" style="font-size:12.5px">Add a project</div></div>`}
    <div class="faint" style="font-size:11.5px;padding:2px 4px">${conn}/${S.providers.length} providers · ${S.mcpServers.filter((m) => m.status === "connected").length}/${S.mcpServers.length} MCP</div>
    ${S.auth?.user ? `<div class="row acct" data-go="settings" title="${esc(S.auth.user.email)}"><div class="av" style="margin:0;width:24px;height:24px;font-size:10px;overflow:hidden">${S.auth.user.photo ? `<img src="${esc(S.auth.user.photo)}" alt="" style="width:100%;height:100%;object-fit:cover">` : esc(initials(S.auth.user.name))}</div><span class="ell grow" style="font-size:12px">${esc(S.auth.user.email)}</span></div>` : ""}`;
}

/* ---------------- shared pieces ---------------- */
function gameIcon(p, size = "") {
  const name = p?.game?.name || p?.name || "?";
  const fb = `<div class="fallback">${esc(initials(name))}</div>`;
  const img = p?.game?.iconUrl ? `<img src="${esc(p.game.iconUrl)}" alt="${esc(name)} icon" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'fallback',textContent:${esc(JSON.stringify(initials(name)))}}))">` : fb;
  return `<div class="gicon ${size}" data-key="${esc(p?.id || "")}">${img}</div>`;
}
function statusChip(st) { const [label, cls] = AGENT_ST[st] || [st, ""]; return `<span class="chip ${cls}"><span class="dot ${st}"></span>${label}</span>`; }
function taskStatus(st) { return `<span class="status-pill s-${st}">${st === "in_progress" || st === "planning" || st === "testing" ? '<span class="spinner" style="width:10px;height:10px;border-width:1.5px"></span>' : ""}${TASK_ST[st] || st}</span>`; }
function bar(v, cls = "") { return `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, v * 100)).toFixed(1)}%"></i></div>`; }
function empty(title, text, action = "") { return `<div class="empty"><b>${esc(title)}</b>${esc(text)}${action ? `<div class="sp"></div>${action}` : ""}</div>`; }
function agentNow(a) {
  if (a.status === "working") { const t = S.tasks.find((x) => x.id === a.currentTaskId); return t ? `${esc(t.stage || t.title)}` : "Working…"; }
  if (a.status === "idle") return "Ready for work.";
  if (a.status === "tokens") return a.used >= a.budget ? "Token budget used up. Reset it or raise the budget." : "The provider account is out of credits.";
  if (a.status === "offline") return a.enabled ? "Cannot reach the AI provider." : "Switched off.";
  return esc(a.providerError || "Not connected.");
}

function md(text) {
  const parts = String(text || "").split(/```/);
  return parts.map((p, i) => {
    if (i % 2) {
      const nl = p.indexOf("\n");
      const lang = nl > -1 ? p.slice(0, nl).trim() : "";
      const code = nl > -1 ? p.slice(nl + 1) : p;
      return `<div class="code"><div class="ch">${esc(lang || "code")}<span class="grow"></span><button class="btn ghost sm" data-act="copyCode">${ic("copy")}Copy</button></div><pre>${esc(code.replace(/\n$/, ""))}</pre></div>`;
    }
    let h = esc(p)
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
      .replace(/^#{1,3} (.+)$/gm, "<h3>$1</h3>")
      .replace(/^(?:[-*] .+(?:\n|$))+/gm, (m) => "<ul>" + m.trim().split("\n").map((l) => `<li>${l.replace(/^[-*] /, "")}</li>`).join("") + "</ul>");
    return h.split(/\n{2,}/).map((b) => (/^<(ul|h3|div)/.test(b.trim()) ? b : `<p>${b.replace(/\n/g, "<br>")}</p>`)).join("");
  }).join("");
}

function lineDiff(a, b) {
  const A = a === null || a === undefined ? [] : String(a).split("\n"), Bl = b === null || b === undefined ? [] : String(b).split("\n");
  if (A.length * Bl.length > 3e6) return [...A.map((l) => ["del", l]), ...Bl.map((l) => ["add", l])];
  const n = A.length, m = Bl.length, dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === Bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === Bl[j]) { out.push(["ctx", A[i]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(["del", A[i++]]); else out.push(["add", Bl[j++]]); }
  while (i < n) out.push(["del", A[i++]]); while (j < m) out.push(["add", Bl[j++]]);
  return out;
}
function diffView(before, after) {
  const rows = lineDiff(before, after);
  const keep = rows.map((r, i) => r[0] !== "ctx" || rows.slice(Math.max(0, i - 3), i + 4).some((x) => x[0] !== "ctx"));
  let html = "", skipped = 0;
  rows.forEach((r, i) => {
    if (!keep[i]) { skipped++; return; }
    if (skipped) { html += `<div class="ctx">  … ${skipped} unchanged lines</div>`; skipped = 0; }
    html += `<div class="${r[0]}">${r[0] === "add" ? "+ " : r[0] === "del" ? "- " : "  "}${esc(r[1])}</div>`;
  });
  if (skipped) html += `<div class="ctx">  … ${skipped} unchanged lines</div>`;
  return `<div class="diff">${html || '<div class="ctx">  (empty file)</div>'}</div>`;
}

/* =================== VIEWS =================== */
const VIEWS = {};

VIEWS.dashboard = () => {
  const p = activeProject();
  const ag = S.agents;
  const cnt = (st) => ag.filter((a) => a.status === st).length;
  const liveTasks = S.tasks.filter((t) => ["pending", "planning", "in_progress", "testing", "waiting_approval"].includes(t.status) && t.kind !== "chat").slice(-8).reverse();
  return `
  <div class="grid" style="grid-template-columns:minmax(0,1.55fr) minmax(0,1fr)">
    ${activeProjectCard(p)}
    <div class="panel pad stack">
      <div class="row"><div class="h3 grow">Build with your AI team</div><span class="faint" style="font-size:12px">${p ? esc(p.game?.name || p.name) : "No project"}</span></div>
      <textarea class="input" id="quickBuild" placeholder="Describe a game system… e.g. “Create a simulator with pets, eggs, an inventory, a shop, currency and upgrades with a clean modern interface.”" style="min-height:118px"></textarea>
      <div class="row"><button class="btn sm ghost" data-go="prompts">${ic("prompts")}Prompt library</button><div class="grow"></div><button class="btn primary" data-act="quickBuild">${ic("bolt")}Plan &amp; build</button></div>
    </div>
  </div>
  <div class="sp"></div>
  <div class="grid g4">
    <div class="panel stat"><div class="label">Agents</div><div class="n">${cnt("working")}<span class="faint" style="font-size:15px"> working</span></div><div class="d">${cnt("idle")} idle · ${cnt("disconnected")} not connected · ${cnt("offline")} offline · ${cnt("tokens")} out of tokens</div></div>
    <div class="panel stat"><div class="label">AI providers</div><div class="n">${S.providers.filter((x) => x.status === "connected").length}<span class="faint" style="font-size:15px"> / ${S.providers.length}</span></div><div class="d">${S.providers.length ? S.providers.map((x) => esc(x.name)).join(", ") : "None yet — add one on AI Agents"}</div></div>
    <div class="panel stat"><div class="label">MCP servers</div><div class="n">${S.mcpServers.filter((m) => m.status === "connected").length}<span class="faint" style="font-size:15px"> / ${S.mcpServers.length}</span></div><div class="d">${S.mcpServers.reduce((n, m) => n + m.tools.length, 0)} tools available</div></div>
    <div class="panel stat"><div class="label">Tasks</div><div class="n">${liveTasks.length}<span class="faint" style="font-size:15px"> active</span></div><div class="d">${S.tasks.filter((t) => t.status === "completed" && t.kind !== "chat").length} completed · ${S.tasks.filter((t) => t.status === "failed").length} failed</div></div>
  </div>
  <div class="sp"></div>
  <div class="grid g3">
    <div class="panel"><div class="panel-h"><h3>Agents</h3><div class="grow"></div><button class="btn sm ghost" data-go="agents">Manage</button></div>
      ${ag.length ? ag.map((a) => `<div class="list-row click" data-go="agents"><div class="ava" style="width:30px;height:30px;font-size:11px;border-radius:9px">${esc(initials(a.name))}</div><div class="grow"><div class="row"><b style="font-weight:600">${esc(a.name)}</b><span class="faint" style="font-size:12px">${esc(a.role)}</span></div><div class="faint ell" style="font-size:12px">${agentNow(a)}</div></div><span class="dot ${a.status}" title="${AGENT_ST[a.status][0]}"></span></div>`).join("")
        : empty("No agents yet", "Connect an AI provider and your team is created automatically.", `<button class="btn sm" data-go="agents">${ic("plus")}Connect a provider</button>`)}
    </div>
    <div class="panel"><div class="panel-h"><h3>Active tasks</h3><div class="grow"></div><button class="btn sm ghost" data-go="tasks">All tasks</button></div>
      ${liveTasks.length ? liveTasks.map((t) => `<div class="list-row click" data-act="openTask" data-id="${t.id}"><div class="grow"><div class="ell" style="font-weight:500">${esc(t.title)}</div><div class="faint ell" style="font-size:12px">${esc(agentById(t.agentId)?.name || "Unassigned")} · ${esc(t.stage || "")}</div></div>${taskStatus(t.status)}</div>`).join("")
        : empty("Nothing running", "Describe something to build and the team will plan it.")}
    </div>
    <div class="panel activity"><div class="panel-h"><h3>Recent activity</h3></div>
      <div style="max-height:360px;overflow:auto" id="dashAct">${S.activity.slice(-30).reverse().map((l) => `<div class="list-row"><time>${time(l.at)}</time><div class="grow"><b class="lv-${l.level}" style="font-weight:600">${esc(l.source)}</b> <span class="muted">${esc(l.text)}</span></div></div>`).join("") || empty("Quiet so far", "")}</div>
    </div>
  </div>
  ${S.projects.length > 1 ? `<div class="sp"></div><div class="panel"><div class="panel-h"><h3>Recent projects</h3></div><div class="row wrap" style="padding:14px 18px;gap:12px">${[...S.projects].sort((a, b) => (b.lastActivity || b.createdAt) - (a.lastActivity || a.createdAt)).slice(0, 6).map((p) => `<div class="mini-proj" data-act="setProject" data-id="${p.id}" style="min-width:220px">${gameIcon(p, "sm")}<div class="grow"><div class="ell" style="font-weight:600;font-size:13px">${esc(p.game?.name || p.name)}</div><div class="faint" style="font-size:11.5px">${p.id === S.activeProjectId ? "Active" : "Active " + ago(p.lastActivity)}</div></div></div>`).join("")}</div></div>` : ""}`;
};

function activeProjectCard(p) {
  if (!p) return `<div class="panel game-card"><div class="gicon"><div class="fallback">+</div></div><div class="game-meta stack grow"><h2>No project selected</h2><div class="muted">Add your Roblox game: link it from Roblox Studio, or enter its Place ID, and choose its Rojo folder.</div><div class="row"><button class="btn primary" data-act="addProject">${ic("plus")}Add project</button><button class="btn" data-go="roblox">${ic("roblox")}Connect Studio</button></div></div></div>`;
  const agents = p.activeAgents.map(agentById).filter(Boolean);
  const b = p.build;
  return `<div class="panel game-card">
    ${gameIcon(p)}
    <div class="game-meta grow stack" style="gap:8px;min-width:0">
      <div class="row"><div class="label">Active project</div><div class="grow"></div>
        <button class="btn sm ghost icon" title="Refresh game info" data-act="refreshGame" data-id="${p.id}">${ic("refresh")}</button>
        ${S.projects.length > 1 ? `<button class="btn sm" data-go="projects">Switch</button>` : ""}</div>
      <h2 class="ell">${esc(p.game?.name || p.name)}</h2>
      <div class="kv">${p.universeId ? `<span>Universe <b>${esc(p.universeId)}</b></span>` : ""}${p.placeId ? `<span>Place <b>${esc(p.placeId)}</b></span>` : ""}${p.game?.creator ? `<span>by <b>${esc(p.game.creator)}</b></span>` : ""}${p.lastChange ? `<span>Last change <b>${ago(p.lastChange)}</b></span>` : ""}</div>
      ${p.gameError ? `<div class="faint" style="font-size:12px">${esc(p.gameError)}</div>` : ""}
      <div class="row wrap">
        <span class="chip ${p.studioConnected ? "ok" : ""}"><span class="dot ${p.studioConnected ? "connected" : "unknown"}"></span>${p.studioConnected ? "Studio connected" + (p.studio?.mode ? " · " + esc(p.studio.mode) : "") : "Studio not connected"}</span>
        <span class="chip ${p.rojoDir ? "" : "warn"}">${ic("folder")}${p.rojoDir ? "Rojo folder linked" : "No Rojo folder"}</span>
        ${(() => { const rev = S.revenue.analytics[p.universeId]?.series?.revenue || []; const d = rev.length > 1 ? rev[rev.length - 2] : rev[0]; return d ? `<span class="chip" data-go="revenue" style="cursor:pointer">${rbx(d.value)} on ${esc(shortDate(d.time))}</span>` : ""; })()}
        ${agents.length ? `<span class="chip ok"><div class="avatars">${agents.map((a) => `<div class="av working" title="${esc(a.name)}">${esc(initials(a.name))}</div>`).join("")}</div>${agents.length} working</span>` : ""}
      </div>
      ${b ? `<div class="stack" style="gap:6px;margin-top:4px"><div class="row"><span class="ell grow" style="font-weight:500">${esc(b.title)}</span>${taskStatus(b.status)}</div>${bar(b.progress, ["in_progress", "planning", "testing"].includes(b.status) ? "live" : b.status === "failed" ? "bad" : "")}<div class="faint ell" style="font-size:12px">${esc(b.stage || "")}</div></div>` : p.currentTask ? `<div class="faint" style="font-size:12.5px">Now: ${esc(p.currentTask.title)}</div>` : ""}
    </div>
  </div>`;
}

/* ---------- workspace ---------- */
VIEWS.workspace = () => {
  if (!S.agents.length) return `<div class="panel">${empty("No agents yet", "Connect an AI provider on the AI Agents page first.", `<button class="btn" data-go="agents">Go to AI Agents</button>`)}</div>`;
  ui.wsSel = ui.wsSel.filter((id) => agentById(id));
  if (!ui.wsSel.length) ui.wsSel = [S.settings.defaultAgentId && agentById(S.settings.defaultAgentId) ? S.settings.defaultAgentId : S.agents[0].id];
  if (!ui.wsSel.includes(ui.wsFocus)) ui.wsFocus = ui.wsSel[0];
  const focus = agentById(ui.wsFocus);
  const conv = S.conversations[focus.id] || [];
  const busy = S.tasks.some((t) => t.kind === "chat" && t.agentId === focus.id && ["pending", "in_progress", "waiting_approval"].includes(t.status));
  const apr = S.approvals.filter((a) => ui.wsSel.includes(a.agentId));
  return `<div class="ws" style="height:calc(100vh - 102px)">
    <div class="panel ws-agents"><div class="panel-h"><h3>Agents</h3><div class="grow"></div><span class="faint" style="font-size:12px">${ui.wsSel.length} selected</span></div>
      <div style="padding:8px">${S.agents.map((a) => `<div class="pick ${a.id === ui.wsFocus ? "on" : ""}" data-act="wsFocus" data-id="${a.id}"><span class="check ${ui.wsSel.includes(a.id) ? "on" : ""}" data-act="wsToggle" data-id="${a.id}"></span><div class="grow" style="min-width:0"><div class="ell" style="font-weight:500">${esc(a.name)}</div><div class="faint ell" style="font-size:11.5px">${esc(a.role)}</div></div><span class="dot ${a.status}" title="${AGENT_ST[a.status][0]}"></span></div>`).join("")}</div>
    </div>
    <div class="panel chat">
      <div class="panel-h"><div class="ava" style="width:30px;height:30px;font-size:11px;border-radius:9px">${esc(initials(focus.name))}</div><div><h3>${esc(focus.name)}</h3><div class="faint" style="font-size:12px">${esc(focus.role)} · ${esc(focus.model)}</div></div><div class="grow"></div>${statusChip(focus.status)}<button class="btn sm ghost" data-act="clearChat" data-id="${focus.id}">Clear</button></div>
      <div class="thread" id="thread">
        ${conv.length ? conv.map((m) => msgView(m, focus)).join("") : `<div class="empty" style="margin:auto"><b>Start a conversation with ${esc(focus.name)}</b>Ask questions, give instructions or request changes. The agent can read and edit your project and use its MCP tools.</div>`}
        ${busy ? `<div class="msg assistant"><div class="who">${esc(focus.name)}</div><span class="typing"><i></i><i></i><i></i></span> <span class="faint" style="font-size:12px">${esc(S.tasks.find((t) => t.kind === "chat" && t.agentId === focus.id && t.status !== "completed")?.stage || "")}</span></div>` : ""}
        ${apr.map(approvalCard).join("")}
      </div>
      <div class="composer">
        <textarea id="chatInput" placeholder="Message ${ui.wsSel.length > 1 ? ui.wsSel.length + " agents" : esc(focus.name)}…  (Enter to send, Shift+Enter for a new line)"></textarea>
        <div class="row"><span class="faint" style="font-size:12px">${ui.wsSel.length > 1 ? "Sends to: " + ui.wsSel.map((id) => esc(agentById(id).name)).join(", ") : ""}</span><div class="grow"></div>
          <button class="btn sm" data-act="chatBuild" title="Plan and split into tasks for the selected agents">${ic("bolt")}Build with team</button>
          <button class="btn sm primary" data-act="chatSend">${ic("send")}Send</button></div>
      </div>
    </div>
  </div>`;
};
function msgView(m, agent) {
  if (m.role === "user") return `<div class="msg user">${esc(m.text).replace(/\n/g, "<br>")}</div>`;
  if (m.role === "error") return `<div class="msg error">⚠ ${esc(m.text)}</div>`;
  return `<div class="msg assistant"><div class="who"><b style="color:var(--text);font-weight:600">${esc(agent.name)}</b>${time(m.at)}</div><div class="md">${md(m.text)}</div>
    ${m.changes?.length ? `<div class="row wrap" style="margin-top:6px">${m.changes.map((c) => `<button class="chip" style="cursor:pointer" data-act="viewChange" data-id="${c.id}">${ic("edit")}${esc(c.op)} ${esc(c.path)}</button>`).join("")}</div>` : ""}</div>`;
}
function approvalCard(a) {
  const d = a.detail || {};
  return `<div class="panel pad" style="border-color:rgba(243,197,111,.35)"><div class="row"><span class="dot disconnected"></span><b>${esc(a.agentName)}</b><span class="muted grow">wants to: ${esc(a.title)}</span><span class="faint" style="font-size:12px">${time(a.at)}</span></div>
    <div class="sp" style="height:10px"></div>
    ${a.kind === "tool" ? `<div class="code"><div class="ch">${esc(d.server)} → ${esc(d.tool)}</div><pre>${esc(JSON.stringify(d.args, null, 2))}</pre></div>` : diffView(d.before, d.after)}
    ${d.reason ? `<div class="muted" style="font-size:12.5px;margin-top:8px">Reason: ${esc(d.reason)}</div>` : ""}
    <div class="row" style="margin-top:10px"><input class="input" id="note-${a.id}" placeholder="Optional note to the agent"><button class="btn danger" data-act="reject" data-id="${a.id}">Reject</button><button class="btn primary" data-act="approve" data-id="${a.id}">Approve</button></div></div>`;
}

/* ---------- agents ---------- */
VIEWS.agents = () => `
  <div class="panel"><div class="panel-h"><h3>AI providers</h3><span class="faint" style="font-size:12px">API keys are encrypted on this PC and never shown in the app.</span><div class="grow"></div><button class="btn sm primary" data-act="addProvider">${ic("plus")}Add provider</button></div>
    ${S.providers.length ? S.providers.map((p) => `<div class="list-row"><span class="dot ${p.status}"></span><div class="grow"><div class="row"><b style="font-weight:600">${esc(p.name)}</b><span class="tag">${esc(S.providerTypes[p.type]?.label.split(" (")[0] || p.type)}</span>${p.hasKey ? '<span class="tag">key saved</span>' : ""}</div>
      <div class="faint" style="font-size:12px">${p.status === "connected" ? `Connected · ${p.models.length} models` : p.status === "checking" ? "Checking connection…" : esc(p.error || "Not tested")}${p.baseURL ? " · " + esc(p.baseURL) : ""}</div></div>
      <button class="btn sm" data-act="testProvider" data-id="${p.id}">${ic("refresh")}Reconnect</button><button class="btn sm" data-act="editProvider" data-id="${p.id}">${ic("edit")}Edit</button><button class="btn sm ghost danger" data-act="removeProvider" data-id="${p.id}">${ic("trash")}</button></div>`).join("")
      : empty("No AI provider connected", "Add Anthropic Claude or any OpenAI-compatible provider (OpenAI, OpenRouter, Groq, Ollama, LM Studio).")}
  </div>
  <div class="sp"></div>
  <div class="row"><div class="h3 grow">Team · ${S.agents.length} agents</div>${S.providers.length && !S.agents.length ? `<button class="btn sm" data-act="defaultTeam">Create default team</button>` : ""}<button class="btn sm primary" data-act="addAgent" ${S.providers.length ? "" : "disabled"}>${ic("plus")}Add agent</button></div>
  <div class="sp" style="height:12px"></div>
  <div class="cards">${S.agents.map(agentCard).join("") || ""}</div>`;

function agentCard(a) {
  const pct = a.used / a.budget;
  const mcpNames = S.mcpServers.filter((s) => s.status === "connected" && (a.tools?.mcp?.[s.id] ?? "all") !== "none").map((s) => s.name);
  return `<div class="panel agent st-${a.status}">
    <div class="row"><div class="ava">${esc(initials(a.name))}</div><div class="grow" style="min-width:0"><h4 class="ell">${esc(a.name)}</h4><div class="faint ell" style="font-size:12px">${esc(a.role)}</div></div>${statusChip(a.status)}</div>
    <div class="now">${agentNow(a)}</div>
    <div class="kv" style="margin-bottom:10px"><span>Provider <b>${esc(a.providerName)}</b></span><span>Model <b>${esc(a.model)}</b></span></div>
    <div class="faint" style="font-size:12px;margin-bottom:10px">${esc(S.roles[a.role] || "")}</div>
    <div class="row wrap" style="margin-bottom:12px"><span class="tag">${a.toolCount} tools</span>${a.tools?.files !== false ? '<span class="tag">project files</span>' : ""}${mcpNames.map((n) => `<span class="tag">${esc(n)}</span>`).join("")}</div>
    <div class="row" style="font-size:11.5px;margin-bottom:6px"><span class="faint grow">Tokens</span><span class="muted">${fmtN(a.used)} / ${fmtN(a.budget)}</span></div>
    ${bar(pct, pct >= 1 ? "bad" : pct > 0.8 ? "warn" : "")}
    <div class="row" style="margin-top:14px"><button class="btn sm" data-act="editAgent" data-id="${a.id}">${ic("settings")}Configure</button>
      ${a.status === "tokens" ? `<button class="btn sm" data-act="agentAct" data-op="reset_budget" data-id="${a.id}">Reset tokens</button>` : ""}
      ${["disconnected", "offline"].includes(a.status) && a.enabled ? `<button class="btn sm" data-act="agentAct" data-op="reconnect" data-id="${a.id}">${ic("refresh")}Reconnect</button>` : ""}
      <div class="grow"></div>
      <button class="btn sm ghost" data-act="agentAct" data-op="${a.enabled ? "disable" : "enable"}" data-id="${a.id}">${a.enabled ? "Switch off" : "Switch on"}</button>
      <button class="btn sm ghost danger icon" title="Remove" data-act="removeAgent" data-id="${a.id}">${ic("trash")}</button></div>
  </div>`;
}

/* ---------- MCP ---------- */
VIEWS.mcp = () => {
  const hasStudio = S.mcpServers.some((s) => s.kind === "roblox-studio");
  return `<div class="row"><div class="muted grow" style="font-size:13px">Agents can use tools from these servers. Read-only tools run automatically; other tools ask you first (change this per tool or in Settings → Permissions).</div>
    ${hasStudio ? "" : `<button class="btn" data-act="addStudioServer">${ic("roblox")}Add Roblox Studio</button>`}<button class="btn primary" data-act="addServer">${ic("plus")}Add server</button></div>
  <div class="sp"></div>
  <div class="stack" style="gap:16px">${S.mcpServers.length ? S.mcpServers.map(serverPanel).join("") : `<div class="panel">${empty("No MCP servers yet", "Add the Roblox Studio server to let agents work directly in Studio, or add any other MCP server.")}</div>`}</div>`;
};
function serverPanel(s) {
  const open = ui.mcpOpen[s.id];
  const tools = open ? s.tools : s.tools.slice(0, 6);
  const st = { connected: ["Connected", "ok"], connecting: ["Connecting…", "warn"], error: ["Error", "bad"], disconnected: ["Disconnected", ""] }[s.status] || [s.status, ""];
  return `<div class="panel">
    <div class="panel-h"><span class="dot ${s.status}"></span><h3>${esc(s.name)}</h3><span class="tag">${s.kind === "roblox-studio" ? "Roblox Studio" : s.transport.toUpperCase()}</span><span class="chip ${st[1]}">${st[0]}</span><div class="grow"></div>
      ${s.status === "connected" ? `<button class="btn sm" data-act="refreshServer" data-id="${s.id}">${ic("refresh")}Refresh tools</button><button class="btn sm" data-act="disconnectServer" data-id="${s.id}">Disconnect</button>` : `<button class="btn sm primary" data-act="connectServer" data-id="${s.id}" ${s.status === "connecting" ? "disabled" : ""}>${s.status === "connecting" ? '<span class="spinner"></span>' : ic("link")}${s.status === "error" ? "Reconnect" : "Connect"}</button>`}
      <button class="btn sm" data-act="editServer" data-id="${s.id}">${ic("edit")}Edit</button><button class="btn sm ghost danger icon" data-act="removeServer" data-id="${s.id}">${ic("trash")}</button></div>
    <div class="panel-b"><div class="mono faint ell">${esc(s.transport === "stdio" ? [s.command, ...(s.args || [])].join(" ") : s.url)}</div>
      ${s.description ? `<div class="muted" style="font-size:12.5px;margin-top:6px">${esc(s.description)}</div>` : ""}
      ${s.envKeys.length || s.headerKeys.length ? `<div class="row wrap" style="margin-top:8px">${[...s.envKeys, ...s.headerKeys].map((k) => `<span class="tag">${esc(k)} = ••••</span>`).join("")}</div>` : ""}
      ${s.error ? `<div class="chip bad" style="height:auto;padding:8px 10px;margin-top:10px;white-space:normal;border-radius:10px">${esc(s.error)}</div>` : ""}
      ${s.stderr && s.status !== "connected" ? `<details style="margin-top:8px"><summary class="faint" style="font-size:12px;cursor:pointer">Server output</summary><pre class="steps" style="margin-top:6px">${esc(s.stderr)}</pre></details>` : ""}
    </div>
    ${s.tools.length ? `<div class="tool-row" style="padding-top:8px;padding-bottom:8px"><span class="label">${s.tools.length} tools</span><span class="label">Permission</span></div>` + tools.map((t) => `<div class="tool-row"><div style="min-width:0"><div class="row"><b class="mono" style="font-weight:500">${esc(t.name)}</b>${t.readOnly ? '<span class="tag">read-only</span>' : ""}${t.destructive ? '<span class="tag" style="color:var(--bad)">destructive</span>' : ""}</div><p>${esc(t.description)}</p></div>
      <select class="select" style="height:30px;font-size:12px" data-change="toolPolicy" data-id="${s.id}" data-tool="${esc(t.name)}">${[["default", "Default (" + ({ auto: "auto", ask: "ask" }[t.policy === "default" ? t.effective : "ask"] || "ask") + ")"], ["auto", "Run automatically"], ["ask", "Ask me first"], ["off", "Disabled"]].map(([v, l]) => `<option value="${v}" ${t.policy === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>`).join("")
      + (s.tools.length > 6 ? `<div class="tool-row" style="grid-template-columns:1fr"><button class="btn sm ghost" data-act="toggleTools" data-id="${s.id}">${open ? "Show less" : "Show all " + s.tools.length + " tools"}</button></div>` : "") : ""}
  </div>`;
}

/* ---------- Roblox ---------- */
VIEWS.roblox = () => {
  const srv = S.mcpServers.find((s) => s.kind === "roblox-studio");
  const p = activeProject();
  if (p && p.rojoDir && ui.filesFor !== p.id) { ui.filesFor = p.id; ui.files = null; ui.fileSel = null; loadFiles(p.id); }
  return `<div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.4fr)">
    <div class="stack" style="gap:16px">
      <div class="panel"><div class="panel-h"><h3>Roblox Studio connection</h3><div class="grow"></div>${srv ? `<span class="chip ${srv.status === "connected" ? "ok" : srv.status === "error" ? "bad" : ""}"><span class="dot ${srv.status}"></span>MCP ${esc(srv.status)}</span>` : ""}</div>
        <div class="panel-b stack">
          ${!srv ? `<div class="muted" style="font-size:13px">Roblox Studio comes with an official MCP server. Add it so agents can read your place, edit scripts and instances, run play tests and read the output.</div><div><button class="btn primary" data-act="addStudioServer">${ic("roblox")}Add Roblox Studio MCP</button></div>`
          : srv.status !== "connected" ? `<div class="muted" style="font-size:13px">${esc(srv.error || "The Studio MCP server is not running.")}</div><div><button class="btn primary" data-act="connectServer" data-id="${srv.id}">${ic("link")}Connect</button></div>`
          : `<div class="row"><div class="muted grow" style="font-size:13px">${S.studios.length ? `${S.studios.length} Studio window${S.studios.length > 1 ? "s" : ""} open` : esc(S.studioError || "No Studio window found.")}</div><button class="btn sm" data-act="detectStudios">${ic("refresh")}Detect</button></div>
             ${S.studios.map((st) => { const linked = S.projects.find((x) => x.studio?.id === st.id); return `<div class="mini-proj" style="cursor:default"><div class="gicon sm"><div class="fallback">${esc(initials(st.name))}</div></div><div class="grow" style="min-width:0"><div class="ell" style="font-weight:600;font-size:13px">${esc(st.name)}</div><div class="faint" style="font-size:11.5px">${esc(st.mode)}${st.placeId ? " · Place " + esc(st.placeId) : st.file ? " · " + esc(st.file) : " · not published"}</div></div>${linked ? `<span class="chip ok">${esc(linked.game?.name || linked.name)}</span>` : `${p ? `<button class="btn sm" data-act="linkStudio" data-id="${esc(st.id)}">Link to active</button>` : ""}<button class="btn sm" data-act="projectFromStudio" data-id="${esc(st.id)}">New project</button>`}</div>`; }).join("")}`}
        </div></div>
      <div class="panel pad"><div class="h3" style="margin-bottom:8px">How agents reach your game</div>
        <div class="muted" style="font-size:12.5px;line-height:1.7"><b>Studio MCP</b> — open your place in Roblox Studio and turn on the MCP / AI assistant connection in Studio. Agents can then inspect instances, read and edit scripts, play-test and read the output (changes that aren't read-only ask you first).<br><b>Rojo folder</b> — agents write Luau files into the project folder. Run <span class="mono">rojo serve</span> there and connect the Rojo plugin in Studio to sync. Every file change is backed up and can be undone on the Projects page.</div></div>
    </div>
    <div class="panel" style="display:flex;flex-direction:column;min-height:520px"><div class="panel-h"><h3>Project files</h3><span class="faint" style="font-size:12px">${p?.rojoDir ? esc(p.rojoDir) : ""}</span><div class="grow"></div>${p?.rojoDir ? `<button class="btn sm" data-act="reloadFiles">${ic("refresh")}</button>${desktop ? `<button class="btn sm" data-act="openFolder">${ic("folder")}Open</button>` : ""}` : ""}</div>
      ${!p ? empty("No project selected", "Add a project first.") : !p.rojoDir ? empty("No Rojo folder", "Set a Rojo folder on the Projects page to browse files here.") :
        `<div style="display:grid;grid-template-columns:260px 1fr;flex:1;min-height:0"><div class="tree" style="border-right:1px solid var(--border);padding:8px" id="tree">${ui.files === null ? '<div class="faint">Loading…</div>' : ui.files.length ? ui.files.map((f) => `<div class="${ui.fileSel === f.path ? "on" : ""}" data-act="openFile" data-id="${esc(f.path)}" title="${esc(f.path)}">${esc(f.path)}</div>`).join("") : '<div class="faint" style="cursor:default">Folder is empty</div>'}</div>
         <div style="min-width:0;overflow:auto">${ui.fileSel ? `<div class="code" style="margin:12px;border-radius:10px"><div class="ch">${esc(ui.fileSel)}</div><pre id="fileView">${esc(ui.fileContent ?? "")}</pre></div>` : empty("Pick a file", "Read-only view of the files the agents work on.")}</div></div>`}
    </div>
  </div>`;
};
async function loadFiles(id) { try { ui.files = await call("listFiles", id); } catch { ui.files = []; } render(); }

/* ---------- projects ---------- */
VIEWS.projects = () => {
  const p = activeProject();
  return `<div class="row"><div class="grow"></div>${p ? `<button class="btn" data-act="snapshot">Save snapshot</button>` : ""}<button class="btn primary" data-act="addProject">${ic("plus")}Add project</button></div><div class="sp"></div>
  <div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr))">${S.projects.map((x) => `<div class="panel pad" style="${x.id === S.activeProjectId ? "border-color:var(--border-2);box-shadow:var(--hl),var(--shadow),var(--glow)" : ""}">
    <div class="row" style="align-items:flex-start;gap:14px">${gameIcon(x, "md")}<div class="grow" style="min-width:0"><div class="row"><b class="ell" style="font:600 15px var(--f-head)">${esc(x.game?.name || x.name)}</b>${x.id === S.activeProjectId ? '<span class="chip ok">Active</span>' : ""}</div>
      <div class="kv" style="margin-top:4px">${x.universeId ? `<span>Universe <b>${esc(x.universeId)}</b></span>` : ""}${x.placeId ? `<span>Place <b>${esc(x.placeId)}</b></span>` : "<span>Not published</span>"}</div>
      <div class="faint ell mono" style="margin-top:4px">${esc(x.rojoDir || "No Rojo folder")}</div>
      <div class="row wrap" style="margin-top:8px"><span class="chip ${x.studioConnected ? "ok" : ""}"><span class="dot ${x.studioConnected ? "connected" : "unknown"}"></span>${x.studioConnected ? "Studio connected" : "Studio not connected"}</span>${x.activeAgents.length ? `<span class="chip ok">${x.activeAgents.length} agents working</span>` : ""}</div>
      ${x.gameError ? `<div class="faint" style="font-size:12px;margin-top:6px">${esc(x.gameError)}</div>` : ""}</div></div>
    <div class="row" style="margin-top:14px">${x.id === S.activeProjectId ? "" : `<button class="btn sm primary" data-act="setProject" data-id="${x.id}">Make active</button>`}<button class="btn sm" data-act="editProject" data-id="${x.id}">${ic("edit")}Edit</button><button class="btn sm" data-act="refreshGame" data-id="${x.id}">${ic("refresh")}Game info</button><div class="grow"></div><button class="btn sm ghost danger icon" data-act="removeProject" data-id="${x.id}">${ic("trash")}</button></div>
  </div>`).join("") || `<div class="panel">${empty("No projects yet", "Add your Roblox game to get started.")}</div>`}</div>
  ${p ? `<div class="sp"></div><div class="panel"><div class="panel-h"><h3>Change history — ${esc(p.game?.name || p.name)}</h3><span class="faint" style="font-size:12px">Every file change by an agent is backed up. Undo restores the previous version.</span></div>
    ${S.history.length ? S.history.map((h) => `<div class="list-row"><span class="faint" style="width:90px;font-size:12px">${ago(h.at)}</span><span class="tag">${esc(h.op === "delete" ? "delete" : h.lines.before ? "edit" : "create")}</span><span class="mono grow ell">${esc(h.path)}</span><span class="faint" style="font-size:12px">${esc(h.agent || "")}</span>${h.status === "undone" ? '<span class="chip">Undone</span>' : `<button class="btn sm" data-act="viewChange" data-id="${h.id}">View</button><button class="btn sm" data-act="undo" data-id="${h.id}">${ic("undo")}Undo</button>`}</div>`).join("")
      : empty("No changes yet", "Changes made by agents will show here.")}</div>` : ""}`;
};

/* ---------- revenue ---------- */
const rbx = (n) => `<span class="rbx">${ic("revenue")}${Math.round(n || 0).toLocaleString()}</span>`;
const shortDate = (iso) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });

/** Single-series chart (bars or line). Hover shows date + value. */
function chart(points, { kind = "bar", unit = "", fmt = (v) => Math.round(v).toLocaleString(), height = 150 } = {}) {
  if (!points.length) return `<div class="empty" style="padding:18px">No data yet</div>`;
  const W = 640, H = height, L = 40, R = 6, T = 10, Bt = 22;
  const max = Math.max(1, ...points.map((p) => p.value));
  const nice = (() => { const e = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / e) * e; })();
  const x = (i) => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - (kind === "bar" ? 0 : 1)));
  const y = (v) => T + (H - T - Bt) * (1 - v / nice);
  const grid = [0, 0.5, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(nice * f)}" y2="${y(nice * f)}" class="grid"/><text x="${L - 6}" y="${y(nice * f) + 4}" text-anchor="end" class="axis">${esc(fmt(nice * f))}</text>`).join("");
  const step = (W - L - R) / points.length;
  let marks = "";
  if (kind === "bar") {
    const bw = Math.max(2, step - 2);
    marks = points.map((p, i) => { const h = Math.max(p.value > 0 ? 2 : 0, (H - T - Bt) * (p.value / nice)); const bx = L + i * step + 1; const r = Math.min(4, bw / 2, h);
      return `<g class="hit" data-tip="${esc(shortDate(p.time))}: ${esc(fmt(p.value))}${esc(unit)}"><rect x="${L + i * step}" y="${T}" width="${step}" height="${H - T - Bt}" fill="transparent"/>${h ? `<path class="bar" d="M${bx},${y(0)} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z"/>` : ""}</g>`; }).join("");
  } else {
    const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
    marks = `<path class="line" d="${d}"/>` + points.map((p, i) => `<g class="hit" data-tip="${esc(shortDate(p.time))}: ${esc(fmt(p.value))}${esc(unit)}"><rect x="${x(i) - step / 2}" y="${T}" width="${step}" height="${H - T - Bt}" fill="transparent"/><circle class="pt" cx="${x(i)}" cy="${y(p.value)}" r="4"/></g>`).join("");
  }
  const lbl = (i) => `<text x="${kind === "bar" ? L + i * step + step / 2 : x(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : "end"}" class="axis">${esc(shortDate(points[i].time))}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${grid}<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="base"/>${marks}${lbl(0)}${points.length > 1 ? lbl(points.length - 1) : ""}</svg>`;
}

VIEWS.revenue = () => {
  const R = S.revenue;
  const a = R.account;
  const sm = R.summary;
  const tf = ui.revTf || "month";
  const frame = sm?.[tf];
  const head = `<div class="row"><div class="grow muted" style="font-size:12.5px">${R.refreshedAt ? "Updated " + ago(R.refreshedAt) + " · refreshes every 10 minutes" : ""}</div>${R.busy ? '<span class="chip"><span class="spinner"></span>Refreshing…</span>' : `<button class="btn sm" data-act="refreshRevenue" ${a || R.hasApiKey ? "" : "disabled"}>${ic("refresh")}Refresh</button>`}</div><div class="sp" style="height:12px"></div>`;

  const account = !a ? `<div class="panel game-card"><div class="gicon md"><div class="fallback">${ic("revenue").replace("<svg", '<svg style="width:28px;height:28px"')}</div></div><div class="grow stack" style="gap:8px"><h2 style="font:600 19px var(--f-head)">Link your Roblox account</h2>
      <div class="muted" style="font-size:13px;max-width:640px">See your Robux balance, pending Robux and earnings here. You sign in on <b>roblox.com</b> in a separate window — VYRON never sees your password. The sign-in stays encrypted on this PC and is only used to talk to roblox.com. Unlink any time to sign out.</div>
      <div class="row">${R.canLink ? `<button class="btn primary" data-act="linkRoblox">${ic("link")}Sign in with Roblox</button>` : '<span class="chip warn">Linking works in the desktop app</span>'}</div></div></div>`
    : `<div class="panel game-card"><div class="gicon md">${a.avatarUrl ? `<img src="${esc(a.avatarUrl)}" alt="">` : `<div class="fallback">${esc(initials(a.displayName))}</div>`}</div>
      <div class="grow stack" style="gap:6px;min-width:0"><div class="label">Linked Roblox account</div><h2 class="ell" style="font:600 20px var(--f-head)">${esc(a.displayName)} <span class="faint" style="font-size:14px;font-weight:500">@${esc(a.name)}</span></h2>
        <div class="row wrap">${a.expired ? `<span class="chip bad">Sign-in expired</span><button class="btn sm primary" data-act="linkRoblox">Sign in again</button>` : '<span class="chip ok"><span class="dot connected"></span>Linked</span>'}<span class="faint" style="font-size:12px">User ID ${esc(a.userId)} · linked ${ago(a.linkedAt)}</span></div>
        ${R.summaryError && !a.expired ? `<div class="faint" style="font-size:12.5px">${esc(R.summaryError)}</div>` : ""}</div>
      <button class="btn sm ghost danger" data-act="unlinkRoblox">Unlink &amp; sign out</button></div>`;

  const tiles = sm ? `<div class="grid g4">
      <div class="panel stat"><div class="label">Robux balance</div><div class="n">${rbx(sm.balance)}</div><div class="d">Available now</div></div>
      <div class="panel stat"><div class="label">Pending Robux</div><div class="n">${rbx(sm.pending)}</div><div class="d">On hold before it's paid out</div></div>
      <div class="panel stat"><div class="label">Sales today</div><div class="n">${rbx(sm.day.sales)}</div><div class="d">${rbx(sm.week.sales)} this week</div></div>
      <div class="panel stat"><div class="label">Incoming this month</div><div class="n">${rbx(sm.month.incoming)}</div><div class="d">${rbx(sm.month.outgoing)} spent this month</div></div></div><div class="sp"></div>` : "";

  const lines = (out) => frame.lines.filter((l) => !!l.outgoing === out);
  const breakdown = sm ? `<div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
    <div class="panel"><div class="panel-h"><h3>Summary</h3><div class="grow"></div><div class="seg">${[["day", "Day"], ["week", "Week"], ["month", "Month"], ["year", "Year"]].map(([k, l]) => `<button class="${tf === k ? "on" : ""}" data-act="revTf" data-id="${k}">${l}</button>`).join("")}</div></div>
      <div class="list-row"><b class="grow" style="font-weight:600">Incoming Robux</b></div>
      ${lines(false).map((l) => `<div class="list-row"><span class="grow muted">${esc(l.label)}</span>${rbx(l.value)}</div>`).join("") || '<div class="list-row"><span class="faint">Nothing in this period</span></div>'}
      <div class="list-row"><b class="grow" style="font-weight:600">Total</b><b>${rbx(frame.incoming)}</b></div>
      <div class="list-row"><b class="grow" style="font-weight:600">Outgoing Robux</b></div>
      ${lines(true).map((l) => `<div class="list-row"><span class="grow muted">${esc(l.label)}</span>−${rbx(l.value)}</div>`).join("") || '<div class="list-row"><span class="faint">Nothing in this period</span></div>'}
      <div class="list-row"><b class="grow" style="font-weight:600">Total</b><b>−${rbx(frame.outgoing)}</b></div></div>
    <div class="panel"><div class="panel-h"><h3>Pending Robux over time</h3></div><div class="panel-b">${R.history.length > 1 ? chart(R.history.map((h) => ({ time: h.date + "T00:00:00Z", value: h.pending })), { kind: "line", unit: " R$" }) : `<div class="empty"><b>Building up</b>VYRON records your pending Robux once a day while it runs, so this chart fills in over the coming days.</div>`}</div></div>
  </div><div class="sp"></div>` : "";

  const keyCard = !R.hasApiKey ? `<div class="panel pad stack"><div class="row"><span style="width:18px;height:18px">${ic("key")}</span><div class="h3 grow">Daily revenue per game (official Roblox Analytics)</div></div>
      <div class="muted" style="font-size:13px;line-height:1.7">To see each game's daily revenue, active users, playtime and retention, add an Open Cloud API key:<br>
      1. Open <b>create.roblox.com → Open Cloud → API Keys</b> and click <b>Create API Key</b>.<br>
      2. Under Access Permissions add <b>universe.analytics</b> → <b>Read</b>, and select your experiences.<br>
      3. Copy the key and paste it here. It is stored encrypted and never shown again.</div>
      <div class="row"><input class="input" type="password" id="rbxKey" placeholder="Paste Open Cloud API key" autocomplete="off"><button class="btn primary" data-act="saveRbxKey">Save key</button></div></div>`
    : "";
  const games = R.games;
  const keyErr = Object.values(R.analytics).find((m) => /rejected/.test(m.fatal || ""));
  const gameCards = R.hasApiKey ? `<div class="row"><div class="h3 grow">Game revenue · last 30 days</div><button class="btn sm ghost" data-act="clearRbxKey">${ic("key")}${keyErr ? "Replace API key" : "Remove API key"}</button></div><div class="sp" style="height:12px"></div>
    ${keyErr ? `<div class="panel pad row" style="border-color:rgba(245,143,143,.35);margin-bottom:14px"><span class="dot error"></span><div class="grow"><b>Roblox rejected the Open Cloud API key.</b><div class="muted" style="font-size:12.5px">Check that you copied the whole key and that it hasn't expired, then remove it and paste it again.</div></div></div>` : ""}
    ${games.length ? `<div class="stack" style="gap:14px">${games.map((g) => {
      const m = R.analytics[g.universeId];
      const rev = m?.series?.revenue || [];
      const total = rev.reduce((s, p) => s + p.value, 0);
      const lastFull = rev.length > 1 ? rev[rev.length - 2] : rev[0];
      const latest = (k) => { const s = m?.series?.[k] || []; return s.length ? s[s.length - (s.length > 1 ? 2 : 1)].value : null; };
      return `<div class="panel"><div class="panel-h">${gameIcon({ id: g.universeId, name: g.name, game: { name: g.name, iconUrl: g.iconUrl } }, "sm")}<div class="grow" style="min-width:0"><h3 class="ell">${esc(g.name)}</h3><div class="faint" style="font-size:12px">Universe ${esc(g.universeId)}${g.projectId ? " · VYRON project" : ""}</div></div>
        ${m && !m.fatal ? `<div style="text-align:right"><div class="label">30-day revenue</div><div style="font:600 18px var(--f-head)">${rbx(total)}</div></div>` : ""}</div>
        <div class="panel-b">${!m ? `<div class="row faint" style="font-size:12.5px">${R.busy && !keyErr ? '<span class="spinner"></span>Loading analytics…' : keyErr ? "Waiting for a working API key." : "Not loaded yet — click Refresh."}</div>`
          : m.fatal ? `<div class="chip bad" style="height:auto;padding:8px 10px;white-space:normal;border-radius:10px">${esc(m.fatal)}</div>`
          : `<div class="grid g4" style="gap:10px;margin-bottom:12px">
              <div><div class="label">Revenue (last full day)</div><div style="font:600 16px var(--f-head);margin-top:4px">${lastFull ? rbx(lastFull.value) : "—"}</div><div class="faint" style="font-size:11.5px">${lastFull ? shortDate(lastFull.time) : ""}</div></div>
              <div><div class="label">Daily active users</div><div style="font:600 16px var(--f-head);margin-top:4px">${latest("dau") != null ? Math.round(latest("dau")).toLocaleString() : "—"}</div></div>
              <div><div class="label">Avg playtime / user</div><div style="font:600 16px var(--f-head);margin-top:4px">${latest("playtime") != null ? latest("playtime").toFixed(1) + " min" : "—"}</div></div>
              <div><div class="label">Day 1 retention</div><div style="font:600 16px var(--f-head);margin-top:4px">${latest("d1") != null ? (latest("d1") * (latest("d1") <= 1 ? 100 : 1)).toFixed(1) + "%" : "—"}</div></div></div>
            ${chart(rev, { kind: "bar", unit: " R$" })}
            ${Object.keys(m.errors || {}).length ? `<div class="faint" style="font-size:11.5px;margin-top:8px">Some metrics unavailable: ${esc(Object.entries(m.errors).map(([k, v]) => k + " (" + v + ")").join(", "))}</div>` : ""}`}</div></div>`; }).join("")}</div>`
      : `<div class="panel">${empty("No games to show", "Link your Roblox account, or add a project with a Place ID on the Projects page.")}</div>`}` : "";

  return head + account + `<div class="sp"></div>` + tiles + breakdown + keyCard + gameCards;
};

/* ---------- prompts ---------- */
VIEWS.prompts = () => {
  const q = ui.promptQ.toLowerCase();
  const list = S.prompts.filter((p) => (ui.promptCat === "All" || (ui.promptCat === "Favorites" ? p.favorite : p.category === ui.promptCat)) && (!q || (p.title + p.body + p.category).toLowerCase().includes(q)));
  const cats = ["All", "Favorites", ...CATEGORIES];
  return `<div class="grid" style="grid-template-columns:220px 1fr">
    <div class="panel" style="padding:8px;align-self:start">${cats.map((c) => `<div class="pick ${ui.promptCat === c ? "on" : ""}" data-act="promptCat" data-id="${esc(c)}"><span class="grow">${esc(c)}</span><span class="faint" style="font-size:12px">${c === "All" ? S.prompts.length : c === "Favorites" ? S.prompts.filter((p) => p.favorite).length : S.prompts.filter((p) => p.category === c).length}</span></div>`).join("")}</div>
    <div><div class="row"><div class="search grow">${ic("search")}<input class="input" id="promptSearch" placeholder="Search prompts" value="${esc(ui.promptQ)}"></div><button class="btn" data-act="improveIdea">${ic("sparkle")}Improve an idea with AI</button><button class="btn primary" data-act="newPrompt">${ic("plus")}New prompt</button></div>
      <div class="sp"></div>
      <div class="cards">${list.map((p) => `<div class="panel pad stack" style="gap:8px"><div class="row"><b class="grow ell" style="font:600 14px var(--f-head)">${esc(p.title)}</b><button class="btn sm ghost icon" title="Favorite" data-act="favPrompt" data-id="${p.id}" style="${p.favorite ? "color:#ffd76a" : ""}">${ic("star")}</button></div>
        <span class="tag" style="align-self:flex-start">${esc(p.category)}</span>
        <div class="muted" style="font-size:12.5px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden">${esc(p.body)}</div>
        <div class="row wrap" style="margin-top:4px"><button class="btn sm primary" data-act="promptBuild" data-id="${p.id}">${ic("bolt")}Build</button><button class="btn sm" data-act="promptSend" data-id="${p.id}">${ic("send")}Send to agent</button><div class="grow"></div><button class="btn sm ghost icon" title="Copy" data-act="copyPrompt" data-id="${p.id}">${ic("copy")}</button><button class="btn sm ghost icon" title="Edit" data-act="editPrompt" data-id="${p.id}">${ic("edit")}</button><button class="btn sm ghost danger icon" title="Delete" data-act="deletePrompt" data-id="${p.id}">${ic("trash")}</button></div></div>`).join("") || `<div class="panel">${empty("No prompts here", "Create one or change the filter.")}</div>`}</div></div>
  </div>`;
};

/* ---------- tasks ---------- */
VIEWS.tasks = () => {
  const f = ui.taskFilter;
  const match = (t) => f === "all" || (f === "active" ? !["completed", "failed", "cancelled"].includes(t.status) : f === "completed" ? t.status === "completed" : ["failed", "cancelled"].includes(t.status));
  const tops = S.tasks.filter((t) => !t.parentId && t.kind !== "chat").filter((t) => match(t) || S.tasks.some((k) => k.parentId === t.id && match(k))).reverse();
  const row = (t, child) => `<div class="task-row ${child ? "child" : ""}" data-act="openTask" data-id="${t.id}">
    <div style="min-width:0"><div class="t ell">${t.kind === "build" ? ic("bolt", "") .replace("<svg", '<svg style="width:13px;height:13px;vertical-align:-2px;margin-right:6px"') : ""}${esc(t.title)}</div><div class="s ell">${esc(t.stage || t.description.slice(0, 120))}</div></div>
    <div class="ell muted" style="font-size:12.5px">${esc(agentById(t.agentId)?.name || (t.role ? t.role : "Any agent"))}</div>
    <div>${taskStatus(t.status)}</div>
    <div><span class="tag">${esc(t.priority)}</span></div>
    <div>${t.kind === "build" ? bar(t.progress || 0, ["in_progress", "planning"].includes(t.status) ? "live" : t.status === "failed" ? "bad" : "") : `<span class="faint" style="font-size:12px">${ago(t.finishedAt || t.startedAt || t.createdAt)}</span>`}</div></div>`;
  return `<div class="row"><div class="seg">${[["active", "Active"], ["all", "All"], ["completed", "Completed"], ["failed", "Failed"]].map(([k, l]) => `<button class="${ui.taskFilter === k ? "on" : ""}" data-act="taskFilter" data-id="${k}">${l}</button>`).join("")}</div><div class="grow"></div><button class="btn" data-act="clearTasks">Clear finished</button><button class="btn primary" data-act="newTask">${ic("plus")}New task</button></div>
  <div class="sp"></div>
  <div class="panel"><div class="task-row" style="cursor:default;border-top:0"><span class="label">Task</span><span class="label">Agent</span><span class="label">Status</span><span class="label">Priority</span><span class="label">Progress</span></div>
    ${tops.length ? tops.map((t) => row(t) + S.tasks.filter((k) => k.parentId === t.id).map((k) => row(k, true)).join("")).join("") : empty("No tasks here", "Start a build from the Dashboard or create a task.")}</div>`;
};

/* ---------- settings ---------- */
VIEWS.settings = () => {
  const s = S.settings;
  const modes = [["ask_all", "Ask before every change", "Every file write and every non-read-only tool needs your approval."], ["ask_destructive", "Ask before risky actions (recommended)", "File edits are applied and backed up (undo any time). Deleting files and Studio/MCP actions that are not read-only ask first."], ["autonomous", "Autonomous", "Agents work on their own. Only deletes and tools marked destructive ask first."]];
  const u = S.auth?.user;
  return `${u ? `<div class="panel pad row" style="margin-bottom:16px;gap:14px"><div class="ava" style="border-radius:50%;overflow:hidden">${u.photo ? `<img src="${esc(u.photo)}" alt="" style="width:100%;height:100%;object-fit:cover">` : esc(initials(u.name))}</div>
      <div class="grow"><div class="h3">${esc(u.name)}</div><div class="faint" style="font-size:12.5px">${esc(u.email)} · signed in with ${u.provider === "google" ? "Google" : "email"}${S.auth.offline ? " · offline" : ""}</div></div>
      <button class="btn sm" data-act="editSignIn">Sign-in settings</button><button class="btn sm danger" data-act="authSignOut">Sign out</button></div>` : ""}
  <div class="grid g2">
    <div class="panel pad"><div class="h3" style="margin-bottom:14px">Appearance</div>
      <div class="row" style="margin-bottom:14px"><span class="grow">Theme</span><div class="seg">${[["dark", "Dark"], ["light", "Light"]].map(([k, l]) => `<button class="${(s.theme || "dark") === k ? "on" : ""}" data-act="setting" data-key="theme" data-val="${k}">${l}</button>`).join("")}</div></div>
      <div class="row" style="margin-bottom:14px"><span class="grow">Animations</span><div class="toggle ${s.animations !== false ? "on" : ""}" data-act="setting" data-key="animations" data-val="${s.animations === false}"></div></div>
      <div class="row"><span class="grow">Reduce effects (no background animation)</span><div class="toggle ${s.reduceEffects ? "on" : ""}" data-act="setting" data-key="reduceEffects" data-val="${!s.reduceEffects}"></div></div>
    </div>
    <div class="panel pad"><div class="h3" style="margin-bottom:14px">AI defaults</div>
      <label class="field"><span>Default agent (chat and prompt improvement)</span><select class="select" data-change="setting" data-key="defaultAgentId"><option value="">First available</option>${S.agents.map((a) => `<option value="${a.id}" ${s.defaultAgentId === a.id ? "selected" : ""}>${esc(a.name)} — ${esc(a.role)} (${esc(a.model)})</option>`).join("")}</select></label>
      <label class="field"><span>Agents working at the same time</span><select class="select" data-change="setting" data-key="maxParallel">${[1, 2, 3, 4, 5, 6, 8].map((n) => `<option ${s.maxParallel === n ? "selected" : ""}>${n}</option>`).join("")}</select><small>More parallel agents finish faster but use tokens faster.</small></label>
    </div>
    <div class="panel pad"><div class="h3" style="margin-bottom:14px">Permissions</div>${modes.map(([k, t, d]) => `<div class="radio-card ${s.permissionMode === k ? "on" : ""}" data-act="setting" data-key="permissionMode" data-val="${k}"><span class="dot ${s.permissionMode === k ? "connected" : "unknown"}"></span><div><b style="font-weight:600">${t}</b><div class="faint" style="font-size:12.5px">${d}</div></div></div>`).join("")}</div>
    <div class="panel pad"><div class="h3" style="margin-bottom:14px">Connections</div>
      <div class="list-row click" data-go="agents" style="padding:10px 0"><span class="grow">AI providers and API keys</span><span class="faint">${S.providers.length} configured</span></div>
      <div class="list-row click" data-go="mcp" style="padding:10px 0"><span class="grow">MCP servers</span><span class="faint">${S.mcpServers.length} configured</span></div>
      <div class="list-row click" data-go="roblox" style="padding:10px 0"><span class="grow">Roblox Studio</span><span class="faint">${S.studios.length} window(s)</span></div>
      <div class="list-row click" data-go="projects" style="padding:10px 0"><span class="grow">Projects</span><span class="faint">${S.projects.length}</span></div>
      <div class="faint" style="font-size:12px;margin-top:10px">API keys and MCP secrets are encrypted with Windows data protection and stay inside the app's backend — the interface never receives them.</div></div>
  </div>
  <div class="sp"></div>
  <div class="panel activity"><div class="panel-h"><h3>Diagnostics log</h3><div class="grow"></div><button class="btn sm" data-act="copyLog">${ic("copy")}Copy log</button></div>
    <div style="max-height:380px;overflow:auto" id="diagLog">${S.activity.slice().reverse().map((l) => `<div class="list-row"><time>${time(l.at)}</time><div class="grow"><b class="lv-${l.level}">${esc(l.source)}</b> <span class="muted">${esc(l.text)}</span></div></div>`).join("")}</div></div>`;
};

/* ---------------- drawers ---------------- */
function drawDrawer() {
  if (ui.drawer === "approvals") {
    return `<div class="dscrim" data-act="closeDrawer"></div><div class="drawer"><div class="panel-h"><h3>Approvals</h3><div class="grow"></div><button class="btn sm ghost icon" data-act="closeDrawer">${ic("x")}</button></div>
      <div class="body stack" id="aprBody">${S.approvals.length ? S.approvals.map(approvalCard).join("") : empty("Nothing waiting", "When an agent wants to do something that needs your OK, it shows up here.")}</div></div>`;
  }
  if (ui.drawer === "task") {
    const t = S.tasks.find((x) => x.id === ui.taskSel);
    if (!t) return "";
    const done = ["completed", "failed", "cancelled"].includes(t.status);
    const kids = S.tasks.filter((k) => k.parentId === t.id);
    const deps = t.deps.map((d) => S.tasks.find((x) => x.id === d)).filter(Boolean);
    return `<div class="dscrim" data-act="closeDrawer"></div><div class="drawer"><div class="panel-h"><div class="grow" style="min-width:0"><h3 class="ell">${esc(t.title)}</h3><div class="row" style="margin-top:4px">${taskStatus(t.status)}<span class="faint" style="font-size:12px">${esc(agentById(t.agentId)?.name || t.role || "")}</span></div></div>
      ${!done ? `<button class="btn sm danger" data-act="cancelTask" data-id="${t.id}">Cancel</button>` : ""}${["failed", "cancelled"].includes(t.status) ? `<button class="btn sm primary" data-act="retryTask" data-id="${t.id}">${ic("refresh")}Retry</button>` : ""}<button class="btn sm ghost icon" data-act="closeDrawer">${ic("x")}</button></div>
      <div class="body stack" id="taskBody" style="gap:16px">
        ${t.kind === "build" ? `<div>${bar(t.progress || 0, done ? "" : "live")}<div class="faint" style="font-size:12px;margin-top:6px">${esc(t.stage || "")}</div></div>` : t.stage ? `<div class="faint" style="font-size:12.5px">${esc(t.stage)}</div>` : ""}
        <div><div class="label" style="margin-bottom:6px">Description</div><div class="md muted" style="font-size:13px">${md(t.description)}</div></div>
        ${t.plan ? `<div><div class="label" style="margin-bottom:6px">Plan</div><div class="muted" style="font-size:13px">${esc(t.plan)}</div></div>` : ""}
        ${kids.length ? `<div><div class="label" style="margin-bottom:6px">Sub-tasks</div>${kids.map((k) => `<div class="list-row click" style="padding:8px 0" data-act="openTask" data-id="${k.id}"><span class="grow ell">${esc(k.title)}</span><span class="faint" style="font-size:12px">${esc(agentById(k.agentId)?.name || k.role)}</span>${taskStatus(k.status)}</div>`).join("")}</div>` : ""}
        ${deps.length ? `<div><div class="label" style="margin-bottom:6px">Depends on</div>${deps.map((d) => `<div class="row" style="font-size:13px"><span class="grow ell">${esc(d.title)}</span>${taskStatus(d.status)}</div>`).join("")}</div>` : ""}
        ${t.error ? `<div class="chip bad" style="height:auto;padding:10px 12px;white-space:pre-wrap;border-radius:10px">${esc(t.error)}</div>` : ""}
        ${t.changes?.length ? `<div><div class="label" style="margin-bottom:6px">Changed files</div><div class="row wrap">${t.changes.map((c) => `<button class="chip" style="cursor:pointer" data-act="viewChange" data-id="${c.id}">${esc(c.op)} ${esc(c.path)}</button>`).join("")}</div></div>` : ""}
        ${t.notes?.length ? `<div><div class="label" style="margin-bottom:6px">Team notes</div>${t.notes.map((n) => `<div style="font-size:13px;margin-bottom:6px"><b>${esc(n.agent)}</b> <span class="muted">${esc(n.text)}</span></div>`).join("")}</div>` : ""}
        ${t.result ? `<div><div class="label" style="margin-bottom:6px">Result</div><div class="md" style="font-size:13px">${md(t.result)}</div></div>` : ""}
        ${t.steps?.length ? `<div><div class="label" style="margin-bottom:6px">Steps</div><div class="steps" id="stepsLog">${t.steps.map((s) => `<div><span class="faint">${time(s.at)}</span> ${esc(s.text)}</div>`).join("")}</div></div>` : ""}
      </div></div>`;
  }
  return "";
}

/* ---------------- modals ---------------- */
function modal(title, body, foot, wide) {
  $("#modalRoot").innerHTML = `<div class="scrim" data-act="closeModalScrim"><div class="modal ${wide ? "wide" : ""}" role="dialog"><div class="modal-h"><h2>${title}</h2><button class="btn sm ghost icon" data-act="closeModal">${ic("x")}</button></div><div class="modal-b">${body}</div><div class="modal-f">${foot}</div></div></div>`;
  setTimeout(() => $("#modalRoot input:not([type=hidden]), #modalRoot textarea")?.focus(), 30);
}
const closeModal = () => ($("#modalRoot").innerHTML = "");
const val = (id) => $("#" + id)?.value ?? "";

function providerModal(p) {
  const type = p?.type || "anthropic";
  modal(p ? "Edit provider" : "Add AI provider", `
    ${p ? "" : `<label class="field"><span>Provider type</span><select class="select" id="pType">${Object.entries(S.providerTypes).map(([k, v]) => `<option value="${k}" ${k === type ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select></label>`}
    <label class="field"><span>Name</span><input class="input" id="pName" value="${esc(p?.name || "")}" placeholder="${type === "anthropic" ? "Claude" : "OpenAI"}"></label>
    <div id="pBaseWrap" style="${type === "openai" ? "" : "display:none"}"><label class="field"><span>Base URL</span><input class="input" id="pBase" value="${esc(p?.baseURL || "https://api.openai.com/v1")}" list="pBaseList"><datalist id="pBaseList">${OPENAI_PRESETS.map(([n, u]) => `<option value="${u}">${n}</option>`).join("")}</datalist><small>Local servers like Ollama or LM Studio don't need a key.</small></label></div>
    <label class="field"><span>API key</span><input class="input" type="password" id="pKey" placeholder="${p?.hasKey ? "Saved — leave blank to keep it" : "Paste your API key"}" autocomplete="off"><small>${type === "anthropic" ? 'Get one at console.anthropic.com → API Keys.' : ""} Stored encrypted on this PC.</small></label>`,
    `<button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" data-act="saveProvider" data-id="${p?.id || ""}">${p ? "Save & reconnect" : "Connect"}</button>`);
  $("#pType")?.addEventListener("change", (e) => { $("#pBaseWrap").style.display = e.target.value === "openai" ? "" : "none"; });
}

function agentModal(a) {
  const provs = S.providers;
  const pid = a?.providerId || provs.find((p) => p.status === "connected")?.id || provs[0]?.id;
  const models = (id) => (S.providers.find((p) => p.id === id)?.models || []);
  modal(a ? "Configure " + esc(a.name) : "Add agent", `
    <div class="grid g2" style="gap:12px"><label class="field"><span>Name</span><input class="input" id="aName" value="${esc(a?.name || "")}" placeholder="e.g. Orion"></label>
    <label class="field"><span>Role</span><select class="select" id="aRole">${Object.keys(S.roles).map((r) => `<option ${a?.role === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select></label></div>
    <div class="faint" id="aRoleDesc" style="font-size:12px;margin:-6px 0 14px">${esc(S.roles[a?.role || Object.keys(S.roles)[0]])}</div>
    <div class="grid g2" style="gap:12px"><label class="field"><span>Provider</span><select class="select" id="aProv">${provs.map((p) => `<option value="${p.id}" ${p.id === pid ? "selected" : ""}>${esc(p.name)}${p.status === "connected" ? "" : " (not connected)"}</option>`).join("")}</select></label>
    <label class="field"><span>Model</span><input class="input" id="aModel" list="aModels" value="${esc(a?.model || models(pid)[0] || "")}"><datalist id="aModels">${models(pid).map((m) => `<option value="${esc(m)}">`).join("")}</datalist></label></div>
    <label class="field"><span>Token budget</span><input class="input" id="aBudget" type="number" step="100000" min="20000" value="${a?.budget || 1000000}"><small>The agent stops and shows “Out of tokens” when it reaches this.</small></label>
    <label class="field"><span>Extra instructions (optional)</span><textarea class="input" id="aInstr" placeholder="e.g. Always use our UI theme module in ReplicatedStorage.Theme">${esc(a?.instructions || "")}</textarea></label>
    <div class="label" style="margin:4px 0 8px">Tools</div>
    <div class="row" style="margin-bottom:10px"><span class="grow">Project files (read, write, search)</span><div class="toggle ${a?.tools?.files === false ? "" : "on"}" id="aFiles" data-act="toggleEl"></div></div>
    ${S.mcpServers.map((s) => { const v = a?.tools?.mcp?.[s.id] ?? "all"; return `<div class="row" style="margin-bottom:10px"><span class="grow">${esc(s.name)} <span class="faint" style="font-size:12px">(${s.tools.length} tools${s.status === "connected" ? "" : ", not connected"})</span></span><select class="select" style="width:170px;height:32px" data-mcp="${s.id}">${[["all", "All tools"], ["none", "No access"], ["custom", "Chosen tools"]].map(([k, l]) => `<option value="${k}" ${(Array.isArray(v) ? "custom" : v) === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="mcp-pick" data-for="${s.id}" style="${Array.isArray(v) ? "" : "display:none"};max-height:150px;overflow:auto;margin:-4px 0 10px;padding:8px;border:1px solid var(--border);border-radius:10px">${s.tools.map((t) => `<label class="row" style="font-size:12.5px;padding:2px 0;cursor:pointer"><input type="checkbox" value="${esc(t.name)}" ${Array.isArray(v) && v.includes(t.name) ? "checked" : ""}> <span class="mono">${esc(t.name)}</span></label>`).join("") || '<span class="faint">Connect the server to list its tools.</span>'}</div>`; }).join("")}`,
    `<button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" data-act="saveAgent" data-id="${a?.id || ""}">${a ? "Save" : "Add agent"}</button>`);
  $("#aRole").addEventListener("change", (e) => ($("#aRoleDesc").textContent = S.roles[e.target.value]));
  $("#aProv").addEventListener("change", (e) => { const m = models(e.target.value); $("#aModels").innerHTML = m.map((x) => `<option value="${esc(x)}">`).join(""); if (m[0]) $("#aModel").value = m[0]; });
  $$("#modalRoot [data-mcp]").forEach((sel) => sel.addEventListener("change", () => { $(`#modalRoot .mcp-pick[data-for="${sel.dataset.mcp}"]`).style.display = sel.value === "custom" ? "" : "none"; }));
}

function serverModal(s) {
  const tr = s?.transport || "stdio";
  modal(s ? "Edit MCP server" : "Add MCP server", `
    <label class="field"><span>Name</span><input class="input" id="sName" value="${esc(s?.name || "")}" placeholder="e.g. Filesystem"></label>
    <div class="field"><span>Transport</span><div class="seg" id="sTr">${[["stdio", "Local command (stdio)"], ["http", "HTTP (streamable)"], ["sse", "HTTP + SSE (legacy)"]].map(([k, l]) => `<button class="${tr === k ? "on" : ""}" data-tr="${k}">${l}</button>`).join("")}</div></div>
    <div id="sStdio" style="${tr === "stdio" ? "" : "display:none"}">
      <label class="field"><span>Command</span><input class="input mono" id="sCmd" value="${esc(s?.command || "")}" placeholder="npx"></label>
      <label class="field"><span>Arguments</span><input class="input mono" id="sArgs" value="${esc((s?.args || []).map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" "))}" placeholder="-y @modelcontextprotocol/server-filesystem C:\\path"></label>
      <label class="field"><span>Working folder (optional)</span><input class="input mono" id="sCwd" value="${esc(s?.cwd || "")}"></label></div>
    <div id="sHttp" style="${tr === "stdio" ? "display:none" : ""}"><label class="field"><span>URL</span><input class="input mono" id="sUrl" value="${esc(s?.url || "")}" placeholder="https://example.com/mcp"></label></div>
    <label class="field"><span>${tr === "stdio" ? "Environment variables" : "Headers"} — one per line, KEY=value (stored encrypted)</span><textarea class="input mono" id="sSecrets" style="min-height:70px" placeholder="${tr === "stdio" ? "API_TOKEN=..." : "Authorization=Bearer ..."}"></textarea>
      ${s && (s.envKeys.length || s.headerKeys.length) ? `<small>Saved: ${[...s.envKeys, ...s.headerKeys].map((k) => `<label style="margin-right:10px"><input type="checkbox" data-rm="${esc(k)}"> remove ${esc(k)}</label>`).join("")}</small>` : ""}</label>
    <div class="row"><span class="grow">Connect automatically when the app starts</span><div class="toggle ${s?.autoConnect === false ? "" : "on"}" id="sAuto" data-act="toggleEl"></div></div>`,
    `<button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" data-act="saveServer" data-id="${s?.id || ""}">${s ? "Save & reconnect" : "Add & connect"}</button>`);
  $$("#sTr button").forEach((b) => b.addEventListener("click", () => {
    $$("#sTr button").forEach((x) => x.classList.toggle("on", x === b));
    $("#sStdio").style.display = b.dataset.tr === "stdio" ? "" : "none";
    $("#sHttp").style.display = b.dataset.tr === "stdio" ? "none" : "";
  }));
}

function projectModal(p) {
  modal(p ? "Edit project" : "Add project", `
    ${!p && S.studios.length ? `<label class="field"><span>From an open Roblox Studio window (optional)</span><select class="select" id="prStudio"><option value="">—</option>${S.studios.map((st) => `<option value="${esc(st.id)}">${esc(st.name)}${st.placeId ? " · Place " + esc(st.placeId) : ""}</option>`).join("")}</select></label>` : ""}
    <label class="field"><span>Name</span><input class="input" id="prName" value="${esc(p?.name || "")}" placeholder="Filled in from Roblox when you give a Place ID"></label>
    <label class="field"><span>Rojo project folder</span><div class="row"><input class="input mono" id="prDir" value="${esc(p?.rojoDir || "")}" placeholder="C:\\Users\\you\\Documents\\MyGame">${desktop ? `<button class="btn" data-act="browseDir">Browse</button>` : ""}</div><small>Agents read and write Luau files here. Leave empty to work only through Roblox Studio MCP.</small></label>
    <div class="grid g2" style="gap:12px"><label class="field"><span>Place ID</span><input class="input mono" id="prPlace" value="${esc(p?.placeId || "")}" placeholder="from the game URL"></label>
    <label class="field"><span>Universe ID (optional)</span><input class="input mono" id="prUni" value="${esc(p?.universeId || "")}"></label></div>
    <small class="faint">The game's real icon and name are loaded from Roblox using these IDs.</small>`,
    `<button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" data-act="saveProject" data-id="${p?.id || ""}">${p ? "Save" : "Add project"}</button>`);
}

function promptModal(p) {
  modal(p ? "Edit prompt" : "New prompt", `
    <label class="field"><span>Title</span><input class="input" id="pmTitle" value="${esc(p?.title || "")}"></label>
    <label class="field"><span>Category</span><select class="select" id="pmCat">${CATEGORIES.map((c) => `<option ${p?.category === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
    <label class="field"><span>Prompt</span><textarea class="input" id="pmBody" style="min-height:200px">${esc(p?.body || "")}</textarea></label>`,
    `<button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" data-act="savePrompt" data-id="${p?.id || ""}">Save</button>`, true);
}

function agentPickModal(text, label) {
  modal(label, `<div class="muted" style="font-size:12.5px;margin-bottom:12px;max-height:120px;overflow:auto">${esc(text)}</div>
    <label class="field"><span>Agent</span><select class="select" id="pickAgent">${S.agents.map((a) => `<option value="${a.id}" ${a.status === "idle" ? "" : ""}>${esc(a.name)} — ${esc(a.role)} (${AGENT_ST[a.status][0]})</option>`).join("")}</select></label>
    <input type="hidden" id="pickText" value="${esc(text)}">`,
    `<button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" data-act="doSendPrompt">Send</button>`);
}

function improveModal() {
  modal("Improve an idea with AI", `
    <label class="field"><span>Your idea</span><textarea class="input" id="impIdea" placeholder="e.g. a fishing game with rare fish and a market"></textarea></label>
    <div class="row" style="margin-bottom:12px"><span class="grow">Research Roblox documentation on the web <span class="faint" style="font-size:12px">(Claude providers)</span></span><div class="toggle" id="impResearch" data-act="toggleEl"></div></div>
    <label class="field"><span>Agent</span><select class="select" id="impAgent">${S.agents.map((a) => `<option value="${a.id}">${esc(a.name)} — ${esc(a.model)}</option>`).join("")}</select></label>
    <div id="impOut"></div>`,
    `<button class="btn" data-act="closeModal">Close</button><button class="btn primary" data-act="runImprove">${ic("sparkle")}Improve</button>`, true);
}

function taskModal() {
  modal("New task", `
    <label class="field"><span>Title (optional)</span><input class="input" id="tkTitle"></label>
    <label class="field"><span>What should be done?</span><textarea class="input" id="tkDesc" style="min-height:130px"></textarea></label>
    <div class="grid g2" style="gap:12px"><label class="field"><span>Assign to</span><select class="select" id="tkAgent"><option value="">Best agent for the role</option>${S.agents.map((a) => `<option value="${a.id}">${esc(a.name)} — ${esc(a.role)}</option>`).join("")}</select></label>
    <label class="field"><span>Role</span><select class="select" id="tkRole"><option value="">Any</option>${Object.keys(S.roles).map((r) => `<option>${esc(r)}</option>`).join("")}</select></label></div>
    <div class="grid g2" style="gap:12px"><label class="field"><span>Priority</span><select class="select" id="tkPrio"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></label>
    <label class="field"><span>Start after (optional)</span><select class="select" id="tkDep"><option value="">—</option>${S.tasks.filter((t) => !["completed", "failed", "cancelled"].includes(t.status) && t.kind !== "chat").map((t) => `<option value="${t.id}">${esc(t.title)}</option>`).join("")}</select></label></div>`,
    `<button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" data-act="saveTask">Create task</button>`);
}

async function showChange(id) {
  const p = activeProject();
  const c = p && (await call("getChange", p.id, id));
  if (!c) return toast("That change is not in the active project's history", "error");
  modal(`${esc(c.path)}`, `<div class="row" style="margin-bottom:10px"><span class="tag">${esc(c.op)}</span><span class="faint" style="font-size:12px">${esc(c.agent || "")} · ${new Date(c.at).toLocaleString()}${c.task ? " · " + esc(c.task) : ""}</span></div>${diffView(c.before, c.after)}`,
    `${c.status !== "undone" ? `<button class="btn" data-act="undo" data-id="${c.id}">${ic("undo")}Undo this change</button>` : '<span class="chip">Undone</span>'}<button class="btn primary" data-act="closeModal">Close</button>`, true);
}

/* ---------------- sign-in (lock screen) ---------------- */
const GOOGLE_G = '<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

function setupForm(editing) {
  return `<div class="stack" style="gap:2px">
    <label class="field"><span>Firebase Web API key</span><input class="input mono" id="suKey" placeholder="AIza…" autocomplete="off"><small>Firebase console → Project settings → General → Web API Key.</small></label>
    <label class="field"><span>Google OAuth client ID <span class="faint">(for “Continue with Google”)</span></span><input class="input mono" id="suGid" placeholder="…apps.googleusercontent.com" autocomplete="off"></label>
    <label class="field"><span>Google OAuth client secret</span><input class="input mono" type="password" id="suGsec" placeholder="${editing ? "Leave blank to keep the saved one" : "GOCSPX-…"}" autocomplete="off"></label>
    <label class="field"><span>Only allow these emails <span class="faint">(optional, comma separated)</span></span><input class="input" id="suAllow" placeholder="you@gmail.com"><small>Leave empty to allow any account in your Firebase project. For private use, put your own email here.</small></label>
    <details class="howto"><summary>How do I get these? (about 5 minutes, free)</summary>
      <ol>
        <li>Go to <b>console.firebase.google.com</b> → <b>Add project</b> (any name, e.g. VYRON). Analytics can stay off.</li>
        <li>In the project: <b>Build → Authentication → Get started</b>. Under <b>Sign-in method</b>, turn on <b>Email/Password</b> and <b>Google</b>.</li>
        <li><b>Project settings</b> (gear) → <b>General</b> → copy the <b>Web API Key</b>. (If it's empty, add a Web app with the &lt;/&gt; button first.)</li>
        <li>For Google: open <b>console.cloud.google.com</b> with the same project → <b>APIs &amp; Services → Credentials → Create credentials → OAuth client ID</b> → type <b>Desktop app</b>. Copy the client ID and secret.</li>
        <li>Back in Firebase → Authentication → Sign-in method → Google → <b>Safelisted client IDs</b>: add that client ID. Save.</li>
      </ol></details>
  </div>`;
}

function drawLock() {
  const A = S.auth;
  const root = $("#lockRoot");
  const keep = preserve(root);
  const msg = ui.authErr ? `<div class="auth-msg bad">${esc(ui.authErr)}</div>` : ui.authInfo ? `<div class="auth-msg">${esc(ui.authInfo)}</div>` : "";
  let body;
  if (!A.configured || (ui.authMode === "setup" && A.canEditSetup)) {
    body = `<h2>Set up sign-in</h2><p class="muted">VYRON uses Firebase Authentication for email and Google accounts. Do this once — after that you just sign in.</p>${msg}${setupForm(false)}
      <button class="btn primary wide" data-act="authSetup" data-primary>Save and continue</button>
      ${A.configured ? `<div class="auth-links"><a data-act="authMode" data-id="signin">Back to sign in</a></div>` : ""}`;
  } else if (A.waitingForGoogle) {
    body = `<h2>Continue in your browser</h2><p class="muted">A Google sign-in page opened in your web browser. Choose your account there, then come back here.</p>
      <div class="row" style="justify-content:center;margin:18px 0"><span class="spinner" style="width:22px;height:22px"></span></div>${msg}
      <button class="btn wide" data-act="authCancelGoogle">Cancel</button>`;
  } else if (A.pendingVerify) {
    body = `<h2>Verify your email</h2><p class="muted">We sent a link to <b>${esc(A.pendingVerify.email)}</b>. Open it to confirm it's your email, then press continue.</p>${msg}
      <button class="btn primary wide" data-act="authCheck" data-primary>I've verified — continue</button>
      <div class="row" style="justify-content:space-between;margin-top:10px"><button class="btn ghost sm" data-act="authResend">Resend email</button><button class="btn ghost sm" data-act="authCancelVerify">Use another account</button></div>`;
  } else {
    const mode = ui.authMode || "signin";
    const google = A.googleEnabled ? `<button class="btn wide google" data-act="authGoogle">${GOOGLE_G}Continue with Google</button><div class="or"><span>or</span></div>` : "";
    if (mode === "reset") {
      body = `<h2>Reset password</h2><p class="muted">Enter your email and we'll send a link to choose a new password.</p>${msg}
        <label class="field"><span>Email</span><input class="input" id="auEmail" type="email" autocomplete="email"></label>
        <button class="btn primary wide" data-act="authReset" data-primary>Send reset link</button>
        <div class="auth-links"><a data-act="authMode" data-id="signin">Back to sign in</a></div>`;
    } else {
      const up = mode === "signup";
      body = `<h2>${up ? "Create your account" : "Sign in to VYRON"}</h2><p class="muted">${up ? "Use your email or Google account." : "Welcome back."}</p>${msg}${google}
        <label class="field"><span>Email</span><input class="input" id="auEmail" type="email" autocomplete="email"></label>
        <label class="field"><span>Password</span><input class="input" id="auPass" type="password" autocomplete="${up ? "new-password" : "current-password"}"></label>
        ${up ? `<label class="field"><span>Repeat password</span><input class="input" id="auPass2" type="password" autocomplete="new-password"></label>` : ""}
        <button class="btn primary wide" data-act="${up ? "authSignUp" : "authSignIn"}" data-primary>${up ? "Create account" : "Sign in"}</button>
        <div class="auth-links">${up ? `<a data-act="authMode" data-id="signin">I already have an account</a>` : `<a data-act="authMode" data-id="signup">Create an account</a><a data-act="authMode" data-id="reset">Forgot password?</a>`}</div>`;
    }
  }
  if (A.configured && A.canEditSetup && ui.authMode !== "setup" && !A.pendingVerify && !A.waitingForGoogle) body += `<div class="auth-links" style="justify-content:center;margin-top:8px"><a data-act="authMode" data-id="setup">Change sign-in setup</a></div>`;
  root.innerHTML = `<div class="lock-bar"><div class="winctl">
      <button data-host="minimize" title="Minimize"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg></button>
      <button data-host="close" class="x" title="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div></div>
    <div class="lock"><div class="lock-card ${!A.configured ? "wide" : ""}"><img class="lock-logo" src="icon.svg" alt=""><div class="lock-brand">VYRON</div>${body}</div>
    ${A.allowList ? '<div class="lock-foot">This copy of VYRON is private.</div>' : ""}</div>`;
  const key = [A.configured, A.waitingForGoogle, !!A.pendingVerify, ui.authMode].join("|");
  root.classList.toggle("settled", root.dataset.key === key);
  root.dataset.key = key;
  restore(root, keep);
}

async function authCall(btn, method, ...args) {
  ui.authErr = ""; ui.authInfo = "";
  const label = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>' + (btn.textContent || ""); }
  try { return await B.call(method, ...args); }
  catch (e) { ui.authErr = e.message; return undefined; }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } render(); }
}

/* ---------------- actions ---------------- */
const ACT = {
  closeModal, closeModalScrim: (el, e) => { if (e.target === el) closeModal(); },
  closeDrawer: () => { ui.drawer = null; render(); },
  openApprovals: () => { ui.drawer = "approvals"; render(); },
  openTask: (el) => { ui.taskSel = el.dataset.id; ui.drawer = "task"; render(); },
  toggleEl: (el) => el.classList.toggle("on"),
  copyCode: (el) => { navigator.clipboard.writeText(el.closest(".code").querySelector("pre").textContent); toast("Copied"); },

  async quickBuild() { const t = val("quickBuild").trim(); if (!t) return toast("Describe what to build first", "error"); await call("build", t); $("#quickBuild").value = ""; toast("The Lead Developer is planning it"); },
  async setProject(el) { await call("setActiveProject", el.dataset.id); },
  async refreshGame(el) { await call("refreshGame", el.dataset.id); toast("Game info refreshed"); },
  addProject: () => projectModal(),
  editProject: (el) => projectModal(S.projects.find((p) => p.id === el.dataset.id)),
  async browseDir() { const d = await B.host("pickFolder"); if (d) $("#prDir").value = d; },
  async saveProject(el) {
    const data = { name: val("prName"), rojoDir: val("prDir"), placeId: val("prPlace"), universeId: val("prUni") };
    if (val("prStudio")) data.studioId = val("prStudio");
    if (el.dataset.id) await call("updateProject", el.dataset.id, data); else await call("addProject", data);
    closeModal(); toast("Project saved");
  },
  async removeProject(el) { if (confirm("Remove this project from VYRON? Files on disk are not deleted.")) await call("removeProject", el.dataset.id); },
  async snapshot() { const r = await call("snapshotProject", S.activeProjectId); toast(`Snapshot saved (${r.files} files)`); },
  async undo(el) { if (!confirm("Restore the previous version of this file?")) return; await call("undoChange", S.activeProjectId, el.dataset.id); closeModal(); toast("Change undone"); },
  viewChange: (el) => showChange(el.dataset.id),

  addProvider: () => providerModal(),
  editProvider: (el) => providerModal(S.providers.find((p) => p.id === el.dataset.id)),
  async saveProvider(el) {
    const b = el; b.disabled = true; b.innerHTML = '<span class="spinner"></span>Connecting…';
    try {
      if (el.dataset.id) await call("updateProvider", el.dataset.id, { name: val("pName"), baseURL: val("pBase"), apiKey: val("pKey") });
      else await call("addProvider", { type: val("pType"), name: val("pName"), baseURL: val("pType") === "openai" ? val("pBase") : "", apiKey: val("pKey") });
      closeModal();
    } catch { b.disabled = false; b.textContent = "Try again"; }
  },
  async testProvider(el) { const r = await call("testProvider", el.dataset.id); toast(r.status === "connected" ? "Connected" : r.error, r.status === "connected" ? "" : "error"); },
  async removeProvider(el) { if (confirm("Remove this provider? Agents using it will show as not connected.")) await call("removeProvider", el.dataset.id); },
  async defaultTeam() { await call("createDefaultTeam", S.providers.find((p) => p.status === "connected")?.id || S.providers[0].id); },
  addAgent: () => agentModal(),
  editAgent: (el) => agentModal(agentById(el.dataset.id)),
  async saveAgent(el) {
    const mcp = {};
    $$("#modalRoot [data-mcp]").forEach((sel) => {
      mcp[sel.dataset.mcp] = sel.value === "custom" ? $$(`#modalRoot .mcp-pick[data-for="${sel.dataset.mcp}"] input:checked`).map((c) => c.value) : sel.value;
    });
    const data = { name: val("aName") || "Agent", role: val("aRole"), providerId: val("aProv"), model: val("aModel"), budget: Number(val("aBudget")), instructions: val("aInstr"), tools: { files: $("#aFiles").classList.contains("on"), mcp } };
    if (el.dataset.id) await call("updateAgent", el.dataset.id, data);
    else { const id = await call("addAgent", data); if (id) await call("updateAgent", id, { tools: data.tools }); }
    closeModal();
  },
  async agentAct(el) { await call("agentAction", el.dataset.id, el.dataset.op); },
  async removeAgent(el) { if (confirm("Remove this agent? Its running task is cancelled.")) await call("removeAgent", el.dataset.id); },

  async addStudioServer() { toast("Starting the Roblox Studio MCP server…"); await call("addServer", { preset: "roblox-studio" }); },
  addServer: () => serverModal(),
  editServer: (el) => serverModal(S.mcpServers.find((s) => s.id === el.dataset.id)),
  async saveServer(el) {
    const tr = $("#sTr button.on").dataset.tr;
    const secrets = {};
    val("sSecrets").split("\n").map((l) => l.trim()).filter(Boolean).forEach((l) => { const i = l.indexOf("="); if (i > 0) secrets[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
    const rm = $$("#modalRoot [data-rm]:checked").map((c) => c.dataset.rm);
    const cfg = { name: val("sName") || "MCP server", transport: tr, command: val("sCmd"), args: val("sArgs"), cwd: val("sCwd"), url: val("sUrl"), autoConnect: $("#sAuto").classList.contains("on"),
      [tr === "stdio" ? "envSet" : "headersSet"]: secrets, envRemove: rm, headersRemove: rm };
    el.disabled = true; el.innerHTML = '<span class="spinner"></span>Connecting…';
    try { if (el.dataset.id) await call("updateServer", el.dataset.id, cfg); else await call("addServer", cfg); closeModal(); }
    catch { el.disabled = false; el.textContent = "Try again"; }
  },
  async connectServer(el) { await call("connectServer", el.dataset.id); },
  async disconnectServer(el) { await call("disconnectServer", el.dataset.id); },
  async refreshServer(el) { await call("refreshServer", el.dataset.id); toast("Tools refreshed"); },
  async removeServer(el) { if (confirm("Remove this MCP server?")) await call("removeServer", el.dataset.id); },
  toggleTools: (el) => { ui.mcpOpen[el.dataset.id] = !ui.mcpOpen[el.dataset.id]; render(); },

  async detectStudios() { try { const r = await call("detectStudios"); toast(r.length ? `Found ${r.length} Studio window(s)` : "No Studio window found"); } catch { /* toasted */ } },
  async linkStudio(el) { await call("updateProject", S.activeProjectId, { studioId: el.dataset.id }); toast("Linked to the active project"); },
  async projectFromStudio(el) { const id = await call("addProject", { studioId: el.dataset.id }); await call("setActiveProject", id); toast("Project created"); },
  async openFile(el) { ui.fileSel = el.dataset.id; ui.fileContent = "Loading…"; render(); try { ui.fileContent = await call("readFile", S.activeProjectId, el.dataset.id); } catch { ui.fileContent = ""; } render(); },
  reloadFiles: () => { ui.filesFor = null; render(); },
  openFolder: () => B.host("openPath", activeProject()?.rojoDir),

  wsFocus: (el, e) => { if (e.target.closest("[data-act=wsToggle]")) return; ui.wsFocus = el.dataset.id; if (!ui.wsSel.includes(el.dataset.id)) ui.wsSel = [el.dataset.id]; render(); },
  wsToggle: (el) => { const id = el.dataset.id; ui.wsSel = ui.wsSel.includes(id) ? ui.wsSel.filter((x) => x !== id) : [...ui.wsSel, id]; if (!ui.wsSel.length) ui.wsSel = [id]; render(); },
  async chatSend() { const t = val("chatInput").trim(); if (!t) return; await call("sendChat", { agentIds: ui.wsSel, text: t }); $("#chatInput").value = ""; },
  async chatBuild() { const t = val("chatInput").trim(); if (!t) return toast("Write what to build first", "error"); await call("build", t, { agentIds: ui.wsSel.length > 1 ? ui.wsSel : null }); $("#chatInput").value = ""; toast("Build started — follow it in Task Manager"); },
  async clearChat(el) { await call("clearChat", el.dataset.id); },
  async approve(el) { await call("resolveApproval", el.dataset.id, true, val("note-" + el.dataset.id)); },
  async reject(el) { await call("resolveApproval", el.dataset.id, false, val("note-" + el.dataset.id)); },

  promptCat: (el) => { ui.promptCat = el.dataset.id; render(); },
  newPrompt: () => promptModal(),
  editPrompt: (el) => promptModal(S.prompts.find((p) => p.id === el.dataset.id)),
  async savePrompt(el) { await call("savePrompt", { id: el.dataset.id || undefined, title: val("pmTitle"), category: val("pmCat"), body: val("pmBody") }); closeModal(); toast("Prompt saved"); },
  async deletePrompt(el) { if (confirm("Delete this prompt?")) await call("deletePrompt", el.dataset.id); },
  async favPrompt(el) { await call("toggleFavorite", el.dataset.id); },
  copyPrompt: (el) => { navigator.clipboard.writeText(S.prompts.find((p) => p.id === el.dataset.id).body); toast("Copied"); },
  async promptBuild(el) { await call("build", S.prompts.find((p) => p.id === el.dataset.id).body); toast("Build started — the Lead Developer is planning"); },
  promptSend: (el) => agentPickModal(S.prompts.find((p) => p.id === el.dataset.id).body, "Send prompt to an agent"),
  async doSendPrompt() { const id = val("pickAgent"); await call("sendChat", { agentIds: [id], text: val("pickText") }); closeModal(); ui.wsSel = [id]; ui.wsFocus = id; go("workspace"); },
  improveIdea: () => improveModal(),
  async runImprove(el) {
    const idea = val("impIdea").trim(); if (!idea) return;
    el.disabled = true; el.innerHTML = '<span class="spinner"></span>Thinking…';
    try {
      const out = await call("improvePrompt", idea, val("impAgent"), $("#impResearch").classList.contains("on"));
      $("#impOut").innerHTML = `<label class="field"><span>Improved prompt (you can edit it)</span><textarea class="input" id="impText" style="min-height:260px">${esc(out)}</textarea></label>
        <div class="row"><select class="select" id="impCat" style="width:200px">${CATEGORIES.map((c) => `<option>${c}</option>`).join("")}</select><button class="btn" data-act="saveImproved">Save to library</button><div class="grow"></div><button class="btn primary" data-act="buildImproved">${ic("bolt")}Build it</button></div>`;
    } finally { el.disabled = false; el.innerHTML = ic("sparkle") + "Improve again"; }
  },
  async saveImproved() { await call("savePrompt", { title: val("impIdea").slice(0, 80), category: val("impCat"), body: val("impText") }); toast("Saved to the library"); },
  async buildImproved() { await call("build", val("impText")); closeModal(); toast("Build started"); go("tasks"); },

  authMode: (el) => { ui.authMode = el.dataset.id; ui.authErr = ""; ui.authInfo = ""; render(); },
  async authSetup(el) {
    const r = await authCall(el, "authSetup", { apiKey: val("suKey"), googleClientId: val("suGid"), googleClientSecret: val("suGsec"), allowedEmails: val("suAllow") });
    if (r !== undefined || !ui.authErr) { ui.authInfo = "Sign-in is set up. Create your account or sign in."; ui.authMode = "signin"; }
    render();
  },
  async authSignIn(el) { await authCall(el, "authSignIn", { email: val("auEmail"), password: val("auPass") }); },
  async authSignUp(el) {
    if (val("auPass") !== val("auPass2")) { ui.authErr = "The passwords don't match."; return render(); }
    await authCall(el, "authSignUp", { email: val("auEmail"), password: val("auPass") });
  },
  async authGoogle(el) { await authCall(el, "authGoogle"); },
  async authCancelGoogle(el) { await authCall(el, "authCancelGoogle"); ui.authErr = ""; render(); },
  async authReset(el) { const r = await authCall(el, "authResetPassword", { email: val("auEmail") }); if (!ui.authErr) { ui.authInfo = "If that email has an account, a reset link is on its way."; ui.authMode = "signin"; render(); } return r; },
  async authResend(el) { await authCall(el, "authResendVerify"); if (!ui.authErr) { ui.authInfo = "Email sent again. Check your spam folder too."; render(); } },
  async authCheck(el) { await authCall(el, "authCheckVerified"); },
  async authCancelVerify(el) { await authCall(el, "authCancelVerify"); },
  async authSignOut() { if (confirm("Sign out of VYRON? Running agents are stopped.")) await B.call("authSignOut"); },
  editSignIn: () => modal("Sign-in settings", setupForm(true), `<button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" data-act="saveSignIn">Save</button>`, true),
  async saveSignIn() { await call("authSetup", { apiKey: val("suKey"), googleClientId: val("suGid"), googleClientSecret: val("suGsec"), allowedEmails: val("suAllow") }); closeModal(); toast("Sign-in settings saved"); },

  async linkRoblox(el) {
    el.disabled = true; el.innerHTML = '<span class="spinner"></span>Waiting for Roblox sign-in…';
    try { const me = await call("linkRoblox"); toast(`Linked @${me.name}`); } catch { /* toasted */ } finally { render(); }
  },
  async unlinkRoblox() { if (confirm("Unlink your Roblox account and sign it out of VYRON?")) { await call("unlinkRoblox"); toast("Roblox account unlinked"); } },
  async refreshRevenue() { await call("refreshRevenue", true); },
  revTf: (el) => { ui.revTf = el.dataset.id; render(); },
  async saveRbxKey() { const k = val("rbxKey"); if (!k.trim()) return; await call("setRobloxApiKey", k); $("#rbxKey").value = ""; toast("API key saved — loading game analytics"); },
  async clearRbxKey() { if (confirm("Remove the Open Cloud API key?")) await call("clearRobloxApiKey"); },

  taskFilter: (el) => { ui.taskFilter = el.dataset.id; render(); },
  newTask: () => taskModal(),
  async saveTask() { await call("createTask", { title: val("tkTitle"), description: val("tkDesc"), agentId: val("tkAgent") || null, role: val("tkRole") || null, priority: val("tkPrio"), deps: val("tkDep") ? [val("tkDep")] : [] }); closeModal(); toast("Task created"); },
  async cancelTask(el) { await call("cancelTask", el.dataset.id); },
  async retryTask(el) { await call("retryTask", el.dataset.id); },
  async clearTasks() { await call("clearFinishedTasks"); },

  async setting(el) { let v = el.dataset.val; if (v === "true") v = true; else if (v === "false") v = false; await call("saveSettings", { [el.dataset.key]: v }); },
  copyLog: () => { navigator.clipboard.writeText(S.activity.map((l) => `${new Date(l.at).toISOString()} [${l.level}] ${l.source}: ${l.text}`).join("\n")); toast("Log copied"); },
};

function go(route) { ui.route = route; lsSet("route", route); ui.drawer = ui.drawer === "approvals" ? null : ui.drawer; render(); }

document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]");
  if (g) { go(g.dataset.go); return; }
  const h = e.target.closest("[data-host]");
  if (h) { B.host(h.dataset.host); return; }
  const a = e.target.closest("[data-act]");
  if (a && ACT[a.dataset.act]) { e.stopPropagation(); Promise.resolve(ACT[a.dataset.act](a, e)).catch(() => {}); }
});
document.addEventListener("change", async (e) => {
  const el = e.target.closest("[data-change]");
  if (!el) return;
  if (el.dataset.change === "toolPolicy") await call("setToolPolicy", el.dataset.id, el.dataset.tool, el.value).catch(() => {});
  if (el.dataset.change === "setting") await call("saveSettings", { [el.dataset.key]: el.dataset.key === "maxParallel" ? Number(el.value) : el.value || null }).catch(() => {});
});
document.addEventListener("input", (e) => { if (e.target.id === "promptSearch") { ui.promptQ = e.target.value; render(); } });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if ($("#modalRoot").innerHTML) closeModal(); else if (ui.drawer) { ui.drawer = null; render(); } }
  if (e.target.id === "chatInput" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ACT.chatSend(); }
  if (e.key === "Enter" && e.target.closest?.("#lockRoot") && e.target.tagName === "INPUT") { e.preventDefault(); $("#lockRoot [data-primary]")?.click(); }
  if (e.target.id === "quickBuild" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) ACT.quickBuild();
});
$("#top").addEventListener("dblclick", (e) => { if (!e.target.closest("button")) B.host("toggleMaximize"); });

/* chart tooltips */
const tipEl = Object.assign(document.createElement("div"), { className: "ctip" });
document.body.appendChild(tipEl);
document.addEventListener("mousemove", (e) => {
  const h = e.target.closest?.("[data-tip]");
  $$(".hit.on").forEach((x) => x !== h && x.classList.remove("on"));
  if (!h) { tipEl.style.opacity = 0; return; }
  h.classList.add("on");
  tipEl.textContent = h.dataset.tip;
  tipEl.style.opacity = 1;
  const x = Math.min(innerWidth - tipEl.offsetWidth - 8, e.clientX + 12);
  tipEl.style.transform = `translate(${x}px,${e.clientY - 36}px)`;
});

/* ripple on buttons and nav */
document.addEventListener("pointerdown", (e) => {
  const t = e.target.closest(".btn,.nav,.pick");
  if (!t || S?.settings?.animations === false) return;
  const r = t.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2.2;
  const s = document.createElement("span");
  s.className = "ripple";
  Object.assign(s.style, { width: d + "px", height: d + "px", left: e.clientX - r.left - d / 2 + "px", top: e.clientY - r.top - d / 2 + "px" });
  t.appendChild(s);
  setTimeout(() => s.remove(), 650);
});

let lastApprovals = 0;
function afterDraw() {
  if (S.approvals.length > lastApprovals) toast(`${S.approvals.at(-1).agentName} is waiting for your approval`);
  lastApprovals = S.approvals.length;
}

/* ---------------- background: quiet light field ---------------- */
(() => {
  const cv = $("#bg"), cx = cv.getContext("2d");
  let W, H, pts = [];
  const resize = () => {
    W = cv.width = innerWidth * devicePixelRatio; H = cv.height = innerHeight * devicePixelRatio;
    pts = Array.from({ length: Math.min(70, Math.floor(innerWidth * innerHeight / 22000)) }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18, r: Math.random() * 1.2 + 0.4 }));
  };
  addEventListener("resize", resize); resize();
  (function frame() {
    requestAnimationFrame(frame);
    if (!S || S.settings?.reduceEffects || document.hidden) { cx.clearRect(0, 0, W, H); return; }
    const light = S.settings?.theme === "light";
    cx.clearRect(0, 0, W, H);
    const D = 140 * devicePixelRatio;
    for (const p of pts) { p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1; }
    cx.lineWidth = devicePixelRatio * 0.6;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < D) { cx.strokeStyle = light ? `rgba(40,60,120,${(1 - d / D) * 0.06})` : `rgba(255,255,255,${(1 - d / D) * 0.05})`; cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke(); }
    }
    for (const p of pts) { cx.fillStyle = light ? "rgba(40,60,120,.18)" : "rgba(255,255,255,.28)"; cx.beginPath(); cx.arc(p.x, p.y, p.r * devicePixelRatio, 0, 7); cx.fill(); }
  })();
})();

/* ---------------- start ---------------- */
(async () => {
  desktop = !!(await B.host("isDesktop"));
  document.body.classList.toggle("desktop", desktop);
  B.on((type, payload) => {
    if (type === "state") {
      const first = !S;
      S = payload;
      render();
      if (first) setTimeout(() => $("#boot").classList.add("gone"), 350);
    }
  });
  try { S = await B.call("publicState"); render(); setTimeout(() => $("#boot").classList.add("gone"), 450); }
  catch (e) { $("#bootMsg").textContent = "Could not start: " + e.message; }
})();

/* VYRON renderer. A companion app for Claude. All data comes from the
   backend (Electron main process, or src/devserver.js in a browser). */
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
  team: '<path d="M12 2.5 4.5 5.5v6c0 4.6 3.2 8.4 7.5 10 4.3-1.6 7.5-5.4 7.5-10v-6z"/><path d="m8.8 12 2.2 2.2 4.4-4.6"/>',
  connect: '<path d="M7 7h10M7 12h10M7 17h6"/><circle cx="4" cy="7" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="17" r="1"/><path d="m16 15 2 2 4-4"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M17 6l3 3M14.5 8.5l2 2"/>', link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
};
ICON.crown = '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/><path d="M5 19h14"/>';
ICON.cube = '<path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z"/><path d="M3.5 7 12 11.5 20.5 7M12 11.5v10"/>';
ICON.code = '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>';
ICON.layout = '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M9 9v11"/>';
ICON.coin = '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2s1.2 1.7 2.8 2 2.8.8 2.8 2-1.2 2-2.8 2c-1.3 0-2.4-.6-2.9-1.5M12 6.3v1.5M12 16.2v1.5"/>';
const ic = (n, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[n] || ""}</svg>`;
ICON.claude = '<path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M5.3 18.7l2.8-2.8M15.9 8.1l2.8-2.8"/>';
ICON.ideas = '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>';
ICON.stop = '<rect x="6" y="6" width="12" height="12" rx="2"/>';
ICON.check = '<path d="m5 12 5 5 9-10"/>';

const PAGES = [["dashboard", "Dashboard"], ["claude", "Claude"], ["ideas", "Game Ideas"], ["projects", "Projects & Studio"], ["revenue", "Revenue"], ["settings", "Settings"]];
const SUB = {
  dashboard: "Your game studio at a glance", claude: "Talk to Claude — it controls VYRON and Roblox Studio for you", ideas: "Pick ideas and let Claude build them",
  projects: "Your Roblox games and the Studio connection", revenue: "Robux, pending earnings and DevEx value in kroner", settings: "Claude access, appearance and account",
};

/* ---------------- state ---------------- */
let S = null;
let desktop = false;
let IDEAS = [];
const ui = { route: lsGet("route") || "dashboard", ideaCat: "All", ideaQ: "", ideaTab: "library", drawer: null };
if (!PAGES.some((p) => p[0] === ui.route)) ui.route = "dashboard";
function lsGet(k) { try { return localStorage.getItem("vy." + k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem("vy." + k, v); } catch { /* ignore */ } }
const activeProject = () => S.projects.find((p) => p.id === S.activeProjectId) || null;
const picked = () => new Set(S.ideas.picked);
const allIdeas = () => [...IDEAS, ...S.ideas.custom];

async function call(method, ...args) {
  try { return await B.call(method, ...args); }
  catch (e) { toast(e.message, "error"); throw e; }
}
function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.innerHTML = `<span class="dot ${kind === "error" ? "error" : "connected"}"></span><span>${esc(msg)}</span>`;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.style.transition = "opacity .3s"; t.style.opacity = 0; setTimeout(() => t.remove(), 300); }, kind === "error" ? 6000 : kind === "note" ? 9000 : 3000);
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
let lastOverlay = "";
function draw() {
  if (!S) return;
  if (S.locked) { document.body.classList.add("locked"); drawLock(); return; }
  if (document.body.classList.contains("locked")) { document.body.classList.remove("locked"); $("#lockRoot").innerHTML = ""; lastRoute = null; }
  applyTheme(themeById(S.settings.themeId || (S.settings.theme === "light" ? "vyron-light" : "vyron-dark")));
  window.__fxOff = !!S.settings.reduceEffects;
  document.body.classList.toggle("noanim", S.settings.animations === false);
  document.body.classList.toggle("reduce", !!S.settings.reduceEffects);
  drawNav();
  const page = $("#page");
  const keep = preserve(page);
  const th0 = $("#thread");
  const sticky = th0 ? th0.scrollHeight - th0.scrollTop - th0.clientHeight < 80 : true;
  const pageScroll = page.scrollTop;
  page.innerHTML = (VIEWS[ui.route] || VIEWS.dashboard)();
  page.scrollTop = pageScroll;
  page.classList.toggle("settled", lastRoute === ui.route);
  if (lastRoute !== ui.route) { page.classList.remove("page-in"); void page.offsetWidth; page.classList.add("page-in"); page.scrollTop = 0; lastRoute = ui.route; }
  else restore(page, keep);
  const th = $("#thread"); if (th && sticky) th.scrollTop = th.scrollHeight;
  $("#title").textContent = PAGES.find((p) => p[0] === ui.route)?.[1] || "";
  $("#subtitle").textContent = SUB[ui.route] || "";
  const C = S.claude;
  $("#topActions").innerHTML = C.busy ? `<button class="btn sm" data-go="claude"><span class="spinner"></span>${C.running} Claude task${C.running === 1 ? "" : "s"} working${C.queued ? ` · ${C.queued} waiting` : ""}</button>` : "";
  const ov = pcOverlay(); if (ov !== lastOverlay) { $("#drawerRoot").innerHTML = ov; lastOverlay = ov; }
  const t = performance.now();
  $$(".spinner").forEach((e) => (e.style.animationDelay = -(t % 800) + "ms"));
  $$(".dot.working,.dot.connecting").forEach((e) => (e.style.animationDelay = -(t % 1800) + "ms"));
  $$(".typing i").forEach((e, i) => (e.style.animationDelay = -(t % 1200) + i * 150 + "ms"));
}

function drawNav() {
  const counts = { ideas: S.ideas.picked.length, claude: S.claude.running + S.claude.queued };
  $("#nav").innerHTML = PAGES.map(([k, label]) => `<div class="nav ${ui.route === k ? "on" : ""}" data-go="${k}">${ic(k === "projects" ? "roblox" : k)}${label}${counts[k] ? `<span class="count">${counts[k]}</span>` : ""}</div>`).join("");
  const p = activeProject();
  const C = S.claude;
  $("#sideFoot").innerHTML = `
    ${p ? `<div class="mini-proj" data-go="projects">${gameIcon(p, "sm")}<div class="grow"><div class="ell" style="font-weight:600;font-size:13px">${esc(p.game?.name || p.name)}</div><div class="faint" style="font-size:11.5px"><span class="dot ${p.studioConnected ? "connected" : "unknown"}" style="display:inline-block;width:6px;height:6px;margin-right:5px"></span>${p.studioConnected ? "Open in Studio" : "Studio not linked"}</div></div></div>`
      : `<div class="mini-proj" data-go="projects"><div class="gicon sm"><div class="fallback">+</div></div><div class="faint" style="font-size:12.5px">Add a project</div></div>`}
    <div class="faint" style="font-size:11.5px;padding:2px 4px"><span class="dot ${claudeDot()}" style="display:inline-block;width:6px;height:6px;margin-right:6px"></span>${claudeLine()}${modelNow() ? " · " + esc(modelNow()) : ""}</div>
    ${S.auth?.user ? `<div class="row acct" data-go="settings" title="${esc(S.auth.user.email)}"><div class="av" style="margin:0;width:24px;height:24px;font-size:10px">${esc(initials(S.auth.user.email))}</div><span class="ell grow" style="font-size:12px">${esc(S.auth.user.email)}</span></div>` : ""}`;
}
const claudeDot = () => (!S.claude.found ? "error" : S.claude.busy ? "working" : S.claude.auth?.loggedIn ? "connected" : "unknown");
/** Which model Claude is running (as Claude Code reports it), and a note if a different one is picked for the next message. */
const modelNow = () => S.claude.modelName || null;
const modelPending = () => { const want = S.settings.claudeModel; const now = (S.claude.modelName || "").toLowerCase(); return want && now && !now.startsWith(want.toLowerCase()) ? want[0].toUpperCase() + want.slice(1) : null; };
const modelChip = () => modelNow() ? `<span class="chip model" title="${esc(S.claude.model)}">${ic("sparkle")}${esc(modelNow())}${modelPending() ? ` → ${esc(modelPending())} next` : ""}</span>` : `<span class="chip" title="Shown after Claude answers once">${ic("sparkle")}${S.settings.claudeModel ? esc(S.settings.claudeModel[0].toUpperCase() + S.settings.claudeModel.slice(1)) : "Model: after first reply"}</span>`;
const claudeLine = () => (!S.claude.found ? "Claude Code not installed" : S.claude.busy ? `${S.claude.running} task${S.claude.running === 1 ? "" : "s"} working` : S.claude.auth?.loggedIn ? "Claude ready" : S.claude.auth ? "Sign in to Claude" : "Checking Claude…");

/* ---------------- sounds ---------------- */
function soundFor(ev) { return (S.settings.soundMap || {})[ev] || SOUND_EVENTS.find((e) => e[0] === ev)?.[2]; }
function ding(ev) { if (S?.settings && S.settings.sounds !== false) playSound(soundFor(ev), S.settings.volume ?? 0.7); }

/* interface sounds: click / hover / pick (Settings → Interface sounds) */
let uiLast = 0, uiHoverEl = null;
function uiSound(kind, step = 0) {
  const st = S?.settings;
  if (!st || st.uiSounds === false || (kind === "hover" && st.uiHover !== true)) return;
  const now = performance.now();
  if (kind === "hover" && now - uiLast < 45) return;
  uiLast = now;
  playSound(`ui-${st.uiPack || "soft"}-${kind}`, (st.volume ?? 0.7) * 0.5, 2 ** (step / 12));
}
const UI_HOVER = ".btn,.nav,.pick,.theme-card,.idea,.radio-card,.toggle,.seg button,.stat.click,.mini-proj,.task-pick";
document.addEventListener("pointerover", (e) => {
  const el = e.target.closest?.(UI_HOVER);
  if (el && el !== uiHoverEl && !el.disabled) uiSound("hover");
  uiHoverEl = el || null;
});
document.addEventListener("click", (e) => {
  const el = e.target.closest?.("[data-go],[data-act],[data-host],button,.seg button,select,input[type=checkbox]");
  if (!el || el.disabled) return;
  // Only tabs and choices make a sound. Each tab is a slightly different note.
  if (el.matches(".nav[data-go]")) return uiSound("nav", [0, 2, 4, 5, 7, 9][PAGES.findIndex((p) => p[0] === el.dataset.go)] || 0);
  const act = el.dataset.act || "";
  if (/^(setting|setTheme|randomTheme|toggleIdea|ideaTab|ideaCat|pickTask|revTf|teamRole)$/.test(act) || el.matches(".toggle,.radio-card")) return uiSound("pick");
}, true);
document.addEventListener("change", (e) => { if (e.target.matches?.("select")) uiSound("pick"); }, true);

/* ---------------- PC control overlay ---------------- */
const PC_ICON = { screenshot: "image", click: "bolt", move: "bolt", scroll: "bolt", type: "edit", key: "key" };
function pcOverlay() {
  const P = S.pc;
  if (!P) return "";
  const using = P.activeAt && Date.now() - P.activeAt < 8000;
  const bar = using || P.allowedUntil ? `<div class="pc-bar"><span class="dot working"></span><b>${using ? "Claude is using your PC" : "PC control allowed"}</b>${P.allowedUntil ? `<span class="faint">without asking until ${time(P.allowedUntil)}</span>` : ""}<button class="btn sm danger" data-act="pcRevoke">${ic("stop")}Stop</button></div>` : "";
  const asks = P.asks.map((a) => `<div class="pc-ask panel"><div class="row" style="gap:10px"><div class="ava" style="width:30px;height:30px;border-radius:9px">${ic(PC_ICON[a.kind] || "bolt")}</div><div class="grow"><div class="label">Claude wants to use your PC</div><b>${esc(a.what)}</b></div></div>
    <div class="faint" style="font-size:12px;margin:8px 0 10px">${a.kind === "screenshot" ? "Claude will see everything on your screens. Close private things first." : "This happens on your real mouse and keyboard."} Asked at ${time(a.at)}; refused automatically after 2 minutes.</div>
    <div class="row"><button class="btn sm danger" data-act="pcAnswer" data-id="${a.id}" data-val="deny">Deny</button><div class="grow"></div><button class="btn sm" data-act="pcAnswer" data-id="${a.id}" data-val="allow10" title="Allow everything for 10 minutes">Allow 10 min</button><button class="btn sm primary" data-act="pcAnswer" data-id="${a.id}" data-val="allow">Allow</button></div></div>`).join("");
  return bar + (asks ? `<div class="pc-asks">${asks}</div>` : "");
}

/* ---------------- shared pieces ---------------- */
function gameIcon(p, size = "") {
  const name = p?.game?.name || p?.name || "?";
  const fb = `<div class="fallback">${esc(initials(name))}</div>`;
  const img = p?.game?.iconUrl ? `<img src="${esc(p.game.iconUrl)}" alt="${esc(name)} icon" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'fallback',textContent:${esc(JSON.stringify(initials(name)))}}))">` : fb;
  return `<div class="gicon ${size}" data-key="${esc(p?.id || "")}">${img}</div>`;
}
function empty(title, text, action = "") { return `<div class="empty"><b>${esc(title)}</b>${esc(text)}${action ? `<div class="sp"></div>${action}` : ""}</div>`; }
const krFmt = new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 2 });
const kr = (robux) => krFmt.format((Number(robux) || 0) * (S.rates?.dkkPerRobux || 0.0038 * 6.8));

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

/* =================== VIEWS =================== */
const VIEWS = {};

function claudeSetupCard() {
  const C = S.claude;
  if (!C.found) return `<div class="panel pad row" style="gap:14px;border-color:rgba(245,143,143,.35)"><span class="dot error"></span><div class="grow"><b>Claude Code isn't installed on this PC</b><div class="muted" style="font-size:12.5px">Install the Claude desktop app (it includes Claude Code), then press Check again.</div></div><button class="btn sm" data-act="openUrl" data-id="https://claude.ai/download">Get Claude</button><button class="btn sm" data-act="claudeCheck">${ic("refresh")}Check again</button></div>`;
  if (C.auth && !C.auth.loggedIn) return `<div class="panel pad row" style="gap:14px;border-color:rgba(255,200,120,.35)"><span class="dot unknown"></span><div class="grow"><b>Sign in to Claude once</b><div class="muted" style="font-size:12.5px">A window opens where you sign in with your Claude account (in your browser). VYRON never sees your password.</div></div><button class="btn primary" data-act="claudeLogin">${ic("claude")}Sign in to Claude</button><button class="btn sm ghost" data-act="claudeCheck">${ic("refresh")}</button></div>`;
  return "";
}

VIEWS.dashboard = () => {
  const p = activeProject();
  const C = S.claude, sm = S.revenue.summary;
  const lt = [...C.tasks].sort((a, b) => b.at - a.at)[0];
  const last = (lt?.messages || []).filter((m) => m.role !== "result").slice(-6);
  return `${claudeSetupCard()}${claudeSetupCard() ? '<div class="sp"></div>' : ""}
  <div class="grid" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)">
    ${projectCard(p)}
    <div class="panel pad stack">
      <div class="row"><div class="h3 grow">Tell Claude what to build</div><span class="faint" style="font-size:12px">${p ? esc(p.game?.name || p.name) : "No project"}</span></div>
      <textarea class="input" id="quickAsk" placeholder="e.g. “Add a pet egg shop with 3 rarities and a hatch animation” — Enter to send" style="min-height:110px"></textarea>
      <div class="row"><button class="btn sm ghost" data-go="ideas">${ic("ideas")}Browse ${S.ideas.count}+ game ideas</button><div class="grow"></div><button class="btn primary" data-act="quickAsk">${ic("send")}Send to Claude</button></div>
    </div>
  </div>
  <div class="sp"></div>
  <div class="grid g4">
    <div class="panel stat click" data-go="claude"><div class="label">Claude</div><div class="n" style="font-size:20px"><span class="dot ${claudeDot()}" style="display:inline-block;margin-right:8px"></span>${claudeLine()}</div><div class="d">${modelNow() ? "Model: <b>" + esc(modelNow()) + "</b> · " : ""}${C.tasks.length} task${C.tasks.length === 1 ? "" : "s"} · up to ${C.limit} at once</div></div>
    <div class="panel stat click" data-go="projects"><div class="label">Roblox Studio</div><div class="n" style="font-size:20px">${S.studio.status === "connected" ? S.studios.length + " open" : "Not connected"}</div><div class="d">${esc(S.studios.map((s) => s.name).join(", ") || S.studioError || "")}</div></div>
    <div class="panel stat click" data-go="ideas"><div class="label">Picked ideas</div><div class="n">${S.ideas.picked.length}</div><div class="d">${S.ideas.count} ideas in the library · ${S.ideas.custom.length} of your own</div></div>
    <div class="panel stat click" data-go="revenue"><div class="label">Robux (DevEx value)</div><div class="n">${sm ? rbx(sm.balance) : "—"}</div><div class="d">${sm ? `≈ ${kr(sm.balance)} · pending ${kr(sm.pending)}` : "Link Roblox on the Revenue tab"}</div></div>
  </div>
  <div class="sp"></div>
  <div class="grid g2">
    <div class="panel"><div class="panel-h"><h3>Latest from Claude</h3><div class="grow"></div><button class="btn sm ghost" data-go="claude">Open chat</button></div>
      <div style="padding:8px 14px 14px">${last.length ? last.map((m) => msgView(m, true)).join("") : empty("No chat yet", "Send Claude a message or pick some game ideas.")}</div></div>
    <div class="panel activity"><div class="panel-h"><h3>Recent activity</h3></div>
      <div style="max-height:360px;overflow:auto" id="dashAct">${S.activity.slice(-30).reverse().map((l) => `<div class="list-row"><time>${time(l.at)}</time><div class="grow"><b class="lv-${l.level}" style="font-weight:600">${esc(l.source)}</b> <span class="muted">${esc(l.text)}</span></div></div>`).join("") || empty("Quiet so far", "")}</div></div>
  </div>`;
};

function projectCard(p) {
  if (!p) return `<div class="panel game-card"><div class="gicon"><div class="fallback">+</div></div><div class="game-meta stack grow"><h2>No project yet</h2><div class="muted">Add your Roblox game (or just open a place in Studio). Claude builds in the Studio window you have open.</div><div class="row"><button class="btn primary" data-act="addProject">${ic("plus")}Add project</button><button class="btn" data-go="projects">${ic("roblox")}Studio</button></div></div></div>`;
  return `<div class="panel game-card">${gameIcon(p)}
    <div class="game-meta grow stack" style="gap:8px;min-width:0">
      <div class="row"><div class="label">Active project</div><div class="grow"></div>${S.projects.length > 1 ? `<button class="btn sm" data-go="projects">Switch</button>` : ""}</div>
      <h2 class="ell">${esc(p.game?.name || p.name)}</h2>
      <div class="kv">${p.placeId ? `<span>Place <b>${esc(p.placeId)}</b></span>` : "<span>Not published</span>"}${p.game?.creator ? `<span>by <b>${esc(p.game.creator)}</b></span>` : ""}${p.game?.playing != null ? `<span><b>${fmtN(p.game.playing)}</b> playing</span>` : ""}</div>
      <div class="row wrap"><span class="chip ${p.studioConnected ? "ok" : ""}"><span class="dot ${p.studioConnected ? "connected" : "unknown"}"></span>${p.studioConnected ? "Open in Studio" : "Not open in Studio"}</span>${p.rojoDir ? `<span class="chip">${ic("folder")}Folder linked</span>` : ""}</div>
    </div></div>`;
}

/* ---------- Claude ---------- */
function msgView(m, compact) {
  if (m.role === "user") return `<div class="msg user"><div class="who">You · ${time(m.at)}</div><div class="md">${md(m.text.replace(/^\[Active VYRON project:[^\]]*\]\n/, ""))}</div></div>`;
  if (m.role === "assistant") return `<div class="msg assistant"><div class="who">Claude · ${time(m.at)}</div><div class="md">${md(compact && m.text.length > 400 ? m.text.slice(0, 400) + "…" : m.text)}</div></div>`;
  if (m.role === "tool") return `<div class="tool-step ${m.tool === "error" ? "bad" : ""}">${ic(m.tool === "error" ? "x" : /roblox_studio/.test(m.tool) ? "roblox" : /vyron/.test(m.tool) ? "dashboard" : "bolt")}<span class="ell">${esc(m.text)}</span></div>`;
  if (m.role === "result") return compact ? "" : `<div class="tool-step done">${ic("check")}<span>${esc(m.text)}</span></div>`;
  return `<div class="msg error"><div class="who">Problem</div>${esc(m.text)}</div>`;
}

/** The task being looked at in the Claude tab. */
function curTask() {
  const T = S.claude.tasks;
  let t = T.find((x) => x.id === ui.taskId);
  if (!t) { t = T[0]; ui.taskId = t?.id; }
  return t;
}
const taskState = (t) => (t.busy ? ["working", "Working"] : t.queued ? ["connecting", "Waiting"] : ["idle", t.count ? "Done" : "New"]);

VIEWS.claude = () => {
  const C = S.claude;
  const p = activeProject();
  const t = curTask();
  const active = t.busy || t.queued;
  const list = C.tasks.map((x) => { const [dot, label] = taskState(x); return `<div class="pick task-pick ${x.id === t.id ? "on" : ""} ${x.role ? "r-" + x.role + " has-role" : ""}" data-act="pickTask" data-id="${x.id}">
      ${x.role ? `<span class="agent-ic sm">${ic(ROLE_ICON[x.role])}</span>` : `<span class="dot ${dot}" title="${label}"></span>`}<div class="grow" style="min-width:0"><div class="ell" style="font-weight:500">${x.role ? `<span class="role-tag r-${x.role}">${esc(S.roles[x.role]?.name || x.role)}</span>` : ""}${esc(x.role ? x.title.replace(/^[^:]{2,22}: /, "") : x.title)}</div>
      <div class="faint ell" style="font-size:11.5px">${label}${x.inbox ? ` · ${x.inbox} message${x.inbox > 1 ? "s" : ""} waiting` : ""}${x.modelName ? " · " + esc(x.modelName) : ""}${x.last ? " · " + esc(x.last) : ""}</div></div></div>`; }).join("");
  return `<div class="chat-wrap" style="height:calc(100vh - 102px)">
    ${claudeSetupCard()}
    <div class="claude-grid" style="flex:1;min-height:0">
      <div class="panel ws-agents"><div class="panel-h"><h3>Tasks</h3><span class="faint" style="font-size:12px">${C.running}/${C.limit} running${C.queued ? ` · ${C.queued} waiting` : ""}</span><div class="grow"></div><button class="btn sm" data-act="newTask" title="Start another Claude that works at the same time">${ic("plus")}New</button></div>
        <div style="padding:8px">${teamColumn()}<div class="label" style="margin:12px 6px 6px">Tasks</div>${list}</div>
        <div class="faint" style="font-size:11.5px;padding:4px 14px 14px">Every task is its own Claude working at the same time (up to ${C.limit}, change it in Settings). More tasks use your Claude usage faster.</div></div>
      <div class="panel chat">
        <div class="panel-h"><div class="ava" style="width:32px;height:32px;border-radius:10px">${ic("claude")}</div><div style="min-width:0"><h3 class="ell">${esc(t.title)}</h3><div class="faint" style="font-size:12px">${S.settings.claudeAccess === "full" ? "Full access" : "Studio + VYRON + project files"} · works in ${esc(p ? p.game?.name || p.name : "VYRON's Games folder")}</div></div><div class="grow"></div>
          ${t.modelName ? `<span class="chip model">${ic("sparkle")}${esc(t.modelName)}</span>` : modelChip()}<span class="chip ${S.studio.status === "connected" && S.studios.length ? "ok" : ""}"><span class="dot ${S.studio.status === "connected" && S.studios.length ? "connected" : "unknown"}"></span>Studio</span>
          ${active ? `<button class="btn sm danger" data-act="claudeStop" data-id="${t.id}">${ic("stop")}${t.queued ? "Cancel" : "Stop"}</button>` : `<button class="btn sm ghost" data-act="claudeNewChat" data-id="${t.id}" title="Clear this task's chat">Clear</button><button class="btn sm ghost danger icon" data-act="removeTask" data-id="${t.id}" title="Delete task">${ic("trash")}</button>`}</div>
        <div class="thread" id="thread">
          ${t.messages.length ? t.messages.map((m) => msgView(m)).join("") : `<div class="empty" style="margin:auto;max-width:520px"><b>You control Claude from here</b>Ask for anything in your game — Claude builds it in Roblox Studio, and can use VYRON too. Want several things at once? Press New for another task — each one is a separate Claude working at the same time.</div>`}
          ${t.busy ? `<div class="msg assistant"><div class="who">Claude</div><span class="typing"><i></i><i></i><i></i></span></div>` : t.queued ? `<div class="tool-step"><span class="spinner"></span><span>Waiting — ${C.running} of ${C.limit} tasks are running. Starts automatically.</span></div>` : ""}
        </div>
        <div class="composer">
          <textarea id="claudeInput" placeholder="${active ? "This task is working — use “As new task” to start another one at the same time" : "Message Claude…  (Enter to send, Shift+Enter for a new line)"}"></textarea>
          <div class="row"><button class="btn sm ghost" data-go="ideas">${ic("ideas")}Ideas</button><div class="grow"></div>
            <button class="btn sm" data-act="claudeSendNew" title="Send as a new task that runs at the same time">${ic("plus")}As new task</button>
            <button class="btn sm primary" data-act="claudeSend" ${active ? "disabled" : ""}>${ic("send")}Send</button></div>
        </div>
      </div></div></div>`;
};

function blenderPanel() {
  const b = S.blender || {};
  return `<div class="panel"><div class="panel-h"><h3>Blender</h3><div class="grow"></div><span class="chip ${b.open ? "ok" : ""}"><span class="dot ${b.open ? "connected" : b.found ? "unknown" : "error"}"></span>${b.open ? "Connected" : b.found ? "Not open" : "Not installed"}</span><button class="btn sm ghost icon" data-act="checkBlender" title="Check again">${ic("refresh")}</button></div>
    <div class="panel-b stack">
      <div class="muted" style="font-size:12.5px">${b.open ? "Claude can make and change 3D models in Blender" + (b.file ? " (" + esc(b.file.split(/[\\/]/).pop()) + ")" : "") + "." : esc(b.error || "Checking…")}</div>
      <div class="row" style="gap:8px"><input class="input grow" id="mkModel" placeholder="Make a 3D model… e.g. a cartoon treasure chest with gold trim"><button class="btn primary" data-act="makeModel" ${b.found ? "" : "disabled"}>${ic("bolt")}Make it</button></div>
      <div class="faint" style="font-size:11.5px">A Builder &amp; Modeler Claude builds it in your open Blender file and exports it as .fbx to the project's models folder for Studio's 3D Importer.</div></div></div>`;
}

/** Working, Idle, Offline or Broken for one role (from the newest team in this project). */
function agentStatus(r) {
  const C = S.claude;
  if (!C.found || (C.auth && !C.auth.loggedIn)) return ["offline", "Offline", !C.found ? "Claude Code isn't installed" : "Claude isn't signed in"];
  const team = (S.teams || [])[0];
  const ro = team?.roles?.[r];
  if (team && ro && !ro.enabled) return ["offline", "Offline", "Switched off"];
  const t = ro?.taskId && C.tasks.find((x) => x.id === ro.taskId);
  if (t?.busy || t?.queued || (r === "cofounder" && team && (team.status === "planning" || team.status === "revising"))) return ["working", "Working", t?.queued && !t?.busy ? "Waiting for a free slot" : esc(t?.last || "Working on " + (team?.plan?.title || "the plan"))];
  if (ro?.state === "problem" || (r === "cofounder" && team?.status === "failed")) return ["broken", "Broken", esc(t?.last || team?.error || "Its last step failed")];
  return ["idle", "Idle", team?.plan ? (ro?.taskId ? "Done — waiting for the next job" : "Ready") : "No team yet — ask the Co-Founder in Game Ideas"];
}
function teamColumn() {
  const team = (S.teams || [])[0];
  return `<div class="team-list"><div class="row" style="padding:2px 6px 8px"><b style="font:600 13px var(--f-head)">Team</b><span class="faint ell grow" style="font-size:11.5px;margin-left:8px">${team?.plan ? esc(team.plan.title) : ""}</span></div>
    ${ROLE_ORDER.map((r) => { const [k, label, why] = agentStatus(r); const tid = team?.roles?.[r]?.taskId;
      return `<div class="agent r-${r} st-${k}" ${tid ? `data-act="pickTask" data-id="${tid}"` : 'data-go="ideas"'} title="${why}">
        <span class="agent-ic">${ic(ROLE_ICON[r])}</span><div class="grow" style="min-width:0"><div class="agent-name ell">${esc(S.roles[r].name)}</div><div class="faint ell" style="font-size:11px">${why}</div></div>
        <span class="agent-st"><span class="dot"></span>${label}</span></div>`; }).join("")}</div>`;
}

/* ---------- Studio team (Co-Founder) ---------- */
const ROLE_ICON = { cofounder: "crown", builder: "cube", coder: "code", ui: "layout", money: "coin" };
const ROLE_ORDER = ["cofounder", "builder", "coder", "ui", "money"];
const STATE_DOT = { working: "working", waiting: "connecting", done: "connected", problem: "error", off: "unknown", "not started": "unknown", ready: "unknown" };
function roleSwitch(team, r) {
  const ro = team.roles[r];
  return `<div class="role-row ${ro.enabled ? "" : "off"}"><span class="role-ic r-${r}">${ic(ROLE_ICON[r])}</span><div class="grow" style="min-width:0"><b>${esc(S.roles[r].name)}</b><div class="faint ell" style="font-size:11.5px">${team.status === "building" || team.status === "done" ? `<span class="dot ${STATE_DOT[ro.state] || "unknown"}" style="display:inline-block;width:6px;height:6px;margin-right:5px"></span>${esc(ro.state)}` : esc(S.roles[r].short)}</div></div>
    ${ro.taskId ? `<button class="btn sm ghost" data-act="openTask" data-id="${ro.taskId}">Chat</button>` : ""}<div class="toggle ${ro.enabled ? "on" : ""}" data-act="teamRole" data-id="${team.id}" data-role="${r}" data-on="${!ro.enabled}" title="Switch ${esc(S.roles[r].name)} ${ro.enabled ? "off" : "on"}"></div></div>`;
}
function teamCard(t) {
  const P = t.plan;
  const head = `<div class="row" style="gap:10px"><span class="role-ic r-cofounder">${ic("crown")}</span><div class="grow" style="min-width:0"><b style="font:600 15px var(--f-head)">${esc(P?.title || "New game plan")}</b><div class="faint ell" style="font-size:12px">${esc({ planning: "The Co-Founder is planning…", revising: "The Co-Founder is changing the plan…", proposed: "Plan ready — accept it or ask for changes", building: "The team is building", failed: "Something went wrong", done: "Done" }[t.status] || t.status)}</div></div>
    ${t.cofounderTaskId ? `<button class="btn sm ghost" data-act="openTask" data-id="${t.cofounderTaskId}">Co-Founder chat</button>` : ""}<button class="btn sm ghost danger icon" data-act="teamDiscard" data-id="${t.id}" title="Remove this plan (stops its team)">${ic("trash")}</button></div>`;
  if (t.status === "planning" || t.status === "revising") return `<div class="panel pad team-card">${head}<div class="row" style="margin-top:12px"><span class="spinner"></span><span class="faint" style="font-size:12.5px">Reading your idea and writing a plan for every role. This takes a minute or two.</span></div></div>`;
  const change = `<div class="row" style="margin-top:12px;gap:8px"><input class="input grow" id="cfChange-${t.id}" placeholder="Want something different? e.g. “make it a horror game, fewer gamepasses”"><button class="btn" data-act="teamRevise" data-id="${t.id}">Change</button>${t.status === "proposed" ? `<button class="btn primary" data-act="teamAccept" data-id="${t.id}">${ic("check")}Accept &amp; start building</button>` : ""}</div>`;
  if (t.status === "failed" || !P) return `<div class="panel pad team-card">${head}<div class="faint" style="margin-top:10px;color:var(--bad)">${esc(t.error || "No plan yet.")}</div>${change}</div>`;
  const jobs = (r) => (P.work[r] || []).map((w) => `<li><b>${esc(w.title)}</b><span class="faint"> — ${esc(w.details)}</span></li>`).join("") || '<li class="faint">No jobs</li>';
  return `<div class="panel pad team-card">${head}
    <div class="muted" style="font-size:13px;margin-top:10px">${esc(P.summary)}</div>
    ${P.features.length ? `<div class="row wrap" style="gap:6px;margin-top:10px">${P.features.map((f) => `<span class="tag">${esc(f)}</span>`).join("")}</div>` : ""}
    <div class="team-grid">${ROLE_ORDER.map((r) => `<div class="team-col">${roleSwitch(t, r)}${r === "cofounder" ? '<div class="faint" style="font-size:12px;margin-top:6px">Directs everyone, checks their work and does the final play test.</div>' : `<ul class="jobs">${jobs(r)}</ul>`}</div>`).join("")}</div>
    ${t.status === "proposed" || t.status === "failed" ? change : `<div class="faint" style="font-size:12px;margin-top:10px">Turn a role off to stop it; turn it on again to let it continue. Each role is its own Claude, and more roles at once use your Claude usage faster.</div>`}</div>`;
}
function teamPanel() {
  const teams = S.teams || [];
  const n = S.ideas.picked.length;
  return `<div class="panel pad stack cofounder-box"><div class="row" style="gap:12px"><span class="role-ic r-cofounder big">${ic("crown")}</span><div class="grow"><div class="h3">Ask the Co-Founder</div><div class="faint" style="font-size:12.5px">Say your idea — the Co-Founder plans the whole game and splits it into jobs for the Builder &amp; Modeler, Coder, UI Maker and Money Maker. Nothing is built until you press Accept.</div></div></div>
    <div class="row" style="gap:8px"><input class="input grow" id="cfIdea" placeholder="e.g. a brainrot pet simulator with trading and a lava obby"><button class="btn primary" data-act="teamPlan">${ic("crown")}Plan it${n ? ` (+${n} picked)` : ""}</button></div></div>
    ${teams.map(teamCard).join("")}<div class="sp" style="height:14px"></div>`;
}

/* ---------- Ideas ---------- */
VIEWS.ideas = () => {
  const P = picked();
  const tabs = `<div class="seg">${[["library", `Library (${IDEAS.length})`], ["custom", `Custom (${S.ideas.custom.length})`], ["picked", `Picked (${P.size})`]].map(([k, l]) => `<button class="${ui.ideaTab === k ? "on" : ""}" data-act="ideaTab" data-id="${k}">${l}</button>`).join("")}</div>`;
  const card = (i) => `<div class="panel pad idea ${P.has(i.id) ? "on" : ""}" data-act="toggleIdea" data-id="${esc(i.id)}">
      <div class="row" style="align-items:flex-start"><span class="check ${P.has(i.id) ? "on" : ""}"></span><div class="grow" style="min-width:0"><b style="font:600 14px var(--f-head)">${esc(i.title)}</b><div><span class="tag">${esc(i.category)}</span></div></div>
      ${i.custom ? `<button class="btn sm ghost danger icon" data-act="removeIdea" data-id="${esc(i.id)}" title="Delete">${ic("trash")}</button>` : ""}</div>
      <div class="muted" style="font-size:12.5px;margin-top:8px">${esc(i.pitch)}</div>
      ${i.features ? `<div class="faint" style="font-size:11.5px;margin-top:6px">${esc(i.features)}</div>` : ""}</div>`;
  let body;
  if (ui.ideaTab === "custom") {
    body = `<div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.2fr)">
      <div class="panel pad stack" style="align-self:start"><div class="h3">Your own idea</div>
        <label class="field"><span>Name</span><input class="input" id="ciTitle" placeholder="e.g. Cat Cafe Wars"></label>
        <label class="field"><span>Describe the game</span><textarea class="input" id="ciPitch" style="min-height:150px" placeholder="What do players do? What's fun about it? How does it make Robux?"></textarea></label>
        <label class="field"><span>Key features (optional)</span><input class="input" id="ciFeat" placeholder="e.g. trading, rebirths, pets, daily rewards"></label>
        <div class="row"><button class="btn" data-act="saveIdea">Save idea</button><div class="grow"></div><button class="btn primary" data-act="saveIdeaBuild">${ic("claude")}Save &amp; build with Claude</button></div></div>
      <div class="cards" style="grid-template-columns:1fr;align-content:start">${S.ideas.custom.map(card).join("") || `<div class="panel">${empty("No ideas of your own yet", "Write one on the left. It's saved here so you can build it any time.")}</div>`}</div></div>`;
  } else {
    const q = ui.ideaQ.toLowerCase();
    const pool = ui.ideaTab === "picked" ? allIdeas().filter((i) => P.has(i.id)) : IDEAS;
    const list = pool.filter((i) => (ui.ideaTab === "picked" || ui.ideaCat === "All" || i.category === ui.ideaCat) && (!q || (i.title + i.pitch + i.features + i.category).toLowerCase().includes(q)));
    const cats = ui.ideaTab === "library" ? `<div class="row wrap" style="gap:6px">${["All", ...S.ideas.categories].map((c) => `<button class="btn sm ${ui.ideaCat === c ? "primary" : "ghost"}" data-act="ideaCat" data-id="${esc(c)}">${esc(c)} <span class="faint" style="margin-left:4px">${c === "All" ? IDEAS.length : IDEAS.filter((i) => i.category === c).length}</span></button>`).join("")}</div><div class="sp" style="height:12px"></div>` : "";
    body = `${cats}<div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(270px,1fr))">${list.map(card).join("") || `<div class="panel">${empty(ui.ideaTab === "picked" ? "Nothing picked yet" : "No ideas match", ui.ideaTab === "picked" ? "Click ideas in the Library to pick them." : "Try another search.")}</div>`}</div>`;
  }
  return `${teamPanel()}<div class="row">${tabs}<div class="grow"></div>${ui.ideaTab !== "custom" ? `<div class="search" style="width:280px">${ic("search")}<input class="input" id="ideaSearch" placeholder="Search ideas" value="${esc(ui.ideaQ)}"></div>` : ""}</div>
    <div class="sp" style="height:14px"></div>${body}<div style="height:90px"></div>
    ${P.size ? `<div class="pickbar panel"><b>${P.size} picked</b><span class="faint ell" style="max-width:340px;font-size:12px">${esc(allIdeas().filter((i) => P.has(i.id)).map((i) => i.title).join(", "))}</span><button class="btn sm ghost" data-act="clearPicked">Clear</button>
      <input class="input grow" id="ideaExtra" placeholder="Extra wishes (optional), e.g. make it multiplayer with trading"><button class="btn primary" data-act="buildIdeas">${ic("claude")}Build with Claude</button></div>` : ""}`;
};

/* ---------- Projects & Studio ---------- */
VIEWS.projects = () => {
  const st = S.studio;
  const p = activeProject();
  return `<div class="grid" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)">
    <div><div class="row"><div class="h3 grow">Projects</div><button class="btn primary" data-act="addProject">${ic("plus")}Add project</button></div><div class="sp" style="height:12px"></div>
      <div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${S.projects.map((x) => `<div class="panel pad" style="${x.id === S.activeProjectId ? "border-color:var(--border-2);box-shadow:var(--hl),var(--shadow),var(--glow)" : ""}">
        <div class="row" style="align-items:flex-start;gap:14px">${gameIcon(x, "md")}<div class="grow" style="min-width:0"><div class="row"><b class="ell" style="font:600 15px var(--f-head)">${esc(x.game?.name || x.name)}</b>${x.id === S.activeProjectId ? '<span class="chip ok">Active</span>' : ""}</div>
          <div class="kv" style="margin-top:4px">${x.placeId ? `<span>Place <b>${esc(x.placeId)}</b></span>` : "<span>Not published</span>"}</div>
          <div class="faint ell mono" style="margin-top:4px">${esc(x.rojoDir || "No folder (Claude works in Studio)")}</div>
          <div class="row wrap" style="margin-top:8px"><span class="chip ${x.studioConnected ? "ok" : ""}"><span class="dot ${x.studioConnected ? "connected" : "unknown"}"></span>${x.studioConnected ? "Open in Studio" : "Not open in Studio"}</span></div>
          ${x.gameError ? `<div class="faint" style="font-size:12px;margin-top:6px">${esc(x.gameError)}</div>` : ""}</div></div>
        <div class="row" style="margin-top:14px">${x.id === S.activeProjectId ? "" : `<button class="btn sm primary" data-act="setProject" data-id="${x.id}">Make active</button>`}<button class="btn sm" data-act="editProject" data-id="${x.id}">${ic("edit")}Edit</button><button class="btn sm" data-act="refreshGame" data-id="${x.id}">${ic("refresh")}Game info</button><div class="grow"></div><button class="btn sm ghost danger icon" data-act="removeProject" data-id="${x.id}">${ic("trash")}</button></div>
      </div>`).join("") || `<div class="panel">${empty("No projects yet", "Add your Roblox game, or make one from an open Studio window.")}</div>`}</div></div>
    <div class="stack" style="gap:16px">
      <div class="panel"><div class="panel-h"><h3>Roblox Studio</h3><div class="grow"></div><span class="chip ${st.status === "connected" ? "ok" : st.status === "error" ? "bad" : ""}"><span class="dot ${st.status}"></span>${esc(st.status)}</span></div>
        <div class="panel-b stack">
          ${st.status !== "connected" ? `<div class="muted" style="font-size:13px">${esc(S.studioError || st.error || "Not connected yet.")}</div><div><button class="btn primary" data-act="connectStudio">${ic("link")}Connect to Studio</button></div>`
          : `<div class="row"><div class="muted grow" style="font-size:13px">${S.studios.length ? `${S.studios.length} Studio window${S.studios.length > 1 ? "s" : ""} open` : esc(S.studioError || "No Studio window found.")}</div><button class="btn sm" data-act="detectStudios">${ic("refresh")}Detect</button></div>
             ${S.studios.map((w) => { const linked = S.projects.find((x) => x.studio?.id === w.id); return `<div class="mini-proj" style="cursor:default"><div class="gicon sm"><div class="fallback">${esc(initials(w.name))}</div></div><div class="grow" style="min-width:0"><div class="ell" style="font-weight:600;font-size:13px">${esc(w.name)}</div><div class="faint" style="font-size:11.5px">${esc(w.mode || "")}${w.placeId ? " · Place " + esc(w.placeId) : " · not published"}</div></div>${linked ? `<span class="chip ok">${esc(linked.game?.name || linked.name)}</span>` : `${p ? `<button class="btn sm" data-act="linkStudio" data-id="${esc(w.id)}">Link</button>` : ""}<button class="btn sm" data-act="projectFromStudio" data-id="${esc(w.id)}">New project</button>`}</div>`; }).join("")}`}
        </div></div>
      ${blenderPanel()}
      <div class="panel pad"><div class="h3" style="margin-bottom:8px">How it works</div>
        <div class="muted" style="font-size:12.5px;line-height:1.7">Open your place in <b>Roblox Studio</b> and turn on its AI / MCP connection (Assistant settings). Claude then builds right in that window: scripts, parts, UI and play tests. If a project has a folder (e.g. Rojo), Claude can also edit the files there.</div></div>
    </div></div>`;
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
      <div class="panel stat"><div class="label">Robux balance</div><div class="n">${rbx(sm.balance)}</div><div class="d">≈ ${kr(sm.balance)} at the DevEx rate</div></div>
      <div class="panel stat"><div class="label">Pending Robux</div><div class="n">${rbx(sm.pending)}</div><div class="d">≈ ${kr(sm.pending)} · on hold before payout</div></div>
      <div class="panel stat"><div class="label">Sales today</div><div class="n">${rbx(sm.day.sales)}</div><div class="d">≈ ${kr(sm.day.sales)} · ${rbx(sm.week.sales)} this week</div></div>
      <div class="panel stat"><div class="label">Incoming this month</div><div class="n">${rbx(sm.month.incoming)}</div><div class="d">≈ ${kr(sm.month.incoming)} · ${rbx(sm.month.outgoing)} spent</div></div></div><div class="sp"></div>` : "";

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
        ${m && !m.fatal ? `<div style="text-align:right"><div class="label">30-day revenue</div><div style="font:600 18px var(--f-head)">${rbx(total)}</div><div class="faint" style="font-size:11.5px">≈ ${kr(total)}</div></div>` : ""}</div>
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

  return head + account + `<div class="sp"></div>` + tiles + devexPanel() + breakdown + keyCard + gameCards;
};

/** DevEx value in Danish kroner, from the official sources. */
function devexPanel() {
  const x = S.rates, sm = S.revenue.summary;
  const min = x?.minRobux || 30000;
  const bal = sm?.balance || 0;
  const calc = Number(ui.calcRobux || 0);
  const pct = Math.min(1, bal / min);
  return `<div class="panel"><div class="panel-h"><h3>DevEx in Danish kroner</h3><span class="faint" style="font-size:12px">What your earned Robux are worth if you cash out with the Developer Exchange</span><div class="grow"></div><button class="btn sm" data-act="refreshRates">${ic("refresh")}Update rates</button></div>
    <div class="panel-b">
      ${!x ? `<div class="faint">Loading the official rates…</div>` : `<div class="grid g4" style="gap:12px">
        <div><div class="label">1 Robux</div><div style="font:600 18px var(--f-head);margin-top:4px">${x.dkkPerRobux.toLocaleString("da-DK", { maximumFractionDigits: 4 })} kr.</div><div class="faint" style="font-size:11.5px">$${x.usdPerRobux} × ${x.dkkPerUsd.toFixed(4)} kr/$</div></div>
        <div><div class="label">1,000 Robux</div><div style="font:600 18px var(--f-head);margin-top:4px">${kr(1000)}</div></div>
        <div><div class="label">Cash-out minimum</div><div style="font:600 18px var(--f-head);margin-top:4px">${rbx(min)}</div><div class="faint" style="font-size:11.5px">= ${kr(min)}</div></div>
        <div><div class="label">Your balance</div><div style="font:600 18px var(--f-head);margin-top:4px">${sm ? kr(bal) : "—"}</div><div class="faint" style="font-size:11.5px">${sm ? (bal >= min ? "Enough to cash out" : `${(min - bal).toLocaleString()} R$ to go`) : "Link Roblox to see it"}</div></div></div>
        ${sm ? `<div style="margin-top:14px"><div class="bar ${bal >= min ? "" : "live"}"><i style="width:${(pct * 100).toFixed(1)}%"></i></div></div>` : ""}
        <div class="row" style="margin-top:16px;gap:10px"><span class="grow muted" style="font-size:13px">Calculator</span><input class="input" id="calcRobux" type="number" min="0" step="1000" placeholder="Robux" style="width:160px" value="${calc || ""}"><span style="font:600 16px var(--f-head);min-width:130px;text-align:right" id="calcOut">${calc ? kr(calc) : "0,00 kr."}</span></div>
        <hr class="sep">
        <div class="faint" style="font-size:11.5px;line-height:1.7">
          DevEx rate <b>$${x.usdPerRobux}</b> per earned Robux ${x.devexLive ? "read from" : "(last known — couldn't reach)"} <a data-act="openUrl" data-id="${esc(x.sources.devex)}" style="cursor:pointer">Roblox's official DevEx page</a>.
          Dollar → krone <b>${x.dkkPerUsd.toFixed(4)}</b> from the <a data-act="openUrl" data-id="https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html" style="cursor:pointer">European Central Bank</a>${x.ecbDate ? ` (${esc(x.ecbDate)})` : ""}${x.ecbLive ? "" : " — last known"}.
          Updated ${ago(x.fetchedAt)}. Only earned Robux can be exchanged, and Roblox pays in US dollars — your bank's exchange rate and fees decide the final kroner amount.</div>`}
    </div></div><div class="sp"></div>`;
}


/* ---------- settings ---------- */
VIEWS.settings = () => {
  const s = S.settings, C = S.claude;
  const A = S.auth;
  const u = A?.user;
  const sy = A?.sync || {};
  const account = !A || !u ? "" : `<div class="panel pad stack"><div class="row" style="gap:12px"><div class="ava" style="border-radius:50%">${esc(initials(u.email))}</div>
      <div class="grow" style="min-width:0"><div class="h3">VYRON account</div><div class="faint ell" style="font-size:12.5px">${esc(u.email)}${A.offline ? " · offline" : ""}</div></div>
      <button class="btn sm danger" data-act="accSignOut">Sign out</button></div>
    <div class="row wrap" style="gap:8px"><span class="chip ${sy.error ? "bad" : "ok"}"><span class="dot ${sy.busy ? "connecting" : sy.error ? "error" : "connected"}"></span>${sy.busy ? "Saving…" : sy.error ? esc(sy.error) : sy.at ? "Saved to your account " + ago(sy.at) : "Not saved yet"}</span><div class="grow"></div>
      <button class="btn sm" data-act="accSyncNow" ${sy.busy || A.offline ? "disabled" : ""}>Save now</button><button class="btn sm ghost" data-act="accChangePassword">Change password</button></div>
    <div class="faint" style="font-size:11.5px">Saved: settings, projects, your ideas, picked ideas and Claude chats. Not saved: your Roblox and Claude sign-ins and keys (they stay on this PC).</div></div>`;
  const X = S.control;
  return `<div class="grid g2">
    <div class="panel pad stack"><div class="row" style="gap:12px"><div class="ava" style="border-radius:10px">${ic("claude")}</div><div class="grow" style="min-width:0"><div class="row" style="gap:8px"><div class="h3">Claude</div>${modelChip()}</div><div class="faint ell mono" style="font-size:11.5px" title="${esc(C.exe || "")}">${C.found ? esc(C.exe) : "Claude Code not found"}</div></div>
        <span class="chip ${C.auth?.loggedIn ? "ok" : ""}"><span class="dot ${claudeDot()}"></span>${claudeLine()}</span></div>
      <div class="row">${C.found ? `<button class="btn sm ${C.auth?.loggedIn ? "" : "primary"}" data-act="claudeLogin">${C.auth?.loggedIn ? "Sign in again / switch account" : "Sign in to Claude"}</button>` : `<button class="btn sm" data-act="openUrl" data-id="https://claude.ai/download">Get Claude</button>`}<button class="btn sm ghost" data-act="claudeCheck">${ic("refresh")}Check</button></div>
      <div class="label" style="margin-top:6px">What Claude may do</div>
      ${[["safe", "Studio, VYRON and project files (recommended)", "Claude builds in Roblox Studio, uses VYRON, and reads/edits files in the project folder. No shell commands."], ["full", "Full access", "Claude may also run commands on this PC without asking. Only turn this on if you trust what you ask for."]].map(([k, t, d]) => `<div class="radio-card ${(s.claudeAccess || "safe") === k ? "on" : ""}" data-act="setting" data-key="claudeAccess" data-val="${k}"><span class="dot ${(s.claudeAccess || "safe") === k ? "connected" : "unknown"}"></span><div><b style="font-weight:600">${t}</b><div class="faint" style="font-size:12.5px">${d}</div></div></div>`).join("")}
      <label class="field"><span>Model</span><select class="select" data-change="setting" data-key="claudeModel">${[["", "Default (your plan's default)"], ["opus", "Opus — strongest"], ["sonnet", "Sonnet — balanced"], ["haiku", "Haiku — fastest"]].map(([k, l]) => `<option value="${k}" ${(s.claudeModel || "") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="row"><span class="grow">Blender for Claude <span class="faint" style="font-size:12px">(${S.blender?.found ? "found" : "Blender extension not found"})</span></span><div class="toggle ${s.blender !== false ? "on" : ""}" data-act="setting" data-key="blender" data-val="${s.blender === false}"></div></div>
      <label class="field"><span>Tasks at the same time</span><select class="select" data-change="setting" data-key="claudeParallel">${[1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map((n) => `<option value="${n}" ${(s.claudeParallel || 3) === n ? "selected" : ""}>${n}${n === 1 ? " (one at a time)" : n >= 10 ? " — uses a lot of usage" : ""}</option>`).join("")}</select><small>Each running task is a separate Claude. More at once is faster, but your Claude usage limit runs out faster, and tasks changing the same part of a game can get in each other's way.</small></label>
    </div>
    <div class="stack" style="gap:16px">
      ${X ? `<div class="panel pad"><div class="row" style="gap:14px"><img src="icon.svg" alt="" style="width:34px;height:34px"><div class="grow"><div class="h3">Claude controls VYRON</div><div class="faint" style="font-size:12.5px">The connector Claude uses to see and change VYRON (projects, ideas, revenue, messages to you). Only this PC can connect, with a secret key.</div></div><div class="toggle ${X.enabled ? "on" : ""}" data-act="controlToggle"></div></div>
        ${X.enabled ? `<hr class="sep"><div class="row wrap" style="gap:10px"><span class="chip ${X.running ? "ok" : "bad"}"><span class="dot ${X.running ? "connected" : "error"}"></span>${X.running ? "On · " + esc(X.url) : esc(X.error || "Not running")}</span><div class="grow"></div><button class="btn sm" data-act="controlNewKey">New key</button></div>
        <div class="row wrap" style="gap:10px;margin-top:10px"><div class="grow" style="min-width:0"><b style="font-weight:600">Claude desktop app</b><div class="faint" style="font-size:12px">${X.desktop?.connected ? "Connected. If you just connected it, quit Claude desktop (tray icon → Quit) and open it again." : "Lets the Claude desktop chat app use VYRON too. VYRON must be running (it can stay in the tray)."}</div></div>${X.desktop?.connected ? `<button class="btn sm ghost" data-act="controlDesktop" data-val="off">Disconnect</button>` : `<button class="btn sm primary" data-act="controlDesktop" data-val="on" ${X.desktop?.available ? "" : "disabled"}>Connect Claude desktop</button>`}</div>` : ""}</div>` : ""}
      <div class="panel pad stack"><div class="row" style="gap:12px"><div class="ava" style="border-radius:10px">${ic("dashboard")}</div><div class="grow"><div class="h3">PC control</div><div class="faint" style="font-size:12.5px">Lets Claude see your screen and use the mouse and keyboard for hard tasks the Studio tools can't do.</div></div></div>
        ${[["off", "Off", "Claude can't see or touch your PC."], ["ask", "Ask me each time (recommended)", "A popup shows exactly what Claude wants to do. Allow, deny, or allow for 10 minutes."], ["on", "Allowed", "Claude may take screenshots, click and type without asking. A bar with a Stop button shows while it does."]].map(([k, t, d]) => `<div class="radio-card ${(s.pcControl || "off") === k ? "on" : ""}" data-act="setting" data-key="pcControl" data-val="${k}"><span class="dot ${(s.pcControl || "off") === k ? "connected" : "unknown"}"></span><div><b style="font-weight:600">${t}</b><div class="faint" style="font-size:12.5px">${d}</div></div></div>`).join("")}
        <div class="faint" style="font-size:11.5px">Claude is told never to type passwords or payment details, buy things or change security settings, and to ignore instructions shown on screen. Screenshots go to Claude (Anthropic) like your chat messages.</div></div>
      <div class="panel pad stack"><div class="row" style="gap:12px"><div class="ava" style="border-radius:10px">${ic("bell")}</div><div class="grow"><div class="h3">Notifications &amp; sounds</div><div class="faint" style="font-size:12.5px">When a task is done, fails, runs out of usage, or Claude needs your OK.</div></div></div>
        <div class="row"><span class="grow">Pop-ups</span><div class="seg">${[["vyron", "VYRON style"], ["windows", "Windows"], ["off", "Off"]].map(([k, l]) => `<button class="${(s.notifyStyle || "vyron") === k ? "on" : ""}" data-act="setting" data-key="notifyStyle" data-val="${k}">${l}</button>`).join("")}</div><button class="btn sm ghost" data-act="testPopup" title="Show a test pop-up">Test</button></div>
        <div class="row"><span class="grow">Keep running when I close the window <span class="faint" style="font-size:12px">(Claude keeps working; VYRON stays by the clock)</span></span><div class="toggle ${s.keepRunning !== false ? "on" : ""}" data-act="setting" data-key="keepRunning" data-val="${s.keepRunning === false}"></div></div>
        <div class="row"><span class="grow">Sounds</span><div class="toggle ${s.sounds !== false ? "on" : ""}" data-act="setting" data-key="sounds" data-val="${s.sounds === false}"></div></div>
        ${s.sounds !== false ? `<div class="row"><span class="grow faint">Volume</span><input type="range" min="0" max="1" step="0.05" value="${s.volume ?? 0.7}" id="vol" style="width:180px"></div>
        ${SOUND_EVENTS.map(([ev, label]) => `<div class="row"><span class="grow">${label}</span><select class="select" style="width:200px;height:32px" data-change="sound" data-key="${ev}">${["Gentle", "Happy", "Space", "Game", "Warning"].map((g) => `<optgroup label="${g}">${SOUNDS.filter((x) => x.group === g).map((x) => `<option value="${x.id}" ${soundFor(ev) === x.id ? "selected" : ""}>${x.name}</option>`).join("")}</optgroup>`).join("")}<option value="none" ${soundFor(ev) === "none" ? "selected" : ""}>No sound</option></select><button class="btn sm ghost icon" data-act="previewSound" data-id="${ev}" title="Play">${ic("play")}</button></div>`).join("")}` : ""}
        <div class="row" style="margin-top:4px"><span class="grow">Interface sounds <span class="faint" style="font-size:12px">(tabs and choices)</span></span><div class="toggle ${s.uiSounds !== false ? "on" : ""}" data-act="setting" data-key="uiSounds" data-val="${s.uiSounds === false}"></div></div>
        ${s.uiSounds !== false ? `<div class="row"><span class="grow faint">Also on hover</span><div class="toggle ${s.uiHover === true ? "on" : ""}" data-act="setting" data-key="uiHover" data-val="${s.uiHover !== true}"></div></div>
        <div class="row"><span class="grow faint">Sound pack</span><div class="seg">${Object.entries(UI_PACKS).map(([k, p]) => `<button class="${(s.uiPack || "soft") === k ? "on" : ""}" data-act="setting" data-key="uiPack" data-val="${k}">${p.name}</button>`).join("")}</div></div>` : ""}
        <div class="row"><span class="grow">Animations</span><div class="toggle ${s.animations !== false ? "on" : ""}" data-act="setting" data-key="animations" data-val="${s.animations === false}"></div></div>
        <div class="row"><span class="grow">Reduce effects (no animated background)</span><div class="toggle ${s.reduceEffects ? "on" : ""}" data-act="setting" data-key="reduceEffects" data-val="${!s.reduceEffects}"></div></div></div>
      ${account}
    </div>
  </div>
  <div class="sp"></div>
  <div class="panel"><div class="panel-h"><h3>Themes</h3><span class="faint" style="font-size:12px">${THEMES.length} looks with animated backgrounds</span><div class="grow"></div><button class="btn sm ghost" data-act="randomTheme">Surprise me</button></div>
    <div class="panel-b">${[...new Set(THEMES.map((t) => t.group))].map((g) => `<div class="label" style="margin:6px 0 10px">${g}</div><div class="theme-grid">${THEMES.filter((t) => t.group === g).map((t) => `<div class="theme-card ${appliedTheme === t.id ? "on" : ""} ${t.light ? "light" : ""}" data-act="setTheme" data-id="${t.id}" style="--tb:${t.bg};--tb2:${t.bg2};--ta:${t.accent};--tc:${t.aura2}"><div class="sw"><i></i><i></i><i></i></div><b>${esc(t.name)}</b><span>${esc({ net: "Network", stars: "Stars", galaxy: "Galaxy", nebula: "Nebula", warp: "Warp", aurora: "Aurora", snow: "Snow", rain: "Rain", matrix: "Code rain", fireflies: "Fireflies", bubbles: "Bubbles", embers: "Embers", petals: "Petals", grid: "Neon grid", none: "Still" }[t.fx])}</span></div>`).join("")}</div>`).join("")}</div></div>
  <div class="sp"></div>
  <div class="panel activity"><div class="panel-h"><h3>Diagnostics log</h3><div class="grow"></div><button class="btn sm" data-act="copyLog">${ic("copy")}Copy log</button></div>
    <div style="max-height:320px;overflow:auto" id="diagLog">${S.activity.slice().reverse().map((l) => `<div class="list-row"><time>${time(l.at)}</time><div class="grow"><b class="lv-${l.level}">${esc(l.source)}</b> <span class="muted">${esc(l.text)}</span></div></div>`).join("")}</div></div>`;
};

/* ---------------- modals ---------------- */
function modal(title, body, foot, wide) {
  $("#modalRoot").innerHTML = `<div class="scrim" data-act="closeModalScrim"><div class="modal ${wide ? "wide" : ""}" role="dialog"><div class="modal-h"><h2>${title}</h2><button class="btn sm ghost icon" data-act="closeModal">${ic("x")}</button></div><div class="modal-b">${body}</div><div class="modal-f">${foot}</div></div></div>`;
  setTimeout(() => $("#modalRoot input:not([type=hidden]), #modalRoot textarea")?.focus(), 30);
}
const closeModal = () => ($("#modalRoot").innerHTML = "");
const val = (id) => $("#" + id)?.value ?? "";

function projectModal(p) {
  modal(p ? "Edit project" : "Add project", `
    ${!p && S.studios.length ? `<label class="field"><span>From an open Roblox Studio window (optional)</span><select class="select" id="prStudio"><option value="">—</option>${S.studios.map((st) => `<option value="${esc(st.id)}">${esc(st.name)}${st.placeId ? " · Place " + esc(st.placeId) : ""}</option>`).join("")}</select></label>` : ""}
    <label class="field"><span>Name</span><input class="input" id="prName" value="${esc(p?.name || "")}" placeholder="Filled in from Roblox when you give a Place ID"></label>
    <label class="field"><span>Place ID (optional)</span><input class="input mono" id="prPlace" value="${esc(p?.placeId || "")}" placeholder="from the game URL"></label>
    <label class="field"><span>Project folder (optional)</span><div class="row"><input class="input mono" id="prDir" value="${esc(p?.rojoDir || "")}" placeholder="e.g. a Rojo folder">${desktop ? `<button class="btn" data-act="browseDir">Browse</button>` : ""}</div><small>Claude works in this folder. Leave empty to build only in Roblox Studio.</small></label>
    <input type="hidden" id="prUni" value="${esc(p?.universeId || "")}">`,
    `<button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" data-act="saveProject" data-id="${p?.id || ""}">${p ? "Save" : "Add project"}</button>`);
}

/* ---------------- VYRON account sign-in (lock screen) ---------------- */
const GOOGLE_G = '<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
const CODE_FOR = { signup: "We sent a code to confirm your email", login: "We sent a code to log you in", recovery: "We sent a code to reset your password" };
function drawLock() {
  const A = S.auth;
  const root = $("#lockRoot");
  const keep = preserve(root);
  const msg = ui.authErr ? `<div class="auth-msg bad">${esc(ui.authErr)}</div>` : ui.authInfo ? `<div class="auth-msg">${esc(ui.authInfo)}</div>` : "";
  const mode = ui.authMode || "login";
  let body;
  if (!A.configured) {
    body = `<h2>Not connected yet</h2><p class="muted">This copy of VYRON isn't connected to the VYRON account service, so it can't be used. Download VYRON from the official VYRON website.</p>`;
  } else if (A.waitingForGoogle) {
    body = `<h2>Continue in your browser</h2><p class="muted">A Google sign-in page opened in your web browser. Pick your account there, then come back.</p>
      <div class="row" style="justify-content:center;margin:18px 0"><span class="spinner" style="width:22px;height:22px"></span></div>${msg}
      <button class="btn wide" data-act="accCancelGoogle">Cancel</button>`;
  } else if (A.mustSetPassword) {
    body = `<h2>Choose a new password</h2><p class="muted">For <b>${esc(A.user?.email || "")}</b>. At least 8 characters.</p>${msg}
      <label class="field"><span>New password</span><input class="input" id="auPass" type="password" autocomplete="new-password"></label>
      <label class="field"><span>Repeat new password</span><input class="input" id="auPass2" type="password" autocomplete="new-password"></label>
      <button class="btn primary wide" data-act="accNewPassword" data-primary>Save password and continue</button>
      <div class="auth-links"><a data-act="accCancel">Cancel</a></div>`;
  } else if (A.pending) {
    body = `<h2>Check your email</h2><p class="muted">${CODE_FOR[A.pending.kind] || "We sent you a code"}: <b>${esc(A.pending.email)}</b>. Type it below. It can take a minute; check spam too.</p>${A.pending.kind !== "login" ? `<p class="faint" style="font-size:12px;margin:-6px 0 12px">Got a <b>link</b> instead of a code? Click it — ${A.pending.kind === "signup" ? "then come back and log in with your password." : "the VYRON website lets you choose a new password, then log in here."}</p>` : ""}${msg}
      <label class="field"><span>Code</span><input class="input code-input" id="auCode" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456"></label>
      <button class="btn primary wide" data-act="accVerify" data-primary>${A.pending.kind === "recovery" ? "Continue" : "Log in"}</button>
      <div class="auth-links"><a data-act="accResend">Send a new code</a><a data-act="accCancel">${A.pending.kind === "login" ? "Use another email" : "Back to log in"}</a></div>`;
  } else if (mode === "signup") {
    body = `<h2>Create your VYRON account</h2><p class="muted">Your projects, ideas and Claude chats are saved to it.</p>${msg}
      <button class="btn wide google" data-act="accGoogle">${GOOGLE_G}Sign up with Google</button><div class="or"><span>or with email</span></div>
      <label class="field"><span>Email</span><input class="input" id="auEmail" type="email" autocomplete="email"></label>
      <label class="field"><span>Password <span class="faint">(at least 8 characters)</span></span><input class="input" id="auPass" type="password" autocomplete="new-password"></label>
      <label class="field"><span>Repeat password</span><input class="input" id="auPass2" type="password" autocomplete="new-password"></label>
      <button class="btn primary wide" data-act="accSignUp" data-primary>Create account</button>
      <div class="auth-links"><a data-act="authMode" data-id="login">I already have an account</a></div>`;
  } else if (mode === "forgot" || mode === "code") {
    const f = mode === "forgot";
    body = `<h2>${f ? "Forgot your password?" : "Log in with an email code"}</h2><p class="muted">${f ? "We'll email you a code. Then you choose a new password." : "No password needed — we'll email you a code."}</p>${msg}
      <label class="field"><span>Email</span><input class="input" id="auEmail" type="email" autocomplete="email" value="${esc(ui.authEmail || "")}"></label>
      <button class="btn primary wide" data-act="${f ? "accForgot" : "accLoginCode"}" data-primary>Email me a code</button>
      <div class="auth-links"><a data-act="authMode" data-id="login">Back to log in</a></div>`;
  } else {
    body = `<h2>Log in to VYRON</h2><p class="muted">VYRON works when you're signed in to your VYRON account.</p>${msg}
      <button class="btn wide google" data-act="accGoogle">${GOOGLE_G}Continue with Google</button><div class="or"><span>or</span></div>
      <label class="field"><span>Email</span><input class="input" id="auEmail" type="email" autocomplete="email" value="${esc(ui.authEmail || "")}"></label>
      <label class="field"><span>Password</span><input class="input" id="auPass" type="password" autocomplete="current-password"></label>
      <button class="btn primary wide" data-act="accSignIn" data-primary>Log in</button>
      <div class="auth-links"><a data-act="authMode" data-id="forgot">Forgot password?</a><a data-act="authMode" data-id="code">Log in with an email code</a></div>
      <div class="or"><span>new here?</span></div>
      <button class="btn wide" data-act="authMode" data-id="signup">Create an account</button>`;
  }
  root.innerHTML = `<div class="lock-bar"><div class="winctl">
      <button data-host="minimize" title="Minimize"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg></button>
      <button data-host="close" class="x" title="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div></div>
    <div class="lock"><div class="lock-card"><img class="lock-logo" src="icon.svg" alt=""><div class="lock-brand">VYRON</div>${body}</div>
    <div class="lock-foot">Your password is never stored on this PC.</div></div>`;
  const key = [A.configured, A.pending?.kind, A.mustSetPassword, A.waitingForGoogle, mode].join("|");
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
async function sendClaude(text) {
  text = String(text || "").trim();
  if (!text) return false;
  return await call("claudeSend", text, ui.taskId);
}
const ACT = {
  closeModal, closeModalScrim: (el, e) => { if (e.target === el) closeModal(); },
  copyCode: (el) => { navigator.clipboard.writeText(el.closest(".code").querySelector("pre").textContent); toast("Copied"); },
  openUrl: (el) => B.host("openUrl", el.dataset.id),

  async quickAsk() { const t = val("quickAsk").trim(); if (!t) return; ui.taskId = await call("claudeStartTask", t); $("#quickAsk").value = ""; go("claude"); },
  async claudeSend() { if (await sendClaude(val("claudeInput"))) $("#claudeInput").value = ""; },
  async claudeSendNew() { const t = val("claudeInput").trim(); if (!t) return toast("Type what the new task should do", "error"); ui.taskId = await call("claudeStartTask", t); $("#claudeInput").value = ""; render(); },
  async claudeStop(el) { await call("claudeStop", el.dataset.id); },
  async claudeNewChat(el) { if (confirm("Clear this task? Claude forgets its conversation (your game stays as it is).")) await call("claudeNewChat", el.dataset.id); },
  async newTask() { ui.taskId = await call("claudeNewTask", "New task"); render(); setTimeout(() => $("#claudeInput")?.focus(), 60); },
  pickTask: (el) => { ui.taskId = el.dataset.id; render(); },
  async removeTask(el) { if (confirm("Delete this task and its chat?")) await call("claudeRemoveTask", el.dataset.id); },
  async claudeLogin() { await call("claudeLogin"); toast("Sign in in the window that opened — VYRON checks automatically"); },
  async claudeCheck() { const a = await call("claudeCheck"); toast(a?.loggedIn ? "Claude is ready" : S.claude.found ? "Not signed in to Claude yet" : "Claude Code not found", a?.loggedIn ? "" : "error"); },

  ideaTab: (el) => { ui.ideaTab = el.dataset.id; render(); },
  ideaCat: (el) => { ui.ideaCat = el.dataset.id; render(); },
  async toggleIdea(el, e) {
    if (e.target.closest("[data-act=removeIdea]")) return;
    const P = picked(), id = el.dataset.id;
    if (P.has(id)) P.delete(id); else P.add(id);
    S.ideas.picked = [...P]; render();
    await call("setPicked", [...P]);
  },
  async clearPicked() { S.ideas.picked = []; render(); await call("setPicked", []); },
  async removeIdea(el) { if (confirm("Delete this idea?")) await call("removeCustomIdea", el.dataset.id); },
  async saveIdea() {
    const id = await call("addCustomIdea", { title: val("ciTitle"), pitch: val("ciPitch"), features: val("ciFeat") });
    ["ciTitle", "ciPitch", "ciFeat"].forEach((k) => ($("#" + k).value = ""));
    toast("Idea saved");
    return id;
  },
  async saveIdeaBuild() { const id = await ACT.saveIdea(); if (id) { ui.taskId = await call("buildIdeas", [id], ""); go("claude"); } },
  async buildIdeas() { ui.taskId = await call("buildIdeas", S.ideas.picked, val("ideaExtra")); toast("Started a new Claude task"); go("claude"); },

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
  async removeProject(el) { if (confirm("Remove this project from VYRON? Nothing in Roblox or on disk is deleted.")) await call("removeProject", el.dataset.id); },
  async connectStudio(el) { el.disabled = true; el.innerHTML = '<span class="spinner"></span>Connecting…'; const r = await call("connectStudio").catch(() => null); toast(r === "connected" ? "Connected to Roblox Studio" : "Couldn't connect — is Studio open with its AI connection on?", r === "connected" ? "" : "error"); },
  async detectStudios() { try { const r = await call("detectStudios"); toast(r.length ? `Found ${r.length} Studio window(s)` : "No Studio window found"); } catch { /* toasted */ } },
  async linkStudio(el) { await call("updateProject", S.activeProjectId, { studioId: el.dataset.id }); toast("Linked to the active project"); },
  async projectFromStudio(el) { const id = await call("addProject", { studioId: el.dataset.id }); await call("setActiveProject", id); toast("Project created"); },
  authMode: (el) => { ui.authEmail = $("#auEmail")?.value || ui.authEmail; ui.authMode = el.dataset.id; ui.authErr = ""; ui.authInfo = ""; render(); },
  async accSignIn(el) { ui.authEmail = val("auEmail"); await authCall(el, "accountSignIn", { email: val("auEmail"), password: val("auPass") }); },
  async accSignUp(el) {
    if (val("auPass") !== val("auPass2")) { ui.authErr = "The passwords don't match."; return render(); }
    ui.authEmail = val("auEmail");
    await authCall(el, "accountSignUp", { email: val("auEmail"), password: val("auPass") });
  },
  async accForgot(el) { ui.authEmail = val("auEmail"); await authCall(el, "accountForgot", { email: val("auEmail") }); },
  async accLoginCode(el) { ui.authEmail = val("auEmail"); await authCall(el, "accountLoginCode", { email: val("auEmail") }); },
  async accVerify(el) { await authCall(el, "accountVerify", { code: val("auCode") }); },
  async accResend(el) { await authCall(el, "accountResend"); if (!ui.authErr) { ui.authInfo = "A new code is on its way."; render(); } },
  async accCancel(el) { ui.authMode = "login"; await authCall(el, "accountCancel"); },
  async accNewPassword(el) {
    if (val("auPass") !== val("auPass2")) { ui.authErr = "The passwords don't match."; return render(); }
    await authCall(el, "accountSetPassword", { password: val("auPass") });
  },
  async accGoogle(el) { await authCall(el, "accountGoogle"); },
  async accCancelGoogle(el) { await authCall(el, "accountCancelGoogle"); ui.authErr = ""; render(); },
  async accSignOut() { if (confirm("Sign out of VYRON? Your data is saved to your account first. Claude's running tasks stop.")) await B.call("accountSignOut"); },
  async accSyncNow() { await call("accountSyncNow"); toast("Saved to your VYRON account"); },
  accChangePassword: () => modal("Change password", `<label class="field"><span>New password <span class="faint">(at least 8 characters)</span></span><input class="input" id="cpPass" type="password" autocomplete="new-password"></label><label class="field"><span>Repeat new password</span><input class="input" id="cpPass2" type="password" autocomplete="new-password"></label>`, `<button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" data-act="accSavePassword">Save</button>`),
  async accSavePassword() { if (val("cpPass") !== val("cpPass2")) return toast("The passwords don't match", "error"); await call("accountSetPassword", { password: val("cpPass") }); closeModal(); toast("Password changed"); },
  async controlToggle() { const r = await call("controlSetEnabled", !S.control.enabled); toast(r.enabled ? (r.running ? "Claude can control VYRON again" : "Could not start: " + r.error) : "Claude control is off"); },
  async controlDesktop(el) { const on = el.dataset.val === "on"; await call("controlDesktop", on); toast(on ? "Connected — now quit Claude desktop and open it again" : "Claude desktop disconnected"); },
  async controlNewKey() { if (confirm("Make a new control key? Claude has to reconnect.")) { await call("controlNewKey"); toast("New key made"); } },
  async linkRoblox(el) {
    el.disabled = true; el.innerHTML = '<span class="spinner"></span>Waiting for Roblox sign-in…';
    try { const me = await call("linkRoblox"); toast(`Linked @${me.name}`); } catch { /* toasted */ } finally { render(); }
  },
  async unlinkRoblox() { if (confirm("Unlink your Roblox account and sign it out of VYRON?")) { await call("unlinkRoblox"); toast("Roblox account unlinked"); } },
  async refreshRevenue() { await call("refreshRevenue", true); },
  revTf: (el) => { ui.revTf = el.dataset.id; render(); },
  async saveRbxKey() { const k = val("rbxKey"); if (!k.trim()) return; await call("setRobloxApiKey", k); $("#rbxKey").value = ""; toast("API key saved — loading game analytics"); },
  async clearRbxKey() { if (confirm("Remove the Open Cloud API key?")) await call("clearRobloxApiKey"); },
  async pcAnswer(el) { await call("pcAnswer", el.dataset.id, el.dataset.val); },
  async pcRevoke() { await call("pcRevoke"); toast("Stopped: Claude can't use your PC until it asks again"); },
  async setTheme(el) { const t = themeById(el.dataset.id); applyTheme(t); render(); await call("saveSettings", { themeId: t.id, theme: t.light ? "light" : "dark", themeLook: { bg: t.bg2, accent: t.accent, light: t.light } }); },
  async randomTheme() { const t = THEMES[(Math.random() * THEMES.length) | 0]; await ACT.setTheme({ dataset: { id: t.id } }); toast("Theme: " + t.name); },
  previewSound: (el) => playSound(soundFor(el.dataset.id), S.settings.volume ?? 0.7),
  async testPopup() { if (!desktop) return toast("Pop-ups show in the desktop app"); if ((S.settings.notifyStyle || "vyron") !== "vyron") return toast("Choose “VYRON style” first"); await B.host("testPopup"); },
  async teamPlan() { const t = val("cfIdea"); await call("teamPlan", t, S.ideas.picked); $("#cfIdea").value = ""; toast("The Co-Founder is planning — this takes a minute or two"); },
  async teamRevise(el) { const f = val("cfChange-" + el.dataset.id); if (!f.trim()) return toast("Write what to change", "error"); await call("teamRevise", el.dataset.id, f); },
  async teamAccept(el) { await call("teamAccept", el.dataset.id); toast("Accepted — the team is starting"); },
  async teamRole(el) { await call("teamSetRole", el.dataset.id, el.dataset.role, el.dataset.on === "true"); },
  async teamDiscard(el) { if (confirm("Remove this plan? Its team's running tasks are stopped.")) await call("teamDiscard", el.dataset.id); },
  openTask: (el) => { ui.taskId = el.dataset.id; go("claude"); },
  async checkBlender() { const b = await call("checkBlender"); toast(b.open ? "Blender is connected" : b.error || "Blender isn't open", b.open ? "" : "error"); },
  async makeModel() { const t = val("mkModel"); if (!t.trim()) return toast("Describe the model first", "error"); ui.taskId = await call("makeModel", t); $("#mkModel").value = ""; go("claude"); },
  async refreshRates() { await call("refreshRates"); toast("Rates updated from Roblox and the ECB"); },
  async setting(el) { let v = el.dataset.val; if (v === "true") v = true; else if (v === "false") v = false; await call("saveSettings", { [el.dataset.key]: v }); },
  copyLog: () => { navigator.clipboard.writeText(S.activity.map((l) => `${new Date(l.at).toISOString()} [${l.level}] ${l.source}: ${l.text}`).join("\n")); toast("Log copied"); },
};

function go(route) { ui.route = route; lsSet("route", route); render(); if (route === "claude") setTimeout(() => $("#claudeInput")?.focus(), 60); }

document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]");
  if (g) { go(g.dataset.go); return; }
  const h = e.target.closest("[data-host]");
  if (h) { B.host(h.dataset.host); return; }
  const a = e.target.closest("[data-act]");
  if (a && ACT[a.dataset.act]) { e.stopPropagation(); Promise.resolve(ACT[a.dataset.act](a, e)).catch(() => {}); }
});
document.addEventListener("change", async (e) => {
  const el = e.target.id === "vol" ? e.target : e.target.closest("[data-change]");
  if (el?.dataset.change === "sound") { const m = { ...(S.settings.soundMap || {}), [el.dataset.key]: el.value }; S.settings.soundMap = m; playSound(el.value, S.settings.volume ?? 0.7); await call("saveSettings", { soundMap: m }).catch(() => {}); return; }
  if (el?.id === "vol") { await call("saveSettings", { volume: Number(el.value) }).catch(() => {}); playSound(soundFor("done"), Number(el.value)); return; }
  if (el?.dataset.change === "setting") await call("saveSettings", { [el.dataset.key]: el.value }).catch(() => {});
});
document.addEventListener("input", (e) => {
  if (e.target.id === "ideaSearch") { ui.ideaQ = e.target.value; render(); }
  if (e.target.id === "calcRobux") { ui.calcRobux = e.target.value; const o = $("#calcOut"); if (o) o.textContent = kr(e.target.value); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("#modalRoot").innerHTML) closeModal();
  if (e.target.id === "claudeInput" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ACT.claudeSend(); }
  if (e.target.id === "quickAsk" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ACT.quickAsk(); }
  if (e.key === "Enter" && e.target.closest?.("#lockRoot") && e.target.tagName === "INPUT") { e.preventDefault(); $("#lockRoot [data-primary]")?.click(); }
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

/* ---------------- start ---------------- */
(async () => {
  desktop = !!(await B.host("isDesktop"));
  document.body.classList.toggle("desktop", desktop);
  B.on((type, payload) => {
    if (type === "state") {
      const first = !S;
      S = payload;
      if (!S.locked && !IDEAS.length) B.call("listIdeas").then((r) => { IDEAS = r; render(); }).catch(() => {});
      render();
      if (first) setTimeout(() => $("#boot").classList.add("gone"), 350);
    }
    if (type === "notify") { toast("Claude: " + payload.text, "note"); ding("message"); }
    if (type === "alert") { toast(payload.title + " — " + payload.body, payload.kind === "done" ? "" : payload.kind === "approval" ? "note" : "error"); ding(payload.kind === "login" ? "failed" : payload.kind); }
    if (type === "openTask") { ui.taskId = payload; go("claude"); }
  });
  try {
    S = await B.call("publicState");
    if (!S.locked) IDEAS = await B.call("listIdeas");
    render(); setTimeout(() => $("#boot").classList.add("gone"), 450);
  } catch (e) { $("#bootMsg").textContent = "Could not start: " + e.message; }
})();

/* keep the "Claude is using your PC" bar honest */
setInterval(() => { if (S?.pc?.activeAt && Date.now() - S.pc.activeAt < 12000) render(); }, 3000);

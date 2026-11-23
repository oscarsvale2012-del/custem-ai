/* VYRON first-run: "Welcome to VYRON" animation, the connect-everything
   checklist, and the setup prompt you paste into the Claude desktop app. */
"use strict";

const SETUP_PROMPT = `# Set up VYRON on this PC

You are helping me finish setting up **VYRON**, my desktop app for making Roblox games with Claude. VYRON is already installed and running on this PC, and I'm signed in to it. Please connect everything VYRON needs so it all works together. You may control my PC (mouse, keyboard, screenshots, terminal) to do this. Work step by step, explain in short simple sentences what you're doing, and check each step before you move on.

## Ground rules (important)
- Never type, read out or store any password, verification code, API key or token of mine. If a login is needed, stop and ask me to do it myself.
- Don't install anything that isn't listed here, and don't change Windows security settings.
- Don't touch my Roblox account sign-in or Discord — I do those myself inside VYRON.
- If something fails twice, stop, tell me what you saw, and suggest what I can do.

## How to talk to VYRON
VYRON has a local connector at \`http://127.0.0.1:47211\`. Its secret key is in \`%APPDATA%\\VYRON\\vyron-control.json\` (field \`token\`). Read it, but never show it to me or put it anywhere else. Call tools like this (PowerShell):

\`\`\`powershell
$c = Get-Content "$env:APPDATA\\VYRON\\vyron-control.json" -Raw | ConvertFrom-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:47211/rpc/vyron_setup_status" -Headers @{ Authorization = "Bearer $($c.token)" } -ContentType "application/json" -Body "{}"
\`\`\`

Useful tools (POST to \`/rpc/<tool>\`):
- \`vyron_setup_status\` — the checklist: what is connected and how to fix the rest.
- \`vyron_check_connections\` — re-checks Roblox Studio and Blender right now.
- \`vyron_enable_blender_mcp\` — turns on Blender's MCP server for good (online access, add-on, Auto Start, saved).
- \`vyron_open_blender\` — opens Blender with the MCP add-on running and connects it.
- \`vyron_connect_claude_desktop\` — adds VYRON to the Claude desktop app's settings.
If the connector doesn't answer: open VYRON, go to Settings → "Claude controls VYRON", make sure it's switched on, and try again.

## Steps
0. **Check what's installed.** Look for these on this PC (don't install anything yet):
   - Claude desktop app — you're running in it, so it's installed.
   - Roblox Studio — \`%LOCALAPPDATA%\\Roblox\\Versions\\*\\RobloxStudioBeta.exe\` (or \`%LOCALAPPDATA%\\Roblox\\mcp.bat\`).
   - Blender **5.1 or newer** (the MCP add-on needs 5.1+) — \`C:\\Program Files\\Blender Foundation\\*\\blender.exe\`, or a portable copy (a folder like \`blender-5.x…\` in Downloads). Check the version; an older Blender (e.g. 4.5) doesn't work.
   - Blender MCP for Claude — the "Blender" extension in Claude desktop (Settings → Extensions).
   \`vyron_setup_status\` also reports this under \`apps\`.
   If something is missing, **send me the official download link** and wait until I tell you it's installed:
   - Roblox Studio: https://create.roblox.com/landing
   - Blender (free, always the newest version — 5.1 or newer is needed): https://www.blender.org/download/
   - Blender MCP add-on and instructions: https://www.blender.org/lab/mcp-server/
   - Claude desktop: https://claude.ai/download
   Only download or run an installer yourself if I clearly say yes, and only from these official links.
1. **Check VYRON.** Call \`vyron_setup_status\` and tell me in one short list what is already connected and what's missing.

2. **Claude desktop ↔ VYRON.** Call \`vyron_connect_claude_desktop\`. Don't restart the Claude desktop app now (you are running inside it). At the very end, remind me to quit it from the tray icon and open it again.

3. **Roblox Studio.**
   - Check Studio is installed: \`%LOCALAPPDATA%\\Roblox\\mcp.bat\` should exist. If it doesn't, tell me to install Roblox Studio from create.roblox.com and stop this step.
   - If Studio isn't open, open it and wait until it has loaded. If it asks me to log in, stop and ask me to log in.
   - Turn on Studio's AI / MCP connection: in Studio, open the **Assistant** panel, open its settings (the "…" / gear menu), and switch on the option that lets Studio work as an **MCP server** for outside AI tools. Use screenshots to find it; the exact wording can change between Studio versions.
   - If no place is open, ask me which place to open (or open a new Baseplate).
   - Call \`vyron_check_connections\` until it lists at least one Studio window.

4. **Blender.**
   - Check Blender is installed (e.g. \`C:\\Program Files\\Blender Foundation\\\`). If it isn't, tell me to install it from blender.org and stop this step.
   - The Claude desktop app needs the **Blender** extension: Claude desktop → Settings → Extensions → search "Blender" → install / turn on.
   - Blender (5.1 or newer) needs the **MCP add-on**: open Blender → Edit → Preferences → **Get Extensions**, search **MCP**, install it and make sure it's enabled (see https://www.blender.org/lab/mcp-server/). Follow the add-on's own instructions on that page if anything looks different.
   - **Turn on Blender's MCP server for me.** Call \`vyron_enable_blender_mcp\`. It allows online access, enables the MCP add-on, switches on its **Auto Start** and saves Blender's preferences, so the server starts by itself every time Blender opens.
   - If it says the **add-on isn't installed**, install it yourself by controlling the PC: open Blender 5.1+ → **Edit → Preferences → Get Extensions** (if Blender asks to allow online access, allow it) → search **MCP** → **Install**. If it isn't listed there, get it from https://www.blender.org/lab/mcp-server/ and use **Install from Disk** (the ▾ menu at the top right of Get Extensions). Then close Blender and call \`vyron_enable_blender_mcp\` again.
   - If it fails another way, do it by hand in Blender: **Edit → Preferences → System → Network → Allow Online Access** on; **Add-ons → MCP** enabled, **Auto Start** ticked, press **Start**; then **Save Preferences** (☰ menu bottom left).
   - Call \`vyron_open_blender\`: VYRON starts Blender with the MCP add-on on and connects it by itself (it waits up to 45 seconds). If it says the add-on isn't installed, install it as above and call it again. If Blender asks about online access, allow it — the add-on needs it to talk to Claude.
   - Check with \`vyron_check_connections\` that Blender shows as open.

5. **Final check.** Call \`vyron_setup_status\` again and give me a short report:
   - ✅ what is connected now,
   - ❌ what still needs me (for example: Roblox account and Discord, which I connect in VYRON's setup screen),
   - and the reminder to quit and reopen the Claude desktop app.`;

/* ---------- "How to connect Blender" guide (setup list + Blender panel) ---------- */
// step ids match connectBlender()'s `step`, so the step that needs the user is highlighted.
const BLENDER_STEPS = [
  ["install", "Install a Blender the MCP add-on supports", `It's free. VYRON works with every Blender the MCP add-on supports (5.1 or newer today) — older Blender (like 4.5) can't run the add-on. <a data-act="openUrl" data-id="https://www.blender.org/download/">Download Blender</a>`],
  ["extension", "Turn on the Blender extension in Claude desktop", `Claude desktop → <b>Settings → Extensions</b> → search <b>Blender</b> → <b>Install</b> and switch it on.`],
  ["addon", "Install the MCP add-on in Blender", `Open Blender → <b>Edit → Preferences → Get Extensions</b> → search <b>MCP</b> → <b>Install</b>. If Blender asks to allow online access, allow it. Not listed? Get it from <a data-act="openUrl" data-id="https://www.blender.org/lab/mcp-server/">blender.org/lab/mcp-server</a> and use <b>Install from Disk</b> (the ▾ menu at the top right).`],
  ["restart", "Close Blender, then press Connect", `Save your work and close Blender. Press <b>Connect</b> here — VYRON turns on Blender's MCP server for good (Auto Start + online access), opens Blender and waits until it's connected.`],
  ["start", "Still not connected?", `In Blender: <b>Edit → Preferences → Add-ons → MCP</b> → tick it, tick <b>Auto Start</b>, press <b>Start</b>, then <b>Save Preferences</b> (☰ menu bottom left). Press Connect again.`],
  ["claude", "Restart Claude desktop", `Quit the Claude desktop app from the tray icon (bottom right) and open it again, so it picks up Blender.`],
];
function blenderGuide(active) {
  return `<div class="ob-prompt bl-guide"><b style="font-size:13px">How to connect Blender</b><ol>${BLENDER_STEPS.map(([id, t, d]) => `<li class="${id === active ? "now" : ""}"><b>${t}</b><div class="faint">${d}</div></li>`).join("")}</ol></div>`;
}

/* ---------- "Connect Blender" card when VYRON starts ---------- */
// Shows once per start if Blender isn't connected (and setup isn't on screen). Pick which Blender, press Connect.
function maybeBlenderStart() {
  if (ui.blStartShown || setupPhase || !S.blender || S.blender.on === false || !S.blender.checked || S.blender.open) return;
  if (S.settings.blenderStartPrompt === false || S.settings.autoConnectBlender === true || S.blender.connecting) return;
  if (document.getElementById("modalRoot").innerHTML) return;
  ui.blStartShown = true;
  blenderConnectModal();
}
function blenderPickExe() {
  const list = S.setup?.apps?.blenders || [];
  const want = ui.blExe || S.settings.blenderExe;
  const ok = list.filter((b) => b.supported);
  return (ok.find((b) => want && b.exe.toLowerCase() === want.toLowerCase()) || ok.find((b) => b.addon) || ok[0] || {}).exe || null;
}
/** "Do it for me": VYRON downloads the MCP add-on, installs and connects everything. Only when a supported Blender is on this PC. */
function blenderDoItRow() {
  const list = S.setup?.apps?.blenders || [], needs = S.setup?.apps?.blenderNeeds || "5.1 or newer";
  const ok = list.some((b) => b.supported), D = S.pc?.doIt, task = S.pc?.doItTask;
  if (D || task) return `<div class="bl-doit working"><span class="ob-ic"><span class="spinner"></span></span><div class="grow" style="min-width:0"><b>${D ? "VYRON is connecting Blender…" : "Claude is doing the last steps…"}</b><div class="faint" style="font-size:12px">${esc(D ? D.text : "Answer Claude's questions in VYRON. Your screen glows purple while it works.")}</div></div>${task ? `<button class="btn sm" data-act="openTask" data-id="${esc(task)}">Watch</button>` : ""}<button class="btn sm danger" data-act="pcRevoke">Stop</button></div>`;
  const rest = "installs Blender's MCP add-on, turns it on and connects Blender. If something needs clicks, Claude does them on your screen (it asks first). Your screen glows purple while it works.";
  const why = ok ? "VYRON downloads and " + rest
    : (list.length ? `Your Blender ${list.map((b) => esc(b.version || "?")).join(", ")} can't run the MCP add-on (it needs ${esc(needs)}), so VYRON` : "No Blender yet? VYRON") + " downloads the newest Blender from blender.org (free, about 400 MB, no installer), then " + rest;
  return `<div class="bl-doit"><span class="ob-ic">${ic("sparkle")}</span><div class="grow" style="min-width:0"><b>Do everything for me</b><div class="faint" style="font-size:12px">${why}</div></div><button class="btn sm primary" data-act="blDoIt">Do it for me</button></div>`;
}
function blenderConnectModal() {
  const list = S.setup?.apps?.blenders || [], needs = S.setup?.apps?.blenderNeeds || "5.1 or newer", pick = blenderPickExe();
  const row = (b) => {
    const chip = !b.supported ? `<span class="chip bad">Needs Blender ${esc(needs)}</span>` : b.addon ? `<span class="chip ok">Ready</span>` : `<span class="chip">Needs the MCP add-on</span>`;
    return `<div class="radio-card ${b.exe === pick ? "on" : ""} ${b.supported ? "" : "off"}" ${b.supported ? `data-act="blPick" data-id="${esc(b.exe)}"` : ""}><span class="dot ${b.exe === pick ? "connected" : "unknown"}"></span><div class="grow" style="min-width:0"><div class="row" style="gap:8px"><b style="font-weight:600">Blender ${esc(b.version || "(version unknown)")}</b>${chip}</div><div class="faint ell mono" style="font-size:11px" title="${esc(b.exe)}">${esc(b.exe)}</div></div></div>`;
  };
  const body = `<div class="stack" style="gap:10px">
    <div class="muted" style="font-size:13px">Connect Blender so Claude can make 3D models. One click: VYRON turns on Blender's MCP add-on, opens Blender and connects it. Works with every Blender the MCP add-on supports (${esc(needs)}).</div>
    ${list.length ? `<div class="label">Which Blender?</div><div class="stack" style="gap:6px">${list.map(row).join("")}</div>` : `<div class="panel pad">No Blender found on this PC. <a data-act="openUrl" data-id="https://www.blender.org/download/" style="cursor:pointer;text-decoration:underline">Download Blender (free)</a>, then press Connect.</div>`}
    ${ui.blMsg ? `<div class="${ui.blOk ? "" : "lv-warn"}" style="font-size:12.5px">${esc(ui.blMsg)}</div>` : ""}
    ${blenderDoItRow()}
    ${ui.blenderStep && ui.blenderStep !== "done" ? blenderGuide(ui.blenderStep) : ""}
    <div class="row"><span class="grow">Connect Blender by itself when VYRON starts</span><div class="toggle ${S.settings.autoConnectBlender === true ? "on" : ""}" data-act="blAuto"></div></div>
  </div>`;
  const foot = `<button class="btn ghost" data-act="blNoAsk">Don't ask at start</button><div class="grow"></div><button class="btn" data-act="closeModal">Not now</button><button class="btn primary" data-act="blConnect" ${pick || !list.length ? "" : "disabled"}>${ic("cube")}Connect</button>`;
  modal("Connect Blender", body, foot);
}

const SETUP_ICON = { claude: "claude", desktop: "dashboard", code: "code", studio: "roblox", blender: "cube", roblox: "revenue", discord: "mail" };
const HELLO = ["Hi", "Hej", "Hola", "Bonjour", "Hallo", "Ciao", "こんにちは"];

let setupRoot = null, setupPhase = null, setupListHtml = "", setupTimers = [];
function setupWanted() { return !!(S && !S.locked && S.setup && (!S.setup.onboarded || ui.forceSetup)); }
function clearSetupTimers() { setupTimers.forEach(clearTimeout); setupTimers = []; }

function drawSetup() {
  setupRoot = setupRoot || document.getElementById("setupRoot");
  if (!setupWanted()) { if (setupPhase && setupPhase !== "bye") { setupRoot.innerHTML = ""; setupPhase = null; document.body.classList.remove("in-setup"); } return; }
  document.body.classList.add("in-setup");
  if (!setupPhase) (S.setup.onboarded ? showSetupList() : startHello());
  if (setupPhase === "list") updateSetupList();
}

function startHello() {
  setupPhase = "hello";
  setupRoot.innerHTML = `<div class="ob"><div class="ob-sky"></div><div class="ob-hello" id="obHello"></div><button class="ob-skipintro" data-act="obSkipIntro">Skip</button></div>`;
  const el = document.getElementById("obHello");
  const show = (html, at, cls = "") => setupTimers.push(setTimeout(() => { el.className = "ob-hello out"; setupTimers.push(setTimeout(() => { el.innerHTML = html; el.className = "ob-hello in " + cls; }, 450)); }, at));
  let t = 300;
  HELLO.forEach((w, i) => { show(`<span class="ob-hi">${w}</span>`, t, "hi"); t += i === 0 ? 1100 : 520; });
  show(`<img src="icon.svg" class="ob-logo" alt=""><div class="ob-title">Welcome to VYRON</div>`, t + 300); t += 2400;
  show(`<div class="ob-title sm">Let's get you connected</div><div class="ob-sub">Claude, Roblox Studio, Blender and more — it only takes a few minutes.</div>`, t); t += 2600;
  setupTimers.push(setTimeout(showSetupList, t));
}

function showSetupList() {
  clearSetupTimers();
  setupPhase = "list"; setupListHtml = "";
  setupRoot.innerHTML = `<div class="ob"><div class="ob-sky"></div><div class="ob-card" id="obCard"></div></div>`;
  updateSetupList();
}

function setupItem(it) {
  const st = it.ok ? `<span class="ob-ok">${ic("check")}Connected</span>` : it.skipped ? `<span class="ob-no">Skipped</span>` : it.optional ? `<span class="ob-no">Optional</span>` : `<span class="ob-no">Not connected</span>`;
  let act = "";
  const help = it.id === "blender" ? `<button class="btn sm ghost" data-act="obBlenderHelp">${ui.obBlenderHelp ? "Hide guide" : "How?"}</button>` : "";
  // "Open" for apps that are set up (Studio also while it waits for a place to be opened), with its keyboard shortcut.
  const app = { studio: "studio", desktop: "claude", blender: "blender" }[it.id];
  const key = app && S.hotkeys?.on && S.hotkeys.keys?.[app];
  const open = app && it.installed !== false && (it.ok || it.id === "studio") ? `<button class="btn sm ${it.ok ? "" : "ghost"}" data-act="openApp" data-id="${app}" title="Open ${esc(it.name)}${key ? " (" + esc(key) + ")" : ""}">${ic("play")}Open${key ? `<kbd class="ob-key">${esc(key)}</kbd>` : ""}</button>` : "";
  const working = !!(S.pc?.doIt || S.pc?.doItTask);
  const doIt = working ? `<button class="btn sm" disabled style="max-width:210px" title="${esc(S.pc.doIt?.text || "")}"><span class="spinner"></span><span class="ell">${esc(S.pc.doIt?.text || "Claude is finishing…")}</span></button>` : `<button class="btn sm primary" data-act="blDoIt" title="VYRON gets Blender and its MCP add-on if needed, and connects everything">${ic("sparkle")}Do it for me</button>`;
  if (!it.ok && it.id === "blender" && it.installed === false) act = working ? doIt : `${doIt}<button class="btn sm ghost" data-act="openUrl" data-id="${esc(it.download)}">${ic("download")}Download myself</button>`;
  else if (!it.ok && it.installed === false) act = `<button class="btn sm primary" data-act="openUrl" data-id="${esc(it.download)}">${ic("download")}Download ${esc(it.downloadName)}</button>`;
  else if (!it.ok) {
    if (it.id === "claude") act = S.claude.found ? `<button class="btn sm primary" data-act="claudeLogin">Sign in to Claude</button>` : `<button class="btn sm" data-act="openUrl" data-id="https://claude.ai/download">Get Claude</button>`;
    if (it.id === "desktop") act = `<button class="btn sm primary" data-act="controlDesktop" data-val="on">Connect</button>`;
    if (it.id === "code") act = `<div class="row" style="gap:6px"><button class="btn sm primary" data-act="obPrompt">Copy setup prompt</button>${it.skipped ? "" : `<button class="btn sm ghost" data-act="obSkipItem" data-id="code">Skip</button>`}</div>`;
    if (it.id === "studio") act = `<button class="btn sm" data-act="obRecheck">${ic("refresh")}Check again</button>`;
    if (it.id === "blender") act = `${doIt}<button class="btn sm" data-act="connectBlender">${ic("cube")}Connect</button>`;
    if (it.id === "roblox") act = `<button class="btn sm primary" data-act="linkRoblox">Sign in with Roblox</button>`;
    if (it.id === "discord") act = `<div class="row" style="gap:6px"><input class="input" id="obDiscord" placeholder="https://discord.com/api/webhooks/…" style="height:32px;width:240px"><button class="btn sm primary" data-act="obDiscord">Connect</button>${it.skipped ? "" : `<button class="btn sm ghost" data-act="obSkipDiscord">Skip</button>`}</div>`;
  }
  return `<div class="ob-item ${it.ok ? "ok" : ""} ${it.skipped && !it.ok ? "skipped" : ""}"><span class="ob-ic">${ic(SETUP_ICON[it.id])}</span><div class="grow" style="min-width:0"><div class="row" style="gap:8px"><b>${esc(it.name)}</b>${st}</div>${it.ok ? "" : `<div class="faint" style="font-size:12px">${it.installed === false ? (it.tooOld ? `Blender ${esc(it.tooOld)} is too old for the MCP add-on — get Blender 5.1 or newer (it's free), then come back.` : `${esc(it.downloadName)} isn't installed on this PC yet — download it from the official site (free), then come back.`) : esc(it.how)}</div>`}</div><div class="row" style="gap:6px">${open}${act}${it.ok ? "" : help}</div></div>${it.id === "blender" && !it.ok && ui.obBlenderHelp ? blenderGuide(ui.blenderStep) : ""}`;
}

function updateSetupList() {
  const s = S.setup, pct = Math.round((s.done / s.total) * 100), all = s.ready;
  const html = `<div class="ob-head"><div class="ob-ring" style="--p:${pct}"><span>${s.done}/${s.total}</span></div><div class="grow"><div class="ob-title sm" style="text-align:left">Connect everything</div>
      <div class="faint" style="font-size:13px">VYRON works best when Claude can reach all of these. Let Claude do most of it for you, or connect them one by one.</div></div></div>
    <button class="ob-magic" data-act="obPrompt">${ic("sparkle")}<div><b>Let Claude set it up for me</b><span>Copy a prompt into the Claude desktop app — Claude connects Studio, Blender and Claude desktop for you.</span></div></button>
    ${ui.obPrompt ? `<div class="ob-prompt"><ol><li>Open the <b>Claude desktop app</b> and go to the <b>Code</b> tab.</li><li>Paste the prompt (Ctrl+V) and press Enter.</li><li>Watch Claude work; it asks you when it needs you. This list turns green as things connect.</li></ol>
      <textarea class="input mono" readonly id="obPromptText" data-fresh>${esc(SETUP_PROMPT)}</textarea><div class="row"><span class="faint" style="font-size:12px">Your Roblox account and Discord stay with you — connect those below.</span><div class="grow"></div><button class="btn primary" data-act="obCopy">${ic("copy")}Copy prompt</button></div></div>` : ""}
    <div class="ob-list">${s.items.map(setupItem).join("")}</div>
    <div class="row" style="margin-top:18px"><span class="faint" style="font-size:12px">Everything except Claude Code / web and Discord is needed to use VYRON.</span><div class="grow"></div><button class="btn ${all ? "primary" : ""} ob-finish" data-act="obFinish" ${all ? "" : "disabled"}>${all ? "Finish — let's build!" : `Finish (${s.total - s.done} left)`}</button></div>`;
  if (html === setupListHtml) return;
  const card = document.getElementById("obCard");
  const keep = preserve(card);
  card.innerHTML = html;
  restore(card, keep);
  setupListHtml = html;
}

function finishSetupAnim() {
  setupPhase = "bye";
  setupRoot.innerHTML = `<div class="ob bye"><div class="ob-sky"></div><div class="ob-hello in"><img src="icon.svg" class="ob-logo" alt=""><div class="ob-title">You're all set</div><div class="ob-sub">Let's build something amazing.</div></div></div>`;
  setupTimers.push(setTimeout(() => { setupRoot.firstElementChild?.classList.add("fade"); }, 1900));
  setupTimers.push(setTimeout(() => { setupRoot.innerHTML = ""; setupPhase = null; ui.forceSetup = false; document.body.classList.remove("in-setup"); render(); }, 2600));
}

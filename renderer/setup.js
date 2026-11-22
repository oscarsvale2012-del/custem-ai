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
- \`vyron_connect_claude_desktop\` — adds VYRON to the Claude desktop app's settings.
If the connector doesn't answer: open VYRON, go to Settings → "Claude controls VYRON", make sure it's switched on, and try again.

## Steps
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
   - Blender needs the **Blender MCP add-on** (from https://www.blender.org/lab/mcp-server/): open Blender → Edit → Preferences → Add-ons / Extensions, make sure the MCP add-on is installed and turned on, and start it if it has a start/connect button. Follow the add-on's own instructions on that page if anything looks different.
   - Keep Blender open, then call \`vyron_check_connections\` until Blender shows as open.

5. **Final check.** Call \`vyron_setup_status\` again and give me a short report:
   - ✅ what is connected now,
   - ❌ what still needs me (for example: Roblox account and Discord, which I connect in VYRON's setup screen),
   - and the reminder to quit and reopen the Claude desktop app.`;

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
  const st = it.ok ? `<span class="ob-ok">${ic("check")}Connected</span>` : `<span class="ob-no">Not connected</span>`;
  let act = "";
  if (!it.ok) {
    if (it.id === "claude") act = S.claude.found ? `<button class="btn sm primary" data-act="claudeLogin">Sign in to Claude</button>` : `<button class="btn sm" data-act="openUrl" data-id="https://claude.ai/download">Get Claude</button>`;
    if (it.id === "desktop") act = `<button class="btn sm primary" data-act="controlDesktop" data-val="on">Connect</button>`;
    if (it.id === "code") act = `<button class="btn sm primary" data-act="obPrompt">Copy setup prompt</button>`;
    if (it.id === "studio" || it.id === "blender") act = `<button class="btn sm" data-act="obRecheck">${ic("refresh")}Check again</button>`;
    if (it.id === "roblox") act = `<button class="btn sm primary" data-act="linkRoblox">Sign in with Roblox</button>`;
    if (it.id === "discord") act = `<div class="row" style="gap:6px"><input class="input" id="obDiscord" placeholder="https://discord.com/api/webhooks/…" style="height:32px;width:240px"><button class="btn sm primary" data-act="obDiscord">Connect</button></div>`;
  }
  return `<div class="ob-item ${it.ok ? "ok" : ""}"><span class="ob-ic">${ic(SETUP_ICON[it.id])}</span><div class="grow" style="min-width:0"><div class="row" style="gap:8px"><b>${esc(it.name)}</b>${st}</div>${it.ok ? "" : `<div class="faint" style="font-size:12px">${esc(it.how)}</div>`}</div>${act}</div>`;
}

function updateSetupList() {
  const s = S.setup, pct = Math.round((s.done / s.total) * 100), all = s.done === s.total;
  const html = `<div class="ob-head"><div class="ob-ring" style="--p:${pct}"><span>${s.done}/${s.total}</span></div><div class="grow"><div class="ob-title sm" style="text-align:left">Connect everything</div>
      <div class="faint" style="font-size:13px">VYRON works best when Claude can reach all of these. Let Claude do most of it for you, or connect them one by one.</div></div></div>
    <button class="ob-magic" data-act="obPrompt">${ic("sparkle")}<div><b>Let Claude set it up for me</b><span>Copy a prompt into the Claude desktop app — Claude connects Studio, Blender and Claude desktop for you.</span></div></button>
    ${ui.obPrompt ? `<div class="ob-prompt"><ol><li>Open the <b>Claude desktop app</b> and go to the <b>Code</b> tab.</li><li>Paste the prompt (Ctrl+V) and press Enter.</li><li>Watch Claude work; it asks you when it needs you. This list turns green as things connect.</li></ol>
      <textarea class="input mono" readonly id="obPromptText" data-fresh>${esc(SETUP_PROMPT)}</textarea><div class="row"><span class="faint" style="font-size:12px">Your Roblox account and Discord stay with you — connect those below.</span><div class="grow"></div><button class="btn primary" data-act="obCopy">${ic("copy")}Copy prompt</button></div></div>` : ""}
    <div class="ob-list">${s.items.map(setupItem).join("")}</div>
    <div class="row" style="margin-top:18px"><a class="ob-later" data-act="obSkip">I'll finish this later</a><div class="grow"></div><button class="btn ${all ? "primary" : ""} ob-finish" data-act="obFinish" ${all ? "" : "disabled"}>${all ? "Finish — let's build!" : `Finish (${s.total - s.done} left)`}</button></div>`;
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

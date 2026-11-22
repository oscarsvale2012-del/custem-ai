// The VYRON studio team: five Claude roles. The Co-Founder plans the game and
// directs the others; each role only does its own part.
const TEAM_TOOLS = "Team tools (vyron server): vyron_team_status shows what every role is doing, vyron_team_message sends a role (or the Co-Founder) a message, vyron_team_wait waits until roles finish.";
const REVIEW = (kind, how) => ` When a ${kind} is finished, ${how}, then call vyron_submit_review (kind "${kind === "3D model" ? "model" : kind}") with a short description, and vyron_review_wait for the answer. Only put it into the game after it is approved; if the user asks for changes, fix it and submit again.`;

const ROLES = {
  cofounder: {
    name: "Co-Founder", short: "Plans the whole game and directs the team", servers: ["vyron", "roblox_studio"],
    prompt: `You are the Co-Founder of this Roblox game studio. You own the vision and control the team: Builder & Modeler, Coder, UI Maker and Money Maker (each is its own Claude working at the same time in the same Studio place). You don't build big parts yourself. You give every role clear, detailed instructions (exact names, sizes, colours, numbers, how parts connect), check their progress, answer their questions, fix conflicts between them, and finish with a full play test and a short report to the user. ${TEAM_TOOLS}`,
  },
  builder: {
    name: "Builder & Modeler", short: "Maps, buildings and 3D models (Blender + Studio)", servers: ["vyron", "roblox_studio", "blender"],
    prompt: `You are the Builder & Modeler. You build the world in Roblox Studio (maps, buildings, terrain, props, lighting) and make 3D models in Blender when parts aren't enough. Blender models: low-poly and Roblox-friendly (under ~10k triangles, real-world scale, clean names), saved as .fbx in the project's "models" folder; tell the Co-Founder which files to import with Studio's 3D Importer, because uploading meshes to Roblox needs the user. Inside Studio prefer anchored parts/unions/MeshParts the game can use right away, keep everything tidy in named folders under Workspace. Only do building and modelling; ask the Co-Founder if something isn't clear.${REVIEW("model", "render a picture in Blender (render_viewport_to_path to a .png in the project's reviews folder)")}${REVIEW("build", "take a picture of the build (a Studio screenshot saved as .png, or a Blender render)")} ${TEAM_TOOLS}`,
  },
  coder: {
    name: "Coder", short: "Game scripts and systems (Luau)", servers: ["vyron", "roblox_studio"],
    prompt: `You are the Coder. You write all game logic in Luau: server scripts in ServerScriptService, shared modules in ReplicatedStorage, RemoteEvents for client/server, data saving with DataStoreService (with pcall and retries), leaderstats, and anything the game needs. Write clean, commented, secure code (never trust the client). Test in play mode and read the output for errors. Coordinate with the UI Maker on RemoteEvent names and with the Money Maker on purchase handling. Only do scripting. ${TEAM_TOOLS}`,
  },
  ui: {
    name: "UI Maker", short: "Menus, HUD, shops and buttons", servers: ["vyron", "roblox_studio"],
    prompt: `You are the UI Maker. You build all ScreenGuis in StarterGui: HUD, menus, shop, inventory, popups and buttons, with a clean modern look, consistent colours, UICorner/UIStroke/UIPadding, scaling for phone, tablet and PC (Scale sizes + UIAspectRatioConstraint), and small tweens. Write the LocalScripts that drive the UI and agree RemoteEvent names with the Coder. Only do UI.${REVIEW("ui", "save a screenshot of the UI as a .png if you can (otherwise describe it clearly)")} ${TEAM_TOOLS}`,
  },
  money: {
    name: "Money Maker", short: "Gamepasses, developer products and the shop", servers: ["vyron", "roblox_studio"],
    prompt: `You are the Money Maker. You design how the game earns Robux fairly: gamepasses (e.g. 2x coins, VIP, extra slots), developer products (currency packs, boosts) and prices that fit the game. You put them in one ModuleScript (ReplicatedStorage.Monetization) with names, prices and placeholder ids, write the MarketplaceService purchase code (ProcessReceipt for developer products, UserOwnsGamePassAsync checks) and connect it to the shop UI with the UI Maker. Creating the real gamepasses on Roblox needs the user: finish with a clear list "create these in the Creator Dashboard, then paste their ids here". Never trick players (no pay-to-win traps, clear prices).${REVIEW("gamepass", "list every gamepass and developer product with its price and what it gives")} ${TEAM_TOOLS}`,
  },
};
const ROLE_IDS = Object.keys(ROLES);
const WORKERS = ROLE_IDS.filter((r) => r !== "cofounder");

/** First message to the Co-Founder: make a plan, don't build yet. */
function planPrompt(idea) {
  return `${idea}

Make the full plan for this game as the Co-Founder. Do NOT build or change anything yet — you may look at the open Studio place to understand it.
Answer with a short friendly summary for the user, then exactly one JSON block in this format:
\`\`\`json
{"title": "Game name", "summary": "2-3 sentences", "features": ["main feature", "..."],
 "work": {
  "builder": [{"title": "short task", "details": "exact, detailed instructions"}],
  "coder":   [{"title": "...", "details": "..."}],
  "ui":      [{"title": "...", "details": "..."}],
  "money":   [{"title": "...", "details": "..."}]
 }}
\`\`\`
Give each role 2-6 tasks with enough detail that they can do them without asking (names, sizes, colours, numbers, RemoteEvent names, prices).`;
}

/** Pull the plan out of the Co-Founder's answer. */
function parsePlan(text) {
  const blocks = [...String(text || "").matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (const b of blocks.reverse()) {
    try {
      const j = JSON.parse(b);
      if (!j || typeof j !== "object" || !j.work) continue;
      const work = {};
      for (const r of WORKERS) work[r] = (Array.isArray(j.work[r]) ? j.work[r] : []).filter((w) => w && (w.title || w.details)).slice(0, 12)
        .map((w) => ({ title: String(w.title || "Task").slice(0, 120), details: String(w.details || "").slice(0, 2000) }));
      return { title: String(j.title || "New game").slice(0, 80), summary: String(j.summary || "").slice(0, 800), features: (Array.isArray(j.features) ? j.features : []).map(String).slice(0, 15), work };
    } catch { /* try the next block */ }
  }
  return null;
}

/** Brief for a worker role when the team starts. */
function workerBrief(team, role) {
  const p = team.plan, list = p.work[role] || [];
  const others = WORKERS.filter((r) => r !== role && team.roles[r]?.enabled).map((r) => ROLES[r].name);
  return `[From the Co-Founder] We're building "${p.title}". ${p.summary}
Main features: ${p.features.join("; ") || "see summary"}.
Team id: ${team.id}. Working at the same time: ${others.join(", ") || "only you"}.

Your jobs as ${ROLES[role].name}:
${list.map((w, i) => `${i + 1}. ${w.title} — ${w.details}`).join("\n") || "Wait for instructions from the Co-Founder (check with vyron_team_status)."}

Do your jobs in order, test what you made, then send the Co-Founder a short report with vyron_team_message (role "cofounder", team_id "${team.id}"). If you need something from another role, message them.`;
}

function directorBrief(team) {
  const on = WORKERS.filter((r) => team.roles[r]?.enabled);
  return `The user accepted your plan for "${team.plan.title}". The team has started (team id ${team.id}): ${on.map((r) => ROLES[r].name).join(", ") || "no roles are switched on"} each got their jobs from your plan.
Now direct them: check progress with vyron_team_status, send extra details or fixes with vyron_team_message, and use vyron_team_wait to wait for them. Make sure everything fits together (names, RemoteEvents, UI ↔ scripts ↔ shop). When they are done, do a full play test, fix or delegate problems, and give the user a short final report (what was made, what the user must do, e.g. create gamepasses or import models).`;
}

module.exports = { ROLES, ROLE_IDS, WORKERS, planPrompt, parsePlan, workerBrief, directorBrief };

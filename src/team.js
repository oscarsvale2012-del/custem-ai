// Team roles, system prompts and the built-in prompt library.

const ROLES = {
  "Lead Developer": {
    short: "Plans the work, splits it into tasks, assigns them and reviews the result.",
    prompt: "You are the lead developer. You understand the whole project, make development plans, split big requests into focused tasks for specialists, and review their work so all systems fit together.",
  },
  "Luau Developer": {
    short: "Writes and edits Luau scripts and gameplay systems, fixes script errors.",
    prompt: "You are a senior Roblox Luau developer. You implement gameplay systems, write and edit scripts, fix errors and improve code quality.",
  },
  "UI/UX Designer": {
    short: "Designs and builds modern Roblox interfaces, layouts and UI animations.",
    prompt: "You are a Roblox UI/UX designer and UI engineer. You build polished interfaces in code (ScreenGui, Frame, UIListLayout, UICorner, UIStroke, UIGradient, TweenService) with consistent spacing and strong hierarchy.",
  },
  "Game Designer": {
    short: "Turns ideas into mechanics, progression systems and gameplay loops.",
    prompt: "You are a game designer. You turn ideas into concrete mechanics, numbers, progression and gameplay loops, and write them into config ModuleScripts the developers can use.",
  },
  Debugger: {
    short: "Finds errors, investigates broken systems and fixes them.",
    prompt: "You are a debugger. You search for errors, read output logs, trace broken systems to the root cause and fix them with the smallest correct change.",
  },
  "Code Reviewer": {
    short: "Reviews code, checks architecture and makes sure systems work together.",
    prompt: "You are a code reviewer. You review new and changed code for bugs, security holes (trusting the client), performance problems and architecture issues, fix what is clearly wrong, and report the rest.",
  },
};

const STANDARDS = `Roblox development standards you must follow:
- Luau with clear names, small functions, ModuleScripts for shared logic, no duplicated code. Use task.wait/task.spawn, not wait/spawn.
- Correct places: server logic in ServerScriptService (Scripts), private server assets/modules in ServerStorage, shared modules and RemoteEvents/RemoteFunctions in ReplicatedStorage, client code in StarterPlayer/StarterPlayerScripts (LocalScripts), UI in StarterGui, world objects in Workspace.
- Server authority: never trust the client. Validate every RemoteEvent argument on the server (types, ranges, ownership, cooldowns). Currency, inventory and purchases are decided on the server only.
- Use DataStoreService with pcall and retries, and save on PlayerRemoving and game:BindToClose.
- Handle errors with pcall where calls can fail. Avoid per-frame work that is not needed; clean up connections.
- Reuse systems that already exist in the project instead of writing new copies. Read related code before changing it, and keep changes focused.`;

const UI_GUIDE = `UI design rules (very important): clean, modern and premium, never generic.
- Light, elegant surfaces: white or near-white highlights, soft semi-transparent panels (BackgroundTransparency 0.1–0.35), subtle UIGradient (two close tones), thin UIStroke (Transparency 0.6–0.85, white), UICorner 8–14 px (not huge).
- Soft shadows (an offset dark ImageLabel or Frame behind with high transparency) and very controlled glow: a faint white UIStroke or glow image on focus/hover only.
- Typography: Font.fromEnum(Enum.Font.GothamBold/GothamMedium) or BuilderSans; clear size scale (e.g. 28/20/16/14), consistent weights, aligned text, never random sizes.
- Consistent spacing with UIPadding and UIListLayout/UIGridLayout padding (8/12/16/24).
- Motion with TweenService: hover scale 1.0→1.04 and brightness, press 0.96, open/close with fade + slight scale/slide (0.18–0.3 s, Quad/Quint Out), a subtle ripple circle that expands and fades from the click point, animated progress bars.
- Do not overuse neon colors, heavy gradients, giant rounded cards, random glowing borders, or unnecessary icons. Every screen needs a clear visual hierarchy. Make it work on phone, tablet and PC (Scale sizing, UIAspectRatioConstraint, UISizeConstraint).`;

function roleNames() { return Object.keys(ROLES); }

function systemPrompt({ agent, project, studio, toolsNote }) {
  const role = ROLES[agent.role] || ROLES["Luau Developer"];
  const lines = [
    `You are ${agent.name}, an AI agent on a team of AI developers building a Roblox game together in a desktop app called VYRON. ${role.prompt}`,
    "",
    "Project:",
    project ? `- Game: ${project.game?.name || project.name}${project.game?.universeId ? ` (Universe ID ${project.game.universeId})` : ""}` : "- No project selected.",
  ];
  if (project?.rojoDir) {
    lines.push(
      "- Source files live in a Rojo project folder that is synced into Roblox Studio. Use the project file tools to read and write them.",
      "  Rojo layout: src/ServerScriptService/*.server.luau (Scripts), src/StarterPlayer/StarterPlayerScripts/*.client.luau (LocalScripts), src/ReplicatedStorage/*.luau (ModuleScripts), src/ServerStorage, src/StarterGui. If default.project.json is missing, create a standard one."
    );
  }
  if (studio) lines.push(`- Roblox Studio is connected through MCP tools. For tools that need a studio_id, use "${studio.id}" (${studio.name}).`);
  lines.push(
    "",
    STANDARDS,
    agent.role === "UI/UX Designer" || agent.role === "Lead Developer" ? "\n" + UI_GUIDE : "",
    "",
    "How to work:",
    "- Understand before you change: list and read the relevant files (and inspect Studio when connected) first. Never overwrite or delete things you have not read.",
    "- Other agents work at the same time. Check the task board for what they are doing, use post_note to tell them about interfaces you create (module names, RemoteEvent names, function signatures).",
    "- Some actions need the user's approval; if one is rejected, adapt your plan.",
    "- Finish with a short report: what you changed (file by file), how to test it, and anything left to do.",
    toolsNote || "",
    agent.instructions ? "\nExtra instructions from the user:\n" + agent.instructions : ""
  );
  return lines.filter((l) => l !== null).join("\n");
}

const SEED_PROMPTS = [
  ["Roblox UI", "Premium shop screen", "Create a shop UI with category tabs, item cards with price and buy button, a currency display, hover/press animations, ripple on click, and smooth open/close. Server validates every purchase."],
  ["Roblox UI", "Main HUD", "Build a clean HUD: currency counter with animated count-up, level + XP bar, and buttons for Shop, Inventory and Settings that open their menus with a fade/scale transition."],
  ["Game Mechanics", "Daily rewards", "Add a daily reward system with a 7-day streak, server-side time checks, DataStore saving, and a popup UI that shows today's reward."],
  ["Simulator Systems", "Pet simulator core", "Create a simulator game with pets, eggs, an inventory, a shop, currency, upgrades, and a clean modern interface."],
  ["Tycoon Systems", "Tycoon base", "Build a tycoon: plot claiming, droppers, conveyors, collectors, buy buttons that unlock in order, and saving of purchased items."],
  ["Combat Systems", "Melee combat", "Create a server-authoritative melee combat system with combo attacks, hit detection, cooldowns, damage numbers and simple anti-exploit checks."],
  ["Inventory Systems", "Inventory with equip", "Make an inventory system with stacking items, equip/unequip, server-side ownership checks, DataStore saving and a grid UI with item tooltips."],
  ["Pet Systems", "Pets that follow", "Add pets that follow the player smoothly, give stat boosts, can be equipped (max 3), and are saved per player."],
  ["Animation", "UI motion pass", "Go through all UI and add consistent TweenService animations: hover, press, open/close and loading spinners, using one shared animation ModuleScript."],
  ["Optimization", "Performance review", "Find performance problems: per-frame loops, leaking connections, too many parts, heavy RemoteEvent traffic. Fix them and report the improvements."],
  ["Bug Fixes", "Find and fix errors", "Check the output log and all scripts for errors and warnings, find the root causes and fix them. Report each fix."],
  ["Game Design", "Progression loop", "Design a progression loop (earn → upgrade → unlock new area) with numbers for costs and rewards in a config ModuleScript."],
  ["Scripting", "DataStore service", "Create a robust PlayerData service module: load/save with retries, session locking, default data template, and auto-save every 2 minutes."],
];

module.exports = { ROLES, roleNames, systemPrompt, SEED_PROMPTS, UI_GUIDE };

# VYRON

An AI game-development studio for Roblox: connect several AI models, give each
agent a role, connect MCP servers (including Roblox Studio's own), and describe a
game system — the team plans it, splits it into tasks, builds it in your project,
reviews and tests it, and reports what changed.

## Features

- **Multi-AI team** — Anthropic Claude and any OpenAI-compatible provider (OpenAI,
  OpenRouter, Groq, Ollama, LM Studio). Agents have a name, role, provider, model,
  token budget, extra instructions and their own tool access. Live status:
  working · idle · not connected · offline · out of tokens.
- **Roles** — Lead Developer, Luau Developer, UI/UX Designer, Game Designer,
  Debugger, Code Reviewer. Each has its own system prompt with Roblox standards
  (server authority, correct services, DataStore safety) and UI design rules.
- **Prompt → game** — the Lead Developer inspects the project and submits a plan;
  tasks run in parallel where their dependencies allow; a reviewer checks, tests
  (via Studio when connected) and writes the final report.
- **MCP servers** — stdio, Streamable HTTP and SSE. Tools are discovered
  automatically; each tool can run automatically, ask first, or be disabled.
  Secrets (env vars, headers) are encrypted and never sent to the interface.
- **Roblox Studio** — one click adds Studio's official MCP server. Open Studio
  windows are detected, linked to projects, and agents can inspect and edit the
  place, run play tests and read the output.
- **Rojo projects** — agents read, search and write Luau files in your Rojo folder.
  Every change is backed up with a diff; undo any change; save snapshots.
- **Safety** — per-file locks between agents, approvals with diff previews,
  three permission modes, cancel and retry for every task.
- **Game card** — the real Roblox icon, name, Universe/Place ID, Studio status,
  agents at work, build progress and last change for the active project.
- **Revenue** — link your Roblox account by signing in on roblox.com inside the
  app (VYRON never sees your password; the session is stored encrypted and
  only used for roblox.com). Shows Robux balance, pending Robux, sales today and
  the Day/Week/Month/Year summary, and records pending Robux daily. With an
  Open Cloud API key (`universe.analytics:read`) each game shows its official
  daily revenue, active users, playtime and Day-1 retention for 30 days.
  Note: Roblox has no official API for pending Robux, so that part uses the same
  endpoints as the Roblox website and may change if Roblox changes them.
- **Prompt library** — categories, search, favorites, copy, send to an agent,
  build from a prompt, and AI prompt improvement (optionally with web research of
  the Roblox docs, labelled Verified vs Suggestion).
- **Workspace chat** — talk to one or several agents; they can act on the project.

## First start

1. **AI Agents → Add provider.** Paste a Claude API key (console.anthropic.com).
   The first connected provider creates a default team of six agents.
2. **MCP Servers → Add Roblox Studio.** Open your place in Studio and enable its
   MCP / AI assistant connection.
3. **Projects → Add project.** Pick the Studio window or enter the Place ID, and
   choose your Rojo folder (run `rojo serve` there and connect the Rojo plugin).
4. **Dashboard → Plan & build.** Describe what you want.

## Install VYRON on Windows

1. Open the **Releases** page of this repository and download
   **VYRON-Setup-x.y.z.exe**.
2. Run it. VYRON installs for your user (no admin needed), adds a **desktop
   shortcut** and a **Start menu** entry, and starts.
3. Pin it to the taskbar like any app. Uninstall from *Settings → Apps*.

Prefer no install? Download **VYRON-x.y.z-Portable.exe** and run it directly.
Upgrading from AgentForge moves your projects, agents and keys automatically.

Every push to `main` also builds the app (Actions → "Build Windows .exe" →
**VYRON-Windows**). Push a tag like `v0.4.0` to publish a new Release.

## Development

```
npm install
npm start          # the Electron app
npm test           # end-to-end backend tests
npm run dev:web    # same backend in a browser at http://localhost:5181 (dev only)
```

Code: `main.js` (Electron host) · `preload.js` (secure bridge) · `src/backend.js`
(orchestrator, agents, approvals) · `src/providers.js` (AI adapters) · `src/mcp.js`
(MCP client) · `src/roblox.js` (Roblox web APIs) · `src/workspace.js` (files,
history, locks) · `src/team.js` (roles, prompts) · `renderer/` (interface).

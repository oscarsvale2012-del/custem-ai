# VYRON

A Windows desktop companion for **Claude** to make Roblox games. You talk to
Claude inside VYRON; Claude controls VYRON and Roblox Studio for you.

## Tabs

- **Dashboard** — active project, Claude and Studio status, picked ideas, Robux in kroner.
- **Claude** — chat with Claude. VYRON runs the Claude Code app installed on this
  PC in the background (`claude -p`, streamed), in the project's folder, with two
  tool servers: VYRON's own connector and Roblox Studio's MCP server. Claude
  builds in your open Studio place. **Multitask**: run up to 20 Claude tasks at once
  (Settings → Tasks at the same time); extra tasks wait in a queue. Each task keeps
  its own chat (`--resume`).
- **Game Ideas** — 700+ original ideas across 17 genres (brainrot, shooter, PvP,
  simulator, tycoon, obby, horror, tower defense, RPG, racing, roleplay, survival,
  party, puzzle, sports, anime-style, sandbox). Pick several and press
  *Build with Claude*. **Custom** tab for your own ideas.
- **Projects & Studio** — your games (name and icon loaded from Roblox) and the
  Roblox Studio connection.
- **Revenue** — linked Roblox account: Robux, pending Robux, sales and per-game
  analytics, all with the **DevEx value in Danish kroner**: the DevEx rate is read
  from [Roblox's official DevEx page](https://create.roblox.com/docs/production/monetization/developer-exchange),
  USD→DKK from the [ECB daily reference rates](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml).
  Shows the 30,000 Robux cash-out minimum and a calculator.
- **PC control** (Settings, off by default) — Claude can take screenshots and use
  mouse/keyboard for hard tasks; "Ask me each time" shows an Allow/Deny popup per
  action, and a Stop bar shows while Claude uses the PC.
- **Background mode** — closing the window keeps VYRON in the tray so Claude keeps
  working. VYRON-style corner pop-ups (or Windows notifications, or off) when a task
  is done, fails, runs out of usage or needs your OK.
- **38 themes** (galaxy, nebula, aurora, synthwave, matrix…) with animated
  backgrounds and **41 sounds** made with Web Audio; sounds per event, on/off, volume.
- **Settings** — Claude sign-in, what Claude may do (Studio + VYRON + project
  files, or full access), model, the connector switch, appearance, optional
  VYRON sign-in.

## Claude

- Needs the Claude desktop app (Claude Code) on this PC; VYRON finds `claude.exe`
  itself. Sign in once with **Sign in to Claude** (`claude auth login`) — VYRON
  never sees your password.
- Safe mode (default): `--permission-mode acceptEdits` and only the VYRON and
  Roblox Studio tools plus file read/edit/search. No shell.
- The connector (`127.0.0.1:47211`, secret key, Host-header check) gives Claude:
  `vyron_status`, `vyron_list_projects`, `vyron_set_project`, `vyron_add_project`,
  `vyron_studio`, `vyron_list_ideas`, `vyron_pick_ideas`, `vyron_add_idea`,
  `vyron_revenue`, `vyron_notify`, `vyron_activity`.

## Develop

```
npm install
npm start        # Electron app
npm test         # ideas, DevEx, Claude runner, connector, revenue, sign-in
npm run dist     # Windows installer + portable exe (also built by GitHub Actions on tags vX.Y.Z)
```

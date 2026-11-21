// Scripted OpenAI-compatible model server for tests and UI checks.
// Not part of the app. Run standalone: node test/mock-model.js  (port 5199)
const http = require("http");

function mockModel(port = 0) {
  const call = (name, args) => ({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "c" + Math.random().toString(36).slice(2), type: "function", function: { name, arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
  const say = (text) => ({ choices: [{ finish_reason: "stop", message: { content: text } }], usage: { prompt_tokens: 50, completion_tokens: 10 } });
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "mock-model" }] }));
      const j = JSON.parse(body);
      const first = j.messages.find((m) => m.role === "user")?.content || "";
      const last = [...j.messages].reverse().find((m) => m.role === "user")?.content || "";
      const tools = j.messages.filter((m) => m.role === "tool").length;
      const toolNames = (j.tools || []).map((t) => t.function.name);
      let out;
      const slow = Number(process.env.MOCK_DELAY || 0);
      if (first.includes("Plan it:")) {
        out = tools === 0 ? call("list_project_files", { dir: "." })
          : tools === 1 ? call("submit_plan", { summary: "Coins module + server", tasks: [
              { key: "mod", title: "Coins module", description: "Create src/ReplicatedStorage/Coins.luau", role: "Luau Developer", priority: "high", depends_on: [] },
              { key: "srv", title: "Coin server", description: "Create src/ServerScriptService/CoinServer.server.luau", role: "Luau Developer", priority: "normal", depends_on: ["mod"] },
            ] })
          : say("Plan submitted.");
      } else if (first.includes("Your task: Coins module")) {
        out = tools === 0 ? call("write_file", { path: "src/ReplicatedStorage/Coins.luau", content: "local Coins = {}\nreturn Coins\n" })
          : tools === 1 ? call("post_note", { text: "Coins module at ReplicatedStorage.Coins" }) : say("Made the Coins module.");
      } else if (first.includes("Your task: Coin server")) {
        out = tools === 0 ? call("write_file", { path: "src/ServerScriptService/CoinServer.server.luau", content: "local Coins = require(game.ReplicatedStorage.Coins)\n" }) : say("Made the server.");
      } else if (first.includes("Your task: Review")) {
        out = tools === 0 ? call("read_file", { path: "src/ReplicatedStorage/Coins.luau" }) : say("Review OK. Built coins module and server.\n\n```lua\nlocal Coins = require(game.ReplicatedStorage.Coins)\n```");
      } else if (first.includes("Make icon please")) {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><radialGradient id="bg" cx="50%" cy="35%" r="70%"><stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#ff8a00"/></radialGradient><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#ffd84d"/></linearGradient></defs><rect x="16" y="16" width="480" height="480" rx="96" fill="url(#bg)"/><path d="M116 330 L150 170 L218 250 L256 140 L294 250 L362 170 L396 330 Z" fill="url(#c)" stroke="#7a3d00" stroke-width="14" stroke-linejoin="round"/><rect x="116" y="330" width="280" height="50" rx="14" fill="#fff3b0" stroke="#7a3d00" stroke-width="14"/><text x="256" y="455" font-family="Arial Black,Arial" font-size="64" font-weight="900" text-anchor="middle" fill="#fff" stroke="#7a3d00" stroke-width="10" paint-order="stroke">VIP</text></svg>';
        out = tools === 0 ? call("create_image", { name: "VIP gamepass", kind: "gamepass_icon", svg }) : say("Made a VIP gamepass icon (512x512): gold crown on a warm gradient with a bold VIP label.");
      } else if (first.includes("MCP please")) {
        const t = toolNames.find((n) => n.endsWith("__wipe_place"));
        out = tools === 0 ? call(t, {}) : say("tool result seen");
      } else if (first.includes("Write please") || last.includes("Write please")) {
        out = j.messages.at(-1).role !== "tool" ? call("write_file", { path: "src/Approved.luau", content: "return 1\n" }) : say("done");
      } else out = say("Hello from the mock model");
      setTimeout(() => res.end(JSON.stringify(out)), slow);
    });
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}

module.exports = { mockModel };
if (require.main === module) mockModel(5199).then(() => console.log("mock model on http://127.0.0.1:5199/v1"));

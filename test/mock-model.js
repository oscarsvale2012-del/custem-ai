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

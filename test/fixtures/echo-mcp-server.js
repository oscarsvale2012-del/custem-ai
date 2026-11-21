// Tiny real MCP server used by the tests (stdio transport).
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const server = new McpServer({ name: "echo-test", version: "1.0.0" });
server.registerTool("echo", { description: "Echo text back", inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } },
  async ({ text }) => ({ content: [{ type: "text", text: "echo: " + text }] }));
server.registerTool("wipe_place", { description: "Pretend destructive action", inputSchema: {}, annotations: { destructiveHint: true } },
  async () => ({ content: [{ type: "text", text: "wiped" }] }));
server.connect(new StdioServerTransport());

// Starts the MCP server the way Claude will, and calls a few tools over the real protocol.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["src/index.js"],
  env: { ...process.env, HR_USER_EMAIL: "shreya.dandare@wohlig.com" },
});
const client = new Client({ name: "smoke", version: "0.0.1" });
await client.connect(transport);
const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));
const list = await client.callTool({ name: "list_employees", arguments: { status: "onboarding" } });
console.log("onboarding:", JSON.parse(list.content[0].text).map((e) => e.full_name));
const chain = await client.callTool({ name: "check_audit_chain", arguments: {} });
console.log("chain:", chain.content[0].text);
await client.close();

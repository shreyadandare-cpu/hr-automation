// Starts the server like Claude does and prints each tool's read-only marking.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const t = new StdioClientTransport({ command: "node", args: ["src/index.js"], env: { ...process.env, HR_USER_EMAIL: "shreya.dandare@wohlig.com" } });
const c = new Client({ name: "ann", version: "0.0.1" });
await c.connect(t);
for (const x of (await c.listTools()).tools) console.log(x.name.padEnd(26), JSON.stringify(x.annotations));
await c.close();

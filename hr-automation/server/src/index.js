// Mac version: the backend talks to Claude over the local connection (stdio).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import { pool } from "./db.js";

const server = buildServer();
await server.connect(new StdioServerTransport());
console.error("hr-automation MCP server ready (sign-in required for every action)");

process.on("SIGINT", async () => { await pool.end(); process.exit(0); });

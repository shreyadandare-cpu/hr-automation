// Web version: the same tools, served over HTTPS-ready HTTP for a hosting provider.
// Every request is stateless; identity comes from the session token each action carries.
import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";
import { pool } from "./db.js";

const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY = 1024 * 1024; // 1 MB is far more than any request needs

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY) { req.destroy(); reject(new Error("request too large")); }
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : undefined); } catch (e) { reject(new Error("request is not valid JSON")); }
    });
    req.on("error", reject);
  });
}

const app = http.createServer(async (req, res) => {
  // Health check for the hosting provider. Reveals nothing about the data.
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }
  if (req.url !== "/mcp") {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("not found");
  }
  try {
    const body = req.method === "POST" ? await readBody(req) : undefined;
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    if (!res.headersSent) res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

app.listen(PORT, () => console.log(`hr-automation web server listening on port ${PORT}`));

async function shutdown() {
  app.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

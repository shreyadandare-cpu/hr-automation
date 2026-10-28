// A tiny front door for the office attendance connector, so a tunnel can reach THIS computer's HR Hub without exposing the rest of the app.
// It passes one request through, POST /api/attendance/device/punches, to the local app (which checks the device key), and refuses everything else.
//   node scripts/device-relay.mjs            listens on RELAY_PORT (default 3100) and forwards to http://localhost:3000
// Then expose it:  cloudflared tunnel --url http://localhost:3100   and put the https address it prints into the connector's APP_URL.
import http from "node:http";

const PORT = Number(process.env.RELAY_PORT || 3100);
const TARGET = String(process.env.RELAY_TARGET || "http://localhost:3000").replace(/\/+$/, "");
const PATH = "/api/attendance/device/punches";
const MAX = 2 * 1024 * 1024;

http.createServer((req, res) => {
  const reply = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method !== "POST" || req.url.split("?")[0] !== PATH) return reply(404, { error: "Not found." });
  const chunks = []; let size = 0, dead = false;
  req.on("data", (c) => { size += c.length; if (size > MAX) { dead = true; reply(413, { error: "Too large." }); req.destroy(); } else chunks.push(c); });
  req.on("end", async () => {
    if (dead) return;
    try {
      const r = await fetch(TARGET + PATH, {
        method: "POST", body: Buffer.concat(chunks), signal: AbortSignal.timeout(30000),
        headers: { "Content-Type": "application/json", Authorization: req.headers.authorization || "" },
      });
      res.writeHead(r.status, { "Content-Type": "application/json" });
      res.end(await r.text());
    } catch (e) { reply(502, { error: `The HR Hub on this computer did not answer: ${e.message}` }); }
  });
}).listen(PORT, "127.0.0.1", () => console.log(`Relay on http://127.0.0.1:${PORT}, passing ${PATH} to ${TARGET}`));

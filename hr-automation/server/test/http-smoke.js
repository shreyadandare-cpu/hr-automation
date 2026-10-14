// Starts the web version on the test database and checks it over real HTTP.
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 8799;
const env = { ...process.env, PORT: String(PORT), DATABASE_URL: "postgres://hr:hr_local_only@localhost:5432/hr_test" };
const srv = spawn("node", ["src/http.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((r) => setTimeout(r, 1500));
let failures = 0;
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) failures++; };
try {
  const health = await fetch(`http://localhost:${PORT}/health`);
  check("health check answers ok", health.status === 200 && (await health.text()) === "ok");

  const client = new Client({ name: "smoke", version: "0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${PORT}/mcp`)));
  const tools = await client.listTools();
  check("all tools are offered over the web", tools.tools.length === 20);

  const noSession = await client.callTool({ name: "list_employees", arguments: {} });
  check("no sign-in means no data", noSession.isError === true);

  const badLogin = await client.callTool({ name: "sign_in", arguments: { email: "shreya.dandare@wohlig.com", password: "wrong-Password-1" } });
  check("wrong password is refused", badLogin.isError === true);

  const outsider = await client.callTool({ name: "sign_in", arguments: { email: "someone@gmail.com", password: "Anything-Long-1" } });
  check("outside email is refused", outsider.isError === true);

  await client.close();
} catch (err) {
  console.log("FAIL unexpected error:", err.message);
  failures++;
} finally {
  srv.kill();
}
console.log(failures ? `${failures} check(s) failed` : "ALL WEB CHECKS PASSED");
process.exit(failures ? 1 : 0);

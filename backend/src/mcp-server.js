// The Wohlig One connector for Claude: an MCP server (Streamable HTTP, no sessions) at POST /mcp, signed in through OAuth
// (oauth.js) or with a personal access key. Setup for staff: docs/MCP_CONNECTOR.md.
//
// The caller's token is an access key, so loadSession has already made the request act as that person (req.access.viaKey) and
// keyGuard has let /mcp through. Each tool calls back into this same server's /api over the loopback address with the same
// token, so every answer passes through the same access rules, salary rule, blocked paths and audit log as any key request.
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { publicUrl } from "./mail.js";
import { PRODUCT } from "./brand.js";
import { specs, WohligError } from "./mcp/tools.js";

const CHARACTER_LIMIT = 25_000;
const TIMEOUT_MS = 20_000;
const loopback = () => `http://127.0.0.1:${process.env.PORT || 3000}`;

const hint = (status) =>
  status === 401 ? " The connection has ended; please reconnect the connector in Claude."
    : status === 403 ? ` The person signed in is not allowed to do this in ${PRODUCT}, or it is never available through the connector.`
      : status === 404 ? " Check the id or address; list the items first to find the right id."
        : status === 429 ? " Too many requests; wait a minute and try again." : "";

/** Calls this server's own /api as the token's owner. */
function caller(token) {
  const call = async (method, path, { query, body } = {}) => {
    if (!String(path).startsWith("/api/")) throw new WohligError(`Paths must start with /api/ (got "${path}").`);
    const url = new URL(loopback() + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    let res;
    try {
      res = await fetch(url, {
        method, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "manual",   // never follow a redirect away from /api
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new WohligError(`${PRODUCT} did not answer in time. Please try again.`);
    }
    const type = res.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await res.json().catch(() => null) : null;
    if (!res.ok) {
      const said = data && data.error ? String(data.error) : `HTTP ${res.status}`;
      const fields = data && data.errors ? ` Details: ${JSON.stringify(data.errors)}.` : "";
      throw new WohligError(`${PRODUCT} said: ${said}${fields}${hint(res.status)}`);
    }
    if (data === null) return { ok: true, note: `${PRODUCT} answered with a file. Files are not passed through the connector; open it in the browser.` };
    return data;
  };
  return { get: (path, query) => call("GET", path, { query }), send: (method, path, body) => call(method, path, { body: body ?? {} }) };
}

/**
 * Keeps an answer under CHARACTER_LIMIT by showing fewer items of its longest lists (halving the longest each round, so two big lists
 * both shrink), never by cutting text, and says what was left out. Only an answer with no list left to shrink is cut, and says so.
 */
export function fit(data) {
  let text = JSON.stringify(data, null, 1);
  if (text === undefined) return "null";
  if (text.length <= CHARACTER_LIMIT) return text;
  let out = JSON.parse(text);
  const cut = new Map();   // where -> [shown, total]
  for (let round = 0; round < 60 && text.length + 300 > CHARACTER_LIMIT; round++) {
    let best = null;
    const visit = (x, at, holder, key) => {
      if (Array.isArray(x)) {
        if (x.length > 1 && (!best || JSON.stringify(x).length > best.size)) best = { arr: x, at, holder, key, size: JSON.stringify(x).length };
        x.forEach((y, i) => visit(y, `${at}[${i}]`, x, i));
      } else if (x && typeof x === "object") for (const [k, y] of Object.entries(x)) visit(y, at ? `${at}.${k}` : k, x, k);
    };
    visit(out, "", null, "");
    if (!best) break;
    const part = best.arr.slice(0, Math.ceil(best.arr.length / 2));
    const label = best.at || "the list";
    cut.set(label, [part.length, (cut.get(label) || [0, best.arr.length])[1]]);
    if (best.holder) best.holder[best.key] = part; else out = part;
    text = JSON.stringify(out, null, 1);
  }
  const notes = [...cut].map(([at, [shown, total]]) => `${shown} of ${total} items in "${at}"`).join("; ");
  if (text.length > CHARACTER_LIMIT) text = text.slice(0, CHARACTER_LIMIT - 200) + "\n…(the rest of this answer was cut to fit)";
  return notes ? `${text}\n\nShowing ${notes}. Narrow the request (a filter, a date, a person) to see the rest.` : text;
}

function createServer(token) {
  const server = new McpServer(
    { name: "wohlig-one", title: PRODUCT, version: "1.0.0" },
    { instructions: `${PRODUCT} is Wohlig's HR portal. These tools act as the person who connected, with exactly their rights. `
      + "Start with wohlig_whoami, then wohlig_dashboard or wohlig_todo. Before any tool that changes data (applying or deciding leave, "
      + "posting an announcement, wohlig_api_call), say what will change and get the user's go-ahead. Salaries, payments, tax, bank "
      + "details, staff documents and access rights are not available here, for anyone; say so and point to the browser." },
  );
  for (const s of specs(caller(token))) {
    server.registerTool(s.name, {
      title: s.title, description: s.description, ...(s.input ? { inputSchema: s.input } : {}),
      annotations: { readOnlyHint: !s.write, destructiveHint: s.write === "remove", idempotentHint: !s.write, openWorldHint: false },
    }, async (args) => {
      try {
        return { content: [{ type: "text", text: fit(await s.run(args ?? {})) }] };
      } catch (err) {
        return { content: [{ type: "text", text: err instanceof WohligError ? err.message : "Something went wrong. Please try again." }], isError: true };
      }
    });
  }
  return server;
}

/** POST /mcp (and GET/DELETE, which a sessionless server answers itself). Only a key or a connector token signs in here. */
export async function mcpRoute(req, res) {
  if (!req.access || !req.access.viaKey) {
    res.set("WWW-Authenticate", `Bearer resource_metadata="${publicUrl()}/.well-known/oauth-protected-resource/mcp"`);
    return res.status(401).json({ error: `Please connect ${PRODUCT} in Claude to use it.` });
  }
  const token = /^Bearer\s+(\S+)/i.exec(req.headers.authorization || "")[1];
  const handler = toNodeHandler(createMcpHandler(() => createServer(token)));
  try { await handler(req, res, req.body); }
  catch (err) { console.error("[mcp]", err); if (!res.headersSent) res.status(500).json({ error: "Server error" }); }
}


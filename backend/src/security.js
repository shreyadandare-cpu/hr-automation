import { COMPANY_LEGAL, MAROON, PRODUCT, SIGN_OFF } from "./brand.js";
// Security headers and a same-origin check on every change. Mounted first in index.js.
//
// Sign-in uses a SameSite=Lax cookie, which already stops most cross-site requests. sameOriginWrites adds a second
// lock: any request that changes data (POST, PUT, PATCH, DELETE) must come from this site's own pages. Browsers send
// Origin (or at least Referer) on those requests, so a page on another website is refused. Callers with no browser
// headers (the office attendance device, scripts, curl) send neither and are let through; they have their own key or
// session check.

/** The origins allowed to send changes: the address this request came in on, plus PUBLIC_URL and FRONTEND_URL. */
function allowedOrigins(req) {
  const set = new Set();
  for (const u of [process.env.PUBLIC_URL, process.env.FRONTEND_URL]) {
    try { if (u) set.add(new URL(u).origin); } catch { /* not a URL: ignore */ }
  }
  const host = req.get("x-forwarded-host") || req.get("host");
  if (host) set.add(`${req.protocol}://${host}`);
  return set;
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

// The connector's token paths (oauth.js, mcp-server.js) use no cookie, only tokens a website cannot send for someone, and MCP clients
// may name their own origin; so they skip the same-origin check. The Allow page (/api/oauth) is a cookie path and keeps it.
const TOKEN_PATHS = new Set(["/mcp", "/oauth/token", "/oauth/register", "/oauth/revoke"]);

export function sameOriginWrites(req, res, next) {
  if (SAFE.has(req.method) || TOKEN_PATHS.has(req.path)) return next();
  let from = req.get("origin");
  if (!from || from === "null") {
    const ref = req.get("referer");
    if (!ref) return from === "null" ? refuse(res) : next();   // no browser headers at all: a device or a script
    try { from = new URL(ref).origin; } catch { return refuse(res); }
  }
  // Compare host and port only: behind a proxy that ends HTTPS, the server itself may see http.
  const host = (o) => { try { return new URL(o).host; } catch { return ""; } };
  const ok = [...allowedOrigins(req)].some((o) => host(o) === host(from));
  return ok ? next() : refuse(res);
}

const refuse = (res) => res.status(403).json({ error: `This request did not come from ${PRODUCT}. Please reload the page and try again.` });

/** Headers every answer carries. The page loads fonts from Google, so the policy names those hosts. */
export function securityHeaders(_req, res, next) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "SAMEORIGIN",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(self), payment=()",
  });
  next();
}

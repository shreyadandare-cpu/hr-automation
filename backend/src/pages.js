// The pages themselves, the logos and the shared leave rules, so one server serves everything on the same origin.
// Mounted by index.js after every API route.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import express from "express";
import { googleRouter } from "./google-signin.js";
import { inviteRouter } from "./invites.js";
import { posterPictureRouter } from "./celebrations.js";
import { emailLinkRouter } from "./email-links.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, "../../frontend");

export function pagesRouter() {
  const app = express.Router();
  app.use("/auth", googleRouter);       // "Continue with Google" (public: it is how people sign in)
  app.use("/invite", inviteRouter);     // the link in the invite email
  app.use("/p", posterPictureRouter);   // the poster picture inside celebration emails (public, long random address)
  app.use("/l", emailLinkRouter);       // short-lived links in automatic emails
  for (const f of ["wohlig-logo.svg", "wohlig-logo-dark.svg", "wohlig-logo.png", "wohlig-logo-dark.png", "wohlig-smile-mark.svg", "wohlig-smile-mark.png", "wohlig-premier-partner-badge.png", "wohlig-logos.zip", "favicon.svg", "favicon.ico", "apple-touch-icon.png"]) app.get("/" + f, (_req, res) => res.sendFile(path.join(frontendDir, "public", f), { maxAge: "1h" }));
  app.use("/sig", express.static(path.join(frontendDir, "public", "sig"), { maxAge: "1h" }));   // small icon pictures used by the email signature (public: mail programs fetch them)
  // The whole interface is React (frontend/src), built into frontend/dist with `npm run build:ui`.
  const distDir = path.join(frontendDir, "dist");
  const hasDist = () => fs.existsSync(path.join(distDir, "index.html"));
  const notBuilt = (res) => res.status(503).type("text").send("The interface has not been built yet. Run `npm run build:ui` in the backend folder, then reload.");
  app.use("/app/assets", compressedAssets(path.join(distDir, "assets")));   // scripts and styles sent compressed (about a quarter of the size)
  app.use("/app/assets", express.static(path.join(distDir, "assets"), { immutable: true, maxAge: "1y" }));
  // A page opened while signed out (say, a leave request from an email) is remembered for 15 minutes and opened after sign-in.
  const AFTER = "hrhub_after";
  const pagePath = (p) => (/^\/app\/[A-Za-z0-9/_-]{1,200}$/.test(p) ? p : null);
  const toLogin = (req, res) => {
    const p = pagePath(req.path);
    if (p) res.append("Set-Cookie", `${AFTER}=${encodeURIComponent(p)}; Max-Age=900; Path=/; HttpOnly; SameSite=Lax`);
    res.redirect("/login");
  };
  const home = (req, res) => {
    const m = new RegExp(`(?:^|;\\s*)${AFTER}=([^;]+)`).exec(req.headers.cookie || "");
    const p = m && pagePath(decodeURIComponent(m[1]));
    if (m) res.append("Set-Cookie", `${AFTER}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
    res.redirect(p || "/app/dashboard");
  };
  app.get("/app/*", (req, res) => (!req.user ? toLogin(req, res) : hasDist() ? res.sendFile(path.join(distDir, "index.html")) : notBuilt(res)));
  app.get("/login", (req, res) => (req.user ? home(req, res) : hasDist() ? res.sendFile(path.join(distDir, "login.html")) : notBuilt(res)));
  app.get("/", (req, res) => (req.user ? home(req, res) : res.redirect("/login")));
  // Leave rules shared by the page and the server (no personal data in it).
  app.get("/leave-rules.js", (_req, res) => res.type("js").sendFile(path.join(frontendDir, "leave-rules.cjs")));
  return app;
}

/* The built scripts and styles, compressed once (Brotli, or gzip for older browsers) and kept in memory. The file names carry a
   content hash, so a compressed copy never goes stale. Anything else, or a browser that accepts neither, falls through to
   express.static. */
function compressedAssets(dir) {
  const cache = new Map();
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const name = path.basename(req.path);
    if (!/^[\w.-]+\.(js|css)$/.test(name) || name !== req.path.slice(1)) return next();
    const accepts = String(req.headers["accept-encoding"] || "");
    const enc = /\bbr\b/.test(accepts) ? "br" : /\bgzip\b/.test(accepts) ? "gzip" : null;
    if (!enc) return next();
    const key = `${enc}:${name}`;
    let body = cache.get(key);
    if (!body) {
      let raw;
      try { raw = fs.readFileSync(path.join(dir, name)); } catch { return next(); }
      body = enc === "br"
        ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } })
        : zlib.gzipSync(raw, { level: 9 });
      cache.set(key, body);
    }
    res.set({
      "Content-Type": name.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8",
      "Content-Encoding": enc, "Vary": "Accept-Encoding", "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(body.length),
    });
    return req.method === "HEAD" ? res.end() : res.end(body);
  };
}

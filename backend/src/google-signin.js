import crypto from "node:crypto";
import express from "express";
import { pool } from "./db.js";
import { startSession } from "./auth.js";
import { isCompanyEmail } from "./validate.js";
import { publicUrl } from "./mail.js";

/* "Continue with Google": the standard OAuth 2.0 code flow with PKCE and a state check.
   It signs in people who already have an account (HR creates accounts) and only with an @wohlig.com Google account. */
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const COOKIE = "gsig";

export const googleEnabled = () => Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
const redirectUri = () => `${publicUrl()}/auth/google/callback`;
const secure = () => (publicUrl().startsWith("https://") ? "; Secure" : "");
const b64 = (buf) => buf.toString("base64url");
const cookieOf = (req) => new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_.-]+)`).exec(req.headers.cookie || "")?.[1];
const clearCookie = (res) => res.append("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/auth/google; Max-Age=0${secure()}`);
const back = (res, error) => { clearCookie(res); res.redirect(`/login?error=${error}`); };
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const googleRouter = express.Router();

googleRouter.get("/google", (_req, res) => {
  if (!googleEnabled()) return res.redirect("/login?error=google_off");
  const state = b64(crypto.randomBytes(24)), verifier = b64(crypto.randomBytes(32));
  const challenge = b64(crypto.createHash("sha256").update(verifier).digest());
  // The state and the PKCE secret wait in a short-lived cookie until Google sends the person back.
  res.append("Set-Cookie", `${COOKIE}=${state}.${verifier}; HttpOnly; SameSite=Lax; Path=/auth/google; Max-Age=600${secure()}`);
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, redirect_uri: redirectUri(), response_type: "code", scope: "openid email profile",
    state, code_challenge: challenge, code_challenge_method: "S256", hd: "wohlig.com", prompt: "select_account",
  });
  res.redirect(`${AUTH_URL}?${q}`);
});

googleRouter.get("/google/callback", async (req, res) => {
  try {
    if (!googleEnabled()) return back(res, "google_off");
    if (req.query.error) return back(res, req.query.error === "access_denied" ? "google_cancelled" : "google");
    const [state, verifier] = (cookieOf(req) || "").split(".");
    const code = String(req.query.code || ""), got = String(req.query.state || "");
    if (!state || !verifier || !code || !same(state, got)) return back(res, "google_state");

    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({
        code, client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: redirectUri(), grant_type: "authorization_code", code_verifier: verifier,
      }),
    });
    const tokens = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokens.access_token) return back(res, "google");

    const infoRes = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10000) });
    const info = await infoRes.json().catch(() => ({}));
    const email = String(info.email || "").toLowerCase();
    if (!infoRes.ok || info.email_verified !== true || !email) return back(res, "google");
    if (!isCompanyEmail(email)) return back(res, "google_domain");

    const u = (await pool.query("SELECT email FROM users WHERE lower(email)=$1", [email])).rows[0];
    if (!u) return back(res, "google_no_account");
    await pool.query("UPDATE users SET last_login=now() WHERE lower(email)=$1", [email]);
    clearCookie(res);
    await startSession(res, u.email);
    res.redirect("/");
  } catch (err) {
    console.error("Google sign-in failed:", err.message);
    back(res, "google");
  }
});

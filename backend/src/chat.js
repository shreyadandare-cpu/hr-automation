/*
 * Company news posted to Slack and Microsoft Teams channels through incoming webhooks (Manage > Slack and Teams). The rules
 * are in chat-rules.js. HR (engage.manage, whole company) adds channels and picks what each gets. postToChat() is called
 * after a request has answered, or from a background job: it never holds up a page. Every attempt is kept in chat_outbox.
 * A server on a local database never sends (live-services.js); it records the message as skipped.
 *
 *   GET    /api/chat-channels            the channels (links shown only as their last characters) and the latest messages
 *   POST   /api/chat-channels            add one; PUT /:id edits (an empty link keeps the saved one); DELETE /:id removes
 *   POST   /api/chat-channels/:id/test   send a test message
 */
import express from "express";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { needAll } from "./access.js";
import { localOnly } from "./live-services.js";
import { encryptionReady, open, seal } from "./payroll/access.js";
import { BRAND, PRODUCT } from "./brand.js";
import { EVENTS, hintOf, KINDS, payload, readChannel } from "./chat-rules.js";

const TIMEOUT_MS = 5000;
const NO_KEY = { error: "Webhook links are stored encrypted, and the server's encryption key is not set yet. Please ask the technical team to set it." };
/** A full address for a page, only when the site has a real public address. */
const linkFor = (path) => { const base = String(process.env.PUBLIC_URL || "").replace(/\/$/, ""); return path && /^https:\/\//.test(base) ? `${base}${path}` : ""; };

async function deliver(ch, event, msg) {
  const record = (status, error = "") => pool.query("INSERT INTO chat_outbox (channel_id, event, title, status, error) VALUES ($1,$2,$3,$4,$5)",
    [ch.id, event, String(msg.title).slice(0, 200), status, String(error).slice(0, 300)]).catch(() => {});
  if (localOnly()) { console.log(`[chat] local server: not posting "${msg.title}" to ${KINDS[ch.kind]} ${ch.name}`); return record("skipped", "Local server: nothing is sent."); }
  let url;
  try { url = open(ch.url_sealed).toString("utf8"); } catch { return record("failed", "The saved link could not be read."); }
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(ch.kind, { ...msg, link: linkFor(msg.link) })),
      signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
    if (!r.ok) return record("failed", `${KINDS[ch.kind]} answered ${r.status}.`);
    return record("sent");
  } catch (err) { return record("failed", err.name === "TimeoutError" ? "No answer within 5 seconds." : "The message could not be sent."); }
}

/** Posts company news to every switched-on channel that chose this kind of news. Never throws. msg: { title, text, link (a path) }. */
export async function postToChat(event, msg) {
  try {
    if (!EVENTS[event]) return;
    const { rows } = await pool.query("SELECT id, kind, name, url_sealed FROM chat_channels WHERE enabled AND deleted_at IS NULL AND events ? $1 LIMIT 20", [event]);
    await Promise.all(rows.map((ch) => deliver(ch, event, msg)));
  } catch (err) { console.error("Chat post failed:", err.message); }
}

export function chatRouter(wrap) {
  const r = express.Router();
  r.use("/api/chat-channels", requireAuth, needAll("engage.manage"));
  const me = (req) => req.user.email.toLowerCase();
  const id = (req) => Number(req.params.id) || 0;
  r.get("/api/chat-channels", wrap(async (_req, res) => {
    const [ch, log] = await Promise.all([
      pool.query("SELECT id, kind, name, url_hint, events, enabled, created_at FROM chat_channels WHERE deleted_at IS NULL ORDER BY name LIMIT 50"),
      pool.query(`SELECT o.id, o.event, o.title, o.status, o.error, o.created_at, c.name FROM chat_outbox o JOIN chat_channels c ON c.id=o.channel_id
        ORDER BY o.id DESC LIMIT 30`),
    ]);
    res.set("Cache-Control", "private, no-store");
    res.json({ kinds: KINDS, events: EVENTS, product: PRODUCT, encryptionReady: encryptionReady(), sendsForReal: !localOnly(),
      channels: ch.rows.map((x) => ({ id: x.id, kind: x.kind, name: x.name, link: x.url_hint, events: x.events, enabled: x.enabled })),
      log: log.rows.map((x) => ({ id: x.id, channel: x.name, event: x.event, title: x.title, status: x.status, error: x.error, at: x.created_at })) });
  }));
  r.post("/api/chat-channels", wrap(async (req, res) => {
    const { value: v, errors } = readChannel(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    if (!encryptionReady()) return res.status(503).json(NO_KEY);
    const { rows: [x] } = await pool.query("INSERT INTO chat_channels (kind, name, url_sealed, url_hint, events, enabled, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [v.kind, v.name, seal(v.url), hintOf(v.url), JSON.stringify(v.events), v.enabled, me(req)]);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Chat channel added: ${KINDS[v.kind]} ${v.name}`, me(req)]);
    res.status(201).json({ id: x.id });
  }));
  r.put("/api/chat-channels/:id", wrap(async (req, res) => {
    const { value: v, errors } = readChannel(req.body, true);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const { rows: [old] } = await pool.query("SELECT kind FROM chat_channels WHERE id=$1 AND deleted_at IS NULL", [id(req)]);
    if (!old) return res.status(404).json({ error: "This channel was not found." });
    if (!v.url && old.kind !== v.kind) return res.status(400).json({ errors: { url: "Please paste the new link when you change between Slack and Teams." } });
    if (v.url && !encryptionReady()) return res.status(503).json(NO_KEY);
    await pool.query(`UPDATE chat_channels SET kind=$2, name=$3, events=$4, enabled=$5${v.url ? ", url_sealed=$6, url_hint=$7" : ""} WHERE id=$1`,
      [id(req), v.kind, v.name, JSON.stringify(v.events), v.enabled, ...(v.url ? [seal(v.url), hintOf(v.url)] : [])]);
    res.json({ ok: true });
  }));
  r.delete("/api/chat-channels/:id", wrap(async (req, res) => {
    const { rows: [x] } = await pool.query("UPDATE chat_channels SET deleted_at=now(), url_sealed='' WHERE id=$1 AND deleted_at IS NULL RETURNING kind, name", [id(req)]);
    if (!x) return res.status(404).json({ error: "This channel was not found." });
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Chat channel removed: ${KINDS[x.kind]} ${x.name}`, me(req)]);
    res.json({ ok: true });
  }));
  r.post("/api/chat-channels/:id/test", wrap(async (req, res) => {
    const { rows: [ch] } = await pool.query("SELECT id, kind, name, url_sealed FROM chat_channels WHERE id=$1 AND deleted_at IS NULL", [id(req)]);
    if (!ch) return res.status(404).json({ error: "This channel was not found." });
    await deliver(ch, "test", { title: `${PRODUCT} is connected`, text: `${BRAND.company.name} news chosen for this channel will appear here.`, link: "/app/dashboard" });
    const { rows: [last] } = await pool.query("SELECT status, error FROM chat_outbox WHERE channel_id=$1 ORDER BY id DESC LIMIT 1", [ch.id]);
    res.json({ status: last ? last.status : "failed", error: last ? last.error : "" });
  }));
  return r;
}

// Tool access HR gives from the Employees page (Claude today), and the audit log. Mounted by index.js.
import express from "express";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { canAll, needAll } from "./access.js";
import { claudeMode, grantClaude, removeClaude, recordAccess, syncClaude, syncClaudeSoon } from "./anthropic.js";
import { confirmOwnClaude, requestClaude } from "./claude-requests.js";

export function toolAccessRouter(wrap) {
  const r = express.Router();
  // The audit log: every recorded action, newest first. "Audit log" (audit.view) only.
  r.get("/api/audit", needAll("audit.view"), wrap(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const { rows } = await pool.query(
      `SELECT a.id, a.ts, a.action, a.work_email, e.name FROM audit_log a LEFT JOIN employees e ON lower(e.work_email)=lower(a.work_email) ORDER BY a.ts DESC, a.id DESC LIMIT $1`, [limit]);
    res.json(rows.map((r) => ({ id: r.id, ts: r.ts, action: r.action, email: r.work_email, name: r.name || null })));
  }));

  // Tool access HR gives from the Employees page. Claude is real when ANTHROPIC_ADMIN_KEY is set.
  r.get("/api/tool-access", requireAuth, wrap(async (req, res) => {
    // Pick up people added to Claude outside this app, in the background: every page loads this list at start, so it never waits
    // for Claude's servers (the next load shows any change).
    syncClaudeSoon().catch(() => {});
    const hr = canAll(req, "tools.manage");   // "Tool access" holders see everyone, with the tool's own message; others only themselves
    const { rows } = hr ? await pool.query("SELECT work_email, tool, status, detail FROM tool_access")
      : await pool.query("SELECT work_email, tool, status, detail FROM tool_access WHERE lower(work_email)=$1", [req.user.email.toLowerCase()]);
    res.json({ claudeMode: claudeMode(), rows: rows.map((r) => ({ email: r.work_email, tool: r.tool, status: r.status, detail: hr ? r.detail : null })) });
  }));
  // "Tool access": check the Claude organisation right now instead of waiting for the automatic check, and bring the app in line with it.
  r.post("/api/tool-access/claude/refresh", needAll("tools.manage"), wrap(async (req, res) => {
    if (claudeMode() === "simulated") return res.json({ mode: "simulated", changed: 0 });
    let changed;
    try { changed = await syncClaude(); } catch (err) { return res.status(502).json({ error: `Claude could not be reached: ${err.message}` }); }
    if (changed) await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Claude: status refreshed from the Claude organisation, ${changed} changed (by ${req.user.email})`, req.user.email]);
    res.json({ mode: "live", changed });
  }));
  // The signed-in person confirms they accepted their Claude invite (only when Claude is not connected; otherwise Claude itself is checked).
  r.post("/api/tool-access/claude/confirm", wrap(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Please sign in." });
    if (claudeMode() !== "simulated") return res.status(409).json({ error: "Claude access is checked with Claude automatically." });
    const r = await confirmOwnClaude(req.user.email);
    if (!r) return res.status(409).json({ error: "There is no Claude invite waiting for you." });
    res.json(r);
  }));
  r.post("/api/tool-access/claude", needAll("tools.manage"), wrap(async (req, res) => {
    const email = String((req.body && req.body.email) || "").toLowerCase();
    const action = req.body && req.body.action;
    if (!["grant", "remove"].includes(action)) return res.status(400).json({ error: "Action must be grant or remove." });
    const emp = (await pool.query("SELECT name, status FROM employees WHERE lower(work_email)=$1", [email])).rows[0];
    if (!emp) return res.status(404).json({ error: "Employee not found." });
    try {
      if (action === "grant") {
        if (emp.status === "offboarded") return res.status(400).json({ error: `${emp.name} has left, so Claude access cannot be given.` });
        // No Admin API key: ask the Claude admin to invite them (claude-requests.js) instead of pretending an invite went out.
        if (claudeMode() === "simulated") return res.json({ ...(await requestClaude(email, req.user.email)), mode: "simulated" });
        const r = await grantClaude(email);
        await recordAccess(email, "claude", r.status, r.detail);
        await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Claude: ${r.detail} (by ${req.user.email})`, email]);
        return res.json({ ...r, mode: claudeMode() });
      }
      const detail = await removeClaude(email);
      await recordAccess(email, "claude", "revoked", detail);
      await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Claude: ${detail} (by ${req.user.email})`, email]);
      res.json({ status: "revoked", detail, mode: claudeMode() });
    } catch (err) {
      await recordAccess(email, "claude", "failed", err.message);
      await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Claude: ${action} failed. ${err.message}`, email]);
      res.status(502).json({ error: `Claude could not do that: ${err.message}` });
    }
  }));
  return r;
}

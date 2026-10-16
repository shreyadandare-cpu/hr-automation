import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { pool } from "./db.js";

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || fileURLToPath(new URL("../uploads", import.meta.url)));
const MAX_BYTES = 5 * 1024 * 1024;

// Mirrors DOCS in hr-access-hub.html: how many files each document type may hold.
const DOCS = {
  aadhaar: 1, pan: 1, dl: 1, passport: 1, voter: 1, exp: 10, edu: 5, bank: 1,
};

// File type is decided by the first bytes, not by the name or the Content-Type the browser claims.
const sniff = (b) =>
  b.subarray(0, 4).toString("latin1") === "%PDF" ? { mime: "application/pdf", ext: "pdf" }
  : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? { mime: "image/jpeg", ext: "jpg" }
  : b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? { mime: "image/png", ext: "png" }
  : null;

const toApi = (r) => ({ id: r.id, email: r.work_email, key: r.doc_key, name: r.filename, size: r.size });
const safeName = (s) => String(s || "file").replace(/[^\w.\- ()]/g, "_").slice(0, 120);
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

export const documentsRouter = express.Router();

// HR can see and download everyone's documents; an employee can only reach their own.
const isHr = (req) => req.user.role === "hr";
const mine = (req, row) => row.work_email.toLowerCase() === req.user.email.toLowerCase();

documentsRouter.get("/", wrap(async (req, res) => {
  const { rows } = isHr(req)
    ? await pool.query("SELECT * FROM documents ORDER BY id")
    : await pool.query("SELECT * FROM documents WHERE lower(work_email)=$1 ORDER BY id", [req.user.email.toLowerCase()]);
  res.json(rows.map(toApi));
}));

// One file per request: the raw file is the body. ?email=<work email>&name=<original file name>
documentsRouter.put("/:docKey", express.raw({ type: () => true, limit: MAX_BYTES }), wrap(async (req, res) => {
  const max = DOCS[req.params.docKey];
  // Documents are uploaded by the employee themselves, always into their own record.
  const email = req.user.email.toLowerCase();
  if (!max) return res.status(400).json({ error: "Unknown document type." });
  const emp = await pool.query("SELECT 1 FROM employees WHERE lower(work_email)=$1", [email]);
  if (!emp.rowCount) return res.status(404).json({ error: "Employee not found." });
  const body = req.body;
  if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: "The file is empty." });
  const type = sniff(body);
  if (!type) return res.status(400).json({ error: "Only PDF, JPG or PNG files are allowed." });

  const name = safeName(req.query.name);
  const stored = crypto.randomUUID() + "." + type.ext;
  const client = await pool.connect();
  const gone = [];
  try {
    await client.query("BEGIN");
    // Serialise uploads per employee so the file-count limit cannot be beaten by parallel requests.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [email]);
    const have = await client.query(
      "SELECT id, stored_name FROM documents WHERE lower(work_email)=$1 AND doc_key=$2 ORDER BY id", [email, req.params.docKey]);
    if (max === 1) {
      for (const r of have.rows) gone.push(r.stored_name);
      await client.query("DELETE FROM documents WHERE lower(work_email)=$1 AND doc_key=$2", [email, req.params.docKey]);
    } else if (have.rowCount >= max) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `At most ${max} files for this document.` });
    }
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(path.join(UPLOAD_DIR, stored), body);
    const ins = await client.query(
      `INSERT INTO documents (work_email, doc_key, filename, mime, size, stored_name)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [email, req.params.docKey, name, type.mime, body.length, stored]);
    await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Uploaded document: ${req.params.docKey}`, email]);
    await client.query("COMMIT");
    for (const f of gone) await fs.rm(path.join(UPLOAD_DIR, f), { force: true });
    res.status(201).json(toApi(ins.rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    await fs.rm(path.join(UPLOAD_DIR, stored), { force: true });
    throw err;
  } finally {
    client.release();
  }
}));

documentsRouter.get("/:id/file", wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM documents WHERE id=$1", [Number(req.params.id) || 0]);
  if (!rows[0] || !(isHr(req) || mine(req, rows[0]))) return res.status(404).json({ error: "Not found" });
  res.set({
    "Content-Type": rows[0].mime,
    "Content-Disposition": `${req.query.download ? "attachment" : "inline"}; filename="${rows[0].filename.replace(/"/g, "")}"`,
    "X-Content-Type-Options": "nosniff",
  });
  res.sendFile(path.join(UPLOAD_DIR, rows[0].stored_name));
}));

documentsRouter.delete("/:id", wrap(async (req, res) => {
  const { rows } = await pool.query(
    "DELETE FROM documents WHERE id=$1 AND lower(work_email)=$2 RETURNING stored_name, work_email, doc_key",
    [Number(req.params.id) || 0, req.user.email.toLowerCase()]);
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  await fs.rm(path.join(UPLOAD_DIR, rows[0].stored_name), { force: true });
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Removed document: ${rows[0].doc_key}`, rows[0].work_email]);
  res.json({ ok: true });
}));

// Oversized bodies get a readable error instead of the default HTML page.
documentsRouter.use((err, _req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "The file is larger than 5 MB." });
  next(err);
});

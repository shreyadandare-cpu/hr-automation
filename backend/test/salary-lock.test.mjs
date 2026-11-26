import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import PDFDocument from "pdfkit";
import { ENC_SUFFIX, openFile, readStored, sealFile } from "../src/file-crypt.js";
import { check } from "../src/payroll/workflow.js";

const withKey = async (fn) => {
  const before = process.env.DOCUMENTS_ENCRYPTION_KEY;
  process.env.DOCUMENTS_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  try { await fn(); } finally { if (before === undefined) delete process.env.DOCUMENTS_ENCRYPTION_KEY; else process.env.DOCUMENTS_ENCRYPTION_KEY = before; }
};

test("documents are encrypted on disk and read back only with the key", () => withKey(async () => {
  const plain = Buffer.from("%PDF-1.4 a passport scan");
  const { body, encrypted } = sealFile(plain);
  assert.equal(encrypted, true);
  assert.ok(!body.includes(Buffer.from("passport")), "the stored bytes do not show the content");
  assert.deepEqual(openFile(body), plain);
  const changed = Buffer.from(body); changed[changed.length - 1] ^= 1;
  assert.throws(() => openFile(changed), "a changed file is refused");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "woe-"));
  await fs.writeFile(path.join(dir, "a.pdf" + ENC_SUFFIX), body);
  await fs.writeFile(path.join(dir, "old.pdf"), plain);
  assert.deepEqual(await readStored(dir, "a.pdf" + ENC_SUFFIX), plain);
  assert.deepEqual(await readStored(dir, "old.pdf"), plain, "files from before encryption still open");
  process.env.DOCUMENTS_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  assert.throws(() => openFile(body), "another key cannot read it");
}));

test("a drawn PDF (payslip, Form 124) is locked with AES-256 and the document password", async () => {
  const { lockedPdfOf } = await import("../src/pdf-lock.js");
  const doc = new PDFDocument({ size: "A4" });
  const parts = []; doc.on("data", (c) => parts.push(c));
  const done = new Promise((r) => doc.on("end", r));
  doc.text("Net pay 12,345"); doc.end(); await done;
  const pdf = (await lockedPdfOf(Buffer.concat(parts), "application/pdf", "correct horse battery")).toString("latin1");
  assert.match(pdf, /\/Encrypt/, "the file carries an encryption dictionary");
  assert.match(pdf, /\/CFM \/AESV3/, "AES-256");
  assert.ok(!pdf.includes("Net pay"), "the text is not readable without the password");
});

test("the only salary owner may approve a payroll they prepared; otherwise maker-checker stays", () => {
  const run = { workflow: true, status: "pending_review", submitted_by: "kailash@wohlig.com" };
  const kailash = { email: "kailash@wohlig.com", hr: true, reviewer: true, bank: true, maker: true };
  assert.equal(check(run, "approve", { ...kailash, sole: false }).ok, false);
  assert.equal(check(run, "approve", { ...kailash, sole: true }).ok, true);
});

test("wrong tries are counted before they are checked, so tries sent together cannot beat the limit", async () => {
  const { _forTests: T } = await import("../src/doc-password.js");
  T.clearTries();
  const results = Array.from({ length: 20 }, () => T.takeTry("someone@wohlig.com"));
  assert.equal(results.filter(Boolean).length, T.MAX_TRIES);
  assert.equal(T.takeTry("other@wohlig.com"), true, "each person has their own count");
  T.clearTries();
});

test("the Claude Code salary guard blocks secrets, dumps and salary queries, and lets normal work through", async () => {
  const { spawnSync } = await import("node:child_process");
  const hook = new URL("../../.claude/hooks/salary-guard.mjs", import.meta.url).pathname;
  const run = (tool_name, tool_input) => spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_name, tool_input }) }).status;
  const bash = (command) => run("Bash", { command });
  for (const c of ["cat backend/.env", "printenv", "env | grep KEY", "pg_dump hrhub > x.out", "ls backend/uploads", "cat /srv/uploads/a.pdf.enc",
    "psql hrhub_local -c 'select * from salary_structures'", "node -e \"new (require('pg').Pool)().query('select * from payroll_items')\"",
    "docker compose exec backend env"]) assert.equal(bash(c), 2, c);
  for (const c of ["npm test", "git status", "grep -rn uploads src", "grep -n salary_structures src/schema.sql", "cat backend/.env.example",
    "psql hrhub_local -c 'select count(*) from employees'", "set -e; npm run build:ui"]) assert.equal(bash(c), 0, c);
  assert.equal(run("Read", { file_path: "/x/backend/.env" }), 2);
  assert.equal(run("Read", { file_path: "/x/backend/uploads/a.pdf" }), 2);
  assert.equal(run("Read", { file_path: "/x/backend/src/payroll/schema.sql" }), 0);
});

test("uploaded PDFs and photos leave as PDFs locked with the document password", async () => {
  const zlib = await import("node:zlib");
  const { PDFDocument, EncryptedPDFError } = await import("@cantoo/pdf-lib");
  const { lockedPdfOf, pdfName } = await import("../src/pdf-lock.js");
  // A 1x1 PNG, built by hand.
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.from([0, 200, 30, 60]))), chunk("IEND", Buffer.alloc(0))]);
  const plainDoc = await PDFDocument.create(); plainDoc.addPage().drawText("PAN ABCDE1234F"); const plainPdf = Buffer.from(await plainDoc.save());
  const isLocked = async (buf) => { try { await PDFDocument.load(buf); return false; } catch (e) { return e instanceof EncryptedPDFError; } };

  const fromPdf = await lockedPdfOf(plainPdf, "application/pdf", "correct horse battery");
  assert.ok(await isLocked(fromPdf), "an uploaded PDF is locked");
  const fromPng = await lockedPdfOf(png, "image/png", "correct horse battery", { title: "Passport.png" });
  assert.equal(fromPng.subarray(0, 4).toString("latin1"), "%PDF");
  assert.ok(await isLocked(fromPng), "a photo becomes a locked PDF");
  assert.deepEqual(await lockedPdfOf(fromPdf, "application/pdf", "another one"), fromPdf, "a PDF already locked by its owner is sent as it is");
  await assert.rejects(lockedPdfOf(plainPdf, "application/pdf", null), "never sent without a password");
  assert.equal(pdfName("Passport scan.JPG"), "Passport scan.pdf");
});

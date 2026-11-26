import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import PDFDocument from "pdfkit";
import { ENC_SUFFIX, openFile, readStored, sealFile } from "../src/file-crypt.js";
import { pdfLock } from "../src/doc-password.js";
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

test("a payslip PDF made with the document password is encrypted", async () => {
  const doc = new PDFDocument({ size: "A4", ...pdfLock("correct horse battery") });
  const parts = []; doc.on("data", (c) => parts.push(c));
  const done = new Promise((r) => doc.on("end", r));
  doc.text("Net pay 12,345"); doc.end(); await done;
  const pdf = Buffer.concat(parts).toString("latin1");
  assert.match(pdf, /\/Encrypt/, "the file carries an encryption dictionary");
  assert.ok(!pdf.includes("Net pay"), "the text is not readable without the password");
  assert.deepEqual(pdfLock(null), {}, "no password, no lock");
});

test("the only salary owner may approve a payroll they prepared; otherwise maker-checker stays", () => {
  const run = { workflow: true, status: "pending_review", submitted_by: "kailash@wohlig.com" };
  const kailash = { email: "kailash@wohlig.com", hr: true, reviewer: true, bank: true, maker: true };
  assert.equal(check(run, "approve", { ...kailash, sole: false }).ok, false);
  assert.equal(check(run, "approve", { ...kailash, sole: true }).ok, true);
});

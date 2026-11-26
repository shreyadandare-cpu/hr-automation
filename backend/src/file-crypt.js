import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/*
 * Personal documents (Aadhaar, PAN, passport, bank proof, certificates) are stored encrypted on disk, AES-256-GCM, so a copy of
 * the uploads folder or a backup shows nothing. The key is DOCUMENTS_ENCRYPTION_KEY (32 bytes: `openssl rand -hex 32`); without
 * it, PAYROLL_ENCRYPTION_KEY is used. With neither, files are stored as before and the server log says so once.
 *
 * An encrypted file's stored name ends in ".enc" and holds: "WOE1" | 12-byte IV | 16-byte tag | the encrypted bytes. Files are at
 * most 5 MB, so they are read whole to decrypt.
 */
const MAGIC = Buffer.from("WOE1");
export const ENC_SUFFIX = ".enc";

function readKey(name) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return null;
  const k = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return k.length === 32 ? k : null;
}
const fileKey = () => readKey("DOCUMENTS_ENCRYPTION_KEY") || readKey("PAYROLL_ENCRYPTION_KEY");
export const fileEncryptionReady = () => !!fileKey();

let warned = false;
/** Encrypts `buf` when a key is set. Returns { body, encrypted }. */
export function sealFile(buf) {
  const key = fileKey();
  if (!key) {
    if (!warned) { warned = true; console.warn("[documents] DOCUMENTS_ENCRYPTION_KEY is not set: uploaded documents are stored unencrypted."); }
    return { body: buf, encrypted: false };
  }
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(buf), c.final()]);
  return { body: Buffer.concat([MAGIC, iv, c.getAuthTag(), data]), encrypted: true };
}

/** The reverse of sealFile(). Throws if the file was changed or the key is wrong. */
export function openFile(buf) {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error("Not an encrypted document.");
  const key = fileKey();
  if (!key) throw new Error("This document is encrypted, but DOCUMENTS_ENCRYPTION_KEY is not set on the server.");
  const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(4, 16));
  d.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
}

/** Reads a stored document: decrypted when its name ends in ".enc", as it is otherwise. */
export async function readStored(dir, stored) {
  const buf = await fs.readFile(path.join(dir, stored));
  return stored.endsWith(ENC_SUFFIX) ? openFile(buf) : buf;
}

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { validPan, validAadhaar, cleanPan, cleanAadhaar, formatAadhaar, maskPan, maskAadhaar, verhoeff } from "../src/validate.js";

test("a PAN is five letters, four digits and a letter; spaces and case are ignored", () => {
  assert.equal(validPan("ABCDE1234F"), true);
  assert.equal(validPan("abcde 1234 f"), true);
  assert.equal(cleanPan("JITP M8642C"), "JITPM8642C");
  assert.equal(validPan("JITPM8642"), false);
  assert.equal(validPan("12345ABCDE"), false);
  assert.equal(maskPan("ABCDE1234F"), "AB••••••4F");
});

test("an Aadhaar is 12 digits that pass the Verhoeff check, so a mistyped digit is caught", () => {
  // Build a valid number: of the ten possible last digits, exactly one makes the check pass.
  const body = "23636035604";
  const lasts = [..."0123456789"].filter((d) => verhoeff(body + d));
  assert.equal(lasts.length, 1);
  const good = body + lasts[0], bad = body + String((Number(lasts[0]) + 1) % 10);
  assert.equal(validAadhaar(good), true);
  assert.equal(validAadhaar(good.replace(/(\d{4})(?=\d)/g, "$1 ")), true, "spaces are ignored");
  assert.equal(validAadhaar(bad), false, "a mistyped last digit is caught");
  assert.equal(validAadhaar(body), false, "11 digits is not enough");
  assert.equal(cleanAadhaar(`${good.slice(0, 4)}-${good.slice(4, 8)}-${good.slice(8)}`), good);
  assert.equal(formatAadhaar(good), `${good.slice(0, 4)} ${good.slice(4, 8)} ${good.slice(8)}`);
  assert.equal(maskAadhaar(good), `•••• •••• ${good.slice(8)}`);
});

test("a full number is stored encrypted and comes back unchanged only with the key", async () => {
  process.env.PAYROLL_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  const { seal, open } = await import("../src/payroll/access.js");
  const sealed = seal("ABCDE1234F");
  assert.ok(sealed.startsWith("v1:") && !sealed.includes("ABCDE1234F"), "the stored form does not contain the number");
  assert.equal(open(sealed).toString("utf8"), "ABCDE1234F");
  process.env.PAYROLL_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  assert.throws(() => open(sealed), "a different key cannot open it");
});

/* The careers page, applications and referrals (careers-rules.js). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readApplication, readJobDetails, referralStatus, resumeType } from "../src/careers-rules.js";

test("a CV is a PDF or a Word file, judged by its content, never its name", () => {
  assert.equal(resumeType(Buffer.from("%PDF-1.4 ...")).ext, "pdf");
  const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("....[Content_Types].xml....word/document.xml")]);
  assert.equal(resumeType(docx).ext, "docx");
  assert.equal(resumeType(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("[Content_Types].xml xl/workbook.xml")])), null, "an Excel file is not a CV");
  assert.equal(resumeType(Buffer.from("MZ executable")), null);
  assert.equal(resumeType(Buffer.alloc(0)), null);
});
test("an application needs a name, a valid email and consent; a filled hidden field marks a bot", () => {
  const ok = readApplication({ name: " Asha ", email: "Asha@Example.com", consent: true });
  assert.deepEqual(ok.errors, {}); assert.equal(ok.value.email, "asha@example.com"); assert.equal(ok.bot, false);
  assert.ok(readApplication({ name: "", email: "x", consent: true }).errors.name);
  assert.ok(readApplication({ name: "A", email: "x", consent: true }).errors.email);
  assert.ok(readApplication({ name: "A", email: "a@b.co" }).errors.consent);
  assert.ok(readApplication({ name: "A", email: "a@b.co", consent: true, link: "javascript:alert(1)" }).errors.link, "only web links");
  assert.ok(readApplication({ name: "A", email: "a@b.co", consent: true, phone: "call me" }).errors.phone);
  assert.equal(readApplication({ name: "A", email: "a@b.co", consent: true, website: "spam.example" }).bot, true);
  assert.deepEqual(readApplication({ name: "A", email: "a@b.co" }, { referral: true }).errors, {}, "a referral needs no consent box");
});
test("a role's public details, and what a referrer may see", () => {
  assert.deepEqual(readJobDetails({ isPublic: true, kind: "Internship", location: "Mumbai" }), { location: "Mumbai", experience: "", kind: "Internship", isPublic: true, errors: {} });
  assert.equal(readJobDetails({ kind: "Forever" }).kind, "Full time");
  assert.equal(readJobDetails({ isPublic: "yes" }).isPublic, false, "only a true tick publishes");
  assert.deepEqual(["applied", "screening", "interview", "offer", "hired", "rejected"].map(referralStatus), ["Received", "In process", "In process", "In process", "Hired", "Not selected"]);
});

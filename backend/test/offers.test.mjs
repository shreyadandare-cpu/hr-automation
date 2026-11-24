/* Offer letters and e-signature (offers-rules.js). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprint, hashKey, newSignKey, offerText, readOffer, readSignature } from "../src/offers-rules.js";
import { PERM } from "../src/access-rules.js";

test("an offer needs a title, a yearly CTC and a joining date that is not past", () => {
  const ok = readOffer({ title: "Frontend Developer", ctc: "12,00,000", joiningDate: "2026-12-15" }, "2026-11-24");
  assert.deepEqual(ok.errors, {}); assert.equal(ok.value.ctc, 1200000);
  assert.ok(readOffer({ title: "", ctc: "1", joiningDate: "2026-12-15" }, "2026-11-24").errors.title);
  assert.ok(readOffer({ title: "x", ctc: "-5", joiningDate: "2026-12-15" }, "2026-11-24").errors.ctc);
  assert.ok(readOffer({ title: "x", ctc: "100", joiningDate: "2026-11-01" }, "2026-11-24").errors.joiningDate);
});
test("the letter names the role, pay, joining date and the date to sign by; its fingerprint shows any change", () => {
  const t = offerText({ company: "Wohlig", candidate: "Asha Rao", title: "Frontend Developer", ctc: 1200000, joiningDate: "2026-12-15", location: "Mumbai", terms: "Probation is six months.", expires: "2026-12-08" });
  assert.match(t, /^Dear Asha Rao,/); assert.match(t, /position of Frontend Developer at Wohlig/); assert.match(t, /Rs\. 12,00,000/);
  assert.match(t, /15 December 2026, at Mumbai/); assert.match(t, /Probation is six months\./); assert.match(t, /sign this letter by 8 December 2026/);
  assert.equal(fingerprint(t), fingerprint(t)); assert.notEqual(fingerprint(t), fingerprint(t.replace("12,00,000", "21,00,000")));
});
test("the link key is never stored: only its fingerprint, and each key is different", () => {
  const a = newSignKey(), b = newSignKey();
  assert.notEqual(a.key, b.key); assert.equal(a.hash, hashKey(a.key)); assert.notEqual(a.hash, a.key); assert.ok(a.key.length >= 30);
});
test("signing: the typed name must match the letter's (case and spaces aside) and the offer must be accepted", () => {
  assert.deepEqual(readSignature({ name: "asha  rao", accept: true }, "Asha Rao").errors, {});
  assert.match(readSignature({ name: "Someone Else", accept: true }, "Asha Rao").errors.name, /Asha Rao/);
  assert.ok(readSignature({ name: "", accept: true }, "Asha Rao").errors.name);
  assert.ok(readSignature({ name: "Asha Rao" }, "Asha Rao").errors.accept);
  assert.equal(PERM["offers.approve"].team, false);
});

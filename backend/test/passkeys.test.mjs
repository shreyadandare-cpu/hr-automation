// The passkey checks (passkey-rules.js) against a passkey made here with Node's crypto, as a phone would make one.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ALGS, checkAssertion, checkRegistration, userHandle } from "../src/passkey-rules.js";

const site = { origin: "https://one.example.com", rpId: "one.example.com" };
const sha = (b) => crypto.createHash("sha256").update(b).digest();
const u = (b) => Buffer.from(b).toString("base64url");
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const spki = publicKey.export({ format: "der", type: "spki" });
const credId = crypto.randomBytes(32);
const client = (type, challenge, origin = site.origin) => u(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
function authData({ rpId = site.rpId, flags = 0x05, count = 0, attested = false } = {}) {
  const head = Buffer.alloc(37); sha(rpId).copy(head, 0); head[32] = flags | (attested ? 0x40 : 0); head.writeUInt32BE(count, 33);
  if (!attested) return head;
  const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
  return Buffer.concat([head, Buffer.alloc(16), len, credId]);
}
const registration = (challenge, over = {}) => ({ id: u(credId), clientDataJSON: client("webauthn.create", challenge), authenticatorData: u(authData({ attested: true })),
  publicKey: u(spki), alg: ALGS.ES256, ...over });
function assertion(challenge, { flags, count, origin, key = privateKey } = {}) {
  const ad = authData({ flags, count }), cd = client("webauthn.get", challenge, origin);
  const signature = crypto.sign("sha256", Buffer.concat([ad, sha(Buffer.from(cd, "base64url"))]), key);
  return { id: u(credId), clientDataJSON: cd, authenticatorData: u(ad), signature: u(signature) };
}
const saved = () => ({ credentialId: u(credId), publicKey: u(spki), signCount: 0 });

test("set up: a good passkey is accepted and its public key kept", () => {
  const r = checkRegistration(registration("abc"), { challenge: "abc", ...site });
  assert.equal(r.ok, true); assert.equal(r.value.credentialId, u(credId)); assert.equal(r.value.alg, ALGS.ES256);
});
test("set up: wrong challenge, another site, no fingerprint or face, or another key type is refused", () => {
  assert.equal(checkRegistration(registration("abc"), { challenge: "other", ...site }).ok, false);
  assert.equal(checkRegistration(registration("abc"), { challenge: "abc", origin: "https://evil.example", rpId: site.rpId }).ok, false);
  assert.equal(checkRegistration(registration("abc", { authenticatorData: u(authData({ attested: true, flags: 0x01 })) }), { challenge: "abc", ...site }).ok, false, "user not verified");
  assert.equal(checkRegistration(registration("abc", { authenticatorData: u(authData({ attested: true, rpId: "evil.example" })) }), { challenge: "abc", ...site }).ok, false);
  assert.equal(checkRegistration(registration("abc", { alg: ALGS.RS256 }), { challenge: "abc", ...site }).ok, false, "an EC key sent as RSA");
  assert.equal(checkRegistration(registration("abc", { publicKey: "" }), { challenge: "abc", ...site }).ok, false);
});
test("punch: a signed answer from the saved passkey is accepted", () => {
  const r = checkAssertion(assertion("xyz"), saved(), { challenge: "xyz", ...site });
  assert.equal(r.ok, true);
});
test("punch: another key, a changed challenge, another site, or no fingerprint or face is refused", () => {
  const other = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
  assert.equal(checkAssertion(assertion("xyz", { key: other }), saved(), { challenge: "xyz", ...site }).ok, false);
  assert.equal(checkAssertion(assertion("xyz"), saved(), { challenge: "abc", ...site }).ok, false);
  assert.equal(checkAssertion(assertion("xyz", { origin: "https://evil.example" }), saved(), { challenge: "xyz", ...site }).ok, false);
  assert.match(checkAssertion(assertion("xyz", { flags: 0x01 }), saved(), { challenge: "xyz", ...site }).error, /fingerprint, face or screen lock/);
});
test("punch: a counter that goes backwards (a copied passkey) is refused; phones that always send 0 are fine", () => {
  assert.equal(checkAssertion(assertion("xyz", { count: 5 }), { ...saved(), signCount: 9 }, { challenge: "xyz", ...site }).ok, false);
  assert.equal(checkAssertion(assertion("xyz", { count: 10 }), { ...saved(), signCount: 9 }, { challenge: "xyz", ...site }).ok, true);
});
test("the person's handle in the passkey is not their email", () => {
  assert.equal(userHandle("A@wohlig.com"), userHandle("a@wohlig.com"));
  assert.ok(!userHandle("a@wohlig.com").includes("wohlig"));
});

/*
 * Passkeys (WebAuthn) without a library: the checks, without the database (routes are in passkeys.js). A passkey lets a person
 * confirm a punch with their phone's own fingerprint, face or screen lock; the fingerprint never leaves the phone. The browser
 * hands over the public key in SPKI form when the passkey is made (getPublicKey()), so no CBOR decoding is needed; Node's crypto
 * checks each signature. Attestation is not asked for (`none`): it proves the make of the phone, which Wohlig One does not need.
 */
import crypto from "node:crypto";

export const ALGS = { ES256: -7, RS256: -257 };   // what every phone and browser offers; asked for in this order
export const CHALLENGE_MS = 5 * 60 * 1000;
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
export const b64u = (b) => Buffer.from(b).toString("base64url");
const bytes = (s) => { try { return typeof s === "string" && s ? Buffer.from(s, "base64url") : null; } catch { return null; } };
export const newChallenge = () => b64u(crypto.randomBytes(32));
/** A stable handle for the person in the passkey (not their email): the first 16 bytes of the email's hash. */
export const userHandle = (email) => b64u(sha256(String(email).toLowerCase()).subarray(0, 16));
const FAIL = (error) => ({ ok: false, error });
const AGAIN = "Your fingerprint or face check could not be confirmed. Please try again.";

/** The browser's clientDataJSON: the right ceremony, our challenge, and the page it came from. */
export function readClientData(b64, { type, challenge, origin }) {
  const raw = bytes(b64);
  if (!raw) return FAIL(AGAIN);
  let c;
  try { c = JSON.parse(raw.toString("utf8")); } catch { return FAIL(AGAIN); }
  if (!c || c.type !== type || c.challenge !== challenge || c.origin !== origin) return FAIL(AGAIN);
  return { ok: true, raw };
}

/** authenticatorData: made for this site (rpIdHash), the person was present and verified (fingerprint, face or screen lock). */
export function readAuthData(b64, rpId) {
  const a = bytes(b64);
  if (!a || a.length < 37) return FAIL(AGAIN);
  if (!a.subarray(0, 32).equals(sha256(rpId))) return FAIL(AGAIN);
  const flags = a[32];
  if (!(flags & 0x01)) return FAIL(AGAIN);                                      // user present
  if (!(flags & 0x04)) return FAIL("Please use your fingerprint, face or screen lock to confirm.");   // user verified
  const out = { ok: true, raw: a, signCount: a.readUInt32BE(33) };
  if (flags & 0x40 && a.length >= 55) {                                         // a new passkey: its id follows the 16-byte AAGUID
    const len = a.readUInt16BE(53);
    out.credentialId = a.length >= 55 + len ? b64u(a.subarray(55, 55 + len)) : null;
  }
  return out;
}

/** A new passkey from the browser: { id, clientDataJSON, authenticatorData, publicKey (SPKI), alg }. */
export function checkRegistration(body, { challenge, origin, rpId }) {
  const b = body || {};
  if (typeof b.id !== "string" || !/^[A-Za-z0-9_-]{16,1400}$/.test(b.id)) return FAIL(AGAIN);
  const cd = readClientData(b.clientDataJSON, { type: "webauthn.create", challenge, origin });
  if (!cd.ok) return cd;
  const ad = readAuthData(b.authenticatorData, rpId);
  if (!ad.ok) return ad;
  if (ad.credentialId && ad.credentialId !== b.id) return FAIL(AGAIN);
  const alg = Number(b.alg);
  if (!Object.values(ALGS).includes(alg)) return FAIL("This phone's passkey type is not supported. Please try another phone or browser.");
  const spki = bytes(b.publicKey);
  if (!spki) return FAIL("This browser cannot set up a passkey. Please update it, or use Chrome or Safari.");
  try {
    const key = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
    if ((alg === ALGS.ES256) !== (key.asymmetricKeyType === "ec")) return FAIL(AGAIN);
  } catch { return FAIL(AGAIN); }
  return { ok: true, value: { credentialId: b.id, publicKey: b64u(spki), alg, signCount: ad.signCount } };
}

/** A confirmation from the browser: { id, clientDataJSON, authenticatorData, signature }, against the saved passkey. */
export function checkAssertion(body, saved, { challenge, origin, rpId }) {
  const b = body || {};
  if (!saved || b.id !== saved.credentialId) return FAIL(AGAIN);
  const cd = readClientData(b.clientDataJSON, { type: "webauthn.get", challenge, origin });
  if (!cd.ok) return cd;
  const ad = readAuthData(b.authenticatorData, rpId);
  if (!ad.ok) return ad;
  const sig = bytes(b.signature);
  if (!sig) return FAIL(AGAIN);
  let good = false;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(saved.publicKey, "base64url"), format: "der", type: "spki" });
    good = crypto.verify("sha256", Buffer.concat([ad.raw, sha256(cd.raw)]), key, sig);
  } catch { good = false; }
  if (!good) return FAIL(AGAIN);
  // A counter that goes backwards means a copied passkey. Most phone passkeys always send 0, which is allowed.
  if (ad.signCount > 0 && saved.signCount > 0 && ad.signCount <= saved.signCount) return FAIL(AGAIN);
  return { ok: true, signCount: ad.signCount };
}

/** The page's origin and the passkey's site id (its host name), from the Origin header the same-origin check already allowed. */
export function siteOf(req) {
  try { const u = new URL(req.get("origin") || ""); return { origin: u.origin, rpId: u.hostname }; } catch { return null; }
}

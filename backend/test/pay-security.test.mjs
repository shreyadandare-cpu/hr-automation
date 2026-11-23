import test from "node:test";
import assert from "node:assert/strict";
import { base32, checkTotp, hashPin, newOtp, newSecret, otpKey, otpauthUrl, seal, totp, unbase32, unseal, verifyPin, weakPin } from "../src/pay-security.js";

// RFC 6238 test secret ("12345678901234567890") at the RFC's own times; the RFC lists 8 digits, we use the last 6.
const RFC = base32(Buffer.from("12345678901234567890"));
test("authenticator codes match the RFC 6238 test vectors", () => {
  assert.equal(RFC, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  for (const [t, code] of [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"]]) assert.equal(totp(RFC, Math.floor(t / 30)), code);
});

test("base32 round-trips and a new secret is 32 letters", () => {
  for (let i = 0; i < 50; i++) { const s = newSecret(); assert.match(s, /^[A-Z2-7]{32}$/); assert.equal(base32(unbase32(s)), s); }
});

test("a code is accepted in its own 30 seconds and the ones either side, never further away", () => {
  const now = 1234567890 * 1000, code = totp(RFC, Math.floor(now / 30000));
  assert.equal(checkTotp(RFC, code, 0, now), Math.floor(now / 30000));
  assert.ok(checkTotp(RFC, code, 0, now + 30000));
  assert.ok(checkTotp(RFC, code, 0, now - 30000));
  assert.equal(checkTotp(RFC, code, 0, now + 90000), null);
  assert.equal(checkTotp(RFC, code, 0, now - 90000), null);
});

test("a code works once: a step at or before the last used one is refused", () => {
  const now = 1234567890 * 1000, step = Math.floor(now / 30000), code = totp(RFC, step);
  assert.equal(checkTotp(RFC, code, step, now), null);
  assert.equal(checkTotp(RFC, code, step - 1, now), step);
});

test("anything but six digits is refused", () => {
  const now = 1234567890 * 1000;
  for (const bad of ["", "12345", "1234567", "12345a", " 005924", null, undefined, 5924]) assert.equal(checkTotp(RFC, bad, 0, now), null);
});

test("the setup link carries the secret and the address", () => {
  const u = otpauthUrl("a.b@wohlig.com", "ABCDEFGH");
  assert.match(u, /^otpauth:\/\/totp\//);
  assert.ok(u.includes("secret=ABCDEFGH") && u.includes("a.b%40wohlig.com") && u.includes("digits=6") && u.includes("period=30"));
});

test("a stored authenticator secret is encrypted, tamper-proof and tied to the server secret", () => {
  const keep = process.env.PAY_PIN_PEPPER;
  process.env.PAY_PIN_PEPPER = "secret-one";
  const sealed = seal("JBSWY3DPEHPK3PXP");
  assert.ok(!sealed.includes("JBSWY3DPEHPK3PXP"));
  assert.equal(unseal(sealed), "JBSWY3DPEHPK3PXP");
  assert.notEqual(seal("JBSWY3DPEHPK3PXP"), sealed);   // a fresh random nonce each time
  const parts = sealed.split("."); parts[3] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => unseal(parts.join(".")));
  assert.throws(() => unseal("nonsense"));
  process.env.PAY_PIN_PEPPER = "secret-two";
  assert.throws(() => unseal(sealed));
  if (keep === undefined) delete process.env.PAY_PIN_PEPPER; else process.env.PAY_PIN_PEPPER = keep;
});

test("the emailed code is six digits, and only its keyed hash (tied to the address) is kept", () => {
  for (let i = 0; i < 200; i++) assert.match(newOtp(), /^\d{6}$/);
  const k = otpKey("a@wohlig.com", "271828");
  assert.equal(k, otpKey("A@wohlig.com", "271828"));
  assert.notEqual(k, otpKey("b@wohlig.com", "271828"));
  assert.notEqual(k, otpKey("a@wohlig.com", "271829"));
  assert.ok(!k.includes("271828"));
});

test("a PIN must be exactly six digits", () => {
  for (const p of ["", "12345", "1234567", "12345a", "12 456", "٣٤٥٦٧٨", null, undefined, "483920 "]) assert.ok(weakPin(p), `${JSON.stringify(p)} should be refused`);
  assert.equal(weakPin("483920"), null);
  assert.equal(weakPin("901467"), null);
});

test("easily guessed PINs are refused", () => {
  const refused = ["000000", "111111", "999999", "123456", "654321", "234567", "012345", "567890", "987654", "890123", "121212", "123123", "112233", "696969", "456456", "101010"];
  for (const p of refused) assert.ok(weakPin(p), `${p} should be refused`);
});

test("a PIN is stored as a salted hash, never as itself", async () => {
  const a = await hashPin("483920"), b = await hashPin("483920");
  assert.match(a, /^pin1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.ok(!a.includes("483920"));
  assert.notEqual(a, b, "the same PIN gets a different salt each time");
  assert.equal(await verifyPin("483920", a), true);
  assert.equal(await verifyPin("483921", a), false);
  assert.equal(await verifyPin("", a), false);
});

test("a malformed stored hash never verifies", async () => {
  for (const bad of ["", null, "x", "pin1$$", "pin2$aa$bb", "483920"]) assert.equal(await verifyPin("483920", bad), false);
});

test("a different server secret gives a different hash (a copied database is no use without it)", async () => {
  const keep = process.env.PAY_PIN_PEPPER;
  process.env.PAY_PIN_PEPPER = "secret-one";
  const h = await hashPin("483920");
  process.env.PAY_PIN_PEPPER = "secret-two";
  assert.equal(await verifyPin("483920", h), false);
  process.env.PAY_PIN_PEPPER = "secret-one";
  assert.equal(await verifyPin("483920", h), true);
  if (keep === undefined) delete process.env.PAY_PIN_PEPPER; else process.env.PAY_PIN_PEPPER = keep;
});


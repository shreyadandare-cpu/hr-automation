import test from "node:test";
import assert from "node:assert/strict";
import { hashPin, verifyPin, weakPin } from "../src/pay-pin.js";

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

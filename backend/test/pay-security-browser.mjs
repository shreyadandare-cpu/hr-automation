/*
 * Pay security through the real screens in a real (headless) Chrome, with a virtual fingerprint reader (Chrome's WebAuthn virtual
 * authenticator, which answers like Touch ID would: user present, user verified). LOCAL server and database only.
 *
 *   DATABASE_URL=postgresql://postgres:x@localhost:55432/postgres BASE=http://localhost:3188 node test/pay-security-browser.mjs
 *
 * The emailed code needs SendGrid, so "proof of identity" is given to the session directly in the database (what a right code does).
 * Not part of `npm test`. It removes its test rows afterwards.
 */
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { totp } from "../src/pay-security.js";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3188";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB) || !/^http:\/\/localhost/.test(BASE)) { console.error("Refusing: local database and local server only."); process.exit(2); }
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", PORT = 9333;
const db = new pg.Pool({ connectionString: DB }), sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const U1 = "ui.finger@wohlig.com", U2 = "ui.app@wohlig.com", U3 = "ui.pin@wohlig.com";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function session(email) {
  await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,'x','employee') ON CONFLICT DO NOTHING", [email]);
  const token = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(token), email]);
  return token;
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "paysec-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=1200,900", "--no-first-run", "about:blank"], { stdio: "ignore" });
let ws, id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "script error"); return r.result.value; };
const text = () => js("document.body.innerText");
const until = async (what, fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(150); } console.log(`   (gave up waiting for ${what}; page says: ${(await text()).replace(/\s+/g, " ").slice(0, 160)})`); return false; };
const click = (label) => js(`(() => { const b = [...document.querySelectorAll("button,a")].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)})); if (!b) return false; b.click(); return true; })()`);
const type = (inputId, value) => js(`(() => { const el = document.getElementById(${JSON.stringify(inputId)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const now = () => Math.floor(Date.now() / 1000 / 30);

try {
  let tabs;
  for (let i = 0; i < 40 && !tabs; i++) { try { tabs = await (await fetch(`http://localhost:${PORT}/json`)).json(); } catch { await wait(250); } }
  const page = tabs.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); } };
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("WebAuthn.enable");
  await send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const open = async (token, route = "/app/my-finances") => {
    await send("Network.setCookie", { name: "sid", value: token, url: BASE, httpOnly: true });
    await send("Page.navigate", { url: BASE + route });
  };

  // ---- Person 1: fingerprint ----
  const t1 = await session(U1);
  await open(t1);
  ok("nothing set up: the page offers to secure Pay and to email a code", await until("secure screen", async () => /Secure Your Pay Section/.test(await text()) && /Email me a code/.test(await text())));
  ok("the salary page is not shown", !/Payslips|Salary/.test((await text()).split("Secure Your Pay Section")[0] || ""));
  await db.query("UPDATE sessions SET pay_recover_until = now() + interval '10 minutes' WHERE token_hash=$1", [sha(t1)]);   // proof of identity, as a right emailed code gives
  await open(t1);
  ok("after proof of identity: the fingerprint is offered first and alone", await until("enrol screen", async () => /Set up your fingerprint/.test(await text())));
  ok("no PIN or authenticator is offered yet, only a way out for a device with no reader", /Use fingerprint or Touch ID/.test(await text()) && !/Use a PIN\n|Use an authenticator app\n/.test(await text()) && /No fingerprint reader\?/.test(await text()), (await text()).slice(-300));
  await click("Use fingerprint or Touch ID");
  await wait(2500); if (process.env.DEBUG) console.log("PAGE:", (await text()).slice(-400));
  ok("the virtual fingerprint sets up and Pay opens (unlocked bar)", await until("unlocked", async () => /Pay is unlocked/.test(await text())), (await text()).slice(0, 200));
  const pk = (await db.query("SELECT credential_id, device_name, counter FROM pay_passkeys WHERE email=$1", [U1])).rows;
  ok("one passkey is stored with a device name (public key only)", pk.length === 1 && !!pk[0].device_name, JSON.stringify(pk));
  ok("proof of identity is used up", (await db.query("SELECT pay_recover_until FROM sessions WHERE token_hash=$1", [sha(t1)])).rows[0].pay_recover_until === null);
  await click("Lock Pay");
  ok("Lock Pay shows the verify screen with the fingerprint button", await until("locked", async () => /Verify Your Identity/.test(await text()) || /Pay is locked/.test(await text())));
  await click("Unlock Pay");
  await until("fingerprint button", async () => /Use fingerprint or Touch ID/.test(await text()));
  ok("no authenticator box when only the fingerprint is set up", !/authenticator code/.test(await text()));
  await click("Use fingerprint or Touch ID");
  ok("the fingerprint unlocks Pay again", await until("unlocked again", async () => /Pay is unlocked/.test(await text())));
  ok("the sign counter / last used is recorded", (await db.query("SELECT last_used_at FROM pay_passkeys WHERE email=$1", [U1])).rows[0].last_used_at !== null);
  await click("Security");
  ok("the Security panel lists the device and offers the authenticator", await until("panel", async () => /Pay security/.test(await text()) && /Set up authenticator app/.test(await text()) && /Add this device/.test(await text())), (await text()).slice(0, 300));
  const log1 = (await db.query("SELECT action FROM audit_log WHERE work_email=$1 AND action ILIKE '%pay%' ORDER BY id", [U1])).rows.map((x) => x.action).join("\n");
  ok("the log has the fingerprint added and used", /Pay fingerprint added/.test(log1) && /Pay opened with the fingerprint/.test(log1), log1);

  await open(t1);
  ok("arriving at Pay with a fingerprint registered opens it by itself (no click)", await until("auto", async () => /Pay is unlocked/.test(await text()), 10000), (await text()).slice(-300));
  const log1b = (await db.query("SELECT count(*)::int AS n FROM audit_log WHERE work_email=$1 AND action='Pay opened with the fingerprint'", [U1])).rows[0].n;
  ok("and that was logged as a fingerprint opening", log1b >= 2, String(log1b));

  // ---- Person 2: authenticator app ----
  const t2 = await session(U2);
  await db.query("UPDATE sessions SET pay_recover_until = now() + interval '10 minutes' WHERE token_hash=$1", [sha(t2)]);
  await open(t2);
  await until("enrol screen", async () => /Set up your fingerprint/.test(await text()));
  await click("No fingerprint reader?");
  ok("the way out offers the authenticator app and the PIN", await until("others", async () => /Choose another way to open Pay/.test(await text()) && /Use an authenticator app/.test(await text()) && /Use a PIN/.test(await text())));
  await click("Use an authenticator app");
  ok("the authenticator step shows a QR picture and the text key", await until("qr", async () => await js(`!!document.querySelector('img[alt^="QR code"]') && document.querySelector('img[alt^="QR code"]').src.startsWith("data:image/png")`)));
  await js(`document.querySelector("details summary").click()`);
  const key = (await js(`document.querySelector("details code").textContent`)).replace(/\s+/g, "");
  ok("the key is a 32-letter secret", /^[A-Z2-7]{32}$/.test(key), key);
  await type("pay-totp-first", "000000"); await click("Confirm and open Pay");
  ok("a wrong first code is refused with a message", await until("error", async () => /not correct/.test(await text())));
  await type("pay-totp-first", totp(key, now()));
  await click("Confirm and open Pay");
  ok("the right code opens Pay", await until("unlocked", async () => /Pay is unlocked/.test(await text())));
  await click("Lock Pay"); await until("locked", async () => /Pay is locked|Verify Your Identity/.test(await text()));
  await click("Unlock Pay");
  ok("with no fingerprint registered yet, setting it up comes first and the code is behind a link", await until("finger", async () => /Set up fingerprint on this device/.test(await text())) && !/6-digit authenticator code/.test(await text()) && /Use your authenticator code instead/.test(await text()));
  await click("Use your authenticator code instead");
  ok("the link brings the authenticator code box", await until("code box", async () => /6-digit authenticator code/.test(await text())));
  await type("pay-code", "123456"); await click("Verify");
  ok("a wrong code is refused with the tries left", await until("tries", async () => /4 tries left/.test(await text())));
  await db.query("UPDATE pay_totp SET last_step=$2 WHERE email=$1", [U2, now() - 3]);   // a new 30 seconds having passed
  await type("pay-code", totp(key, now())); await click("Verify");
  ok("the right code unlocks Pay", await until("unlocked", async () => /Pay is unlocked/.test(await text())));
  await click("Security");
  ok("the Security panel shows the authenticator as set up and offers the fingerprint", await until("panel", async () => /Set up\. You type its 6-digit code/.test(await text()) && /Add this device/.test(await text())), (await text()).slice(0, 300));
  await click("Add this device's fingerprint");
  ok("adding this device's fingerprint from inside Pay works and lists it", await until("listed", async () => /Remove/.test(await text()) && /Added/.test(await text())), (await text()).slice(0, 300));
  await click("Lock Pay"); await until("locked", async () => /Pay is locked|Verify Your Identity/.test(await text()));
  await click("Unlock Pay");
  ok("with a fingerprint registered, the lock screen shows the fingerprint alone (no code box)", await until("finger", async () => /Use fingerprint or Touch ID/.test(await text())) && !/6-digit authenticator code/.test(await text()) && /Cannot use your fingerprint\?/.test(await text()), (await text()).slice(-300));
  await click("Cannot use your fingerprint?");
  ok("the way out brings back the authenticator code box", await until("code box", async () => /6-digit authenticator code/.test(await text())));
  const log2 = (await db.query("SELECT action FROM audit_log WHERE work_email=$1 AND action ILIKE '%pay%' ORDER BY id", [U2])).rows.map((x) => x.action).join("\n");
  ok("the log never holds a code or the key", !log2.includes(key) && !/000000|123456/.test(log2), log2);

  // ---- Person 3: a device with no fingerprint reader uses a PIN ----
  const t3 = await session(U3);
  await db.query("UPDATE sessions SET pay_recover_until = now() + interval '10 minutes' WHERE token_hash=$1", [sha(t3)]);
  await open(t3);
  await until("enrol screen", async () => /Set up your fingerprint/.test(await text()));
  await click("No fingerprint reader?");
  ok("the PIN is offered as a way out", await until("others", async () => /Use a PIN/.test(await text())));
  await click("Use a PIN");
  await until("pin screen", async () => /Choose your PIN/.test(await text()));
  await type("pay-pin-new", "123456"); await type("pay-pin-again", "123456"); await click("Save PIN and open Pay");
  ok("an easy PIN is refused with a reason", await until("weak", async () => /too easy to guess/.test(await text())));
  await type("pay-pin-new", "483920"); await type("pay-pin-again", "483921"); await click("Save PIN and open Pay");
  ok("two different PINs are refused", await until("mismatch", async () => /do not match/.test(await text())));
  await type("pay-pin-new", "483920"); await type("pay-pin-again", "483920"); await click("Save PIN and open Pay");
  ok("a good PIN opens Pay", await until("unlocked", async () => /Pay is unlocked/.test(await text())));
  await click("Lock Pay"); await until("locked", async () => /Pay is locked|Verify Your Identity/.test(await text()));
  await click("Unlock Pay");
  ok("the lock screen offers setting up the fingerprint first, with the PIN behind a link", await until("finger", async () => /Set up fingerprint on this device/.test(await text())) && !/6-digit PIN/.test(await text()) && /Use your PIN instead/.test(await text()));
  await click("Use your PIN instead");
  ok("the link brings the PIN box", await until("pin box", async () => /6-digit PIN/.test(await text())) && !/authenticator code/.test(await text()));
  await type("pay-code", "000111"); await click("Verify");
  ok("a wrong PIN is refused with the tries left", await until("tries", async () => /4 tries left/.test(await text())));
  await type("pay-code", "483920"); await click("Verify");
  ok("the right PIN unlocks Pay", await until("unlocked", async () => /Pay is unlocked/.test(await text())));
  await click("Lock Pay"); await until("locked", async () => /Pay is locked|Verify Your Identity/.test(await text()));
  await click("Unlock Pay");
  await until("finger", async () => /Set up fingerprint on this device/.test(await text()));
  await click("Set up fingerprint on this device");
  ok("the set-up button on the lock screen asks for the PIN once, to turn the fingerprint on", await until("notice", async () => /Setting up your fingerprint/.test(await text()) && /6-digit PIN/.test(await text())), (await text()).slice(-300));
  await type("pay-code", "483920"); await click("Verify");
  ok("PIN then touch: the fingerprint is registered right there and Pay opens", await until("registered", async () => (await db.query("SELECT count(*)::int AS n FROM pay_passkeys WHERE email=$1", [U3])).rows[0].n === 1) && await until("unlocked", async () => /Pay is unlocked/.test(await text())));
  await click("Lock Pay"); await until("locked", async () => /Pay is locked|Verify Your Identity/.test(await text()));
  await click("Unlock Pay");
  ok("next time the fingerprint button is there, not the set-up", await until("finger", async () => /Use fingerprint or Touch ID/.test(await text())) && !/Setting up your fingerprint/.test(await text()));
  await click("Use fingerprint or Touch ID");
  ok("and it unlocks with one touch, no PIN", await until("unlocked", async () => /Pay is unlocked/.test(await text())));
  await click("Security");
  ok("the Security panel offers to change the PIN and add the other ways", await until("panel", async () => /Change PIN/.test(await text()) && /Set up authenticator app/.test(await text())), (await text()).slice(0, 300));
  const log3 = (await db.query("SELECT action FROM audit_log WHERE work_email=$1 AND action ILIKE '%pay%' ORDER BY id", [U3])).rows.map((x) => x.action).join("\n");
  ok("the log never holds a PIN", !/483920|483921|123456|000111/.test(log3), log3);
} catch (e) { fail++; console.log("ERROR  " + e.stack); }
finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
  await db.query("DELETE FROM sessions WHERE lower(email) IN ($1,$2,$3)", [U1, U2, U3]);
  for (const t of ["pay_totp", "pay_passkeys", "pay_pin_otps", "pay_pins"]) await db.query(`DELETE FROM ${t} WHERE email IN ($1,$2,$3)`, [U1, U2, U3]);
  await db.query("DELETE FROM users WHERE email IN ($1,$2,$3)", [U1, U2, U3]);
  await db.query("DELETE FROM audit_log WHERE work_email IN ($1,$2,$3) AND action ILIKE '%pay%'", [U1, U2, U3]);
  await db.end();
  await wait(1000);   // Chrome is still writing to its profile for a moment after it is told to stop
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* a temp folder: the system clears it */ }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

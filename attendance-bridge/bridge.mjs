// Reads the office attendance device and sends new punches to the HR Access Hub. It only READS the device: it never clears or changes it.
//   npm start                      keep running, read every INTERVAL_SECONDS
//   npm run once                   read once and stop
//   npm run test-device            connect to the device and show what it holds; sends nothing
//   node bridge.mjs --from-file punches.json --once     send punches from a file instead of the device (to try the app side)
import "dotenv/config";
import fs from "node:fs";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n), arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const cfg = {
  ip: process.env.DEVICE_IP, port: Number(process.env.DEVICE_PORT || 4370), name: process.env.DEVICE_NAME || "device",
  app: String(process.env.APP_URL || "").replace(/\/+$/, ""), key: process.env.DEVICE_KEY || "",
  every: Math.max(30, Number(process.env.INTERVAL_SECONDS || 300)), from: process.env.SYNC_FROM || "",
};
const STATE = new URL("./bridge-state.json", import.meta.url);
const log = (...m) => console.log(new Date().toLocaleString("en-IN"), "-", ...m);
const p2 = (n) => String(n).padStart(2, "0");
/** The device's own wall-clock time as "YYYY-MM-DD HH:MM:SS". (The library builds the Date from the device's clock parts, so the local getters give back the device time.) */
const wall = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return {}; } };
const writeState = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
const startPoint = () => {
  const s = readState();
  if (s.lastSynced) return s.lastSynced;
  if (/^\d{4}-\d{2}-\d{2}$/.test(cfg.from)) return `${cfg.from} 00:00:00`;
  const d = new Date(Date.now() - 7 * 864e5); return `${wall(d).slice(0, 10)} 00:00:00`;
};

/** Every punch the device holds: [{ userId, time }]. */
async function readDevice() {
  const file = arg("--from-file");
  if (file) return JSON.parse(fs.readFileSync(file, "utf8")).map((p) => ({ userId: String(p.userId), time: String(p.time) }));
  if (!cfg.ip) throw new Error("Set DEVICE_IP in .env");
  const ZKLib = createRequire(import.meta.url)("node-zklib");
  // A big log (tens of thousands of punches) is sometimes cut short on the way, with no error. The device says how many it holds,
  // so a read that comes back much smaller is thrown away and tried again, rather than trusted.
  let last = 0, expected = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const zk = new ZKLib(cfg.ip, cfg.port, 10000, 4000);
    try {
      await zk.createSocket();
      expected = await zk.getInfo().then((i) => Number(i.logCounts) || 0).catch(() => 0);
      const logs = await zk.getAttendances();
      const out = (logs.data || []).map((l) => ({ userId: String(l.deviceUserId), time: wall(new Date(l.recordTime)) }));
      last = out.length;
      if (!expected || out.length >= expected * 0.98 || process.env.ALLOW_PARTIAL === "true") { out.expected = expected; return out; }
      log(`Read ${out.length} of the ${expected} punches the device holds (attempt ${attempt} of 3), trying again.`);
    } catch (e) {
      log(`Device read failed (attempt ${attempt} of 3): ${e && e.message ? e.message : e}`);
    } finally { try { await zk.disconnect(); } catch {} }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`The device read was incomplete (${last} of ${expected || "an unknown number of"} punches), so nothing was sent this round`);
}

async function send(punches) {
  const res = await fetch(`${cfg.app}/api/attendance/device/punches`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({ device: cfg.name, punches }), signal: AbortSignal.timeout(30000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${body.error || "the app refused the punches"}`);
  return body;
}

async function syncOnce() {
  const since = startPoint();
  const all = await readDevice();
  const fresh = all.filter((p) => p.time > since).sort((a, b) => (a.time < b.time ? -1 : 1));
  log(`Device holds ${all.length} punches, ${fresh.length} newer than ${since}.`);
  let added = 0, unmatched = new Set();
  for (let i = 0; i < fresh.length; i += 200) {
    const batch = fresh.slice(i, i + 200);
    const r = await send(batch);
    added += r.added; r.unmatchedIds.forEach((u) => unmatched.add(u));
    if (!arg("--from-file")) writeState({ lastSynced: batch[batch.length - 1].time, at: new Date().toISOString() });   // only after the app accepted the batch
  }
  if (fresh.length) log(`Sent ${fresh.length}: ${added} added${unmatched.size ? `, waiting for HR to link device IDs: ${[...unmatched].join(", ")}` : ""}.`);
}

async function main() {
  if (flag("--test")) {
    const all = await readDevice();
    log(`Connected. Read ${all.length} punches${all.expected ? ` (the device says it holds ${all.expected})` : ""}.`);
    const users = new Set(all.map((p) => p.userId));
    log(`${users.size} different device user IDs. The latest 5 punches:`);
    all.sort((a, b) => (a.time < b.time ? 1 : -1)).slice(0, 5).forEach((p) => console.log(`   user ${p.userId}  ${p.time}`));
    return;
  }
  if (!cfg.app || !cfg.key) throw new Error("Set APP_URL and DEVICE_KEY in .env");
  if (flag("--once") || arg("--from-file")) { await syncOnce(); return; }
  log(`Reading ${cfg.ip}:${cfg.port} every ${cfg.every} s and sending to ${cfg.app}. Press Ctrl+C to stop.`);
  for (;;) {
    try { await syncOnce(); } catch (e) { log("Skipped this round:", e.message); }   // device off or app unreachable: try again next time
    await new Promise((r) => setTimeout(r, cfg.every * 1000));
  }
}
main().catch((e) => { console.error("Stopped:", e.message); process.exit(1); });

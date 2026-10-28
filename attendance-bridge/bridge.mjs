// Reads the office attendance device and sends new punches to the HR Access Hub. It only READS the device: it never clears or changes it.
//   npm start                      keep running, read every INTERVAL_SECONDS
//   npm run once                   read once and stop
//   npm run test-device            connect to the device and show what it holds; sends nothing
//   run.bat --users               list every user on the device (ID and name) and save it to device-users.txt; sends nothing
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

const RECORD = 40;   // bytes per punch in the device's log

/** Reads only the newest `want` punches from the device, one chunk at a time, instead of downloading the whole log (about 70,000 punches).
    The log is one long byte stream (a 4-byte header, then 40 bytes per punch, oldest first) that the device hands out in chunks of MAX_CHUNK bytes.
    This asks for the last few chunks only. It uses the same chunk framing as the node-zklib library. Returns { records, total }. */
async function readNewest(zk, want) {
  const req = createRequire(import.meta.url);
  const { MAX_CHUNK, COMMANDS, REQUEST_DATA } = req("node-zklib/constants");
  const { createTCPHeader, decodeTCPHeader, decodeRecordData40, checkNotEventTCP } = req("node-zklib/utils");
  const t = zk.zklibTcp;
  if (!t || !t.socket) throw new Error("no TCP connection to the device");

  const chunk = (start, size) => new Promise((resolve, reject) => {
    let total = Buffer.alloc(0), real = Buffer.alloc(0), timer = null;
    const done = (err, data) => { clearTimeout(timer); t.socket.removeListener("data", onData); err ? reject(err) : resolve(data); };
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => done(new Error("the device stopped answering")), 20000); };
    const onData = (reply) => {
      if (checkNotEventTCP(reply)) return;
      arm();
      total = Buffer.concat([total, reply]);
      const packetLength = total.readUIntLE(4, 2);
      if (total.length >= 8 + packetLength) {
        real = Buffer.concat([real, total.subarray(16, 8 + packetLength)]);
        total = total.subarray(8 + packetLength);
        if (real.length === size + 8) done(null, real.subarray(8));
      }
    };
    t.socket.on("data", onData);
    arm();
    t.sendChunkRequest(start, size);
  });

  await t.freeData();
  t.replyId++;
  const reply = await t.requestData(createTCPHeader(COMMANDS.CMD_DATA_WRRQ, t.sessionId, t.replyId, REQUEST_DATA.GET_ATTENDANCE_LOGS));
  const head = decodeTCPHeader(reply.subarray(0, 16));
  let stream, base = 0, total;
  if (head.commandId === COMMANDS.CMD_DATA) {                // a small log: it all came in one go
    stream = reply.subarray(16); total = Math.floor((stream.length - 4) / RECORD);
  } else if (head.commandId === COMMANDS.CMD_ACK_OK || head.commandId === COMMANDS.CMD_PREPARE_DATA) {
    const size = reply.subarray(16).readUIntLE(1, 4);
    total = Math.floor((size - 4) / RECORD);
    const startByte = 4 + Math.max(0, total - want) * RECORD;
    const firstChunk = Math.floor(startByte / MAX_CHUNK), lastFull = Math.floor(size / MAX_CHUNK), remain = size % MAX_CHUNK;
    const parts = [];
    for (let c = firstChunk; c < lastFull; c++) parts.push(await chunk(c * MAX_CHUNK, MAX_CHUNK));
    if (remain > 0) parts.push(await chunk(lastFull * MAX_CHUNK, remain));
    stream = Buffer.concat(parts); base = firstChunk * MAX_CHUNK;
  } else throw new Error(`the device answered with an unexpected reply (${head.commandId})`);
  try { await t.freeData(); } catch {}

  const first = base === 0 ? 4 : (RECORD - ((base - 4) % RECORD)) % RECORD;   // the first whole punch inside this piece of the stream
  const records = [];
  for (let i = first; i + RECORD <= stream.length; i += RECORD) records.push(decodeRecordData40(stream.subarray(i, i + RECORD)));
  return { records, total };
}

/** The punches from `since` on, reading only the newest part of the log (widening it until it reaches back past `since`). Retries on errors. */
async function readSince(since) {
  const ZKLib = createRequire(import.meta.url)("node-zklib");
  let want = 4000, lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const zk = new ZKLib(cfg.ip, cfg.port, 30000, 4000);
    try {
      await zk.createSocket();
      for (;;) {
        const { records, total } = await readNewest(zk, want);
        const out = records.map((l) => ({ userId: String(l.deviceUserId), time: wall(new Date(l.recordTime)) }));
        const good = out.filter((p) => /^\d+$/.test(p.userId) && p.time >= "2015-01-01");
        if (out.length && good.length < out.length * 0.9) throw new Error(`the newest part of the log came back unreadable (${out.length - good.length} of ${out.length} records blank or dated before 2015)`);
        const oldest = out.reduce((m, p) => (p.time < m ? p.time : m), "9999");
        if (out.length < total && oldest > since && want < total) { want = Math.min(total, want * 4); continue; }   // not far enough back yet: read more
        out.expected = total; out.newestOnly = out.length < total;
        return out;
      }
    } catch (e) {
      lastError = e && e.message ? e.message : String(e);
      log(`Reading the newest punches failed (attempt ${attempt} of 3): ${lastError}`);
    } finally { try { await zk.disconnect(); } catch {} }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(lastError || "could not read the newest punches");
}

/** Every punch the device holds: [{ userId, time }]. */
async function readDevice() {
  const file = arg("--from-file");
  if (file) return JSON.parse(fs.readFileSync(file, "utf8")).map((p) => ({ userId: String(p.userId), time: String(p.time) }));
  if (!cfg.ip) throw new Error("Set DEVICE_IP in .env");
  if (process.env.TAIL_READ === "true") {   // experimental: reading only the newest chunks. Off by default, because it returned blank records on the office device.
    try { return await readSince(startPoint()); }
    catch (e) { log(`Could not read just the newest punches (${e.message}). Reading the whole log instead.`); }
  }
  const ZKLib = createRequire(import.meta.url)("node-zklib");
  // A big log (tens of thousands of punches) is often cut short on the way. The library reports that in `err` ("TIME OUT !! n PACKETS REMAIN")
  // but still hands back what it got, so a read with an error is thrown away and tried again, never trusted. The device's own count is a second check.
  let last = 0, expected = 0, why = "";
  for (let attempt = 1; attempt <= 5; attempt++) {
    const zk = new ZKLib(cfg.ip, cfg.port, 30000, 4000);
    try {
      await zk.createSocket();
      expected = await zk.getInfo().then((i) => Number(i.logCounts) || 0).catch(() => 0);
      const logs = await zk.getAttendances();
      const out = (logs.data || []).map((l) => ({ userId: String(l.deviceUserId), time: wall(new Date(l.recordTime)) }));
      last = out.length;
      if (logs.err) why = `the device stopped sending: ${logs.err.message || logs.err}`;
      else if (expected && out.length < expected * 0.98) why = `only ${out.length} of the ${expected} punches the device holds arrived`;
      else { out.expected = expected; return out; }
      if (process.env.ALLOW_PARTIAL === "true" && out.length) { out.expected = expected; return out; }
      log(`Incomplete read (attempt ${attempt} of 5): ${why}. Trying again.`);
    } catch (e) {
      why = e && e.message ? e.message : String(e);
      log(`Device read failed (attempt ${attempt} of 5): ${why}`);
    } finally { try { await zk.disconnect(); } catch {} }
    await new Promise((r) => setTimeout(r, 10000));
  }
  throw new Error(`The device read was incomplete (${last} punches arrived; ${why}), so nothing was sent this round`);
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

/** Prints every user stored on the device (ID and name) so HR can match IDs to people. Reads only. */
async function listUsers() {
  if (!cfg.ip) throw new Error("Set DEVICE_IP in .env");
  const ZKLib = createRequire(import.meta.url)("node-zklib");
  const zk = new ZKLib(cfg.ip, cfg.port, 10000, 4000);
  try {
    await zk.createSocket();
    const res = await zk.getUsers();
    const rows = (res.data || []).map((u) => ({ id: String(u.userId), name: String(u.name || "").replace(/\0/g, "").trim() }))
      .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
    const text = rows.map((r) => `${r.id}\t${r.name}`).join("\n");
    fs.writeFileSync(new URL("./device-users.txt", import.meta.url), text + "\n");
    log(`The device has ${rows.length} users. Saved to device-users.txt. ID, then name:`);
    console.log(text);
  } finally { try { await zk.disconnect(); } catch {} }
}

async function main() {
  if (flag("--users")) { await listUsers(); return; }
  if (flag("--test")) {
    const all = await readDevice();
    log(all.newestOnly ? `Connected. Read the newest ${all.length} punches (the device holds ${all.expected}).` : `Connected. Read ${all.length} punches${all.expected ? ` (the device says it holds ${all.expected})` : ""}.`);
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

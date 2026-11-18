// Log viewer for the attendance connector, to open on the admin computer (it only reads bridge-events.jsonl and bridge-state.json).
//   view-logs.bat   or   npm run logs      then open http://localhost:4010
// It listens on this computer only (127.0.0.1), so nobody else on the network can open it. It changes nothing.
import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.VIEWER_PORT || 4010);
const EVENTS = new URL("./bridge-events.jsonl", import.meta.url), PUNCHES = new URL("./bridge-punches.jsonl", import.meta.url), STATE = new URL("./bridge-state.json", import.meta.url);
const read = (f = EVENTS) => { try { return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
let busy = false;   // one button action at a time
const info = () => ({
  device: process.env.DEVICE_NAME || "device", ip: process.env.DEVICE_IP || "", port: process.env.DEVICE_PORT || "4370", app: process.env.APP_URL || "",
  state: (() => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return {}; } })(),
  last: read().filter((e) => e.kind === "resync").pop() || null,
  file: fs.existsSync(EVENTS) || fs.existsSync(PUNCHES),
});

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wohlig Attendance Sync</title><style>
*{box-sizing:border-box}body{margin:0;font:14px/1.4 "Segoe UI",Lato,Arial,sans-serif;color:#2b2b3a;background:#fff;display:flex;min-height:100vh}
nav{width:200px;background:#2b3147;color:#fff;flex:none}nav .brand{background:#4a3a52;padding:22px;font-size:22px;font-weight:700;height:110px;display:flex;align-items:center}
nav button{display:block;width:100%;background:none;border:0;color:#fff;padding:20px;font:inherit;text-align:center;cursor:pointer}nav button.on{background:#3b415a}
main{flex:1;min-width:0}header{background:#b5397a;color:#fff;padding:0 24px;height:110px;display:flex;align-items:center;justify-content:space-between}
header h1{margin:0;font-size:28px;font-weight:400}header small{display:block;font-size:12px;opacity:.85}header b{font-size:17px;font-weight:600}
.tabs{display:flex;gap:8px;padding:0 24px;border-bottom:1px solid #e4e4ea}.tabs button{background:none;border:0;border-bottom:4px solid transparent;padding:22px 28px 14px;font:inherit;font-size:13px;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;color:#333}
.tabs button.on{border-color:#b5397a}.body{padding:24px}.bar{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:22px}
input[type=date],input[type=search]{border:1px solid #bbb;padding:9px 12px;font:inherit;background:#fff}.btn{background:#b5397a;color:#fff;border:0;padding:11px 36px;font:inherit;cursor:pointer}
.total{margin:0 0 12px}.total b{margin-left:6px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:13px 16px;border:1px solid #e4e4ea;vertical-align:top}
th{font-weight:400;background:#fafafc}td.msg{word-break:break-word}td:nth-child(2),td:nth-child(3){white-space:nowrap}.Error{color:#b3261e;font-weight:600}.Warning{color:#a15c00;font-weight:600}.Failed{color:#b3261e;font-weight:600}.Synced{color:#1b7a3a;font-weight:600}
.empty{padding:40px;text-align:center;color:#777;border:1px solid #e4e4ea;border-top:0}.hide{display:none}.lnk{background:none;border:0;color:#b5397a;font:inherit;cursor:pointer;padding:2px 0;text-align:left}.lnk:hover{text-decoration:underline}.lnk:disabled{color:#aaa;cursor:wait}.sm{font-size:12px;font-weight:600;margin-bottom:2px}.actout{margin:16px 0 0;white-space:pre-wrap;font:13px/1.5 Consolas,monospace}.actout:empty{display:none}
@media(max-width:800px){nav{width:120px}table{font-size:12px}}
</style></head><body>
<nav><div class="brand">Attendance</div><button id="n-dev" class="on">Devices</button><button id="n-log">Logs</button></nav>
<main><header><h1>Attendance Sync</h1><div><small>DEVICE</small><b id="hd">-</b></div></header>
<section id="dev"><div class="tabs"><button class="on">Devices</button></div><div class="body"><table><thead><tr><th>Device</th><th>Integration</th><th>Address</th><th>Last clock entry</th><th>Device connection</th><th>Actions</th></tr></thead><tbody id="devrows"></tbody></table><pre class="actout" id="actout"></pre></div></section>
<section id="log" class="hide"><div class="tabs"><button id="t-pu" class="on">Punches</button><button id="t-re">Resync logs</button><button id="t-ev">Event viewer</button></div>
<div class="body"><div class="bar"><label>From Date <input type="date" id="from"></label><label>To Date <input type="date" id="to"></label><button class="btn" id="get">Get Logs</button><input type="search" id="q" placeholder="Search" style="margin-left:auto"></div>
<pre class="actout" id="actout2"></pre><p class="total">Total Logs: <b id="total">0</b></p><table><thead id="head"></thead><tbody id="rows"></tbody></table><div class="empty hide" id="empty">No logs for these dates.</div></div></section></main>
<script>
const $=(i)=>document.getElementById(i);let kind="punch",data=[];
const day=(d)=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const when=(iso)=>{if(!iso)return"-";const d=new Date(iso);return d.toLocaleTimeString("en-US")+" "+d.getDate()+" "+d.toLocaleString("en-US",{month:"short"})};
const punchTime=(w)=>{const d=new Date(String(w).replace(" ","T"));return isNaN(d)?w:d.getDate()+" "+d.toLocaleString("en-US",{month:"short"})+" "+d.getFullYear()+", "+d.toLocaleTimeString("en-US")};
const cell=(t,c)=>{const e=document.createElement("td");e.textContent=t;if(c)e.className=c;return e};
const today=new Date(),tom=new Date(Date.now()+864e5);$("from").value=day(today);$("to").value=day(tom);
function show(w){$("dev").classList.toggle("hide",w!=="dev");$("log").classList.toggle("hide",w!=="log");$("n-dev").classList.toggle("on",w==="dev");$("n-log").classList.toggle("on",w==="log");if(w==="log")load()}
$("n-dev").onclick=()=>show("dev");$("n-log").onclick=()=>show("log");
const tabs={punch:"t-pu",resync:"t-re",event:"t-ev"};
Object.entries(tabs).forEach(([k,i])=>{$(i).onclick=()=>{kind=k;Object.values(tabs).forEach((t)=>$(t).classList.toggle("on",t===i));load()}});
$("get").onclick=async()=>{   // on the Punches tab, Get Logs reads the device itself for the chosen dates, then shows them
  if(kind==="punch"){await act("/api/day?from="+$("from").value+"&to="+$("to").value,"Reading the device for "+$("from").value+" to "+$("to").value+"... this can take about a minute.",[$("get")],"actout2");$("get").disabled=false}
  load()};$("q").oninput=draw;
async function load(){const r=await fetch("/api/logs?kind="+kind+"&from="+$("from").value+"&to="+$("to").value);data=await r.json();
$("empty").textContent="No logs for these dates.";if(!data.length){const d=await(await fetch("/api/info")).json();if(!d.file)$("empty").textContent="No log file yet. The connector has not written any entries. Stop it, copy the updated files into this folder, start it again with run.bat, wait a minute, then press Get Logs."}draw()}
function draw(){const q=$("q").value.trim().toLowerCase(),head=$("head"),rows=$("rows");rows.textContent="";head.textContent="";
const cols=kind==="punch"?["Index","Device user ID","Punch time","Device","Status","Received at"]:kind==="event"?["Index","Source","Time Generated","Event Type","Message"]:["Index","Time Generated","Device","On device","New punches","Added","Not linked","Status","Details"];
const tr=document.createElement("tr");cols.forEach((c)=>{const th=document.createElement("th");th.textContent=c;tr.appendChild(th)});head.appendChild(tr);
const list=data.filter((e)=>!q||JSON.stringify(e).toLowerCase().includes(q));$("total").textContent=list.length;$("empty").classList.toggle("hide",list.length>0);
list.forEach((e,i)=>{const r=document.createElement("tr");r.appendChild(cell(i+1));
if(kind==="punch"){r.appendChild(cell(e.userId));r.appendChild(cell(punchTime(e.time)));r.appendChild(cell(e.device||"-"));r.appendChild(cell(e.status,/^Sent|^On device/.test(e.status)?"Synced":"Warning"));r.appendChild(cell(when(e.at)))}
else if(kind==="event"){r.appendChild(cell(e.source||"Attendance Connector"));r.appendChild(cell(when(e.at)));r.appendChild(cell(e.type,e.type));r.appendChild(cell(e.message,"msg"))}
else{r.appendChild(cell(when(e.at)));r.appendChild(cell(e.device||"-"));r.appendChild(cell(e.onDevice??"-"));r.appendChild(cell(e.fresh??"-"));r.appendChild(cell(e.added??"-"));r.appendChild(cell(e.unlinked??"-"));r.appendChild(cell(e.status,e.status));r.appendChild(cell(e.message||"","msg"))}
rows.appendChild(r)})}
const link=(t,fn)=>{const a=document.createElement("button");a.type="button";a.textContent=t;a.className="lnk";a.onclick=fn;return a};
const two=(small,cls,btn)=>{const e=document.createElement("td");const s=document.createElement("div");s.textContent=small;s.className="sm "+(cls||"");e.appendChild(s);e.appendChild(btn);return e};
async function act(path,msg,btns,outId){const out=$(outId||"actout");btns.forEach((b)=>b.disabled=true);out.className="actout";out.textContent=msg;
try{const r=await(await fetch(path,{method:"POST",headers:{"X-Requested-With":"viewer"}})).json();out.className="actout "+(r.ok?"Synced":"Failed");out.textContent=r.output}catch{out.className="actout Failed";out.textContent="Could not reach the viewer."}
dev();}
async function dev(){const d=await(await fetch("/api/info")).json();$("hd").textContent=d.device+(d.ip?" ("+d.ip+")":"");const r=$("devrows");r.textContent="";const t=document.createElement("tr");
const ok=d.last&&d.last.status==="Synced";t.appendChild(cell(d.device));t.appendChild(cell("SDK (ZkemSDK)"));t.appendChild(cell(d.ip?d.ip+":"+d.port:"-"));
t.appendChild(cell(d.state.lastSynced?when(d.state.lastSynced.replace(" ","T")):"-"));
const c=link("Connect to Device",()=>act("/api/connect","Connecting to the device...",[c,s]));
const s=link("Sync Now",()=>act("/api/sync","Syncing...",[c,s]));
t.appendChild(two(d.last?(ok?"Connected":"Not connected"):"Not checked yet",ok?"Synced":d.last?"Failed":"",c));
t.appendChild(two(d.last?(ok?"Synced "+when(d.last.at):"Not synced"):"Not synced",ok?"Synced":"Failed",s));r.appendChild(t)}
dev();setInterval(dev,30000);
</script></body></html>`;

http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  const send = (code, type, body) => { res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); res.end(body); };
  // The two buttons on the Devices page start the connector's own commands. Only a page served by this program may do that.
  const okHost = /^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host || ""), okOrigin = !req.headers.origin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(req.headers.origin);
  if (req.method === "POST" && (u.pathname === "/api/connect" || u.pathname === "/api/sync" || u.pathname === "/api/day")) {
    if (!okHost || !okOrigin || req.headers["x-requested-with"] !== "viewer") return send(403, "application/json", JSON.stringify({ ok: false, output: "Not allowed." }));
    if (busy) return send(409, "application/json", JSON.stringify({ ok: false, output: "Another action is still running. Wait for it to finish." }));
    if (u.pathname === "/api/day" && !fs.readFileSync(new URL("./bridge.mjs", import.meta.url), "utf8").includes('"--log-day"'))   // an old bridge.mjs would ignore the flag and start syncing forever
      return send(200, "application/json", JSON.stringify({ ok: false, output: "The bridge.mjs in this folder is the old version and cannot load a day. Copy the new bridge.mjs into this folder, stop the connector, start it again with run.bat, then try again." }));
    busy = true;
    const child = spawn(process.execPath, ["bridge.mjs", ...(u.pathname === "/api/connect" ? ["--test"] : u.pathname === "/api/day" ? ["--log-day", u.searchParams.get("from") || "today", u.searchParams.get("to") || ""] : ["--once"])], { cwd: fileURLToPath(new URL(".", import.meta.url)), windowsHide: true });
    let out = "", done = false;
    const finish = (ok, extra) => { if (done) return; done = true; busy = false; clearTimeout(timer); const lines = (out + (extra || "")).trim().split("\n").slice(-6).join("\n"); send(200, "application/json", JSON.stringify({ ok, output: lines || (ok ? "Done." : "No output.") })); };
    const timer = setTimeout(() => { child.kill(); finish(false, "\nStopped: it took longer than 5 minutes."); }, 300000);
    child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
    child.on("error", (e) => finish(false, `Could not start: ${e.message}`));
    child.on("close", (code) => finish(code === 0));
    return;
  }
  if (req.method !== "GET") return send(405, "text/plain", "Not allowed");
  if (u.pathname === "/") return send(200, "text/html; charset=utf-8", PAGE);
  if (u.pathname === "/api/info") return send(200, "application/json", JSON.stringify(info()));
  if (u.pathname === "/api/logs") {
    const kind = ["resync", "punch"].includes(u.searchParams.get("kind")) ? u.searchParams.get("kind") : "event";
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const fromD = day.test(u.searchParams.get("from") || "") ? u.searchParams.get("from") : "0000-01-01", toD = day.test(u.searchParams.get("to") || "") ? u.searchParams.get("to") : "9999-12-31";
    let out;
    if (kind === "punch") {   // punches are filtered on the time the device recorded and listed by device user ID, then time
      out = read(PUNCHES).filter((p) => p.time >= `${fromD} 00:00:00` && p.time <= `${toD} 23:59:59`).sort((a, b) => (Number(a.userId) - Number(b.userId)) || (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)).slice(0, 5000);
    } else {
      const f = new Date(`${fromD}T00:00:00`), t = new Date(`${toD}T23:59:59.999`);
      out = read().filter((e) => e.kind === kind && new Date(e.at) >= f && new Date(e.at) <= t).reverse();
    }
    return send(200, "application/json", JSON.stringify(out));
  }
  send(404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Log viewer: http://localhost:${PORT}  (press Ctrl+C to close)`));

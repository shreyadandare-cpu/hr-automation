// Log viewer for the attendance connector, to open on the admin computer (it only reads bridge-events.jsonl and bridge-state.json).
//   view-logs.bat   or   npm run logs      then open http://localhost:4010
// It listens on this computer only (127.0.0.1), so nobody else on the network can open it. It changes nothing.
import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.VIEWER_PORT || 4010);
const EVENTS = new URL("./bridge-events.jsonl", import.meta.url), PUNCHES = new URL("./bridge-punches.jsonl", import.meta.url), STATE = new URL("./bridge-state.json", import.meta.url);
const read = (f = EVENTS) => { try { return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const ENV = fileURLToPath(new URL("./.env", import.meta.url));
/** Sets KEY=value lines in .env (adds a line when missing) and leaves every other line, including the secrets, exactly as they are. */
function setEnv(updates) {
  let text = ""; try { text = fs.readFileSync(ENV, "utf8"); } catch { /* a new file */ }
  const eol = text.includes("\r\n") ? "\r\n" : "\n", seen = new Set();
  const out = text.split(/\r?\n/).map((l) => { const m = /^\s*([A-Z_]+)\s*=/.exec(l); if (m && m[1] in updates) { seen.add(m[1]); return `${m[1]}=${updates[m[1]]}`; } return l; });
  for (const k of Object.keys(updates)) if (!seen.has(k)) { if (out.length && out[out.length - 1] === "") out.splice(out.length - 1, 0, `${k}=${updates[k]}`); else out.push(`${k}=${updates[k]}`); }
  fs.writeFileSync(ENV + ".tmp", out.join(eol)); fs.renameSync(ENV + ".tmp", ENV);   // written whole, so a crash cannot leave half a file
  for (const [k, val] of Object.entries(updates)) process.env[k] = val;
}
const ipOk = (ip) => (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split(".").every((n) => Number(n) <= 255)) || /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(ip);
const portOk = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;
const appOk = (u) => /^(https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)$/.test(u);   // where the device key is sent: https, or this computer for tests
/** The details people may edit here, checked strictly. Only the fields that were sent are changed. The device key can be replaced but is never shown. */
function cleanSettings(b) {
  const u = {}, bad = (error) => ({ error }), has = (k) => b[k] !== undefined;
  if (has("name")) { const x = String(b.name).trim(); if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/.test(x)) return bad("Give the device a name: letters, numbers, space . _ - only, up to 40 characters."); u.DEVICE_NAME = x; }
  if (has("ip")) { const x = String(b.ip).trim(); if (!ipOk(x)) return bad("Enter the device's IP address, like 192.168.1.12."); u.DEVICE_IP = x; }
  if (has("port")) { const x = Number(b.port); if (!portOk(x)) return bad("The port is a number from 1 to 65535 (usually 4370)."); u.DEVICE_PORT = String(x); }
  const kindOk = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/;
  if (has("opType")) { const x = String(b.opType).trim(); if (x && !kindOk.test(x)) return bad("Operating type: letters, numbers, space . _ - only, up to 40 characters."); u.DEVICE_OPERATING_TYPE = x; }
  if (has("sdkType")) { const x = String(b.sdkType).trim(); if (x && !kindOk.test(x)) return bad("Device SDK type: letters, numbers, space . _ - only, up to 40 characters."); u.DEVICE_SDK_TYPE = x; }
  if (has("number")) { const x = String(b.number).trim(); if (x && !/^\d{1,4}$/.test(x)) return bad("Device number is a number up to 4 digits, like 1."); u.DEVICE_NUMBER = x; }
  if (has("mac")) { const x = String(b.mac).trim().toUpperCase().replace(/-/g, ":"); if (x && !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(x)) return bad("MAC address looks like 00:1A:2B:3C:4D:5E, or leave it empty."); u.DEVICE_MAC = x; }
  if (has("interval")) { const x = Number(b.interval); if (!Number.isInteger(x) || x < 30 || x > 86400) return bad("Sync every: a number of seconds from 30 to 86400."); u.INTERVAL_SECONDS = String(x); }
  if (has("from")) { const x = String(b.from).trim(); if (x && !/^\d{4}-\d{2}-\d{2}$/.test(x)) return bad("Start date must look like 2026-10-01, or be empty."); u.SYNC_FROM = x; }
  if (has("appUrl")) { const x = String(b.appUrl).trim().replace(/\/+$/, ""); if (!appOk(x)) return bad("Enter the HR app address, like https://hr.wohlig.com."); u.APP_URL = x; }
  if (has("key") && String(b.key).trim()) { const x = String(b.key).trim(); if (!/^[A-Za-z0-9._~+\/=-]{8,200}$/.test(x)) return bad("The device key must be 8 to 200 letters, numbers or . _ ~ + / = - with no spaces."); u.DEVICE_KEY = x; }
  return Object.keys(u).length ? { updates: u } : bad("There is nothing to save.");
}
/* What was typed and saved in the two type boxes is remembered here, so the boxes can suggest it next time. Nothing is suggested until something was saved. */
const PREFS = fileURLToPath(new URL("./viewer-prefs.json", import.meta.url));
const prefs = () => { try { const p = JSON.parse(fs.readFileSync(PREFS, "utf8")); return { ops: Array.isArray(p.ops) ? p.ops : [], sdks: Array.isArray(p.sdks) ? p.sdks : [] }; } catch { return { ops: [], sdks: [] }; } };
const remember = (updates) => {
  const p = prefs(), add = (list, x) => (x ? [x, ...list.filter((y) => y.toLowerCase() !== x.toLowerCase())].slice(0, 8) : list);
  p.ops = add(p.ops, updates.DEVICE_OPERATING_TYPE); p.sdks = add(p.sdks, updates.DEVICE_SDK_TYPE);
  try { fs.writeFileSync(PREFS, JSON.stringify(p)); } catch { /* suggestions are a convenience: never block a save */ }
};
let busy = false;   // one button action at a time
const info = () => ({
  device: process.env.DEVICE_NAME || "device", opType: process.env.DEVICE_OPERATING_TYPE || "", sdkType: process.env.DEVICE_SDK_TYPE || "", number: process.env.DEVICE_NUMBER || "", ip: process.env.DEVICE_IP || "", port: process.env.DEVICE_PORT || "4370", app: process.env.APP_URL || "",
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
.empty{padding:40px;text-align:center;color:#777;border:1px solid #e4e4ea;border-top:0}.hide{display:none}.modal{position:fixed;inset:0;background:rgba(30,30,45,.4);display:flex;align-items:center;justify-content:center;z-index:9}.modal.hide{display:none}.dlg{background:#fff;width:min(700px,94vw);max-height:94vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.25)}.dlgbar{display:flex;justify-content:space-between;align-items:center;padding:12px 18px}.dlgbar button{background:none;border:0;font-size:18px;cursor:pointer;color:#333}.dlg form{padding:6px 34px 30px}.dlg h2,.set h2{margin:6px 0 22px;font-size:20px;font-weight:400}.frow{display:grid;grid-template-columns:170px 1fr;gap:14px;align-items:center;margin-bottom:14px}.frow label{color:#333}.frow input,.frow select{width:100%;border:1px solid #bbb;padding:11px 12px;font:inherit;color:#222;background:#fff}.frow small{display:block;margin-top:4px;color:#777;font-size:12px}.btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}.btns .btn{padding:11px 20px}.set{max-width:760px}
.lnk{background:none;border:0;color:#b5397a;font:inherit;cursor:pointer;padding:2px 0;text-align:left}.lnk:hover{text-decoration:underline}.lnk:disabled{color:#aaa;cursor:wait}.sm2{font-size:12px;color:#777;margin-top:2px}.sm{font-size:12px;font-weight:600;margin-bottom:2px}.actout{margin:16px 0 0;white-space:pre-wrap;font:13px/1.5 Consolas,monospace}.actout:empty{display:none}
@media(max-width:800px){nav{width:120px}table{font-size:12px}}
</style></head><body>
<nav><div class="brand">Attendance</div><button id="n-dev" class="on">Devices</button><button id="n-set">Settings</button><button id="n-log">Logs</button></nav>
<main><header><h1>Attendance Sync</h1><div><small>DEVICE</small><b id="hd">-</b></div></header>
<section id="dev"><div class="tabs"><button class="on">Devices</button></div><div class="body"><table><thead><tr><th>Device</th><th>Integration</th><th>Address</th><th>Last clock entry</th><th>Device connection</th><th>Actions</th></tr></thead><tbody id="devrows"></tbody></table><pre class="actout" id="actout"></pre></div></section>
<section id="set" class="hide"><div class="tabs"><button class="on">Sync settings</button></div><div class="body"><form class="set" id="s-form" autocomplete="off"><h2>Sync Configuration</h2>
<div class="frow"><label for="s-app">HR app address</label><input id="s-app" maxlength="200"></div>
<div class="frow"><label for="s-key">Device key</label><div><input id="s-key" type="password" placeholder="Leave empty to keep the current key" maxlength="200"><small id="s-keynote"></small></div></div>
<div class="frow"><label for="s-int">Sync every (seconds)</label><div><input id="s-int" inputmode="numeric" maxlength="5"><small>How often the device is read. 300 means every 5 minutes.</small></div></div>
<div class="frow"><label for="s-from">Start from date</label><div><input id="s-from" type="date"><small>Used only the first time, before anything has been synced.</small></div></div>
<div class="frow"><span></span><div class="btns"><button type="button" class="btn" id="s-test">Test Connection</button><button type="submit" class="btn" id="s-save">Save</button></div></div>
<pre class="actout" id="s-out"></pre></form></div></section>
<section id="log" class="hide"><div class="tabs"><button id="t-pu" class="on">Punches</button><button id="t-re">Resync logs</button><button id="t-ev">Event viewer</button></div>
<div class="body"><div class="bar"><label>From Date <input type="date" id="from"></label><label>To Date <input type="date" id="to"></label><button class="btn" id="get">Get Logs</button><input type="search" id="q" placeholder="Search" style="margin-left:auto"></div>
<pre class="actout" id="actout2"></pre><p class="total">Total Logs: <b id="total">0</b></p><table><thead id="head"></thead><tbody id="rows"></tbody></table><div class="empty hide" id="empty">No logs for these dates.</div></div></section></main>
<div class="modal hide" id="modal"><div class="dlg" role="dialog" aria-label="Edit Device"><div class="dlgbar"><span>Device Manager</span><button type="button" id="f-x" aria-label="Close">&#10005;</button></div>
<form id="form" autocomplete="off"><h2>Edit Device</h2>
<div class="frow"><label for="f-op">Operating Type</label><div><input id="f-op" list="dl-op" maxlength="40" placeholder="SDK" autocomplete="off"><datalist id="dl-op"></datalist></div></div>
<div class="frow"><label for="f-sdk">Device SDK Type</label><div><input id="f-sdk" list="dl-sdk" maxlength="40" placeholder="ZkemSDK" autocomplete="off"><datalist id="dl-sdk"></datalist><small>The connector reads eSSL / ZKTeco devices (SDK, ZkemSDK). Other names are only recorded here.</small></div></div>
<div class="frow"><label for="f-name">Device Name</label><input id="f-name" maxlength="40"></div>
<div class="frow"><label for="f-no">Device Number</label><input id="f-no" inputmode="numeric" maxlength="4"></div>
<div class="frow"><label for="f-ip">IP Address</label><input id="f-ip" maxlength="253"></div>
<div class="frow"><label for="f-port">Port</label><input id="f-port" inputmode="numeric" maxlength="5"></div>
<div class="frow"><label for="f-mac">MAC Address</label><input id="f-mac" maxlength="17" placeholder="Device Mac Address"></div>
<div class="frow"><span></span><div class="btns"><button type="button" class="btn" id="f-ping">Ping Device</button><button type="button" class="btn" id="f-test">Test Connection</button><button type="submit" class="btn" id="f-save">Update Device</button></div></div>
<pre class="actout" id="f-out"></pre></form></div></div>
<script>
const $=(i)=>document.getElementById(i);let kind="punch",data=[];
const day=(d)=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const when=(iso)=>{if(!iso)return"-";const d=new Date(iso);return d.toLocaleTimeString("en-US")+" "+d.getDate()+" "+d.toLocaleString("en-US",{month:"short"})};
const punchTime=(w)=>{const d=new Date(String(w).replace(" ","T"));return isNaN(d)?w:d.getDate()+" "+d.toLocaleString("en-US",{month:"short"})+" "+d.getFullYear()+", "+d.toLocaleTimeString("en-US")};
const cell=(t,c)=>{const e=document.createElement("td");e.textContent=t;if(c)e.className=c;return e};
const today=new Date(),tom=new Date(Date.now()+864e5);$("from").value=day(today);$("to").value=day(tom);
function show(w){["dev","set","log"].forEach((k)=>{$(k).classList.toggle("hide",w!==k);$("n-"+k).classList.toggle("on",w===k)});if(w==="log")load();if(w==="set")loadSet()}
$("n-dev").onclick=()=>show("dev");$("n-set").onclick=()=>show("set");$("n-log").onclick=()=>show("log");
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
const H={"X-Requested-With":"viewer","Content-Type":"application/json"},enc=encodeURIComponent;
const say=(el,ok,t)=>{el.className="actout "+(ok===null?"":ok?"Synced":"Failed");el.textContent=t};
const postJson=async(path,body)=>{const r=await fetch(path,{method:"POST",headers:H,body:body?JSON.stringify(body):undefined});return {ok:r.ok,j:await r.json()}};
async function restart(out,prefix){say(out,null,"Restarting the connector...");const q=(await postJson("/api/restart")).j;say(out,q.ok,prefix+q.output);dev()}
const fillList=(id,list)=>{const dl=$(id);dl.textContent="";(list||[]).forEach((x)=>{const o=document.createElement("option");o.value=x;dl.appendChild(o)})};
async function openEdit(){$("f-out").textContent="";const s=await(await fetch("/api/settings")).json();$("f-op").value=s.opType;$("f-sdk").value=s.sdkType;fillList("dl-op",s.ops);fillList("dl-sdk",s.sdks);$("f-name").value=s.name;$("f-no").value=s.number;$("f-ip").value=s.ip;$("f-port").value=s.port;$("f-mac").value=s.mac;$("modal").classList.remove("hide");$("f-name").focus()}
const closeEdit=()=>$("modal").classList.add("hide");
$("f-x").onclick=closeEdit;$("modal").onclick=(e)=>{if(e.target.id==="modal")closeEdit()};
const fbtns=()=>["f-ping","f-test","f-save"].map($);
$("f-ping").onclick=async()=>{const o=$("f-out");fbtns().forEach((b)=>b.disabled=true);say(o,null,"Pinging...");
try{const r=await postJson("/api/ping?ip="+enc($("f-ip").value)+"&port="+enc($("f-port").value));say(o,r.j.ok,r.j.output)}catch{say(o,false,"Could not reach the viewer.")}fbtns().forEach((b)=>b.disabled=false)};
$("f-test").onclick=async()=>{const o=$("f-out");fbtns().forEach((b)=>b.disabled=true);say(o,null,"Testing the connection... this can take about a minute.");
try{const r=await postJson("/api/connect?ip="+enc($("f-ip").value)+"&port="+enc($("f-port").value));say(o,r.j.ok,r.j.output)}catch{say(o,false,"Could not reach the viewer.")}fbtns().forEach((b)=>b.disabled=false)};
$("form").onsubmit=async(e)=>{e.preventDefault();const o=$("f-out");fbtns().forEach((b)=>b.disabled=true);
try{const r=await postJson("/api/settings",{opType:$("f-op").value,sdkType:$("f-sdk").value,name:$("f-name").value,number:$("f-no").value,ip:$("f-ip").value,port:$("f-port").value,mac:$("f-mac").value});
if(!r.ok){say(o,false,r.j.error||"Could not save.");return}
await restart(o,"Device updated. ")}catch{say(o,false,"Could not reach the viewer.")}finally{fbtns().forEach((b)=>b.disabled=false)}};
async function loadSet(){$("s-out").textContent="";const s=await(await fetch("/api/settings")).json();$("s-app").value=s.appUrl;$("s-int").value=s.interval;$("s-from").value=s.from;$("s-key").value="";$("s-keynote").textContent=s.hasKey?"A key is saved. It is never shown here.":"No key is saved yet."}
$("s-test").onclick=async()=>{const o=$("s-out");say(o,null,"Checking...");try{const r=await postJson("/api/testapp?url="+enc($("s-app").value));say(o,r.j.ok,r.j.output)}catch{say(o,false,"Could not reach the viewer.")}};
$("s-form").onsubmit=async(e)=>{e.preventDefault();const o=$("s-out"),b=$("s-save");b.disabled=true;
try{const r=await postJson("/api/settings",{appUrl:$("s-app").value,interval:$("s-int").value,from:$("s-from").value,key:$("s-key").value});
if(!r.ok){say(o,false,r.j.error||"Could not save.");return}
await restart(o,"Saved. ");loadSet()}catch{say(o,false,"Could not reach the viewer.")}finally{b.disabled=false}};
const link=(t,fn)=>{const a=document.createElement("button");a.type="button";a.textContent=t;a.className="lnk";a.onclick=fn;return a};
const two=(small,cls,btn)=>{const e=document.createElement("td");const s=document.createElement("div");s.textContent=small;s.className="sm "+(cls||"");e.appendChild(s);e.appendChild(btn);return e};
async function act(path,msg,btns,outId){const out=$(outId||"actout");btns.forEach((b)=>b.disabled=true);out.className="actout";out.textContent=msg;
try{const r=await(await fetch(path,{method:"POST",headers:{"X-Requested-With":"viewer"}})).json();out.className="actout "+(r.ok?"Synced":"Failed");out.textContent=r.output}catch{out.className="actout Failed";out.textContent="Could not reach the viewer."}
dev();}
async function dev(){const d=await(await fetch("/api/info")).json();$("hd").textContent=d.device+(d.ip?" ("+d.ip+")":"");const r=$("devrows");r.textContent="";const t=document.createElement("tr");
const ok=d.last&&d.last.status==="Synced";const dc=document.createElement("td");const dn=document.createElement("div");dn.textContent=d.device;dc.appendChild(dn);if(d.number){const dm=document.createElement("div");dm.className="sm2";dm.textContent="Device Number : "+d.number;dc.appendChild(dm)}t.appendChild(dc);
const integ=document.createElement("td");const si=document.createElement("div");si.textContent=(d.opType||"SDK")+" ("+(d.sdkType||"ZkemSDK")+")";integ.appendChild(si);integ.appendChild(link("Edit details",openEdit));t.appendChild(integ);t.appendChild(cell(d.ip?d.ip+":"+d.port:"-"));
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
    const qIp = u.searchParams.get("ip"), qPort = Number(u.searchParams.get("port"));   // Test Connection checks the values typed in the form, before they are saved
    const env = { ...process.env, ...(u.pathname === "/api/connect" && qIp && ipOk(qIp) && portOk(qPort) ? { DEVICE_IP: qIp, DEVICE_PORT: String(qPort) } : {}) };
    const child = spawn(process.execPath, ["bridge.mjs", ...(u.pathname === "/api/connect" ? ["--test"] : u.pathname === "/api/day" ? ["--log-day", u.searchParams.get("from") || "today", u.searchParams.get("to") || ""] : ["--once"])], { cwd: fileURLToPath(new URL(".", import.meta.url)), windowsHide: true, env });
    let out = "", done = false;
    const finish = (ok, extra) => { if (done) return; done = true; busy = false; clearTimeout(timer); const lines = (out + (extra || "")).trim().split("\n").slice(-6).join("\n"); send(200, "application/json", JSON.stringify({ ok, output: lines || (ok ? "Done." : "No output.") })); };
    const timer = setTimeout(() => { child.kill(); finish(false, "\nStopped: it took longer than 5 minutes."); }, 300000);
    child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
    child.on("error", (e) => finish(false, `Could not start: ${e.message}`));
    child.on("close", (code) => finish(code === 0));
    return;
  }
  const guarded = okHost && okOrigin && req.headers["x-requested-with"] === "viewer";
  if (req.method === "POST" && u.pathname === "/api/ping") {   // is anything answering at that address and port? (a plain connection check, nothing is read)
    if (!guarded) return send(403, "application/json", JSON.stringify({ ok: false, output: "Not allowed." }));
    const ip = String(u.searchParams.get("ip") || "").trim(), port = Number(u.searchParams.get("port"));
    if (!ipOk(ip) || !portOk(port)) return send(200, "application/json", JSON.stringify({ ok: false, output: "Enter a valid IP address and port first." }));
    const t0 = Date.now(), s = net.connect({ host: ip, port, timeout: 4000 });
    const end = (ok, text) => { s.destroy(); send(200, "application/json", JSON.stringify({ ok, output: text })); };
    s.once("connect", () => end(true, `The device answered at ${ip}:${port} in ${Date.now() - t0} ms.`));
    s.once("timeout", () => end(false, `No answer from ${ip}:${port} within 4 seconds. Check the address, the network cable and that the device is on.`));
    s.once("error", (e) => end(false, `Could not reach ${ip}:${port} (${e.code || e.message}).`));
    return;
  }
  if (req.method === "POST" && u.pathname === "/api/testapp") {   // can this computer reach the HR app? (the device key is not sent)
    if (!guarded) return send(403, "application/json", JSON.stringify({ ok: false, output: "Not allowed." }));
    const url = String(u.searchParams.get("url") || process.env.APP_URL || "").trim().replace(/\/+$/, "");
    if (!appOk(url)) return send(200, "application/json", JSON.stringify({ ok: false, output: "Enter the HR app address first, like https://hr.wohlig.com." }));
    fetch(url, { signal: AbortSignal.timeout(8000) }).then((r) => send(200, "application/json", JSON.stringify({ ok: r.status < 500, output: `The HR app answered (status ${r.status}).` })))
      .catch((e) => send(200, "application/json", JSON.stringify({ ok: false, output: `Could not reach ${url}: ${e.cause?.code || e.message}.` })));
    return;
  }
  if (req.method === "POST" && u.pathname === "/api/settings") {   // Edit details: saves the device details into .env
    if (!guarded) return send(403, "application/json", JSON.stringify({ error: "Not allowed." }));
    let raw = ""; req.on("data", (d) => { raw += d; if (raw.length > 4096) req.destroy(); });
    req.on("end", () => {
      let b; try { b = JSON.parse(raw || "{}"); } catch { return send(400, "application/json", JSON.stringify({ error: "That did not look right. Try again." })); }
      const c = cleanSettings(b); if (c.error) return send(400, "application/json", JSON.stringify({ error: c.error }));
      try { setEnv(c.updates); remember(c.updates); send(200, "application/json", JSON.stringify({ ok: true })); } catch (e) { send(500, "application/json", JSON.stringify({ error: `Could not save the settings file: ${e.message}` })); }
    });
    return;
  }
  if (req.method === "POST" && u.pathname === "/api/restart") {   // stops the connector and starts it again so it reads the new settings
    if (!guarded) return send(403, "application/json", JSON.stringify({ ok: false, output: "Not allowed." }));
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const done = () => { try { spawn(process.platform === "win32" ? "wscript.exe" : process.execPath, process.platform === "win32" ? [fileURLToPath(new URL("./run-hidden.vbs", import.meta.url))] : ["bridge.mjs"], { cwd: dir, detached: true, stdio: "ignore", windowsHide: true }).unref(); send(200, "application/json", JSON.stringify({ ok: true, output: "The connector was restarted with the new details." })); } catch (e) { send(200, "application/json", JSON.stringify({ ok: false, output: `Could not start it: ${e.message}` })); } };
    const killer = process.platform === "win32"
      ? spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|cmd)\\.exe$' -and $_.CommandLine -match 'run-forever|bridge\\.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"], { windowsHide: true })
      : spawn("pkill", ["-f", "node.*bridge.mjs"]);
    killer.on("error", done); killer.on("close", () => setTimeout(done, 1500));
    return;
  }
  if (req.method === "GET" && u.pathname === "/api/settings")
    return send(200, "application/json", JSON.stringify({ name: process.env.DEVICE_NAME || "", ip: process.env.DEVICE_IP || "", port: process.env.DEVICE_PORT || "4370", interval: process.env.INTERVAL_SECONDS || "300", from: process.env.SYNC_FROM || "", appUrl: process.env.APP_URL || "", opType: process.env.DEVICE_OPERATING_TYPE || "", sdkType: process.env.DEVICE_SDK_TYPE || "", ops: prefs().ops, sdks: prefs().sdks, number: process.env.DEVICE_NUMBER || "", mac: process.env.DEVICE_MAC || "", hasKey: !!process.env.DEVICE_KEY }));
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

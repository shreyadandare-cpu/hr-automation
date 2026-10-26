import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { Donut, Ring } from "../components/charts.jsx";
import { Avatar, Icon, Pill, ToolIcon, shortDate } from "../components/ui.jsx";
import { AVATAR_COLORS, STATUS, TOOLS, docCount, mgrOf, toolIds } from "../lib/people.js";
import { R } from "../lib/leave.js";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const diff = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "there";
const money = (n) => (n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }));
const monthLabel = (p) => (p ? new Date(p + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "—");
const longDay = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

/* The hero changes with the hour: only a faint tint, warmer in the morning, deeper at night. */
function sky() {
  const h = new Date().getHours();
  const sun = <><circle cx="32" cy="32" r="12" /><path d="M32 6v8M32 50v8M6 32h8M50 32h8M13.6 13.6l5.6 5.6M44.8 44.8l5.6 5.6M13.6 50.4l5.6-5.6M44.8 19.2l5.6-5.6" /></>;
  const moon = <path d="M50 38A20 20 0 1 1 26 14a16 16 0 0 0 24 24z" />;
  const [word, a, b, icon] = h < 12 ? ["Good morning", "rgba(255,176,140,.18)", "rgba(169,187,255,.12)", sun]
    : h < 18 ? ["Good afternoon", "rgba(125,140,238,.14)", "rgba(189,238,226,.12)", sun]
    : ["Good evening", "rgba(98,84,200,.16)", "rgba(111,127,238,.10)", moon];
  return { word, a, b, svg: <svg className="db-sky" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">{icon}</svg> };
}

function Hero({ me, photo, today, sub, actions }) {
  const s = sky();
  return (
    <section className="db-hero" style={{ "--db-a": s.a, "--db-b": s.b }}>
      {s.svg}
      <a className="db-avatar" href="/app/profile" style={{ background: photo ? "transparent" : me.color || "#4254d4" }} aria-label="My profile">
        {photo ? <img src={photo} alt="" /> : me.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
      </a>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="eyebrow">{longDay(today)}</div>
        <h1>{s.word}, <em>{first(me.name)}.</em></h1>
        <p>{sub}</p>
        <div className="row">{actions}</div>
      </div>
    </section>
  );
}

const rel = (today, iso) => { const n = diff(today, iso); return n === 0 ? "today" : n === 1 ? "tomorrow" : n === -1 ? "yesterday" : n > 1 ? `in ${n} days` : `${-n} days ago`; };
const empLink = (p) => `/app/employees/${encodeURIComponent(p.email)}`;

function Move({ p, sub, right }) {
  return <a className="mv" href={empLink(p)} style={{ textDecoration: "none", color: "inherit" }}><Avatar person={p} /><div className="grow"><b>{p.name}</b><span>{sub}</span></div>{right}</a>;
}

function HrDashboard() {
  const { user } = useAuth();
  const { people, docs, leave, profile } = useData();
  const [audit, setAudit] = useState([]);
  useEffect(() => { api("GET", "/api/audit?limit=5").then((r) => r.ok && setAudit(r.data)); }, []);
  const today = leave ? leave.today : new Date().toISOString().slice(0, 10);
  const me = people.find((p) => p.email.toLowerCase() === user.email.toLowerCase()) || { name: user.name, color: "#4254d4" };

  const here = people.filter((p) => p.status !== "offboarded");
  const active = people.filter((p) => p.status === "active").length;
  const onb = people.filter((p) => p.status === "onboarding");
  const leaving = people.filter((p) => p.status === "offboarding" || (p.lastDay && p.status === "active" && p.lastDay >= today));

  const q = [];
  for (const p of people) for (const id of Object.keys(p.errors || {})) q.push({ t: "bad", ic: "alert", title: `${TOOLS[id] ? TOOLS[id].name : id} access failed for ${p.name}`, meta: p.errors[id] || "The service rejected the request", href: empLink(p), btn: "Open" });
  const pendR = (leave ? leave.requests : []).filter((r) => r.status === "pending"), pendC = (leave ? leave.compOffs : []).filter((c) => c.status === "pending");
  const nPend = pendR.length + pendC.length;
  if (nPend) {
    const names = [...new Set([...pendR, ...pendC].map((r) => (people.find((p) => p.email.toLowerCase() === r.email.toLowerCase()) || {}).name).filter(Boolean))];
    q.push({ t: "warn", ic: "calendar", title: `${nPend} leave request${nPend === 1 ? "" : "s"} waiting for approval`, meta: names.slice(0, 3).join(", ") + (names.length > 3 ? ` and ${names.length - 3} more` : ""), href: "/app/leave", btn: "Review" });
  }
  const noDocs = onb.filter((p) => !docCount(docs, p.email));
  if (noDocs.length) q.push({ t: "warn", ic: "filedoc", title: `${noDocs.length} new joiner${noDocs.length === 1 ? " hasn't" : "s haven't"} uploaded documents`, meta: noDocs.slice(0, 3).map((p) => p.name).join(", ") + (noDocs.length > 3 ? ` and ${noDocs.length - 3} more` : ""), href: "/app/documents", btn: "See documents" });
  for (const p of onb.filter((x) => x.start >= today && diff(today, x.start) <= 7)) q.push({ t: "info", ic: "onboard", title: `${p.name} joins ${rel(today, p.start)}`, meta: `${p.title} · ${shortDate(p.start)}`, href: empLink(p), btn: "Open" });
  for (const p of leaving.filter((x) => x.lastDay && diff(today, x.lastDay) >= 0 && diff(today, x.lastDay) <= 7)) q.push({ t: "info", ic: "offboard", title: `${p.name} leaves ${rel(today, p.lastDay)}`, meta: `Last working day ${shortDate(p.lastDay)}`, href: empLink(p), btn: "Open" });
  const rank = { bad: 0, warn: 1, info: 2 };
  q.sort((x, y) => rank[x.t] - rank[y.t]);

  const soon = onb.filter((p) => p.start > today).sort((x, y) => (x.start < y.start ? -1 : 1));
  const settling = onb.filter((p) => p.start <= today).sort((x, y) => (x.start < y.start ? 1 : -1));
  const byDept = {};
  for (const p of here) byDept[p.dept || "Other"] = (byDept[p.dept || "Other"] || 0) + 1;
  const depts = Object.entries(byDept).sort((x, y) => y[1] - x[1]).map(([label, value], i) => ({ label, value, color: AVATAR_COLORS[i % AVATAR_COLORS.length] }));
  const seats = Object.values(TOOLS).map((t) => ({ t, n: people.filter((p) => p.grants[t.id] === "active").length }));
  const max = Math.max(...seats.map((x) => x.n), 1);
  const summary = q.length ? `${q.length} thing${q.length === 1 ? "" : "s"} need${q.length === 1 ? "s" : ""} you today.` : "You're all caught up.";
  const photo = profile && profile.photoV ? `/api/profile/photo?v=${profile.photoV}` : "";
  const stepsDone = (p) => [["active", "invited"].includes(p.grants.claude), docCount(docs, p.email) > 0];

  return (
    <>
      <Hero me={me} photo={photo} today={today}
        sub={`${summary} ${active} active ${active === 1 ? "person" : "people"}${soon.length ? `, ${soon.length} joining soon` : ""}${leaving.length ? `, ${leaving.length} leaving` : ""}.`}
        actions={<><a className="btn primary" href="/app/documents">+ New onboarding</a><a className="btn glass" href="/app/offboarding"><Icon name="offboard" />Offboard someone</a></>} />
      <div className="db-masonry">
        <div className="card"><div className="card-h"><h3>Needs you</h3><span className="muted">{q.length ? `${q.length} item${q.length === 1 ? "" : "s"}` : "Nothing waiting"}</span></div>
          {q.length ? q.map((i, k) => (
            <div key={k} className="q-item"><span className={`q-ic q-${i.t}`}><Icon name={i.ic} /></span>
              <div className="grow"><b>{i.title}</b><div className="meta" style={{ fontSize: 13, color: "var(--ink-faint)" }}>{i.meta}</div></div>
              <a className="btn glass sm" href={i.href}>{i.btn}</a></div>))
            : <div className="q-clear"><span className="q-ic q-ok"><Icon name="check" /></span><div><b style={{ color: "var(--ink)" }}>All clear.</b><div className="meta" style={{ fontSize: 13 }}>Failed access, leave to approve and new joiners waiting on you show up here.</div></div></div>}
        </div>
        <div className="card"><div className="card-h"><h3>People on the move</h3><span className="muted">Joining, settling in, leaving</span></div>
          <div className="mv-group">
            <h4>Starting soon</h4>
            {soon.length ? soon.slice(0, 4).map((p) => <Move key={p.id} p={p} sub={`${p.title} · ${shortDate(p.start)}`} right={<Pill tone="info">{rel(today, p.start)}</Pill>} />) : <div className="mv-empty">No one is due to start.</div>}
            <h4>Settling in</h4>
            {settling.length ? settling.slice(0, 5).map((p) => { const s = stepsDone(p), n = s.filter(Boolean).length;
              return <Move key={p.id} p={p} sub={`Joined ${shortDate(p.start)}`} right={<div className="progress" title={`${n} of ${s.length} done`}><i style={{ width: `${Math.round(n / s.length * 100)}%` }} /></div>} />; }) : <div className="mv-empty">No one is onboarding.</div>}
            <h4>Leaving</h4>
            {leaving.length ? leaving.slice(0, 4).map((p) => <Move key={p.id} p={p} sub={`Last day ${p.lastDay ? shortDate(p.lastDay) : "not set"}`} right={<Pill tone={STATUS[p.status][1]}>{p.status === "active" && p.lastDay ? `Leaving ${shortDate(p.lastDay)}` : STATUS[p.status][0]}</Pill>} />) : <div className="mv-empty">No one is leaving.</div>}
          </div>
        </div>
        <div className="card"><div className="card-h"><h3>People by department</h3><a className="btn link" href="/app/employees">Everyone</a></div>
          <div className="db-donut"><Donut parts={depts} label="people" /><div className="db-legend">{depts.map((d) => <div key={d.label}><i style={{ background: d.color }} />{d.label}<span>{d.value}</span></div>)}</div></div>
        </div>
        <div className="card"><div className="card-h"><h3>Seats in use</h3></div><div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {seats.map((x) => (
            <div key={x.t.id} style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr) 28px", gap: 12, alignItems: "center" }}>
              <ToolIcon tool={x.t} state="active" />
              <div><div style={{ fontSize: "13.5px", fontWeight: 600 }}>{x.t.name}</div><div className="progress" style={{ marginTop: 5 }}><i style={{ width: `${x.n / max * 100}%` }} /></div></div>
              <span className="num-cell" style={{ textAlign: "right", font: "600 18px/1 var(--display)" }}>{x.n}</span>
            </div>))}
        </div></div>
        <div className="card"><div className="card-h"><h3>Recent activity</h3><a className="btn link" href="/app/audit">Audit log</a></div>
          <div style={{ paddingBottom: 12 }}>{audit.length ? audit.map((a) => (
            <div key={a.id} className="tl"><span className="dot" style={{ background: "var(--ok)" }} /><div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14 }}><b style={{ fontWeight: 600 }}>{a.name || a.email || "System"}</b> · {a.action}</div>
              <div className="meta">{new Date(a.ts).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div></div></div>))
            : <div className="empty">No recorded actions yet.</div>}</div></div>
      </div>
    </>
  );
}

function EmployeeDashboard() {
  const { user } = useAuth();
  const { people, docs, leave, profile } = useData();
  const [claims, setClaims] = useState(null);
  useEffect(() => { api("GET", "/api/reimbursements").then((r) => setClaims(r.ok ? r.data.claims : [])); }, []);
  const today = leave ? leave.today : new Date().toISOString().slice(0, 10);
  const me = people.find((p) => p.email.toLowerCase() === user.email.toLowerCase()) || { id: -1, name: user.name, email: user.email, title: "—", dept: "—", color: "#4254d4", grants: {}, status: "active", start: "" };
  const photo = profile && profile.photoV ? `/api/profile/photo?v=${profile.photoV}` : "";
  const mgr = mgrOf(me);
  const prof = profile || {};
  const steps = [["Add a profile photo", !!photo, "/app/profile"], ["Tell us about yourself", !!prof.about, "/app/profile"], ["Add your date of birth", !!(prof.primary && prof.primary.dob), "/app/profile"],
    ["Add your address", !!(prof.addresses && prof.addresses.current && prof.addresses.current.line), "/app/profile"], ["Add your education", !!(prof.education && prof.education.length), "/app/profile"],
    ["Upload your documents", docCount(docs, me.email) > 0, "/app/documents"]];
  const done = steps.filter((s) => s[1]).length, pct = Math.round(done / steps.length * 100);

  let bal = null;
  if (R && leave) {
    try {
      const pay = (leave.pay || []).find((x) => String(x.email).toLowerCase() === user.email.toLowerCase()) || { casualOpening: 0 };
      const b = R.balances(Number(today.slice(0, 4)), { start: me.start, casualOpening: pay.casualOpening },
        leave.requests.filter((r) => r.email.toLowerCase() === user.email.toLowerCase()), leave.compOffs.filter((c) => c.email.toLowerCase() === user.email.toLowerCase()));
      const cT = b.casual.carried + b.casual.quota;
      bal = (
        <div className="db-bal">
          <div><Ring pct={cT ? b.casual.left / cT * 100 : 0} color="var(--purple-soft)" label={String(b.casual.left)} sub="days left" /><small>{R.TYPES.casual.name}</small></div>
          <div><Ring pct={b.sick.quota ? b.sick.left / b.sick.quota * 100 : 0} color="#8fae3e" label={String(b.sick.left)} sub="days left" /><small>{R.TYPES.sick.name}</small></div>
          <div><Ring pct={b.compoff.earned ? b.compoff.left / b.compoff.earned * 100 : 0} color="#0e7c86" label={String(b.compoff.left)} sub="days left" /><small>{R.TYPES.compoff.name}</small></div>
        </div>);
    } catch (e) { bal = null; }
  }
  const holidays = (leave ? leave.holidays : []).filter((h) => h.day >= today).sort((x, y) => (x.day < y.day ? -1 : 1)).slice(0, 3);
  const mo = today.slice(5, 7), yr = Number(today.slice(0, 4));
  const anniv = people.filter((x) => x.status !== "offboarded" && x.start && x.start.slice(5, 7) === mo && Number(x.start.slice(0, 4)) < yr).sort((x, y) => (x.start.slice(8) < y.start.slice(8) ? -1 : 1));
  const fresh = people.filter((x) => x.status !== "offboarded" && x.start && x.start <= today && diff(x.start, today) <= 30 && x.id !== me.id);
  const tools = toolIds(me).filter((k) => me.grants[k] === "active");
  const chip = (x, txt) => <span key={x.id} className="chip"><Avatar person={x} />{x.name}{txt && <> <small>{txt}</small></>}</span>;

  const cl = claims || [], month = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
  const wait = cl.filter((c) => ["submitted", "under_review", "resubmitted"].includes(c.status)), todo = cl.filter((c) => ["draft", "changes_requested"].includes(c.status));
  const thisMonth = cl.filter((c) => ["payroll_pending", "in_payroll", "paid"].includes(c.status) && c.payrollPeriod === month);
  const pay = (c) => (c.approvedAmount != null ? c.approvedAmount : c.amount || 0);

  return (
    <>
      <Hero me={me} photo={photo} today={today}
        sub={<>{me.title && me.title !== "—" ? me.title : "Welcome"}{me.dept && me.dept !== "—" && !String(me.title || "").toLowerCase().includes(me.dept.toLowerCase()) ? ` · ${me.dept}` : ""}{mgr ? ` · Reports to ${mgr}` : ""}</>}
        actions={<><a className="btn primary" href="/app/my-leave">Request leave</a><a className="btn glass" href="/app/profile">My profile</a><a className="btn glass" href="/app/documents">Upload documents</a></>} />
      <div className="db-masonry">
        <div className="card"><div className="card-h"><h3>My leave</h3><a className="btn link" href="/app/my-leave">Details</a></div>
          {bal || <div className="card-b muted">Your leave balances show here once the leave data has loaded.</div>}
        </div>
        <div className="card"><div className="card-h"><h3>Reimbursements</h3><div className="row" style={{ gap: 8 }}><a className="btn link sm" href="/app/reimbursements">My claims</a><a className="btn primary sm" href="/app/reimbursements">New claim</a></div></div>
          <div className="rb-stats four" style={{ padding: "0 24px 18px" }}>
            <div className="rb-stat"><span className="lbl">Added to {monthLabel(month)} salary</span><b>{money(thisMonth.reduce((n, c) => n + pay(c), 0))}</b><span className="sub">{thisMonth.length} approved claim{thisMonth.length === 1 ? "" : "s"}</span></div>
            <div className="rb-stat"><span className="lbl">Waiting for HR</span><b>{wait.length}</b><span className="sub">{money(wait.reduce((n, c) => n + c.amount, 0))}</span></div>
            <div className={`rb-stat ${todo.length ? "warn" : ""}`}><span className="lbl">Needs your action</span><b>{todo.length}</b><span className="sub">Drafts and changes asked</span></div>
            <div className="rb-stat"><span className="lbl">Paid to you</span><b>{money(cl.filter((c) => c.status === "paid").reduce((n, c) => n + (c.paidAmount || c.amount), 0))}</b></div>
          </div></div>
        <div className="card"><div className="card-h"><h3>{pct === 100 ? "Your profile is complete" : "Finish setting up"}</h3><span className="muted">{done} of {steps.length}</span></div>
          <div className="db-donut" style={{ paddingBottom: 10 }}><Ring pct={pct} color="var(--purple)" label={`${pct}%`} sub="complete" size={112} />
            <div className="db-legend"><span style={{ margin: 0, textAlign: "left", color: "var(--ink-dim)" }}>{pct === 100 ? "Everything is in. Nice work." : "A fuller profile helps your team and HR."}</span></div></div>
          {steps.map(([t, ok, href]) => <a key={t} className={`step ${ok ? "done" : ""}`} href={href}><span className="tick"><Icon name="check" /></span><span>{t}</span>{!ok && <em>Do it</em>}</a>)}
        </div>
        <div className="card"><div className="card-h"><h3>Celebrating this month</h3><span className="muted">Work anniversaries</span></div>
          {anniv.length ? <div className="cel">{anniv.slice(0, 10).map((x) => chip(x, `${yr - Number(x.start.slice(0, 4))} yr${yr - Number(x.start.slice(0, 4)) === 1 ? "" : "s"}`))}</div> : <div className="card-b muted">No anniversaries this month.</div>}
        </div>
        <div className="card"><div className="card-h"><h3>New to the team</h3><span className="muted">Joined in the last 30 days</span></div>
          {fresh.length ? <div className="cel">{fresh.slice(0, 10).map((x) => chip(x, ""))}</div> : <div className="card-b muted">No new joiners lately.</div>}
        </div>
        <div className="card"><div className="card-h"><h3>Coming up</h3><span className="muted">Company holidays</span></div>
          {holidays.length ? holidays.map((h) => { const [, m, dn] = h.day.split("-").map(Number);
            return <div key={h.day} className="q-item"><div className="dtile"><b>{dn}</b><span>{MON[m - 1]}</span></div><div className="grow"><b>{h.name}</b>
              <div className="meta" style={{ fontSize: 13, color: "var(--ink-faint)" }}>{new Date(h.day + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long" })} · {rel(today, h.day)}</div></div></div>; })
            : <div className="card-b muted">No upcoming holidays on the calendar.</div>}
        </div>
        <div className="card"><div className="card-h"><h3>My tools</h3><span className="muted">{tools.length} active</span></div>
          <div className="card-b">{tools.length ? <div className="chips">{tools.map((id) => <span key={id} className="chip"><ToolIcon tool={TOOLS[id]} state="active" />{TOOLS[id].name}</span>)}</div> : <span className="muted">No tools yet. HR gives access when you join.</span>}</div>
        </div>
      </div>
    </>
  );
}

export default function Dashboard() {
  const { isHr } = useAuth();
  const { people } = useData();
  if (!people) return <section className="section"><div className="empty">Loading…</div></section>;
  return isHr ? <HrDashboard /> : <EmployeeDashboard />;
}

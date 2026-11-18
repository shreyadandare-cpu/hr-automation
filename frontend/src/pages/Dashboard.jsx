import FestivalTile from "../modules/festivals/FestivalTile.jsx";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { Donut, Ring } from "../components/charts.jsx";
import TodayCards from "../components/TodayCards.jsx";
import BirthdayPopup from "../components/BirthdayPopup.jsx";
import CelebrateCard from "../components/CelebrateCard.jsx";
import { Icon, ToolIcon, shortDate } from "../components/ui.jsx";
import { AVATAR_COLORS, TOOLS, docCount, mgrOf } from "../lib/people.js";
import { R } from "../lib/leave.js";

const diff = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "there";
const longDay = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

/* The hero changes with the hour: only a faint tint, warmer in the morning, deeper at night. */
function sky() {
  const h = new Date().getHours();
  const sun = <><circle cx="32" cy="32" r="12" /><path d="M32 6v8M32 50v8M6 32h8M50 32h8M13.6 13.6l5.6 5.6M44.8 44.8l5.6 5.6M13.6 50.4l5.6-5.6M44.8 19.2l5.6-5.6" /></>;
  const moon = <path d="M50 38A20 20 0 1 1 26 14a16 16 0 0 0 24 24z" />;
  const [word, a, b, icon] = h < 12 ? ["Good morning", "rgba(247,120,29,.14)", "rgba(234,217,194,.45)", sun]
    : h < 18 ? ["Good afternoon", "rgba(247,120,29,.08)", "rgba(200,95,68,.10)", sun]
    : ["Good evening", "rgba(128,13,53,.14)", "rgba(247,120,29,.08)", moon];
  return { word, a, b, svg: <svg className="db-sky" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">{icon}</svg> };
}

function Hero({ me, photo, today, sub, actions }) {
  const s = sky();
  return (
    <section className="db-hero" style={{ "--db-a": s.a, "--db-b": s.b }}>
      {s.svg}
      <a className="db-avatar" href="/app/profile" style={{ background: photo ? "transparent" : me.color || "#800d35" }} aria-label="My profile">
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


const SETTLE_DAYS = 30;

function HrDashboard() {
  const { user } = useAuth();
  const { people, docs, leave, profile } = useData();
  const today = leave ? leave.today : new Date().toISOString().slice(0, 10);
  const me = people.find((p) => p.email.toLowerCase() === user.email.toLowerCase()) || { name: user.name, color: "#800d35" };

  const here = people.filter((p) => p.status !== "offboarded");
  const active = people.filter((p) => p.status === "active").length;
  const onb = people.filter((p) => p.status === "onboarding");
  const leaving = people.filter((p) => p.status === "offboarding" || (p.lastDay && p.status === "active" && p.lastDay >= today));

  const pendR = (leave ? leave.requests : []).filter((r) => r.status === "pending"), pendC = (leave ? leave.compOffs : []).filter((c) => c.status === "pending");
  const nPend = pendR.length + pendC.length;
  const awayToday = (leave ? leave.requests : []).filter((r) => r.status === "approved" && r.from <= today && r.to >= today).length;

  const soon = onb.filter((p) => p.start > today).sort((x, y) => (x.start < y.start ? -1 : 1));
  // Someone has moved in once they have been here a month: the Onboarding status is not changed by anything else, so the dashboard decides by the start date.
  const settling = onb.filter((p) => p.start <= today && diff(p.start, today) <= SETTLE_DAYS).sort((x, y) => (x.start < y.start ? 1 : -1));
  const byDept = {};
  for (const p of here) byDept[p.dept || "Other"] = (byDept[p.dept || "Other"] || 0) + 1;
  const depts = Object.entries(byDept).sort((x, y) => y[1] - x[1]).map(([label, value], i) => ({ label, value, color: AVATAR_COLORS[i % AVATAR_COLORS.length] }));
  const seats = Object.values(TOOLS).map((t) => ({ t, n: people.filter((p) => p.grants[t.id] === "active").length }));
  const max = Math.max(...seats.map((x) => x.n), 1);
  const summary = nPend ? `${nPend} leave request${nPend === 1 ? " is" : "s are"} waiting for you.` : "You're all caught up.";
  const photo = profile && profile.photoV ? `/api/profile/photo?v=${profile.photoV}` : "";

  return (
    <div className="db">
      <Hero me={me} photo={photo} today={today}
        sub={`${summary} ${active} active ${active === 1 ? "person" : "people"}${soon.length ? `, ${soon.length} joining soon` : ""}${leaving.length ? `, ${leaving.length} leaving` : ""}.`}
        actions={<><a className="btn primary" href="/app/documents">+ New onboarding</a><a className="btn glass" href="/app/offboarding"><Icon name="offboard" />Offboard someone</a></>} />
      <div className="rb-stats four db-strip">
        <a className="rb-stat" href="/app/employees"><span className="lbl">Active people</span><b>{active}</b><span className="sub">{here.length} on the staff list</span></a>
        <a className="rb-stat" href="/app/attendance"><span className="lbl">Away today</span><b>{awayToday}</b><span className="sub">on approved leave</span></a>
        <a className={`rb-stat ${nPend ? "warn" : ""}`} href="/app/leave"><span className="lbl">Leave to approve</span><b>{nPend}</b><span className="sub">{nPend ? "waiting for you" : "nothing waiting"}</span></a>
        <a className="rb-stat" href="/app/onboarding"><span className="lbl">New joiners</span><b>{soon.length + settling.length}</b><span className="sub">{leaving.length ? `${leaving.length} leaving` : "no one leaving"}</span></a>
      </div>
      {/* Rows of two, each pair the same height; Festival wishes is a slim card across the bottom. */}
      <div className="db-grid">
        <TodayCards only="leave" />
        <CelebrateCard />
        <div className="card"><div className="card-h"><h3>Seats in use</h3></div><div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {seats.map((x) => (
            <div key={x.t.id} style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr) 28px", gap: 12, alignItems: "center" }}>
              <ToolIcon tool={x.t} state="active" />
              <div><div style={{ fontSize: "13.5px", fontWeight: 600 }}>{x.t.name}</div><div className="progress" style={{ marginTop: 5 }}><i style={{ width: `${x.n / max * 100}%` }} /></div></div>
              <span className="num-cell" style={{ textAlign: "right", font: "600 18px/1 var(--display)" }}>{x.n}</span>
            </div>))}
        </div></div>
        <div className="card"><div className="card-h"><h3>People by department</h3><a className="btn link" href="/app/employees">Everyone</a></div>
          <div className="db-donut"><Donut parts={depts} label="people" /><div className="db-legend">{depts.map((d) => <div key={d.label}><i style={{ background: d.color }} />{d.label}<span>{d.value}</span></div>)}</div></div>
        </div>
        <div className="db-wide"><FestivalTile /></div>
      </div>
    </div>
  );
}

function EmployeeDashboard() {
  const { user } = useAuth();
  const { people, docs, leave, profile } = useData();
  const today = leave ? leave.today : new Date().toISOString().slice(0, 10);
  const me = people.find((p) => p.email.toLowerCase() === user.email.toLowerCase()) || { id: -1, name: user.name, email: user.email, title: "—", dept: "—", color: "#800d35", grants: {}, status: "active", start: "" };
  const photo = profile && profile.photoV ? `/api/profile/photo?v=${profile.photoV}` : "";
  const mgr = mgrOf(me);
  const prof = profile || {};
  const steps = [["Add a profile photo", !!photo, "/app/profile"], ["Tell us about yourself", !!prof.about, "/app/profile"], ["Add your date of birth", !!(prof.primary && prof.primary.dob) || !!prof.employeeDob, "/app/profile"],
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
          <div><Ring pct={b.compoff.earned ? b.compoff.left / b.compoff.earned * 100 : 0} color="#76775a" label={String(b.compoff.left)} sub="days left" /><small>{R.TYPES.compoff.name}</small></div>
        </div>);
    } catch (e) { bal = null; }
  }


  return (
    <div className="db">
      <Hero me={me} photo={photo} today={today}
        sub={<>{me.title && me.title !== "—" ? me.title : "Welcome"}{me.dept && me.dept !== "—" && !String(me.title || "").toLowerCase().includes(me.dept.toLowerCase()) ? ` · ${me.dept}` : ""}{mgr ? ` · Reports to ${mgr}` : ""}</>}
        actions={<><a className="btn primary" href="/app/my-leave">Request leave</a><a className="btn glass" href="/app/profile">My profile</a><a className="btn glass" href="/app/documents">Upload documents</a></>} />
      <div className="db-cols">
        <div className="db-col">
        <div className="card"><div className="card-h"><h3>My leave</h3><a className="btn link" href="/app/my-leave">Details</a></div>
          {bal || <div className="card-b muted">Your leave balances show here once the leave data has loaded.</div>}
        </div>
        <TodayCards only="leave" />
        </div>
        <div className="db-col">
        <div className="card"><div className="card-h"><h3>{pct === 100 ? "Your profile is complete" : "Finish setting up"}</h3><span className="muted">{done} of {steps.length}</span></div>
          <div className="db-donut" style={{ paddingBottom: 10 }}><Ring pct={pct} color="var(--purple)" label={`${pct}%`} sub="complete" size={112} />
            <div className="db-legend"><span style={{ margin: 0, textAlign: "left", color: "var(--ink-dim)" }}>{pct === 100 ? "Everything is in. Nice work." : "A fuller profile helps your team and HR."}</span></div></div>
          {steps.map(([t, ok, href]) => <a key={t} className={`step ${ok ? "done" : ""}`} href={href}><span className="tick"><Icon name="check" /></span><span>{t}</span>{!ok && <em>Do it</em>}</a>)}
        </div>
        <CelebrateCard />
        <FestivalTile />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { isHr } = useAuth();
  const { people } = useData();
  if (!people) return <section className="section"><div className="empty">Loading…</div></section>;
  return <>{isHr ? <HrDashboard /> : <EmployeeDashboard />}<BirthdayPopup /></>;
}

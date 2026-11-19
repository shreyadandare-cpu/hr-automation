import { Link } from "react-router-dom";
import Posts from "../modules/posts/Posts.jsx";
import TimeToday from "../components/TimeToday.jsx";
import RemoteToday from "../components/RemoteToday.jsx";
import FestivalTile from "../modules/festivals/FestivalTile.jsx";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { Donut, Ring } from "../components/charts.jsx";
import TodayCards from "../components/TodayCards.jsx";
import BirthdayPopup from "../components/BirthdayPopup.jsx";
import CelebrateCard from "../components/CelebrateCard.jsx";
import { Icon, ToolIcon, shortDate, PageSkeleton } from "../components/ui.jsx";
import { AVATAR_COLORS, TOOLS, docCount, mgrOf } from "../lib/people.js";
import { R } from "../lib/leave.js";
import { FestivalArt, festivalFrom, festivalGreeting, festivalTheme, festivalWhen, useFestivalLook } from "../components/FestivalLook.jsx";

const diff = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "there";
const longDay = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

/* The head of the dashboard: a small photo, the greeting, the date and what needs you today. No buttons inside it: the actions sit in Quick access below. */
function Head({ me, photo, today, sub }) {
  const fest = useFestivalLook();
  return (
    <section className={`db-head ${fest ? "overflow-hidden bg-none! [&>*:not(canvas,.fest-veil)]:relative [&>*:not(canvas,.fest-veil)]:z-1" : ""}`}>
      {fest && <><FestivalArt slug={fest.slug} className="object-[70%_45%] animate-fest-art" /><span aria-hidden="true" className="fest-veil pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(20,6,10,.82)_0%,rgba(20,6,10,.55)_45%,rgba(20,6,10,.1)_100%)]" /></>}
      <Link className="db-avatar" to="/app/profile" style={{ background: photo ? "transparent" : me.color || "var(--brand-maroon)" }} aria-label="My profile">
        {photo ? <img src={photo} alt="" /> : me.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
      </Link>
      <div className="db-head-text">
        <h1 className={fest ? "animate-fest-rise" : ""}>{fest && !fest.inDays ? festivalGreeting(fest) : greeting()}, {first(me.name)}</h1>
        <p>{longDay(today)}. {sub}</p>
        {fest && <p className="mt-2! animate-fest-rise font-display text-[17px] italic text-orange!">{fest.inDays ? `${festivalWhen(fest)}. ${festivalFrom(fest)}.` : `${festivalFrom(fest)}. Have a wonderful day.`}</p>}
      </div>
      {fest && <span aria-hidden="true" className="fest-veil pointer-events-none absolute inset-x-0 bottom-0 z-1 h-1" style={{ background: `linear-gradient(90deg, ${festivalTheme(fest.slug).colors.join(", ")})` }} />}
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
      <Head me={me} photo={photo} today={today} sub={summary} />
      <div className="rb-stats four db-strip">
        <Link className="rb-stat" to="/app/employees"><span className="lbl">Active people</span><b>{active}</b><span className="sub">{here.length} on the staff list</span></Link>
        <Link className="rb-stat" to="/app/attendance"><span className="lbl">Away today</span><b>{awayToday}</b><span className="sub">on approved leave</span></Link>
        <Link className={`rb-stat ${nPend ? "warn" : ""}`} to="/app/leave"><span className="lbl">Leave to approve</span><b>{nPend}</b><span className="sub">{nPend ? "waiting for you" : "nothing waiting"}</span></Link>
        <Link className="rb-stat" to="/app/onboarding/progress"><span className="lbl">New joiners</span><b>{soon.length + settling.length}</b><span className="sub">{leaving.length ? `${leaving.length} leaving` : "no one leaving"}</span></Link>
      </div>
      {/* A narrow quick-access column beside the wider main column, like a home screen: what is happening today on the left, the company on the right. */}
      <div className="db-main">
        <div className="db-col">
          <h2 className="db-h">Quick access</h2>
          <div className="row"><Link className="btn glass sm" to="/app/onboarding"><Icon name="onboard" />Add a new joiner</Link><Link className="btn glass sm" to="/app/offboarding"><Icon name="offboard" />Offboard someone</Link></div>
          <Link className="card db-inbox" to="/app/inbox">
            <span className={`q-ic ${nPend ? "q-warn" : "q-ok"}`}><Icon name={nPend ? "mail" : "check"} /></span>
            <span className="grow"><b>To do</b><span>{nPend ? `${nPend} leave request${nPend === 1 ? "" : "s"} waiting for you` : "You have no pending actions."}</span></span>
            <span className="btn link">Open</span>
          </Link>
          <TimeToday />
          <TodayCards only="leave" />
          <RemoteToday />
          <FestivalTile />
        <div className="card"><div className="card-h"><h3>Seats in use</h3></div><div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {seats.map((x) => (
            <div key={x.t.id} style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr) 28px", gap: 12, alignItems: "center" }}>
              <ToolIcon tool={x.t} state="active" />
              <div><div style={{ fontSize: "13.5px", fontWeight: 600 }}>{x.t.name}</div><div className="progress" style={{ marginTop: 5 }}><i style={{ width: `${x.n / max * 100}%` }} /></div></div>
              <span className="num-cell" style={{ textAlign: "right", font: "600 18px/1 var(--display)" }}>{x.n}</span>
            </div>))}
        </div></div>
        <div className="card"><div className="card-h"><h3>People by department</h3><Link className="btn link" to="/app/employees">Everyone</Link></div>
          <div className="db-donut"><Donut parts={depts} label="people" /><div className="db-legend">{depts.map((d) => <div key={d.label}><i style={{ background: d.color }} />{d.label}<span>{d.value}</span></div>)}</div></div>
        </div>
        </div>
        <div className="db-col">
          <h2 className="db-h">Organisation</h2>
          <CelebrateCard />
          <div className="row"><Link className="btn glass sm" to="/app/polls">Polls</Link><Link className="btn glass sm" to="/app/praise">Praise a colleague</Link><Link className="btn glass sm" to="/app/articles">Articles</Link></div>
          <Posts embedded />
        </div>
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
      <Head me={me} photo={photo} today={today}
        sub={<>{me.title && me.title !== "—" ? me.title : "Welcome"}{me.dept && me.dept !== "—" && !String(me.title || "").toLowerCase().includes(me.dept.toLowerCase()) ? ` · ${me.dept}` : ""}{mgr ? ` · Reports to ${mgr}` : ""}</>} />
      <div className="db-cols">
        <div className="db-col">
        <div className="row"><Link className="btn glass sm" to="/app/leave/apply?self=1">Request leave</Link><Link className="btn glass sm" to="/app/documents">Upload documents</Link></div>
        <div className="card"><div className="card-h"><h3>My leave</h3><Link className="btn link" to="/app/my-leave">Details</Link></div>
          {bal || <div className="card-b muted">Your leave balances show here once the leave data has loaded.</div>}
        </div>
        <TimeToday />
        <TodayCards only="leave" />
        <RemoteToday />
        </div>
        <div className="db-col">
        <div className="card"><div className="card-h"><h3>{pct === 100 ? "Your profile is complete" : "Finish setting up"}</h3><span className="muted">{done} of {steps.length}</span></div>
          <div className="db-donut" style={{ paddingBottom: 10 }}><Ring pct={pct} color="var(--purple)" label={`${pct}%`} sub="complete" size={112} />
            <div className="db-legend"><span style={{ margin: 0, textAlign: "left", color: "var(--ink-dim)" }}>{pct === 100 ? "Everything is in. Nice work." : "A fuller profile helps your team and HR."}</span></div></div>
          {steps.map(([t, ok, href]) => <Link key={t} className={`step ${ok ? "done" : ""}`} to={href}><span className="tick"><Icon name="check" /></span><span>{t}</span>{!ok && <em>Do it</em>}</Link>)}
        </div>
        <CelebrateCard />
        <FestivalTile />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { canAll, superAdmin } = useAuth();
  // The company dashboard is for the people who run the company's people records; everyone else gets their own.
  const runsCompany = canAll("people.edit") || superAdmin;
  const { people } = useData();
  if (!people) return <PageSkeleton />;
  return <>{runsCompany ? <HrDashboard /> : <EmployeeDashboard />}<BirthdayPopup /></>;
}

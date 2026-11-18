import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useData } from "../data.jsx";
import PersonAvatar from "./PersonAvatar.jsx";
import "./birthday.css";

/* One card for the good news at Wohlig, with three tabs: Birthdays, Work anniversaries and New joiners. Each tab shows today first, then what is coming up.
   Birthdays come from the server (day and month only, never the year). Anniversaries start at one year. New joiners are people who joined in the last 30 days. */
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n) => String(n).padStart(2, "0");
const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const dayLabel = (iso) => `${iso.slice(8, 10)} ${LONG[Number(iso.slice(5, 7)) - 1]}`;
const dayNo = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
const years = (n) => `${n} year${n === 1 ? "" : "s"}`;
const WINDOW = 30;

/** Work anniversaries today and in the next 30 days, from one year on, for people still here. */
export function upcomingAnniversaries(people, today) {
  const y = Number(today.slice(0, 4)), out = [];
  for (const p of people || []) {
    if (p.status === "offboarded" || !/^\d{4}-\d{2}-\d{2}/.test(p.start || "")) continue;
    const sy = Number(p.start.slice(0, 4)), md = p.start.slice(5, 10);
    for (const yy of [y, y + 1]) {
      const date = `${yy}-${md === "02-29" && !leap(yy) ? "02-28" : md}`;
      if (date >= today && dayNo(date) - dayNo(today) <= WINDOW && yy - sy >= 1) { out.push({ p, date, n: yy - sy }); break; }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.p.name.localeCompare(b.p.name)));
}

const Cake = () => <svg viewBox="0 0 120 90" width="120" height="90" fill="none" aria-hidden="true"><path d="M18 78h84" stroke="#ead9c2" strokeWidth="3" strokeLinecap="round" /><rect x="26" y="56" width="68" height="20" rx="5" fill="#fff7e9" stroke="#800d35" strokeWidth="2.2" /><path d="M26 64c8 7 14-4 22 0s14 7 22 0 14-4 24 0" stroke="#f7781d" strokeWidth="2.4" strokeLinecap="round" /><rect x="38" y="38" width="44" height="18" rx="5" fill="#fff7e9" stroke="#800d35" strokeWidth="2.2" /><path d="M38 46c7 6 12-3 18 0s12 5 18 0 6-2 8 0" stroke="#c85f44" strokeWidth="2.2" strokeLinecap="round" /><path d="M60 38V26" stroke="#800d35" strokeWidth="2.6" strokeLinecap="round" /><path d="M60 14c4 4 4 8 0 11-4-3-4-7 0-11z" fill="#f7781d" /></svg>;
const Party = () => <svg viewBox="0 0 120 90" width="120" height="90" fill="none" aria-hidden="true"><path d="M30 76l14-44 30 30z" fill="#fff7e9" stroke="#800d35" strokeWidth="2.2" strokeLinejoin="round" /><path d="M52 40l22 22M40 56l14 14" stroke="#f7781d" strokeWidth="2.2" strokeLinecap="round" /><circle cx="84" cy="30" r="3" fill="#f7781d" /><circle cx="96" cy="48" r="2.6" fill="#800d35" /><path d="M70 22l6 4M88 64l7-2M58 18l1 7" stroke="#c85f44" strokeWidth="2.2" strokeLinecap="round" /></svg>;
const Crowd = () => <svg viewBox="0 0 120 90" width="120" height="90" fill="none" aria-hidden="true"><circle cx="60" cy="34" r="12" fill="#fff7e9" stroke="#800d35" strokeWidth="2.2" /><path d="M36 74c2-14 12-22 24-22s22 8 24 22" stroke="#800d35" strokeWidth="2.2" strokeLinecap="round" /><circle cx="30" cy="42" r="8" stroke="#c85f44" strokeWidth="2.2" /><circle cx="90" cy="42" r="8" stroke="#c85f44" strokeWidth="2.2" /></svg>;
const Ico = { birthdays: <><path d="M5 11h14v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" /><path d="M5 15c2 1.500 3-1 5 0s3 1.500 5 0 3 1 4 0M12 11V8M12 3.500c1 1 1 2 0 3-1-1-1-2 0-3z" /></>, anniversaries: <><path d="M4 20l4-12 8 8z" /><path d="M14 5l.5 2M18 9l2-.5M17 3l-1 2" /></>, joiners: <><circle cx="9" cy="8" r="3.500" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M18 8v6M15 11h6" /></> };

function Person({ p, sub, today }) {
  return <div className={`cc-person${today ? " today" : ""}`} title={p.name}><PersonAvatar email={p.email} name={p.name} /><b>{p.name}</b>{sub && <span>{sub}</span>}</div>;
}
const Block = ({ title, children }) => <div className="cc-block"><h4>{title}</h4>{children}</div>;
const Empty = ({ art, text }) => <div className="cc-empty">{art}<span>{text}</span></div>;

export default function CelebrateCard() {
  const { people, leave } = useData();
  const [d, setD] = useState(null);
  const [tab, setTab] = useState("birthdays"), [open, setOpen] = useState(true);
  useEffect(() => { api("GET", "/api/leave/today").then((r) => setD(r.ok ? r.data : { failed: true })); }, []);
  const today = (d && d.today) || (leave && leave.today) || new Date().toISOString().slice(0, 10);

  const bAll = (d && d.birthdays) || [], bToday = bAll.filter((b) => b.date === today), bSoon = bAll.filter((b) => b.date !== today);
  const aAll = upcomingAnniversaries(people, today), aToday = aAll.filter((a) => a.date === today), aSoon = aAll.filter((a) => a.date !== today);
  const joiners = (people || []).filter((x) => x.status !== "offboarded" && x.start && x.start <= today && dayNo(today) - dayNo(x.start) <= WINDOW).sort((a, b) => (a.start < b.start ? 1 : -1));
  const tabs = [["birthdays", `${bToday.length} Birthdays`], ["anniversaries", `${aToday.length} Work anniversaries`], ["joiners", `${joiners.length} New joiners`]];

  return (
    <div className="card cc">
      <div className="cc-tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => { setTab(k); setOpen(true); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{Ico[k]}</svg>{label}
          </button>))}
        <button type="button" className="cc-fold" aria-label={open ? "Collapse" : "Expand"} aria-expanded={open} onClick={() => setOpen(!open)}><span className="caret" aria-hidden="true" /></button>
      </div>
      {open && (
        <div className="cc-body" role="tabpanel">
          {tab === "birthdays" && <>
            <Block title="Birthdays today">{bToday.length ? <div className="cc-grid">{bToday.map((b) => <Person key={b.email} p={b} sub="Today 🎂" today />)}</div> : <Empty art={<Cake />} text="No birthdays today." />}</Block>
            <Block title="Upcoming birthdays">{bSoon.length ? <div className="cc-grid">{bSoon.slice(0, 8).map((b) => <Person key={b.email} p={b} sub={dayLabel(b.date)} />)}</div> : <div className="cc-none">{d ? "None in the next 30 days." : "Loading…"}</div>}</Block>
          </>}
          {tab === "anniversaries" && <>
            <Block title="Work anniversaries today">{aToday.length ? <div className="cc-grid">{aToday.map((a) => <Person key={a.p.id || a.p.email} p={a.p} sub={`${years(a.n)} · Today 🎉`} today />)}</div> : <Empty art={<Party />} text="No work anniversaries today." />}</Block>
            <Block title="Upcoming work anniversaries">{aSoon.length ? <div className="cc-grid">{aSoon.slice(0, 8).map((a) => <Person key={a.p.id || a.p.email} p={a.p} sub={`${years(a.n)} · ${dayLabel(a.date)}`} />)}</div> : <div className="cc-none">None in the next 30 days. Anniversaries start at one year.</div>}</Block>
          </>}
          {tab === "joiners" && <Block title="Joined in the last 30 days">{joiners.length ? <div className="cc-grid">{joiners.slice(0, 8).map((x) => <Person key={x.id || x.email} p={x} sub={dayLabel(x.start)} />)}</div> : <Empty art={<Crowd />} text="No new joiners lately." />}</Block>}
        </div>)}
    </div>
  );
}

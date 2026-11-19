import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { useData } from "../../data.jsx";
import BackButton from "../../components/BackButton.jsx";
import { Callout, SectionHead } from "../../components/ui.jsx";
import { Background, Card, Celebrate, LinkedIn, MissingNotice, Signature } from "./Personal.jsx";
import { Downloads, ReadyText, Templates } from "./Company.jsx";
import Manage from "./Manage.jsx";
import "./dk.css";

const IC = {
  mail: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3.5 7.5l8.5 6 8.5-6" /></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M7 10h6M7 14h3M16 10h1" /></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="2.5" /><path d="M16 10.5l5-3v9l-5-3" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></>,
  text: <><path d="M5 5h14M5 10h14M5 15h9" /></>,
  file: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></>,
  down: <><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></>,
  spark: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.600 5.600l2.100 2.100M16.300 16.300l2.100 2.100M5.600 18.400l2.100-2.100M16.300 7.700l2.100-2.100" /></>,
};
const NAV = [
  ["Made for you", [["signature", "Email signature", "mail"], ["card", "Business card", "card"], ["background", "Call background", "video"], ["linkedin", "LinkedIn kit", "user"], ["celebrate", "Welcome & celebrations", "spark"]]],
  ["Company", [["text", "Ready-to-use text", "text"], ["templates", "Templates", "file"], ["downloads", "Downloads", "down"]]],
];
const PERSONAL = ["signature", "card", "background", "linkedin", "celebrate"];

/* My Digital Kit: what I can use as a Wohlig employee. The first four are made from my own details; the next three are the company's shared resources. */
export default function DigitalKit() {
  const { profile } = useData();
  const [kit, setKit] = useState(null);
  const [err, setErr] = useState("");
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") || "signature";
  const load = useCallback(async () => {
    const r = await api("GET", "/api/digital-kit");
    if (r.ok) { setKit(r.data); setErr(""); } else setErr(apiMsg(r));
  }, []);
  useEffect(() => { load(); }, [load]);

  const go = (k) => setSp({ tab: k }, { replace: true });
  const count = (k, r) => ({ text: r.text.length, templates: r.template.length, downloads: 5 + r.download.length + r.card.length + r.background.length + r.linkedin.length })[k];

  if (err) return <section className="section"><BackButton /><SectionHead eyebrow="Me" title="My Digital" accent="Kit." /><Callout>{err}</Callout></section>;
  if (!kit) return <section className="section"><BackButton /><div className="empty">Loading your Digital Kit…</div></section>;
  const p = kit.person, r = kit.resources;

  return (
    <section className="section dk">
      <SectionHead eyebrow="Me" title="My Digital" accent="Kit."
        sub="Everything you need to look and sound like Wohlig: made from your own details, plus the company's text, templates and files." />
      <div className="dk-shell">
        <nav className="dk-side" aria-label="Digital Kit sections">
          {NAV.map(([group, items]) => (
            <div className="dk-side-group" key={group}>{group !== "Company" && <h4>{group}</h4>}
              {items.map(([k, label, ic]) => (
                <button key={k} type="button" className={tab === k ? "on" : ""} aria-current={tab === k ? "page" : undefined} onClick={() => go(k)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{IC[ic]}</svg>
                  <span>{label}</span>{count(k, r) != null && <em>{count(k, r)}</em>}
                </button>))}
            </div>))}
          <p className="dk-side-note">{p.title ? <>Matched to your role: <b>{p.title}</b></> : <>Add your designation (ask HR) and the company resources for your role appear here.</>}</p>
          {kit.isHr && <div className="dk-side-group">
            <button type="button" className={tab === "manage" ? "on" : ""} aria-current={tab === "manage" ? "page" : undefined} onClick={() => go("manage")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{IC.gear}</svg><span>Manage</span></button></div>}
        </nav>
        <div className="dk-main">
          {PERSONAL.includes(tab) && <MissingNotice missing={kit.missing} />}
          {tab === "signature" && <Signature p={p} />}
          {tab === "card" && <Card p={p} />}
          {tab === "background" && <Background p={p} />}
          {tab === "linkedin" && <LinkedIn p={p} />}
          {tab === "celebrate" && <Celebrate p={p} />}
          {tab === "text" && <ReadyText items={r.text} p={p} />}
          {tab === "templates" && <Templates items={r.template} p={p} />}
          {tab === "downloads" && <Downloads items={r.download} p={p} photoV={profile && profile.photoV} extra={{ background: r.background, linkedin: r.linkedin, card: r.card }} />}
          {tab === "manage" && kit.isHr && <Manage onChanged={load} />}
          {tab === "manage" && !kit.isHr && <Callout>Only HR can manage the Digital Kit. <Link to="/app/digital-kit">Back to my kit</Link></Callout>}
        </div>
      </div>
    </section>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { useData } from "../../data.jsx";
import BackButton from "../../components/BackButton.jsx";
import { Callout, SectionHead } from "../../components/ui.jsx";
import { Background, Card, LinkedIn, MissingNotice, Signature } from "./Personal.jsx";
import { Downloads, ReadyText, Templates } from "./Company.jsx";
import Manage from "./Manage.jsx";
import "./dk.css";

const PERSONAL = [["signature", "Email signature"], ["card", "Business card"], ["background", "Call background"], ["linkedin", "LinkedIn kit"]];
const COMPANY = [["text", "Ready-to-use text"], ["templates", "Templates"], ["downloads", "Downloads"]];

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
  const Tab = ([k, label]) => <button key={k} type="button" role="tab" className={tab === k ? "on" : ""} aria-selected={tab === k} onClick={() => go(k)}>{label}</button>;

  if (err) return <section className="section"><BackButton /><SectionHead eyebrow="Me" title="My Digital" accent="Kit." /><Callout>{err}</Callout></section>;
  if (!kit) return <section className="section"><BackButton /><div className="empty">Loading your Digital Kit…</div></section>;
  const p = kit.person, r = kit.resources;

  return (
    <section className="section dk">
      <SectionHead eyebrow="Me" title="My Digital" accent="Kit."
        sub="Your email signature, business card, call backgrounds and LinkedIn kit, made from your details, plus the company's text, templates and downloads." />
      <div className="dk-tabs">
        <div className="dk-tabgroup"><span>Made for you</span><div className="subtabs" role="tablist" aria-label="Made for you">{PERSONAL.map(Tab)}</div></div>
        <div className="dk-tabgroup"><span>Company resources</span><div className="subtabs" role="tablist" aria-label="Company resources">{COMPANY.map(Tab)}</div></div>
        {kit.isHr && <div className="dk-tabgroup"><span>HR</span><div className="subtabs" role="tablist" aria-label="HR"><button type="button" role="tab" className={tab === "manage" ? "on" : ""} aria-selected={tab === "manage"} onClick={() => go("manage")}>Manage</button></div></div>}
      </div>

      {PERSONAL.some(([k]) => k === tab) && <MissingNotice missing={kit.missing} />}

      {tab === "signature" && <Signature p={p} />}
      {tab === "card" && <Card p={p} />}
      {tab === "background" && <Background p={p} />}
      {tab === "linkedin" && <LinkedIn p={p} />}
      {tab === "text" && <ReadyText items={r.text} p={p} />}
      {tab === "templates" && <Templates items={r.template} p={p} />}
      {tab === "downloads" && <Downloads items={r.download} p={p} photoV={profile && profile.photoV} extra={{ background: r.background, linkedin: r.linkedin, card: r.card }} />}
      {tab === "manage" && kit.isHr && <Manage onChanged={load} />}
      {tab === "manage" && !kit.isHr && <Callout>Only HR can manage the Digital Kit. <Link to="/app/digital-kit">Back to my kit</Link></Callout>}
    </section>
  );
}

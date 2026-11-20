import { useEffect, useState } from "react";
import { api, apiMsg } from "../../api.js";
import { useData } from "../../data.jsx";
import { Callout, SectionHead, PageSkeleton } from "../../components/ui.jsx";
import { Downloads, Templates } from "./Company.jsx";

/* Org > Documents: the company's shared templates and files. They are the same resources HR manages in the Digital Kit,
   shown here on their own so nobody has to look for them inside a personal kit. */
export default function OrgDocuments() {
  const { profile } = useData();
  const [kit, setKit] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { api("GET", "/api/digital-kit").then((r) => { if (r.ok) setKit(r.data); else setErr(apiMsg(r)); }); }, []);
  if (err) return <section className="section"><SectionHead title="Organisation documents" /><Callout>{err}</Callout></section>;
  if (!kit) return <PageSkeleton />;
  const p = kit.person, r = kit.resources;
  return (
    <section className="section dk">
      <SectionHead title="Organisation documents" sub="Company templates and files that everyone can use. HR keeps them up to date." />
      <Templates items={r.template} p={p} />
      <Downloads items={r.download} p={p} photoV={profile && profile.photoV} extra={{ background: [], linkedin: [], card: [] }} />
    </section>
  );
}

import { useEffect, useState } from "react";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import { PageSkeleton, SectionHead, Skeleton } from "../../components/ui.jsx";
import { BRAND } from "../../brand.js";

/* A preview of the card, drawn in the same layout as the PDF (the server draws the PDF: CR80, 85.6 x 54 mm, front and back).
   It loads the card's details from the server, which applies the same access rules as the PDF. */
export function Card({ email }) {
  const [c, setC] = useState(null), [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    setC(null); setErr("");
    api("GET", `/api/id-card.json?email=${encodeURIComponent(email)}`).then((r) => { if (!live) return; if (r.ok) setC(r.data); else setErr(apiMsg(r)); });
    return () => { live = false; };
  }, [email]);
  const face = "grid aspect-[54/85.6] w-full max-w-[260px] overflow-hidden rounded-card border border-line bg-surface text-center shadow-raised";
  if (err) return <div className="empty">{err}</div>;
  if (!c) return <Skeleton className="aspect-[54/85.6] w-full max-w-[260px] rounded-card" />;
  const initials = c.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className={`${face} grid-rows-[52%_1fr]`} aria-label="ID card, front">
        <div className="flex flex-col items-center bg-maroon px-3 pt-[9%] text-ivory">
          <span className="grid aspect-square w-[44%] place-items-center overflow-hidden rounded-full border-4 border-white bg-beige font-display text-2xl text-maroon">
            {c.photoV ? <img src={`/api/profile/photo?email=${encodeURIComponent(email)}&v=${c.photoV}`} alt="" className="size-full object-cover" /> : initials}
          </span>
          <b className="mt-3 font-body text-[17px] leading-tight font-normal text-white">{c.name}</b>
          {c.title && c.title !== "—" && <span className="mt-1 text-[13px]">{c.title}</span>}
        </div>
        <div className="flex flex-col items-center justify-between px-3 py-3">
          <dl className="m-0 grid w-full grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-left text-[11px] leading-snug">
            {c.rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-ink-dim">{k}</dt><dd className="m-0 break-words text-ink">{v}</dd></div>)}
          </dl>
          <img src={BRAND.logos.mark} alt="" className="size-7" />
        </div>
      </div>
      <div className={`${face} grid-rows-[1fr_3%]`} aria-label="ID card, back">
        <div className="flex flex-col items-center px-4 pt-[14%]">
          <img src={BRAND.logos.light} alt="" className="h-auto w-[46%]" />
          <b className="mt-3 text-[12px] tracking-wide text-maroon">{BRAND.company.legalName.toUpperCase()}</b>
          <dl className="mt-6 w-full space-y-3 text-left">
            <div><dt className="text-[11px] tracking-widest text-ink-dim">EMAIL</dt><dd className="m-0 break-all text-[13px] font-bold text-ink">{c.email}</dd></div>
            {c.joined && <div><dt className="text-[11px] tracking-widest text-ink-dim">JOINED</dt><dd className="m-0 text-[13px] font-bold text-ink">{c.joined}</dd></div>}
          </dl>
          <p className="mt-5 text-[12px] leading-snug text-ink-dim">This card belongs to Wohlig. If found, please return it to the HR team.</p>
        </div>
        <div className="bg-maroon" />
      </div>
    </div>
  );
}

export default function IdCard() {
  const { user, canAll } = useAuth();
  const { people } = useData();
  const [who, setWho] = useState("");
  if (!people) return <PageSkeleton stats={0} />;
  const current = people.filter((p) => p.status !== "offboarded");
  const email = (who || user.email).toLowerCase();
  const p = people.find((x) => x.email.toLowerCase() === email);
  const seesAll = canAll("people.view");
  return (
    <section className="section">
      <SectionHead title="ID card" sub="Your Wohlig ID card, in the standard card size (85.6 × 54 mm). Download it as a PDF to print on any card printer."
        actions={<>
          {p && <a className="btn primary" href={`/api/id-card.pdf?email=${encodeURIComponent(p.email)}`} download>Download PDF</a>}
          {seesAll && <a className="btn glass" href="/api/id-cards.pdf" download>Download everyone's cards</a>}
        </>} />
      {seesAll && (
        <div className="card"><div className="card-b">
          <label htmlFor="idc-who" className="mb-2 block font-bold text-ink-dim">Show the card for</label>
          <select id="idc-who" className="input" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Me</option>
            {current.slice().sort((a, b) => a.name.localeCompare(b.name)).map((x) => <option key={x.email} value={x.email}>{x.name}{x.no ? ` (${x.no})` : ""}</option>)}
          </select>
        </div></div>)}
      {p ? <div className="card"><div className="card-b"><Card email={p.email} /></div></div>
        : <div className="card"><div className="empty">Your employee record was not found. Please ask the HR team to check your work email.</div></div>}
    </section>
  );
}

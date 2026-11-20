import { useState } from "react";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import { PageSkeleton, SectionHead } from "../../components/ui.jsx";
import { BRAND } from "../../brand.js";

/* A preview of the card, drawn in the same layout as the PDF (the server draws the PDF: CR80, 85.6 x 54 mm, front and back). */
export function Card({ p }) {
  const initials = p.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase();
  const face = "grid aspect-[54/85.6] w-full max-w-[260px] overflow-hidden rounded-card border border-line bg-ivory text-center shadow-raised";
  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className={`${face} grid-rows-[27%_1fr_3%]`} aria-label="ID card, front">
        <div className="grid place-items-center bg-maroon"><img src={BRAND.logos.dark} alt={BRAND.company.name} className="h-auto w-[48%]" /></div>
        <div className="flex flex-col items-center px-3 pt-0">
          <span className="-mt-[14%] grid aspect-square w-[48%] place-items-center overflow-hidden rounded-full border-4 border-ivory bg-beige font-display text-2xl text-maroon outline-2 outline-maroon">
            {p.photoV ? <img src={`/api/profile/photo?email=${encodeURIComponent(p.email)}&v=${p.photoV}`} alt="" className="size-full object-cover" /> : initials}
          </span>
          <b className="mt-3 font-display text-[17px] leading-tight text-maroon">{p.name}</b>
          {p.title && p.title !== "—" && <span className="mt-1 text-[13px] text-ink">{p.title}</span>}
          {p.dept && p.dept !== "—" && <span className="text-[13px] text-ink-dim">{p.dept}</span>}
          <span className="my-3 h-0.5 w-8 bg-orange" />
          <span className="text-[11px] tracking-widest text-ink-dim">EMPLOYEE ID</span>
          <b className="text-[17px] text-ink">{p.no || "—"}</b>
        </div>
        <div className="bg-maroon" />
      </div>
      <div className={`${face} grid-rows-[1fr_3%]`} aria-label="ID card, back">
        <div className="flex flex-col items-center px-4 pt-[14%]">
          <img src={BRAND.logos.light} alt="" className="h-auto w-[46%]" />
          <b className="mt-3 text-[12px] tracking-wide text-maroon">{BRAND.company.legalName.toUpperCase()}</b>
          <dl className="mt-6 w-full space-y-3 text-left">
            <div><dt className="text-[11px] tracking-widest text-ink-dim">EMAIL</dt><dd className="m-0 break-all text-[13px] font-bold text-ink">{p.email}</dd></div>
            {p.start && <div><dt className="text-[11px] tracking-widest text-ink-dim">JOINED</dt><dd className="m-0 text-[13px] font-bold text-ink">{new Date(p.start).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</dd></div>}
            <div><dt className="text-[11px] tracking-widest text-ink-dim">WEBSITE</dt><dd className="m-0 text-[13px] font-bold text-ink">{BRAND.company.website.replace(/^https?:\/\//, "")}</dd></div>
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
      {p ? <div className="card"><div className="card-b"><Card p={p} /></div></div>
        : <div className="card"><div className="empty">Your employee record was not found. Please ask the HR team to check your work email.</div></div>}
    </section>
  );
}

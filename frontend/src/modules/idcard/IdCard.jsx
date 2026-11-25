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
  const face = "relative aspect-[54/85.6] w-full max-w-[260px] overflow-hidden rounded-card border border-line bg-surface shadow-raised";
  if (err) return <div className="empty">{err}</div>;
  if (!c) return <Skeleton className="aspect-[54/85.6] w-full max-w-[260px] rounded-card" />;
  const initials = c.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase();
  const HEX = "[clip-path:polygon(50%_0,100%_25%,100%_75%,50%_100%,0_75%,0_25%)]";
  const { company } = BRAND;
  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className={face} aria-label="ID card, front">
        {/* the bands, stripes and the hexagon frame, drawn on the card's own 153 x 243 grid, the same as the PDF */}
        <svg viewBox="0 0 153.07 242.65" className="absolute inset-0 size-full" aria-hidden="true">
          <polygon points="0,38 76.5,62 76.5,76 0,52" className="fill-maroon" /><polygon points="153.07,38 76.5,62 76.5,76 153.07,52" className="fill-maroon" />
          <polygon points="0,54 76.5,78 76.5,81 0,57" className="fill-orange" /><polygon points="153.07,54 76.5,78 76.5,81 153.07,57" className="fill-orange" />
          <polygon points="0,108 17,115 17,119 0,112" className="fill-maroon" /><polygon points="153.07,108 136.07,115 136.07,119 153.07,112" className="fill-maroon" />
          <polygon points="0,116 17,123 17,127 0,120" className="fill-orange" /><polygon points="153.07,116 136.07,123 136.07,127 153.07,120" className="fill-orange" />
          <polygon points="76.5,55 105.1,71.5 105.1,104.5 76.5,121 47.9,104.5 47.9,71.5" className="fill-surface stroke-maroon" strokeWidth="2.4" />
          <path d="M0 231.65Q76.5 221.65 153.07 231.65V242.65H0Z" className="fill-maroon" /><path d="M0 230.15Q76.5 220.15 153.07 230.15" className="fill-none stroke-orange" strokeWidth="1.2" />
        </svg>
        <img src={BRAND.logos.light} alt="" className="absolute top-[3.7%] left-1/2 w-[38%] -translate-x-1/2" />
        <span className={`absolute top-[24%] left-[32.4%] grid h-[25.4%] w-[35.2%] place-items-center bg-beige font-display text-2xl text-maroon ${HEX}`}>
          {c.photoV ? <img src={`/api/profile/photo?email=${encodeURIComponent(email)}&v=${c.photoV}`} alt="" className="size-full object-cover" /> : initials}
        </span>
        <div className="absolute inset-x-[5%] top-[51.5%] text-center">
          <b className="block text-[13px] leading-tight tracking-wide text-ink uppercase">{c.name}</b>
          {c.title && c.title !== "—" && <span className="mt-1 block text-[9.5px] tracking-wide text-ink-dim uppercase">{c.title}</span>}
        </div>
        <dl className="absolute top-[62.9%] right-[4%] left-[6.5%] m-0 flex flex-col p-0 text-[10px] leading-none" style={{ height: `${c.rows.length * 4.95}%` }}>
          {c.rows.map(([k, v]) => <div key={k} className="grid min-h-0 flex-1 grid-cols-[34%_1fr] items-center"><dt className="m-0 p-0 text-[8.5px] text-ink-dim">{k}</dt><dd className="m-0 truncate p-0 text-ink" title={v}>{v}</dd></div>)}
        </dl>
      </div>
      <div className={face} aria-label="ID card, back">
        <img src={BRAND.logos.light} alt="" className="absolute top-[6.6%] left-1/2 w-[42%] -translate-x-1/2" />
        <ul className="absolute inset-x-[7.5%] top-[23%] m-0 list-disc space-y-[2.2%] pl-3 text-[9px] leading-snug text-ink">
          {["The holder of this card is a registered employee of Wohlig Transformations.", "By the registration, the holder agrees to abide by the rules and regulations of the company.", "Anyone finding this card is requested to return it to the HR team at the address below."].map((t) => <li key={t}>{t}</li>)}
        </ul>
        <div className="absolute inset-x-0 top-[60%] text-center"><b className="block text-[10px] text-ink">Emergency Contact No.</b><b className="block text-[12.5px] text-maroon">{c.emergency?.phone || "—"}</b>
          {c.emergency?.who && <span className="block text-[8.5px] text-ink">{c.emergency.who}</span>}</div>
        <div className="absolute inset-x-0 bottom-0 h-[27.2%] border-t-[3px] border-orange bg-maroon px-[6%] pt-[5%] text-center text-ivory">
          <b className="block text-[10px] text-white">{company.legalNameShort.replace(/ Pvt Ltd$/, " Pvt. Ltd.")}</b>
          <span className="mt-1 block text-[8px] leading-snug">{company.address}</span>
          <b className="mt-1.5 block text-[9.5px] text-white">{company.website.replace(/^https?:\/\//, "www.")}</b>
        </div>
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

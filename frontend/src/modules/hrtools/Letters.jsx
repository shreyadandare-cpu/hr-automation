import { useState } from "react";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import { Callout, SectionHead, shortDate, PageSkeleton } from "../../components/ui.jsx";
import { BRAND } from "../../brand.js";

const longDate = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "__________");
const or = (v, blank = "__________") => (v && v !== "—" ? v : blank);

/* The letters HR issues most. Each is plain wording with the person's details filled in from the staff list; anything the
   app does not know is left as a blank line to fill in by hand. HR must read every letter before it is signed. */
const LETTERS = {
  confirmation: { name: "Confirmation of employment", body: (p, d) => [
    `Dear ${p.name},`,
    `We are pleased to confirm your employment with ${BRAND.company.legalName} as ${or(p.title)}${p.dept && p.dept !== "—" ? ` in the ${p.dept} team` : ""}, with effect from ${d.effective}.`,
    `You joined us on ${longDate(p.start)} and have completed your probation successfully. All other terms of your appointment remain the same.`,
    "We thank you for your contribution and wish you continued success with us.",
  ] },
  experience: { name: "Experience letter", body: (p) => [
    "To whom it may concern,",
    `This is to certify that ${p.name} (employee ID ${or(p.no)}) worked with ${BRAND.company.legalName} from ${longDate(p.start)} to ${longDate(p.lastDay)}.`,
    `At the time of leaving, ${p.name} held the position of ${or(p.title)}${p.dept && p.dept !== "—" ? ` in the ${p.dept} team` : ""}.`,
    "We wish them every success in their future work.",
  ] },
  relieving: { name: "Relieving letter", body: (p) => [
    `Dear ${p.name},`,
    `Further to your resignation, you are relieved from your duties as ${or(p.title)} at ${BRAND.company.legalName} at the close of working hours on ${longDate(p.lastDay)}.`,
    "We confirm that you have handed over your responsibilities and returned all company property in your possession.",
    "We thank you for your work and wish you the very best.",
  ] },
  employment: { name: "Proof of employment", body: (p) => [
    "To whom it may concern,",
    `This is to certify that ${p.name} (employee ID ${or(p.no)}) has been employed with ${BRAND.company.legalName} since ${longDate(p.start)} and currently holds the position of ${or(p.title)}${p.dept && p.dept !== "—" ? ` in the ${p.dept} team` : ""}.`,
    "This letter is issued at the request of the employee and carries no financial commitment on the part of the company.",
  ] },
};

/* HR > Letters: pick a person and a letter; the wording is filled in and can be printed or saved as a PDF from the
   browser's print window. Nothing is stored and nothing is sent. */
export default function Letters() {
  const { can, user } = useAuth();
  const { people } = useData();
  const [email, setEmail] = useState(""), [kind, setKind] = useState("confirmation");
  if (!can("people.edit")) return <section className="section"><SectionHead title="Letters" /><div className="empty">Only the people who edit staff details can prepare letters.</div></section>;
  if (!people) return <PageSkeleton />;
  const list = [...people].sort((a, b) => a.name.localeCompare(b.name));
  const p = list.find((x) => x.email === email);
  const now = new Date();   // the date on the letter is today where HR is, not the date in UTC
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const paras = p ? LETTERS[kind].body(p, { effective: longDate(today) }) : [];
  const missing = p ? [["joining date", p.start], ["designation", p.title && p.title !== "—"], ...(kind === "experience" || kind === "relieving" ? [["last working day", p.lastDay]] : [])].filter(([, v]) => !v).map(([k]) => k) : [];
  const signer = (people.find((x) => x.email.toLowerCase() === user.email.toLowerCase()) || { name: user.name, title: "" });
  return (
    <section className="section">
      <SectionHead title="Letters" sub="Prepare a letter with the person's details filled in, then print it or save it as a PDF. Please read every letter before it is signed."
        actions={<button type="button" className="btn primary" disabled={!p} onClick={() => window.print()}>Print or save as PDF</button>} />
      <div className="card no-print"><div className="filters">
        <select className="input grow" aria-label="Person" value={email} onChange={(e) => setEmail(e.target.value)}><option value="">Choose a person</option>{list.map((x) => <option key={x.email} value={x.email}>{x.name}{x.status === "offboarded" ? " (left)" : ""}</option>)}</select>
        <select className="input" aria-label="Letter" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(LETTERS).map(([k, l]) => <option key={k} value={k}>{l.name}</option>)}</select>
      </div></div>
      {missing.length > 0 && <Callout>The staff list has no {missing.join(" or ")} for {p.name}, so that part is left blank. Please add it on their page, or fill it in by hand.</Callout>}
      {p ? (
        <article className="card lt-page" aria-label={`${LETTERS[kind].name} for ${p.name}`}>
          <img className="lt-logo" src={BRAND.logos.light} alt={BRAND.company.name} />
          <p className="lt-date">{longDate(today)}</p>
          <h2>{LETTERS[kind].name}</h2>
          {paras.map((t, i) => <p key={i}>{t}</p>)}
          <div className="lt-sign"><p>Yours sincerely,</p><p className="lt-gap" /><p><b>{signer.name}</b><br />{or(signer.title, "Human Resources")}<br />{BRAND.company.legalName}</p></div>
        </article>)
        : <div className="card"><div className="empty">Choose a person and a letter to see it here.</div></div>}
      <p className="muted no-print">Joined dates, designations and last working days come from the staff list{p ? ` (${p.name}: joined ${p.start ? shortDate(p.start) : "not set"})` : ""}. The wording is a starting point, not legal advice.</p>
    </section>
  );
}

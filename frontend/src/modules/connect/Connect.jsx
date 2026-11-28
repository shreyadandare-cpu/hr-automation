import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { PRODUCT } from "../../brand.js";
import { CardSkeleton, SectionHead } from "../../components/ui.jsx";

/* Claude's Connect button for the Wohlig One connector lands here (via /oauth/authorize, oauth.js). The person sees which app
   asks, what it can and cannot do, and allows or cancels; either way they go back to the app. */
const CAN = ["See and do what you can do here: your leave, attendance, requests and profile",
  "The HR work you are allowed to do, such as deciding leave, following onboarding or answering the helpdesk",
  "Every change it makes is recorded in the audit log under your name"];
const NEVER = ["Salaries, payslips, payroll and every other payment", "Tax, bank details, PAN and Aadhaar", "Your documents and document password",
  "Access rights, logins and passwords",
  "Other people's phone numbers, addresses, dates of birth and family details (only the salary owners see these)"];

const List = ({ items, mark }) => (
  <ul className="m-0 flex list-none flex-col gap-2 p-0">
    {items.map((t) => (
      <li key={t} className="flex gap-3 text-[15px] leading-snug text-ink">
        <span aria-hidden="true" className={`mt-0.5 grid size-5 flex-none place-items-center rounded-full text-[14px] font-bold ${mark === "yes" ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{mark === "yes" ? "✓" : "✕"}</span>
        <span>{t}</span>
      </li>
    ))}
  </ul>
);

export default function Connect() {
  const { id } = useParams();
  const [req, setReq] = useState(null);     // { clientName, returnsTo, freshSignIn, freshMinutes, email } or { error }
  const [busy, setBusy] = useState(null);   // "allow" | "cancel"
  const [err, setErr] = useState("");
  useEffect(() => { api("GET", `/api/oauth/requests/${encodeURIComponent(id)}`).then((r) => setReq(r.ok ? r.data : { error: apiMsg(r) })); }, [id]);

  const decide = async (what) => {
    setBusy(what); setErr("");
    const r = await api("POST", `/api/oauth/requests/${encodeURIComponent(id)}/${what === "allow" ? "approve" : "deny"}`);
    if (r.ok) { location.href = r.data.redirect; return; }
    setBusy(null);
    if (r.data && r.data.needsFreshSignIn) setReq({ ...req, freshSignIn: false }); else setErr(apiMsg(r));
  };
  // Signing out and opening this page again goes through sign-in and comes back here (pages.js keeps the page for 15 minutes).
  const signInAgain = async () => { await api("POST", "/api/logout"); location.href = location.pathname; };

  return (
    <section className="section">
      <SectionHead title={req && req.clientName ? `Connect ${req.clientName} to ${PRODUCT}` : `Connect an app to ${PRODUCT}`} sub="An app is asking to work in the portal for you." />
      {!req ? <CardSkeleton lines={6} /> : req.error ? (
        <div className="card"><div className="card-b">
          <p role="alert" className="m-0 text-[15px] text-ink">{req.error}</p>
        </div></div>
      ) : (
        <div className="card max-w-[720px]"><div className="card-b flex flex-col gap-5">
          <p className="m-0 text-[16px] leading-relaxed text-ink">
            <strong className="[overflow-wrap:anywhere]">{req.clientName}</strong> would like to use {PRODUCT} as you
            (<span className="[overflow-wrap:anywhere]">{req.email}</span>).
          </p>
          <div className="rounded-field border border-line bg-tint px-4 py-3">
            <div className="text-[14px] text-ink-dim">When you decide, you go back to</div>
            <div className="font-mono text-[18px] font-bold text-ink [overflow-wrap:anywhere]">{req.returnsTo}</div>
            <div className="mt-1 text-[14px] text-ink-dim">Please allow only if you started connecting from Claude yourself.</div>
          </div>
          <div>
            <h2 className="m-0 mb-3 font-display text-[18px] font-semibold text-ink">It will be able to</h2>
            <List items={CAN} mark="yes" />
          </div>
          <div>
            <h2 className="m-0 mb-3 font-display text-[18px] font-semibold text-ink">It will never see</h2>
            <List items={NEVER} mark="no" />
          </div>
          <p className="m-0 text-[15px] text-ink-dim">You can disconnect it at any time on Account &gt; Access keys for Claude.</p>
          {!req.freshSignIn && (
            <div role="alert" className="flex flex-col items-start gap-2 rounded-field border border-line bg-tint px-4 py-3 text-[15px] text-ink">
              For your safety, an app can be connected only within {req.freshMinutes} minutes of signing in. Please sign in again; you will come back to this page.
              <button type="button" className="btn glass" onClick={signInAgain}>Sign in again</button>
            </div>
          )}
          {err && <p role="alert" className="m-0 text-[15px] text-bad">{err}</p>}
          <div className="flex flex-wrap gap-3 max-sheet:flex-col-reverse max-sheet:[&_.btn]:w-full">
            <button type="button" className="btn glass" onClick={() => decide("cancel")} disabled={!!busy}>{busy === "cancel" ? "Cancelling…" : "Cancel"}</button>
            <button type="button" className="btn primary" onClick={() => decide("allow")} disabled={!!busy || !req.freshSignIn}>{busy === "allow" ? "Connecting…" : "Allow"}</button>
          </div>
        </div></div>
      )}
    </section>
  );
}

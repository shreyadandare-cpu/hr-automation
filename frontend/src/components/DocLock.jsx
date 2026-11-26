import { useEffect, useState } from "react";
import { api, apiMsg } from "../api.js";
import Modal, { Field } from "./Modal.jsx";
import { LineSkeleton } from "./ui.jsx";

/* The document password. Personal documents, tax proofs, Form 124 and payslips open only after the person enters their own
   document password (backend/src/doc-password.js), and every one of them leaves as a PDF locked with it (pdf-lock.js). Mounted once in the shell: any link to such a file is
   caught here, the dialog asks for the password (or to set one the first time), then the file opens. It stays open for ten
   minutes. Forgotten? The person sets a new one here or on the Account page; files saved earlier keep the old password. */
const LOCKED = /^\/api\/(documents\/\d+\/file|payslips\/[^/]+\/pdf|tax-declaration\/form-124|tax-declarations\/[^/]+\/proofs\/\d+\/file)(\?|$)/;
let until = 0;   // when the unlock ends, as the server said

export const docUnlocked = () => until > Date.now();
export const lockDocuments = async () => { until = 0; await api("POST", "/api/document-password/lock"); };

/* Opens a caught link the way the link asked: a new tab, a download, or this tab. */
function follow(a) {
  const x = document.createElement("a");
  x.href = a.href;
  if (a.target) x.target = a.target;
  if (a.hasAttribute("download")) x.setAttribute("download", a.getAttribute("download") || "");
  x.rel = "noopener";
  x.dataset.unlocked = "1";
  document.body.appendChild(x);
  x.click();
  x.remove();
}

export default function DocLockGate() {
  const [link, setLink] = useState(null);
  useEffect(() => {
    const onClick = (e) => {
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a || a.dataset.unlocked || e.defaultPrevented) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || !LOCKED.test(url.pathname + url.search) || docUnlocked()) return;
      e.preventDefault();
      setLink(a);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  if (!link) return null;
  return <DocPasswordDialog onClose={() => setLink(null)} onUnlocked={() => { const a = link; setLink(null); follow(a); }} />;
}

/* Asks for the document password, or has the person set one. Changing an existing one needs the current password, or, when it
   is forgotten, a sign-in from the last few minutes (the server says so; "Sign in again" signs out and back to the sign-in page). */
export function DocPasswordDialog({ onClose, onUnlocked, mode: start = null, saveLabel = "Save and open" }) {
  const [info, setInfo] = useState(null);   // { set, freshSignIn, minLength } from the server
  const [mode, setMode] = useState(start);   // "unlock" | "set"
  const [f, setF] = useState({ current: "", password: "", again: "" });
  const [err, setErr] = useState({});
  const [fresh, setFresh] = useState(false);   // the server asked for a new sign-in
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api("GET", "/api/document-password").then((r) => {
      const d = r.ok ? r.data : { set: false, freshSignIn: false, minLength: 10 };
      setInfo(d);
      setMode((m) => m || (d.set ? "unlock" : "set"));
    });
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (mode === "set" && f.password !== f.again) { setErr({ again: "The two passwords do not match." }); return; }
    setBusy(true); setErr({}); setFresh(false);
    const r = mode === "set" ? await api("PUT", "/api/document-password", { password: f.password, current: f.current || undefined })
      : await api("POST", "/api/document-password/unlock", { password: f.password });
    setBusy(false);
    if (!r.ok) {
      if (r.data && r.data.needsSetup) { setMode("set"); return; }
      if (r.data && r.data.needsFreshSignIn) { setFresh(true); return; }
      const fe = (r.data && r.data.errors) || {};
      setErr(fe.current ? { current: fe.current } : { password: fe.password || apiMsg(r) });
      return;
    }
    until = Date.parse(r.data.unlockedUntil) || Date.now() + 9 * 60_000;
    onUnlocked();
  };
  const signInAgain = async () => { await api("POST", "/api/logout"); location.href = "/login"; };

  const setting = mode === "set", changing = setting && info && info.set, min = (info && info.minLength) || 10;
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      {/* The title row sits outside the form: Modal styles a .card-h that is its own child. */}
      <div className="card-h"><h3>{!setting ? "Enter your document password" : changing ? "Change your document password" : "Set your document password"}</h3></div>
      <form onSubmit={submit} noValidate>
        <div className="card-b">
          {!info || !mode ? <><LineSkeleton width="w-full" /><LineSkeleton width="w-40" /></> : <>
            <p className="m-0 text-[15px] text-ink-dim">
              {!setting ? "Personal documents and payslips open only with your document password. They stay open for ten minutes in this browser."
                : changing ? "Enter your current document password. If you have forgotten it, leave it empty: you can set a new one within ten minutes of signing in."
                : "Personal documents and payslips open only with this password, and payslip PDFs you save are locked with it. It is yours alone: nobody else can see or reset it."}
            </p>
            {changing && <Field id="dp-cur" label="Current document password" hint={info.freshSignIn ? "You signed in a moment ago, so you may leave this empty." : null} error={err.current}>
              <input id="dp-cur" className="input" type="password" autoComplete="current-password" data-autofocus
                value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} aria-invalid={!!err.current} />
            </Field>}
            <Field id="dp-pass" label={setting ? "New document password" : "Document password"} hint={setting ? `At least ${min} characters.` : null} error={err.password}>
              <input id="dp-pass" className="input" type="password" autoComplete={setting ? "new-password" : "current-password"} data-autofocus={changing ? undefined : true}
                value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} aria-invalid={!!err.password} />
            </Field>
            {setting && <Field id="dp-again" label="New document password again" error={err.again}>
              <input id="dp-again" className="input" type="password" autoComplete="new-password"
                value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} aria-invalid={!!err.again} />
            </Field>}
            {fresh && <div role="alert" className="flex flex-col items-start gap-2 rounded-field border border-line bg-tint px-4 py-3 text-[15px] text-ink">
              To set a new password without the current one, please sign out, sign in again, and set it within ten minutes.
              <button type="button" className="btn glass sm" onClick={signInAgain}>Sign in again</button>
            </div>}
            {!setting && <button type="button" className="btn link self-start" onClick={() => { setMode("set"); setErr({}); setF({ current: "", password: "", again: "" }); }}>
              Forgot it? Set a new one
            </button>}
          </>}
        </div>
        <div className="modal-f">
          <button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !mode || !f.password}>{busy ? (setting ? "Saving…" : "Checking…") : setting ? saveLabel : "Open"}</button>
        </div>
      </form>
    </Modal>
  );
}

/* Shown where figures are held back until the document password is entered (payslips, My finances). */
export function UnlockPrompt({ what = "Your pay figures", onUnlocked }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card"><div className="card-b flex flex-wrap items-center justify-between gap-3">
      <p className="m-0 max-w-[60ch] text-[15px] text-ink-dim">{what} are locked. Please enter your document password to see them.</p>
      <button type="button" className="btn glass sm" onClick={() => setOpen(true)}>Enter document password</button>
      {open && <DocPasswordDialog saveLabel="Save and show" onClose={() => setOpen(false)} onUnlocked={() => { setOpen(false); onUnlocked(); }} />}
    </div></div>
  );
}

/* The Account page card: set the document password, or reset it when forgotten. */
export function DocPasswordCard({ toast }) {
  const [state, setState] = useState(null);   // { set } once read
  const [open, setOpen] = useState(false);
  useEffect(() => { api("GET", "/api/document-password").then((r) => setState(r.ok ? r.data : { set: false })); }, []);
  return (
    <div className="card"><div className="card-h"><h3>Document password</h3></div><div className="card-b">
      <p className="m-0 mb-3 max-w-[64ch] text-[15px] text-ink-dim">
        Your personal documents and payslips open only with this password, and payslip PDFs you save are locked with it.
        Only you can set or change it. If you change it, PDFs you saved before still open with the old password.
      </p>
      {!state ? <LineSkeleton width="w-48" />
        : <button type="button" className="btn glass" onClick={() => setOpen(true)}>{state.set ? "Change document password" : "Set document password"}</button>}
      {open && <DocPasswordDialog mode="set" saveLabel="Save password" onClose={() => setOpen(false)}
        onUnlocked={() => { setOpen(false); setState({ set: true }); toast("Your document password is saved."); }} />}
    </div></div>
  );
}

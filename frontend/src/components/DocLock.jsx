import { useEffect, useState } from "react";
import { api, apiMsg } from "../api.js";
import Modal, { Field } from "./Modal.jsx";
import { LineSkeleton } from "./ui.jsx";

/* The document password. Personal documents and payslip PDFs open only after the person enters their own document password
   (backend/src/doc-password.js); a payslip PDF is also locked with it. Mounted once in the shell: any link to such a file is
   caught here, the dialog asks for the password (or to set one the first time), then the file opens. It stays open for ten
   minutes. Forgotten? The person sets a new one here or on the Account page; files saved earlier keep the old password. */
const LOCKED = /^\/api\/(documents\/\d+\/file|payslips\/[^/]+\/pdf)(\?|$)/;
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

/* Asks for the document password, or has the person set one (first time, or "Forgot it?"). */
export function DocPasswordDialog({ onClose, onUnlocked, mode: start = null, saveLabel = "Save and open" }) {
  const [mode, setMode] = useState(start);   // "unlock" | "set" | null while we ask the server
  const [f, setF] = useState({ password: "", again: "" });
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (start) return;
    api("GET", "/api/document-password").then((r) => setMode(r.ok && r.data.set ? "unlock" : "set"));
  }, [start]);

  const submit = async (e) => {
    e.preventDefault();
    if (mode === "set" && f.password !== f.again) { setErr({ again: "The two passwords do not match." }); return; }
    setBusy(true); setErr({});
    const r = mode === "set" ? await api("PUT", "/api/document-password", { password: f.password })
      : await api("POST", "/api/document-password/unlock", { password: f.password });
    setBusy(false);
    if (!r.ok) {
      if (r.data && r.data.needsSetup) { setMode("set"); return; }
      setErr({ password: (r.data && r.data.errors && r.data.errors.password) || apiMsg(r) });
      return;
    }
    until = Date.parse(r.data.unlockedUntil) || Date.now() + 9 * 60_000;
    onUnlocked();
  };

  const setting = mode === "set";
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} noValidate>
        <div className="card-h"><h3>{setting ? "Set your document password" : "Enter your document password"}</h3></div>
        <div className="card-b">
          {!mode ? <><LineSkeleton width="w-full" /><LineSkeleton width="w-40" /></> : <>
            <p className="m-0 text-[15px] text-ink-dim">
              {setting
                ? "Personal documents and payslips open only with this password, and payslip PDFs you save are locked with it. It is yours alone: nobody else can see or reset it."
                : "Personal documents and payslips open only with your document password. They stay open for ten minutes."}
            </p>
            <Field id="dp-pass" label={setting ? "New document password" : "Document password"} hint={setting ? "At least 8 characters." : null} error={err.password}>
              <input id="dp-pass" className="input" type="password" autoComplete={setting ? "new-password" : "current-password"} data-autofocus
                value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} aria-invalid={!!err.password} />
            </Field>
            {setting && <Field id="dp-again" label="New document password again" error={err.again}>
              <input id="dp-again" className="input" type="password" autoComplete="new-password"
                value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} aria-invalid={!!err.again} />
            </Field>}
            {!setting && <button type="button" className="btn link self-start" onClick={() => { setMode("set"); setErr({}); setF({ password: "", again: "" }); }}>
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

/* The Account page card: set the document password, or reset it when forgotten. */
export function DocPasswordCard({ toast }) {
  const [state, setState] = useState(null);   // { set } once read
  const [open, setOpen] = useState(false);
  useEffect(() => { api("GET", "/api/document-password").then((r) => setState(r.ok ? r.data : { set: false })); }, []);
  return (
    <div className="card"><div className="card-h"><h3>Document password</h3></div><div className="card-b">
      <p className="m-0 mb-3 max-w-[64ch] text-[15px] text-ink-dim">
        Your personal documents and payslips open only with this password, and payslip PDFs you save are locked with it.
        Only you can set or reset it. If you reset it, PDFs you saved before still open with the old password.
      </p>
      {!state ? <LineSkeleton width="w-48" />
        : <button type="button" className="btn glass" onClick={() => setOpen(true)}>{state.set ? "Reset document password" : "Set document password"}</button>}
      {open && <DocPasswordDialog mode="set" saveLabel="Save password" onClose={() => setOpen(false)}
        onUnlocked={() => { setOpen(false); setState({ set: true }); toast("Your document password is saved."); }} />}
    </div></div>
  );
}

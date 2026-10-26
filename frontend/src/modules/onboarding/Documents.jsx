import { useEffect, useState } from "react";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import { SectionHead } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { DOCS, MAX_MB, ObTabs, DocRows, docCount, fileProblem, fmtSize, groupDocs } from "./shared.jsx";

/* HR reads what employees uploaded. */
function DocsHr() {
  const { people, docs, reload } = useData();
  useEffect(() => { reload(); }, [reload]);   // employees upload while HR is working
  if (!people) return <section className="section"><div className="empty">Loading…</div></section>;
  const by = groupDocs(docs);
  const mine = (e) => by[e.email.toLowerCase()] || {};
  const withDocs = people.filter((e) => docCount(mine(e)) > 0).sort((a, b) => a.name.localeCompare(b.name));
  const waiting = people.filter((e) => e.status === "onboarding" && !docCount(mine(e))).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section className="section">
      <ObTabs cur="docs" />
      <SectionHead eyebrow="Onboarding" title="Employee" accent="documents." sub="Employees upload their own documents after signing in. You can open or save every file here." />
      {withDocs.length ? withDocs.map((e) => { const m = mine(e), n = docCount(m); return (
        <div className="card" key={e.id}><div className="card-h"><h3>{e.name}</h3><span className="muted">{e.email} · {n} file{n === 1 ? "" : "s"}</span></div><DocRows m={m} /></div>
      ); }) : <div className="card"><div className="card-b muted">No employee has uploaded a document yet.</div></div>}
      {waiting.length > 0 && <div className="card"><div className="card-h"><h3>Waiting for documents</h3><span className="muted">{waiting.length} in onboarding, nothing uploaded yet</span></div><div className="card-b muted">{waiting.map((e) => e.name).join(", ")}</div></div>}
    </section>
  );
}

/* An employee uploads their own documents. */
function MyDocs() {
  const { user } = useAuth();
  const { docs, reload } = useData();
  const toast = useToast();
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const m = groupDocs(docs)[user.email.toLowerCase()] || {};

  const upload = async (def, input) => {
    const files = [...input.files];
    input.value = "";
    const cur = (m[def.k] || []).length;
    const probs = []; let added = 0, have = cur;
    setBusy(true);
    for (const f of files) {
      const p = fileProblem(f); if (p) { probs.push(p); continue; }
      if (def.multi && have >= def.max) { probs.push(`${def.name}: at most ${def.max} files.`); continue; }
      let r;
      try {
        r = await fetch(`/api/documents/${def.k}?name=${encodeURIComponent(f.name)}`, { method: "PUT", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f });
      } catch { probs.push(`${f.name}: the server could not be reached.`); continue; }
      if (r.status === 401) { location.href = "/login"; return; }
      const data = await r.json().catch(() => null);
      if (!r.ok) { probs.push(`${f.name}: ${(data && data.error) || "the server could not save this file."}`); continue; }
      if (!def.multi) have = 1; else have++;
      added++;
    }
    setErrs(probs.length ? { [def.k]: probs.join(" ") } : {});
    if (added) toast(`${def.name} uploaded. HR can see it.`);
    await reload();
    setBusy(false);
  };
  const remove = async (def, f) => {
    const r = await api("DELETE", "/api/documents/" + f.id);
    if (!r.ok) toast(apiMsg(r));
    setErrs({});
    reload();
  };
  const n = docCount(m);
  return (
    <section className="section">
      <SectionHead eyebrow="Onboarding" title="Your" accent="documents." sub="Upload your own documents for onboarding. HR can see them and fills in the document data from them." />
      <div className="card"><div className="card-h"><h3>Your documents</h3><span className="muted">{n} file{n === 1 ? "" : "s"} uploaded</span></div>
        {DOCS.map((def) => {
          const fl = m[def.k] || [], er = errs[def.k];
          return (
            <div className="doc-row" key={def.k}><div className="grow"><b>{def.name} <span className={`pill ${fl.length ? "p-ok" : "p-mute"}`}>{fl.length ? "Uploaded" : "Optional"}</span></b>
              <span className="sub">PDF, JPG or PNG, up to {MAX_MB} MB{def.multi ? `, up to ${def.max} files` : ""}</span>
              <div>{fl.map((f) => (
                <span className="fchip" key={f.id}><a href={`/api/documents/${f.id}/file`} target="_blank" rel="noopener">{f.name}</a> · {fmtSize(f.size)} · <a href={`/api/documents/${f.id}/file?download=1`} download={f.name}>Save</a>
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => remove(def, f)}>×</button></span>
              ))}</div>
              {er && <div className="derr" role="alert">{er}</div>}</div>
              <label className="btn glass sm" style={{ cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>{fl.length && !def.multi ? "Replace" : "Choose file" + (def.multi ? "s" : "")}
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple={!!def.multi} hidden disabled={busy} onChange={(e) => upload(def, e.target)} /></label></div>
          );
        })}
      </div>
    </section>
  );
}

export default function Documents() {
  const { isHr } = useAuth();
  return isHr ? <DocsHr /> : <MyDocs />;
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { api } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import Modal from "../../components/Modal.jsx";
import { Avatar, Icon } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { NEW_FROM, TOOLS, mgrOf, toolIds } from "../../lib/people.js";
import { lc, useLeave } from "../../lib/useLeave.js";
import { AppLoginCard } from "./access.jsx";
import { HistoryCard, LaptopCard, LaptopReturnModal, LeaveCard, ProjectsCard, OffCard, RecordCard, ReimbCard, fdate } from "./cards.jsx";
import { getLocal, patchLocal, useLocal } from "./local.js";

const ON_TASKS = ["Laptop issued", "Policy documents signed"];
const DEPTS = ["Engineering", "Data", "DevOps & Cloud", "Gen AI", "Sales", "HR", "Finance & Admin", "Leadership"];
const GRANT = {
  none: ["Not started", "p-mute"], provisioning: ["Giving access", "p-info p-busy"], active: ["Active", "p-ok"], created: ["Created, waiting for joining date", "p-warn"],
  invited: ["Invite sent", "p-info"], failed: ["Failed", "p-bad"], revoking: ["Removing", "p-warn p-busy"], revoked: ["Removed", "p-mute"],
};
const EMP = { onboarding: ["Onboarding", "p-info"], active: ["Active", "p-ok"], offboarding: ["Offboarding", "p-warn"], offboarded: ["Offboarded", "p-mute"] };

function EmpPill({ e }) {
  if (e.status === "active" && e.lastDay) return <span className="pill p-warn">Leaving {fdate(e.lastDay)}</span>;
  return <span className={`pill ${EMP[e.status][1]}`}>{EMP[e.status][0]}</span>;
}

/* Edit details: name, work email, job title, joining date and department. No API saves these, so they stay on this page (as in the old one). */
function EditModal({ e, people, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ name: e.name || "", email: e.email || "", title: e.title === "—" ? "" : e.title || "", start: e.start || "", dept: e.dept });
  const [emailErr, setEmailErr] = useState("");
  const taken = (email) => people.find((x) => x.id !== e.id && lc(x.email) === lc(email.trim()));
  const problem = (email) => {
    if (!email.trim()) return "Enter a work email.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return "Enter a valid work email, like name@wohlig.com.";
    const dup = taken(email); return dup ? `${email.trim().toLowerCase()} already belongs to ${dup.name}. Use a different work email.` : "";
  };
  const set = (k) => (ev) => { setF({ ...f, [k]: ev.target.value }); if (k === "email") setEmailErr(taken(ev.target.value) ? problem(ev.target.value) : ""); };
  const submit = (ev) => {
    ev.preventDefault();
    const v = { name: f.name.trim(), email: f.email.trim().toLowerCase(), title: f.title.trim() || "—", start: f.start, dept: f.dept };
    if (!v.name) { document.getElementById("e-name").focus(); toast("Add the employee's full name."); return; }
    const bad = problem(v.email); if (bad) { setEmailErr(bad); document.getElementById("e-email").focus(); return; }
    const diff = Object.keys(v).filter((k) => (e[k] || "") !== v[k]);
    if (!diff.length) { onClose(); toast("No changes to save."); return; }
    patchLocal(e.baseEmail, { edits: { ...(getLocal(e.baseEmail).edits || {}), ...Object.fromEntries(diff.map((k) => [k, v[k]])) } });
    onClose(); toast(`Saved changes for ${e.name}.`);
  };
  const F = [["name", "Full name", "text"], ["email", "Work email", "email"], ["title", "Job title", "text"], ["start", "Date of joining", "date"]];
  return (
    <Modal onClose={onClose}><form onSubmit={submit} noValidate>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Edit {e.name}</h3></div>
      <div className="card-b">
        {F.map(([k, l, ty]) => (
          <div className="field" key={k}><label htmlFor={`e-${k}`}>{l}</label>
            <input className={`input${k === "email" ? " mono" : ""}`} id={`e-${k}`} type={ty} value={f[k]} onChange={set(k)} {...(k === "email" ? { "aria-describedby": "e-email-err", "aria-invalid": !!emailErr } : {})} />
            {k === "email" && <span className="ferr" id="e-email-err" role="alert" hidden={!emailErr}>{emailErr}</span>}</div>
        ))}
        <div className="field"><label htmlFor="e-dept">Department</label><select className="input" id="e-dept" value={f.dept} onChange={set("dept")}>{[...new Set([f.dept, ...DEPTS])].map((d) => <option key={d}>{d}</option>)}</select></div>
        <div className="muted" style={{ fontSize: 13 }}>No server record stores these edits yet, so they show on this page until it is reloaded.</div></div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Cancel</button><button type="submit" className="btn primary">Save changes</button></div>
    </form></Modal>
  );
}

function EmployeeView({ p }) {
  const { isHr, user } = useAuth();
  const { people, docs, records, reload } = useData();
  const lv = useLeave();
  const toast = useToast();
  const loc = useLocal(p.email);
  const [rec, setRec] = useState(null);          // the offboarding record (HR)
  const [busy, setBusy] = useState(null);        // "provisioning" or "revoking" while a Claude call runs
  const [modal, setModal] = useState(null);      // "edit" | "laptop"

  const loadRec = useCallback(async () => {
    if (!isHr) return;
    const r = await api("GET", "/api/offboarding");
    if (r.ok && Array.isArray(r.data)) setRec(r.data.filter((o) => lc(o.email) === lc(p.email)).pop() || null);
  }, [isHr, p.email]);
  useEffect(() => { loadRec(); }, [loadRec]);

  const record = useMemo(() => records.find((x) => lc(x.email) === lc(p.email)), [records, p.email]);
  const status = loc.status && p.status === "onboarding" ? loc.status : p.status;
  const grants = { ...p.grants }, errors = { ...p.errors };
  if (rec) for (const s of rec.steps.filter((x) => x.kind === "tool")) {
    if (s.status === "done") { grants[s.key] = "revoked"; delete errors[s.key]; }
    else if (s.status === "failed") { grants[s.key] = "failed"; errors[s.key] = s.detail; }
  }
  if (busy) grants.claude = busy;
  const e = { ...p, ...(loc.edits || {}), baseEmail: p.email, status, grants, errors, laptop: loc.laptop, lastDay: rec && rec.lastDay ? String(rec.lastDay).slice(0, 10) : p.lastDay };
  const scheduled = !!(rec && rec.status === "scheduled");
  const isMe = lc(user.email) === lc(p.email);

  /* The checklist: tool steps are automatic, the rest are ticked by hand. */
  const phase = status === "offboarding" || status === "offboarded" ? "off" : "on";
  const auto = Object.keys(grants).filter((id) => ["claude"].includes(id)).map((id) => ({
    t: (phase === "on" ? "Give access: " : "Remove access: ") + TOOLS[id].name,
    done: phase === "on" ? grants[id] === "active" || grants[id] === "invited" : grants[id] === "revoked",
  }));
  const onTasks = loc.onTasks || ON_TASKS.map((t) => ({ t, done: !(p.start >= NEW_FROM) }));
  const manual = (phase === "on" ? onTasks : rec ? rec.steps.filter((s) => s.kind === "task").map((s) => ({ t: s.label, done: s.status === "done", key: s.key, detail: s.detail })) : []).map((x, i) => ({ ...x, i }));
  const total = auto.length + manual.length, done = auto.filter((x) => x.done).length + manual.filter((x) => x.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  // Onboarding closes by itself once every item is done (the server does the same for offboarding).
  useEffect(() => {
    if (status === "onboarding" && total > 0 && done === total && !loc.status) {
      patchLocal(p.email, { status: "active" }); toast(`${e.name} is fully onboarded`);
    }
  }, [status, total, done]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pending = toolIds(e).filter((k) => grants[k] === "none");
  const canOff = (status === "active" || status === "onboarding") && !scheduled;

  const toolDo = async (action) => {
    setBusy(action === "grant" ? "provisioning" : "revoking");
    let r; try { r = await api("POST", "/api/tool-access/claude", { email: p.email, action }); } catch { r = { ok: false, data: { error: "No server connection." } }; }
    if (r.ok) toast(r.data.mode === "simulated" ? "Done as a test only: Claude is not connected yet (no admin key)." : action === "grant" ? `Claude access for ${e.name}: ${r.data.detail}.` : `Claude access removed for ${e.name}.`);
    else toast((r.data && r.data.error) || "Request failed");
    await reload(); setBusy(null);
  };
  const remove = () => { if (confirm(`Remove ${e.name} from the Claude organization?`)) toolDo("remove"); };
  const retry = async (app) => {
    if (status === "offboarding") {
      if (!rec) return;
      const r = await api("POST", `/api/offboarding/${rec.id}/steps/${app}/retry`);
      if (!r.ok) { toast((r.data && (r.data.error || Object.values(r.data.errors || {})[0])) || "Could not save. Try again."); return; }
      setRec(r.data); reload();
      toast(r.data.steps.find((s) => s.key === app).status === "done" ? `${TOOLS[app].name} access removed.` : `${TOOLS[app].name} failed again.`);
      return;
    }
    toolDo("grant");
  };

  const tick = async (x, checked) => {
    if (!isHr) { toast("Only HR can do this."); return; }
    if (phase === "on") {
      patchLocal(p.email, { onTasks: onTasks.map((t, i) => (i === x.i ? { ...t, done: checked } : t)) });
      return;
    }
    if (!rec) return;
    if (checked && x.key === "laptop") { setModal("laptop"); return; }
    const r = await api("POST", `/api/offboarding/${rec.id}/steps/${x.key}`, { done: checked });
    if (!r.ok) { toast((r.data && (r.data.error || Object.values(r.data.errors || {})[0])) || "Could not save. Try again."); return; }
    setRec(r.data); reload();
    if (r.data.status === "completed") toast(`${e.name} is fully offboarded`);
  };

  return (
    <section className="section" style={{ gap: 22 }}>
      <Link className="back" to="/app/employees">← All employees</Link>
      <div className="card">
        <div className="profile"><Avatar person={e} /><div style={{ flex: 1, minWidth: 0 }}><div className="eyebrow">{e.dept}</div><h2 style={{ marginTop: 6 }}>{e.name}</h2><div style={{ color: "var(--ink-dim)", marginTop: 2 }}>{e.title}</div></div>
          <div className="row"><EmpPill e={e} />
            {isHr && status !== "offboarded" && <button className="btn glass sm" onClick={() => setModal("edit")}>Edit details</button>}
            {isHr && pending.length > 0 && <button className="btn primary sm" disabled={!!busy} onClick={() => toolDo("grant")}>Give access ({pending.length} tools)</button>}
            {isHr && canOff && <Link className="btn glass sm" to={`/app/offboarding?email=${encodeURIComponent(p.email)}`}><Icon name="offboard" />Offboard</Link>}</div></div>
        <dl className="facts">
          <div><dt>Employee no.</dt><dd className="mono">{e.no || "Not assigned"}</dd></div>
          <div><dt>Work email</dt><dd className="mono">{e.email}</dd></div>
          <div><dt>Date of joining</dt><dd>{fdate(e.start)}</dd></div>
          <div><dt>Reporting manager</dt><dd>{mgrOf(e) || "—"}</dd></div>
          <div><dt>Works from</dt><dd>{e.location || "—"}</dd></div>
          <div><dt>{status === "offboarded" ? "Left on" : "Last working day"}</dt><dd>{status === "offboarded" ? fdate(e.lastDay) : e.lastDay ? fdate(e.lastDay) : "Not set"}</dd></div>
        </dl>
      </div>
      <div className="grid g-main">
        <div className="card"><div className="card-h"><h3>Tool access</h3><span className="muted">{toolIds(e).filter((k) => grants[k] === "active").length} of {toolIds(e).length} active</span></div>
          {!toolIds(e).length && <div className="card-b muted">No Claude access yet.</div>}
          {toolIds(e).map((id) => (
            <div className="access-row" key={id}><span className="app-ic" style={{ background: TOOLS[id].color }} title={TOOLS[id].name}>{TOOLS[id].mono}</span>
              <div className="grow"><b>{TOOLS[id].name}</b><span className={grants[id] === "failed" ? "err" : ""}>{grants[id] === "failed" ? errors[id] || "Request failed" : grants[id] === "created" ? `Suspended until ${fdate(e.start)}, then activates automatically` : TOOLS[id].sub}</span></div>
              <span className={`pill ${GRANT[grants[id]][1]}`}>{GRANT[grants[id]][0]}</span>
              {isHr && grants[id] === "failed" && <button className="btn glass sm" onClick={() => retry(id)}>Retry</button>}
              {isHr && id === "claude" && status !== "offboarded" && ["none", "revoked"].includes(grants[id]) && <button className="btn primary sm" onClick={() => toolDo("grant")}>Give access</button>}
              {isHr && id === "claude" && ["active", "invited"].includes(grants[id]) && <button className="btn glass sm" onClick={remove}>Remove access</button>}
            </div>
          ))}
        </div>
        <div className="card"><div className="card-h"><h3>{phase === "on" ? "Onboarding" : "Offboarding"} checklist</h3><span className="muted">{done} of {total}</span></div>
          <div style={{ padding: "0 24px 14px" }}><div className="progress"><i style={{ width: `${pct}%` }} /></div></div>
          {auto.map((x) => (
            <div className={`check ${x.done ? "done" : ""}`} style={{ cursor: "default" }} key={x.t}><input type="checkbox" disabled checked={x.done} readOnly aria-label={x.t} /><div className="grow"><div className="lbl">{x.t}</div><div className="tag">Automatic</div></div></div>
          ))}
          {manual.map((x) => (
            <label className={`check ${x.done ? "done" : ""}`} key={x.i}>
              <input type="checkbox" id={`chk-${p.id}-${phase}-${x.i}`} checked={x.done} disabled={status === "offboarded"} onChange={(ev) => tick(x, ev.target.checked)} />
              <div className="grow"><div className="lbl">{x.t}</div>{x.detail && x.done && <div className="muted" style={{ fontSize: 13 }}>{x.detail}</div>}<div className="tag">Manual · {phase === "on" ? "IT / Admin" : "HR / Admin"}</div></div></label>
          ))}
        </div>
      </div>
      {isHr && status !== "offboarded" && <AppLoginCard person={{ ...e, email: p.email }} personalEmail={record && record.personalEmail} />}
      <LaptopCard key={p.email + (loc.laptop ? "1" : "0")} e={e} isHr={isHr} />
      <RecordCard e={e} record={record} docs={docs} isMe={isMe} isHr={isHr} />
      <OffCard e={e} rec={rec} scheduled={scheduled} isHr={isHr} onChanged={() => { loadRec(); reload(); }} />
      <ProjectsCard e={e} />
      <LeaveCard e={e} isHr={isHr} />
      {isHr && <ReimbCard e={e} />}
      {isHr && <HistoryCard email={p.email} />}
      {modal === "edit" && <EditModal e={e} people={people} onClose={() => setModal(null)} />}
      {modal === "laptop" && rec && <LaptopReturnModal e={e} rec={rec} today={lv.today} serial0={(loc.laptop && loc.laptop.serial) || ""} onClose={() => setModal(null)} onDone={(r) => { setRec(r); reload(); }} />}
    </section>
  );
}

export default function EmployeePage() {
  const { email } = useParams();
  const { people } = useData();
  if (!people) return <section className="section"><div className="empty">Loading…</div></section>;
  const p = people.find((x) => lc(x.email) === lc(email));
  if (!p) return <Navigate to="/app/employees" replace />;
  return <EmployeeView key={p.email} p={p} />;
}

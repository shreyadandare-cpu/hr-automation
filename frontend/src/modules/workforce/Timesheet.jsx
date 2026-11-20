import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { Callout, PersonCell, Pill, SectionHead, ViewTabs, ListSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { useList, usePerson, when } from "../engage/shared.jsx";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATUS = { draft: ["Not submitted", "mute"], submitted: ["Waiting for approval", "warn"], approved: ["Approved", "ok"], returned: ["Sent back", "bad"] };
const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (day) => { const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); return addDays(day, dow === 0 ? -6 : 1 - dow); };
const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const dayLabel = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const hrs = (m) => { const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h ${String(r).padStart(2, "0")}m` : `${h}h`; };
const asTyped = (m) => (m ? String(Math.round((m / 60) * 100) / 100) : "");
const NUM = "num-cell text-right";

/* Me > Timesheet: the hours you spent on each project, a week at a time. Your reporting manager approves the week
   (or a stand-in covering them, or HR). Approved hours decide how your cost is shared between projects. */
export default function Timesheet() {
  const [params, setParams] = useSearchParams();
  const { data: queue } = useList("/api/timesheets/to-approve");
  const canApprove = !!(queue && queue.canApprove);
  const view = params.get("view") === "approve" && canApprove ? "approve" : "mine";
  const setView = (v) => { const n = new URLSearchParams(params); if (v === "mine") n.delete("view"); else n.set("view", v); setParams(n, { replace: true }); };
  return (
    <section className="section">
      <SectionHead title="Timesheet" sub="Enter the hours you spent on each project, then submit the week for approval."
        tabs={canApprove ? <ViewTabs label="Timesheets" view={view} onView={setView} views={[["mine", "My week"], ["approve", "To approve"]]} /> : null} />
      {view === "approve" ? <Approve /> : <MyWeek />}
    </section>
  );
}

function MyWeek() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const week = mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(params.get("week") || "") ? params.get("week") : istToday());
  const go = (w) => { const n = new URLSearchParams(params); n.set("week", w); setParams(n, { replace: true }); };
  const [d, setD] = useState(null), [grid, setGrid] = useState({}), [err, setErr] = useState({}), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const load = async () => {
    const r = await api("GET", `/api/timesheet?week=${week}`);
    if (!r.ok) { setError(apiMsg(r)); setD({ rows: [], projects: [] }); return; }
    setError(""); setErr({}); setD(r.data);
    setGrid(Object.fromEntries(r.data.rows.map((l) => [String(l.projectId), l.minutes.map(asTyped)])));
  };
  useEffect(() => { setD(null); load(); }, [week]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <ListSkeleton />;
  const locked = d.status === "approved" || d.status === "submitted";
  const toMin = (v) => { const s = String(v || "").trim(); if (!s) return 0; const m = s.match(/^(\d{1,2}):([0-5]\d)$/); if (m) return Number(m[1]) * 60 + Number(m[2]); const n = Number(s); return Number.isFinite(n) ? Math.round(n * 60) : 0; };
  const dayTotal = (i) => d.rows.reduce((n, l) => n + toMin((grid[String(l.projectId)] || [])[i]), 0);
  const weekTotal = DAYS.reduce((n, _, i) => n + dayTotal(i), 0);
  const save = async (submit) => {
    setBusy(true);
    const r = await api("PUT", "/api/timesheet", { week, submit, rows: d.rows.map((l) => ({ projectId: l.projectId, hours: grid[String(l.projectId)] || [] })) });
    setBusy(false);
    if (!r.ok) { const e = (r.data && r.data.errors) || {}; setErr(e); toast(e.form || (r.data && r.data.errors ? "Please check the hours marked below." : apiMsg(r))); return; }
    toast(submit ? "Your week was sent for approval." : "Your hours were saved."); load();
  };
  const edit = async () => {   // a submitted week can be taken back to change it
    const r = await api("PUT", "/api/timesheet", { week, submit: false, rows: d.rows.map((l) => ({ projectId: l.projectId, hours: grid[String(l.projectId)] || [] })) });
    if (!r.ok) { toast(apiMsg(r)); return; }
    toast("The week is back with you to change."); load();
  };
  const [label, tone] = STATUS[d.status] || STATUS.draft;
  return (
    <>
      {error && <Callout>{error}</Callout>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn glass sm" onClick={() => go(addDays(week, -7))} aria-label="Previous week">Previous</button>
          <b className="font-display text-[18px] font-medium">Week of {dayLabel(week)}</b>
          <button type="button" className="btn glass sm" onClick={() => go(addDays(week, 7))} aria-label="Next week">Next</button>
          {week !== mondayOf(istToday()) && <button type="button" className="btn link nolink" onClick={() => go(mondayOf(istToday()))}>This week</button>}
        </div>
        <Pill tone={tone}>{label}</Pill>
      </div>
      {d.status === "returned" && d.decisionNote && <Callout>Sent back: {d.decisionNote} Please change the hours and submit the week again.</Callout>}
      <div className="card">
        <div className="tbl-wrap"><table>
          <thead><tr><th>Project</th>{DAYS.map((n, i) => <th key={n} className="text-right">{n}<div className="text-[12.5px] font-normal text-ink-faint">{dayLabel(addDays(week, i))}</div></th>)}<th className="text-right">Total</th></tr></thead>
          <tbody>
            {d.rows.map((l, ri) => {
              const key = String(l.projectId), vals = grid[key] || Array(7).fill("");
              return (
                <tr key={key}><td><b className="font-bold">{l.project}</b>{err[`row${ri}`] && <div className="ferr" role="alert">{err[`row${ri}`]}</div>}</td>
                  {DAYS.map((n, i) => <td key={n} className="text-right">
                    <input className="input w-[72px] text-right" inputMode="decimal" maxLength={5} disabled={locked} aria-label={`${l.project}, ${n} ${dayLabel(addDays(week, i))}, hours`} aria-invalid={!!err[`row${ri}`] || !!err[`day${i}`]}
                      value={vals[i] || ""} onChange={(e) => setGrid({ ...grid, [key]: vals.map((v, j) => (j === i ? e.target.value : v)) })} /></td>)}
                  <td className={NUM}>{hrs(vals.reduce((n, v) => n + toMin(v), 0))}</td></tr>);
            })}
            <tr className="font-bold [&>td]:border-t-2 [&>td]:border-line"><td>Total</td>{DAYS.map((n, i) => <td key={n} className={NUM}>{hrs(dayTotal(i))}{err[`day${i}`] && <div className="ferr" role="alert">Over 24 hours</div>}</td>)}<td className={NUM}>{hrs(weekTotal)}</td></tr>
          </tbody>
        </table></div>
        <div className="card-b flex flex-wrap items-center justify-between gap-3">
          <span className="text-[14px] text-ink-dim">{d.projects.length ? "Type hours as 7.5 or 7:30. Internal work is time not on a client project." : "You are not on a project this week, so all time goes to internal work. Projects are kept under Org, Allocations."}</span>
          <div className="flex flex-wrap gap-3">
            {d.status === "submitted" && <button type="button" className="btn glass" onClick={edit}>Take back to change</button>}
            {!locked && <><button type="button" className="btn glass" disabled={busy} onClick={() => save(false)}>Save</button><button type="button" className="btn primary" disabled={busy} onClick={() => save(true)}>{busy ? "Saving…" : "Submit week"}</button></>}
          </div>
        </div>
      </div>
    </>
  );
}

function Approve() {
  const toast = useToast(), person = usePerson();
  const [status, setStatus] = useState("submitted");
  const { data, reload } = useList(`/api/timesheets/to-approve?status=${status}`);
  const [open, setOpen] = useState(null), [detail, setDetail] = useState(null), [note, setNote] = useState(""), [err, setErr] = useState("");
  useEffect(() => { setDetail(null); setNote(""); setErr(""); if (open) api("GET", `/api/timesheet?email=${encodeURIComponent(open.person.email)}&week=${open.week}`).then((r) => setDetail(r.ok ? r.data : { error: apiMsg(r) })); }, [open]);
  const decide = async (w, decision) => {
    const r = await api("POST", `/api/timesheets/${w.id}/decision`, { decision, note });
    if (!r.ok) { setErr((r.data && r.data.errors && (r.data.errors.note || r.data.errors.decision)) || apiMsg(r)); return; }
    toast(decision === "approved" ? "The week was approved." : "The week was sent back."); setOpen(null); reload();
  };
  const weeks = (data && data.weeks) || [];
  return (
    <>
      <div className="flex flex-wrap items-center gap-3"><label className="font-body text-[14px] font-bold text-ink-dim" htmlFor="ts-status">Show</label>
        <select id="ts-status" className="input w-auto max-w-full pr-10" value={status} onChange={(e) => { setOpen(null); setStatus(e.target.value); }}><option value="submitted">Waiting for approval</option><option value="approved">Approved</option><option value="returned">Sent back</option></select></div>
      <div className="card">{!data ? <ListSkeleton /> : weeks.length ? (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Employee</th><th>Week of</th><th className="text-right">Hours</th><th>Status</th><th><span className="sr-only">Open</span></th></tr></thead>
          <tbody>{weeks.map((w) => [
            <tr key={w.id}><td><PersonCell person={person(w.person)} /></td><td>{dayLabel(w.week)}</td><td className={NUM}>{hrs(w.minutes)}</td><td><Pill tone={STATUS[w.status][1]}>{STATUS[w.status][0]}</Pill></td>
              <td className="text-right"><button type="button" className="btn glass sm" aria-expanded={open && open.id === w.id} onClick={() => setOpen(open && open.id === w.id ? null : w)}>{open && open.id === w.id ? "Close" : "Open"}</button></td></tr>,
            open && open.id === w.id && <tr key={`${w.id}-d`}><td colSpan={5} className="bg-tint">
              {!detail ? <ListSkeleton /> : detail.error ? <Callout>{detail.error}</Callout> : <div className="flex flex-col gap-3 py-2">
                <div className="tbl-wrap"><table>
                  <thead><tr><th>Project</th>{DAYS.map((n) => <th key={n} className="text-right">{n}</th>)}<th className="text-right">Total</th></tr></thead>
                  <tbody>{detail.rows.filter((l) => l.minutes.some(Boolean)).map((l) => <tr key={String(l.projectId)}><td>{l.project}</td>{l.minutes.map((m, i) => <td key={i} className={NUM}>{m ? hrs(m) : ""}</td>)}<td className={NUM}>{hrs(l.minutes.reduce((a, b) => a + b, 0))}</td></tr>)}</tbody>
                </table></div>
                {w.status === "submitted" && <div className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor="ts-note">Note for {w.person.name}</label>
                  <input id="ts-note" className="input max-w-[420px] min-w-0 flex-1 basis-[220px]" maxLength={500} placeholder="What should change (needed to send it back)" value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!err} />
                  <button type="button" className="btn primary sm" onClick={() => decide(w, "approved")}>Approve</button>
                  <button type="button" className="btn glass sm" onClick={() => decide(w, "returned")}>Send back</button>
                </div>}
                {err && <span className="ferr" role="alert">{err}</span>}
                {w.decidedAt && <span className="text-[14px] text-ink-dim">Decided {when(w.decidedAt)}</span>}
              </div>}
            </td></tr>,
          ])}</tbody>
        </table></div>) : <div className="empty">{status === "submitted" ? "No weeks are waiting for you." : "Nothing to show here yet."}</div>}
      </div>
    </>
  );
}

import { useState } from "react";
import { api, apiMsg } from "../../api.js";
import { Callout, CardSkeleton, Pill } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { problems, useList } from "../engage/shared.jsx";

/* Calibration for one review cycle, as Keka has it: the spread of ratings before and after, the 9-box by performance and
   potential, and one row per person where HR moves a rating (with the reason) and sets potential. Finished reviews are
   shown but locked. Nothing here is visible to the person reviewed or to their manager. */
const RATING = { 1: "1, needs to improve", 2: "2, below expectations", 3: "3, meets expectations", 4: "4, exceeds expectations", 5: "5, outstanding" };
const POT_ROWS = [3, 2, 1], PERF_COLS = [1, 2, 3];
const PERF = { 1: "Low (rating 1 to 2)", 2: "Medium (rating 3)", 3: "High (rating 4 to 5)" };
const BOX = { "3-1": "Rough diamond", "3-2": "High potential", "3-3": "Star", "2-1": "Inconsistent performer", "2-2": "Core player",
  "2-3": "High performer", "1-1": "Needs attention", "1-2": "Effective", "1-3": "Trusted professional" };

export default function Calibration({ cycle, onBack }) {
  const [dept, setDept] = useState("");
  const { data, error, reload } = useList(`/api/review-cycles/${cycle.id}/calibration${dept ? `?dept=${encodeURIComponent(dept)}` : ""}`);
  const rows = (data && data.reviews) || [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <button type="button" className="inline-flex min-h-11 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-[15px] font-bold text-accent hover:underline" onClick={onBack}><span aria-hidden="true">←</span>All cycles</button>
          <h2 className="m-0 font-display text-[24px] font-medium">Calibrate {cycle.name}</h2>
          <p className="m-0 text-ink-dim">Line up the ratings, move one with the reason, and judge each person's potential. Only HR sees this page.</p>
        </div>
        {data && data.depts && data.depts.length > 1 && (
          <label className="flex flex-col gap-1 text-[14px] font-bold">Department
            <select className="input min-w-48" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">Everyone</option>{data.depts.map((d) => <option key={d}>{d}</option>)}</select></label>)}
      </div>
      {error && <Callout>{error}</Callout>}
      {!data ? <CardSkeleton lines={6} /> : !rows.length ? <div className="card"><div className="empty">No reviews in this cycle{dept ? " for that department" : ""}.</div></div> : (
        <>
          <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
            <Spread spread={data.spread} total={rows.length} />
            <NineBox rows={rows} />
          </div>
          <div className="card">
            <div className="card-h"><h3>People</h3><span className="text-[14px] text-ink-dim">{rows.length} {rows.length === 1 ? "review" : "reviews"}</span></div>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Person</th><th>Manager's rating</th><th>Calibrated rating</th><th>Potential</th><th>Reason for the change</th><th><span className="sr-only">Save</span></th></tr></thead>
              <tbody>{rows.map((x) => <Row key={x.id} x={x} onSaved={reload} />)}</tbody>
            </table></div>
          </div>
          <Callout>When you finish a review under All reviews, its rating starts from the calibrated one. The person sees only the final rating.</Callout>
        </>)}
    </div>
  );
}

/* Ratings 1 to 5: how many people the managers gave each, and how many have it now. */
function Spread({ spread, total }) {
  const max = Math.max(1, ...spread.manager, ...spread.now);
  return (
    <div className="card">
      <div className="card-h"><h3>Rating spread</h3></div>
      <div className="card-b flex flex-col gap-3">
        <div className="flex flex-wrap gap-4 text-[14px] text-ink-dim">
          <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="inline-block size-3 rounded-sm bg-ink-faint" />Managers</span>
          <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="inline-block size-3 rounded-sm bg-accent" />Now, after calibration</span>
        </div>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {[5, 4, 3, 2, 1].map((n) => (
            <li key={n} className="grid grid-cols-[9.5rem_1fr] items-center gap-3 max-xs:grid-cols-1 max-xs:gap-1">
              <span className="text-[14px]">{RATING[n]}</span>
              <span className="flex flex-col gap-1" aria-label={`${RATING[n]}: ${spread.manager[n - 1]} from managers, ${spread.now[n - 1]} now`}>
                <Bar value={spread.manager[n - 1]} max={max} tone="bg-ink-faint" />
                <Bar value={spread.now[n - 1]} max={max} tone="bg-accent" />
              </span>
            </li>))}
        </ul>
        <p className="m-0 text-[14px] text-ink-dim">{total} {total === 1 ? "person" : "people"}. A rating not yet given is left out.</p>
      </div>
    </div>
  );
}
const Bar = ({ value, max, tone }) => (
  <span className="flex items-center gap-2" aria-hidden="true">
    <span className={`h-2.5 rounded-full ${tone}`} style={{ width: `${Math.max(value ? 4 : 0, (value / max) * 100)}%` }} />
    <span className="num-cell text-[14px] text-ink-dim">{value}</span>
  </span>
);

/* Potential (rows, high at the top) against performance (columns). */
function NineBox({ rows }) {
  const placed = rows.filter((x) => x.box), waiting = rows.length - placed.length;
  return (
    <div className="card">
      <div className="card-h"><h3>9-box</h3></div>
      <div className="card-b flex flex-col gap-2">
        <div className="grid grid-cols-[1.5rem_repeat(3,minmax(0,1fr))] gap-1.5" role="table" aria-label="9-box by potential and performance">
          {POT_ROWS.map((p) => (
            <div key={p} className="contents" role="row">
              <span className="flex items-center justify-center text-[13px] text-ink-dim [writing-mode:vertical-rl] rotate-180" role="rowheader">{["", "Low", "Medium", "High"][p]}</span>
              {PERF_COLS.map((f) => {
                const here = placed.filter((x) => x.box.potential === p && x.box.perf === f);
                return (
                  <div key={f} role="cell" className={`flex min-h-24 min-w-0 flex-col gap-1 rounded-field border border-line p-2 max-sm:min-h-20 max-sm:p-1.5 ${here.length ? "bg-tint" : ""}`}>
                    <span className="min-w-0 text-[14px] leading-tight font-bold [overflow-wrap:anywhere] hyphens-auto" lang="en">{BOX[`${p}-${f}`]}</span>
                    <span className="text-[14px] text-ink-dim">{here.length}</span>
                    <span className="min-w-0 text-[14px] leading-snug break-words max-sm:hidden">{here.slice(0, 4).map((x) => x.name).join(", ")}{here.length > 4 ? `, and ${here.length - 4} more` : ""}</span>
                  </div>);
              })}
            </div>))}
        </div>
        <div className="grid grid-cols-[1.5rem_repeat(3,minmax(0,1fr))] gap-1.5 text-center text-[13px] text-ink-dim" aria-hidden="true">
          <span />{PERF_COLS.map((f) => <span key={f}>{PERF[f].split(" (")[0]}</span>)}
        </div>
        <p className="m-0 text-[14px] text-ink-dim">Up the side: potential. Along the bottom: performance.<span className="hidden max-sm:inline"> The names are in the list below.</span>{waiting ? ` ${waiting} ${waiting === 1 ? "person is" : "people are"} not placed yet: they need a rating and a potential.` : ""}</p>
      </div>
    </div>
  );
}

function Row({ x, onSaved }) {
  const toast = useToast();
  const locked = x.status === "done";
  const [f, setF] = useState({ rating: x.rating || "", potential: x.potential || "", note: x.note || "" }), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const changed = String(f.rating) !== String(x.rating || "") || String(f.potential) !== String(x.potential || "") || f.note !== (x.note || "");
  const save = async () => {
    setBusy(true);
    const r = await api("PUT", `/api/reviews/${x.id}/calibrate`, { rating: Number(f.rating) || null, potential: f.potential ? Number(f.potential) : null, note: f.note });
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    setErr({}); toast(`${x.name}: saved.`); onSaved();
  };
  const id = `cal-${x.id}`;
  return (
    <tr>
      <td><b className="font-bold">{x.name}</b><div className="text-[13px] text-ink-faint">{[x.dept, x.manager && `Manager: ${x.manager}`].filter(Boolean).join(" · ")}</div>
        {locked ? <Pill tone="ok">Finished, rating {x.finalRating}</Pill> : !x.managerRating && <Pill tone="warn">{x.manager ? "Waiting for the manager" : "No manager"}</Pill>}
        {err.form && <div className="ferr" role="alert">{err.form}</div>}</td>
      <td className="num-cell">{x.managerRating || "—"}</td>
      <td><label className="sr-only" htmlFor={`${id}-r`}>Calibrated rating for {x.name}</label>
        <select id={`${id}-r`} className="input min-w-44" value={f.rating} disabled={locked} onChange={(e) => setF({ ...f, rating: e.target.value })} aria-invalid={!!err.rating}>
          <option value="">Choose</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{RATING[n]}</option>)}</select>
        {err.rating && <div className="ferr" role="alert">{err.rating}</div>}</td>
      <td><label className="sr-only" htmlFor={`${id}-p`}>Potential for {x.name}</label>
        <select id={`${id}-p`} className="input min-w-32" value={f.potential} disabled={locked} onChange={(e) => setF({ ...f, potential: e.target.value })} aria-invalid={!!err.potential}>
          <option value="">Not judged</option><option value="3">High</option><option value="2">Medium</option><option value="1">Low</option></select>
        {err.potential && <div className="ferr" role="alert">{err.potential}</div>}</td>
      <td><label className="sr-only" htmlFor={`${id}-n`}>Reason for the change for {x.name}</label>
        <input id={`${id}-n`} className="input min-w-56" maxLength={1000} value={f.note} disabled={locked} placeholder={x.managerRating && String(f.rating) !== String(x.managerRating) ? "Needed: the rating differs from the manager's" : "Optional"}
          onChange={(e) => setF({ ...f, note: e.target.value })} aria-invalid={!!err.note} />
        {err.note && <div className="ferr" role="alert">{err.note}</div>}</td>
      <td className="text-right">{!locked && <button type="button" className="btn glass sm" disabled={busy || !changed || !f.rating} onClick={save}>{busy ? "Saving…" : "Save"}</button>}</td>
    </tr>
  );
}

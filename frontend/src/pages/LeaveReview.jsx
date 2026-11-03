import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { PersonCell, Pill, SectionHead, shortDate } from "../components/ui.jsx";
import { DecideButtons } from "../components/leaveParts.jsx";
import { LSTAT, LTYPE, dd, lc, rangeText, useLeave } from "../lib/useLeave.js";

/* One leave request, opened from the approver's email: the details and Approve / Decline. The server checks who may decide. */
export default function LeaveReview() {
  const { id } = useParams();
  const { people, leave } = useData();
  const { isHr } = useAuth();
  const lv = useLeave();
  if (!people || !leave) return <section className="section"><div className="empty">Loading…</div></section>;
  const r = lv.requests.find((x) => String(x.id) === String(id));
  const emp = r && lv.empBy(r.email);
  const back = isHr ? "/app/leave" : "/app/team-leave";
  if (!r || !emp) return (
    <section className="section"><SectionHead eyebrow="Leave" title="Leave" accent="request." />
      <div className="card"><div className="empty">This leave request can't be found, or it isn't one you can see. <Link to={back}>See all leave requests</Link></div></div></section>);
  const a = r.status === "pending" ? lv.preview(r) : null;
  const decidedBy = r.decidedBy && ((lv.empBy(r.decidedBy) || {}).name || r.decidedBy);
  return (
    <section className="section">
      <SectionHead eyebrow="Leave" title="Leave" accent="request." sub={r.status === "pending" ? `${emp.name} is waiting for a decision.` : null} />
      <div className="card" style={{ maxWidth: 720 }}>
        <div className="card-h"><PersonCell person={emp} sub={emp.title} /><Pill tone={LSTAT[r.status][1]}>{LSTAT[r.status][0]}</Pill></div>
        <div className="card-b">
          <div className="lr-facts">
            <div><span>Type</span><b>{LTYPE[r.type]}</b></div>
            <div><span>Dates</span><b>{rangeText(r, shortDate)}</b></div>
            <div><span>Days</span><b>{dd(Number(r.days))}</b></div>
            <div><span>Applied</span><b>{r.createdAt ? shortDate(String(r.createdAt).slice(0, 10)) : "—"}</b></div>
          </div>
          <p style={{ margin: "16px 0 0" }}><span className="muted">Reason</span><br />“{r.reason}”</p>
          {a && <p className="muted" style={{ margin: "12px 0 0" }}>If approved now: <b style={{ color: "var(--ink)" }}>{dd(a.paid)} paid</b>{a.lop > 0 && <> · <b style={{ color: "var(--bad)" }}>{dd(a.lop)} loss of pay</b></>}</p>}
          {r.status !== "pending" && <p className="muted" style={{ margin: "12px 0 0" }}>{LSTAT[r.status][0]}{decidedBy ? ` by ${decidedBy}` : ""}{r.decidedAt ? ` on ${shortDate(String(r.decidedAt).slice(0, 10))}` : ""}. Nothing more to do.</p>}
        </div>
        <div className="modal-f" style={{ justifyContent: "space-between" }}>
          <Link className="btn link" to={back}>All leave requests</Link>
          {r.status === "pending" && <DecideButtons kind="requests" id={r.id} email={r.email} />}
        </div>
      </div>
    </section>
  );
}

import BackButton from "../components/BackButton.jsx";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { Callout, Pill, SectionHead, shortDate } from "../components/ui.jsx";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const label = (period) => { const [y, m] = period.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amt = (n) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dash = (v) => (v === null || v === undefined || v === "" ? "—" : v);

/* One payslip on screen, in the same order as the PDF. Every amount comes from the server's stored payslip. */
function SlipView({ s, pdf, onClose }) {
  const lines = (list) => list.map((i) => <div key={i.name} className="ps-line"><span>{i.name}</span><b>{amt(i.amount)}</b></div>);
  return (
    <div className="card ps-slip" id="ps-view">
      <div className="card-h"><h3>Payslip · {label(s.period)}</h3>
        <div className="row" style={{ gap: 8 }}><a className="btn primary sm" href={pdf} download>Download PDF</a><button type="button" className="btn glass sm" onClick={onClose}>Close</button></div></div>
      <dl className="facts ps-facts">
        <div><dt>Date joined</dt><dd>{s.employee.start ? shortDate(String(s.employee.start).slice(0, 10)) : "—"}</dd></div>
        <div><dt>PAN</dt><dd>{dash(s.employee.pan)}</dd></div>
        <div><dt>Payment mode</dt><dd>{dash(s.employee.paymentMode)}</dd></div>
        <div><dt>Payable days</dt><dd>{s.days.payable ?? "—"} <span className="muted">of {s.days.total ?? "—"}</span></dd></div>
        <div><dt>Loss of pay days</dt><dd>{s.days.lop || 0}</dd></div>
      </dl>
      <div className="ps-cols">
        <section><h4>Earnings</h4>{lines(s.earnings)}<div className="ps-line ps-tot"><span>Total earnings (A)</span><b>{amt(s.totals.earnings)}</b></div></section>
        <section>
          <h4>Contributions</h4>{lines(s.contributions)}<div className="ps-line ps-tot"><span>Total contributions (B)</span><b>{amt(s.totals.contributions)}</b></div>
          <h4 style={{ marginTop: 18 }}>Taxes &amp; deductions</h4>{lines(s.deductions)}<div className="ps-line ps-tot"><span>Total taxes &amp; deductions (C)</span><b>{amt(s.totals.deductions)}</b></div>
        </section>
      </div>
      <div className="ps-net"><span>Net salary payable (A − B − C)</span><b>{money(s.totals.net)}</b></div>
      <div className="card-b muted" style={{ paddingTop: 0 }}>{s.status === "paid" ? `Paid${s.paidAt ? ` on ${shortDate(String(s.paidAt).slice(0, 10))}` : ""}.` : "Payroll for this month is processed. Payment is not marked as made yet."} All amounts are in INR.</div>
    </div>
  );
}

export default function Payslips() {
  const { user, isHr } = useAuth();
  const { people } = useData();
  const [params, setParams] = useSearchParams();
  const who = isHr && params.get("email") ? params.get("email").toLowerCase() : "";
  const q = who ? `?email=${encodeURIComponent(who)}` : "";
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [pick, setPick] = useState("");
  const [slip, setSlip] = useState(null);
  const [slipErr, setSlipErr] = useState("");

  useEffect(() => {
    setData(null); setSlip(null); setSlipErr(""); setError("");
    api("GET", "/api/payslips" + q).then((r) => {
      if (!r.ok) { setError(apiMsg(r)); setData({ employee: null, payslips: [] }); return; }
      setData(r.data);
      const first = r.data.payslips.find((x) => x.available) || r.data.payslips[0];
      setPick(first ? first.period : "");
    }).catch(() => { setError("Could not reach the server."); setData({ employee: null, payslips: [] }); });
  }, [q]);

  const view = useCallback(async (period) => {
    setPick(period); setSlipErr(""); setSlip(null);
    const r = await api("GET", `/api/payslips/${period}${q}`);
    if (!r.ok) { setSlipErr(apiMsg(r)); return; }
    setSlip(r.data);
    setTimeout(() => { const el = document.getElementById("ps-view"); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); });
  }, [q]);

  const pdf = (period) => `/api/payslips/${period}/pdf${q}`;
  const list = data ? data.payslips : [];
  const emp = data && data.employee;
  const others = isHr && people ? people.filter((p) => p.status !== "offboarded" || p.email.toLowerCase() === who).sort((a, b) => (a.name < b.name ? -1 : 1)) : [];
  const chosen = list.find((x) => x.period === pick);

  return (
    <section className="section">
      <BackButton />
      <SectionHead eyebrow="Me" title={who ? "Payslips" : "My"} accent={who ? "." : "payslips."} sub="View or download the payslip for any month that payroll has been processed. Each one is also a PDF."
        actions={isHr && others.length > 0 && (
          <select className="input" aria-label="Whose payslips" style={{ width: "auto", maxWidth: "100%" }} value={who || user.email.toLowerCase()}
            onChange={(e) => { const v = e.target.value.toLowerCase(); const n = new URLSearchParams(params); if (v === user.email.toLowerCase()) n.delete("email"); else n.set("email", v); setParams(n, { replace: true }); }}>
            <option value={user.email.toLowerCase()}>My payslips</option>
            {others.filter((p) => p.email.toLowerCase() !== user.email.toLowerCase()).map((p) => <option key={p.email} value={p.email.toLowerCase()}>{p.name}</option>)}
          </select>)} />
      {error && <Callout>{error}</Callout>}

      {data === null ? <div className="card"><div className="card-b"><span className="skel" style={{ width: "50%" }} /><span className="skel" style={{ width: "30%" }} /></div></div> : <>
        <div className="card">
          <dl className="facts ps-who">
            <div><dt>Employee</dt><dd>{emp ? emp.name : "—"}</dd></div>
            <div><dt>Employee ID</dt><dd>{dash(emp && emp.empNo)}</dd></div>
            <div><dt>Department</dt><dd>{dash(emp && emp.dept)}</dd></div>
            <div><dt>Designation</dt><dd>{dash(emp && emp.title)}</dd></div>
          </dl>
          {list.length > 0 && (
            <div className="card-b ps-pick">
              <label className="lv-fsel"><span>Salary month</span>
                <select value={pick} onChange={(e) => { setPick(e.target.value); setSlip(null); setSlipErr(""); }}>
                  {list.map((x) => <option key={x.period} value={x.period}>{label(x.period)}</option>)}
                </select></label>
              <button type="button" className="btn primary" disabled={!pick} onClick={() => view(pick)}>View payslip</button>
              {chosen && chosen.available && <a className="btn glass" href={pdf(pick)} download>Download PDF</a>}
            </div>
          )}
        </div>

        {slipErr && <Callout>{slipErr}</Callout>}
        {slip && <SlipView s={slip} pdf={pdf(slip.period)} onClose={() => setSlip(null)} />}

        <div className="card">
          <div className="card-h"><h3>Available payslips</h3><span className="muted">{list.length} month{list.length === 1 ? "" : "s"}</span></div>
          {list.length === 0 ? (
            <div className="empty">No payslips yet. A payslip appears here once HR has processed payroll for a month {who ? "this person was" : "you were"} paid in.</div>
          ) : (
            <div className="tbl-wrap"><table>
              <thead><tr><th>Month</th><th className="num">Net pay</th><th>Status</th><th><span className="sr">Actions</span></th></tr></thead>
              <tbody>{list.map((x) => (
                <tr key={x.period}>
                  <td><b>{label(x.period)}</b></td>
                  <td className="num">{x.available ? money(x.net) : "—"}</td>
                  <td>{!x.available ? <Pill tone="warn">Incomplete</Pill> : x.status === "paid" ? <Pill tone="ok">Paid{x.paidAt ? ` ${shortDate(String(x.paidAt).slice(0, 10))}` : ""}</Pill> : <Pill tone="info">Processed</Pill>}</td>
                  <td style={{ textAlign: "right" }}>{x.available
                    ? <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}><button type="button" className="btn glass sm" onClick={() => view(x.period)}>View</button><a className="btn primary sm" href={pdf(x.period)} download>Download PDF</a></div>
                    : <span className="muted">{x.message}</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </>}
    </section>
  );
}

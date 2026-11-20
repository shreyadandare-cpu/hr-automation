import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiMsg } from "../api.js";
import { Callout, Pill, SectionHead, PageSkeleton } from "../components/ui.jsx";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (period) => { const [y, m] = String(period).split("-").map(Number); return `${MON[m - 1]} ${y}`; };
const inr = (n) => (n === null || n === undefined ? "Not ready" : `₹${Number(n).toLocaleString("en-IN")}`);
/* The Indian financial year a pay month falls in: April to March. */
const fyOf = (period) => { const [y, m] = String(period).split("-").map(Number); return m >= 4 ? y : y - 1; };

/* Pay > Overview: your pay at a glance, from the payslips HR has published. The payslips themselves are on My pay. */
export default function MyFinances() {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api("GET", "/api/payslips").then((r) => { if (r.ok) setD(r.data); else { setError(apiMsg(r)); setD({ payslips: [] }); } }); }, []);
  if (!d) return <PageSkeleton />;

  const ready = d.payslips.filter((p) => p.available && !p.draft);
  const latest = ready[0];
  const fy = latest ? fyOf(latest.period) : null;
  const thisYear = ready.filter((p) => fyOf(p.period) === fy);
  const total = thisYear.reduce((n, p) => n + Number(p.net || 0), 0);

  return (
    <section className="section">
      <SectionHead title="Pay" sub="Your pay at a glance. Open My pay to view or download a payslip."
        actions={<Link className="btn primary" to="/app/payslips">Open My pay</Link>} />
      {error && <Callout>{error}</Callout>}
      <div className="rb-stats four db-strip">
        <div className="rb-stat"><span className="lbl">Latest net pay</span><b>{latest ? inr(latest.net) : "Not ready"}</b><span className="sub">{latest ? monthName(latest.period) : "No payslip has been published yet"}</span></div>
        <div className="rb-stat"><span className="lbl">Paid this financial year</span><b>{latest ? inr(total) : "₹0"}</b><span className="sub">{fy ? `April ${fy} to March ${fy + 1}` : "Net pay, after deductions"}</span></div>
        <div className="rb-stat"><span className="lbl">Payslips this year</span><b>{thisYear.length}</b><span className="sub">published</span></div>
        <div className="rb-stat"><span className="lbl">All payslips</span><b>{ready.length}</b><span className="sub">available to download</span></div>
      </div>
      <div className="card"><div className="card-h"><h3>Recent pay</h3><Link className="btn link" to="/app/payslips">All payslips</Link></div>
        {ready.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>Month</th><th>Net pay</th><th>Status</th><th aria-label="Open" /></tr></thead>
            <tbody>{ready.slice(0, 6).map((p) => (
              <tr key={p.period}>
                <td>{monthName(p.period)}</td>
                <td className="num-cell">{inr(p.net)}</td>
                <td>{p.paidAt ? <Pill tone="ok">Paid</Pill> : <Pill tone="info">Published</Pill>}</td>
                <td><a className="btn glass sm" href={`/api/payslips/${p.period}/pdf`} download>Download PDF</a></td>
              </tr>))}</tbody>
          </table></div>) : <div className="empty">Your payslips appear here early in the month after each pay month.</div>}
      </div>
    </section>
  );
}

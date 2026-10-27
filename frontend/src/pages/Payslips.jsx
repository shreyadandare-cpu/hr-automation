import BackButton from "../components/BackButton.jsx";
import { useEffect, useState } from "react";
import { api, apiMsg } from "../api.js";
import { Callout, Pill, SectionHead, shortDate } from "../components/ui.jsx";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const label = (period) => { const [y, m] = period.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Payslips() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api("GET", "/api/payslips").then((r) => { setList(r.ok ? r.data : []); setError(r.ok ? "" : apiMsg(r)); }).catch(() => { setList([]); setError("Could not reach the server."); });
  }, []);
  return (
    <section className="section">
      <BackButton />
      <SectionHead eyebrow="Me" title="My" accent="payslips." sub="Download the payslip for any month that payroll has been processed. Each one is a PDF." />
      {error && <Callout>{error}</Callout>}
      <div className="card">
        {list === null ? <div className="empty">Loading…</div> : list.length === 0 ? (
          <div className="empty">No payslips yet. A payslip appears here once HR has processed payroll for a month you were paid in.</div>
        ) : (
          <div className="tbl-wrap"><table>
            <thead><tr><th>Month</th><th className="num">Net pay</th><th>Status</th><th><span className="sr">Download</span></th></tr></thead>
            <tbody>{list.map((x) => (
              <tr key={x.period}>
                <td><b>{label(x.period)}</b></td>
                <td className="num">{money(x.net)}</td>
                <td>{x.status === "paid" ? <Pill tone="ok">Paid{x.paidAt ? ` ${shortDate(x.paidAt)}` : ""}</Pill> : <Pill tone="info">Processed</Pill>}</td>
                <td style={{ textAlign: "right" }}><a className="btn primary sm" href={`/api/payslips/${x.period}/pdf`} download>Download PDF</a></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </section>
  );
}

import { useData } from "../../data.jsx";
import { useAuth } from "../../auth.jsx";
import { Donut } from "../../components/charts.jsx";
import { SectionHead, PageSkeleton } from "../../components/ui.jsx";
import { AVATAR_COLORS } from "../../lib/people.js";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ym = (d) => String(d || "").slice(0, 7);
const csv = (rows) => rows.map((r) => r.map((c) => `"${String(c == null ? "" : c).replace(/"/g, '""')}"`).join(",")).join("\n");
function save(name, rows) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv(rows)], { type: "text/csv" }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

/* HR > Reports: headcount, who joined and left, attrition, leave taken and how long people have been here.
   Everything is counted from the staff list and the leave data the app already holds; nothing new is stored. */
export default function Reports() {
  const { canAll } = useAuth();
  const { people, leave } = useData();
  if (!canAll("people.view")) return <section className="section"><SectionHead title="Reports" /><div className="empty">Only the people who can see everyone's details can see reports.</div></section>;
  if (!people) return <PageSkeleton />;
  const today = leave ? leave.today : new Date().toISOString().slice(0, 10);
  const here = people.filter((p) => p.status !== "offboarded");
  const left = people.filter((p) => p.status === "offboarded" && p.lastDay);

  // The last 12 months, oldest first.
  const [ty, tm] = today.split("-").map(Number);
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(ty, tm - 1 - (11 - i), 1)); return { key: d.toISOString().slice(0, 7), label: `${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` }; });
  const flow = months.map((m) => ({ ...m, joined: people.filter((p) => ym(p.start) === m.key).length, left: left.filter((p) => ym(p.lastDay) === m.key).length }));
  const maxFlow = Math.max(1, ...flow.map((f) => Math.max(f.joined, f.left)));
  const joined12 = flow.reduce((n, f) => n + f.joined, 0), left12 = flow.reduce((n, f) => n + f.left, 0);
  // Attrition over 12 months: leavers divided by the average of headcount now and a year ago.
  const yearAgo = here.length - joined12 + left12;
  const attrition = (here.length + yearAgo) > 0 ? Math.round(left12 / ((here.length + yearAgo) / 2) * 1000) / 10 : 0;

  const byDept = {};
  for (const p of here) byDept[p.dept && p.dept !== "—" ? p.dept : "Not set"] = (byDept[p.dept && p.dept !== "—" ? p.dept : "Not set"] || 0) + 1;
  const depts = Object.entries(byDept).sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: AVATAR_COLORS[i % AVATAR_COLORS.length] }));

  const years = (p) => (p.start ? (Date.parse(today) - Date.parse(p.start)) / (365.25 * 86400000) : null);
  const bands = [["Under 6 months", (y) => y < 0.5], ["6 to 12 months", (y) => y >= 0.5 && y < 1], ["1 to 3 years", (y) => y >= 1 && y < 3], ["3 to 5 years", (y) => y >= 3 && y < 5], ["Over 5 years", (y) => y >= 5]]
    .map(([label, test]) => ({ label, n: here.filter((p) => { const y = years(p); return y !== null && test(y); }).length }));
  const maxBand = Math.max(1, ...bands.map((b) => b.n));

  const thisYear = String(ty);
  const taken = {};
  for (const r of (leave ? leave.requests : [])) if (r.status === "approved" && String(r.from).startsWith(thisYear)) taken[r.type] = (taken[r.type] || 0) + Number(r.days || 0);
  const leaveRows = [["casual", "Casual leave"], ["sick", "Sick leave"], ["compoff", "Comp off"], ["unpaid", "Unpaid leave"]].map(([k, label]) => ({ label, days: taken[k] || 0 }));
  const maxLeave = Math.max(1, ...leaveRows.map((r) => r.days));

  const exportAll = () => save(`wohlig-one-hr-report-${today}.csv`, [
    ["Headcount", here.length], ["Joined in the last 12 months", joined12], ["Left in the last 12 months", left12], ["Attrition, 12 months (%)", attrition], [],
    ["Month", "Joined", "Left"], ...flow.map((f) => [f.label, f.joined, f.left]), [],
    ["Department", "People"], ...depts.map((d) => [d.label, d.value]), [],
    ["Time at Wohlig", "People"], ...bands.map((b) => [b.label, b.n]), [],
    [`Leave taken in ${thisYear}`, "Days"], ...leaveRows.map((r) => [r.label, r.days]),
  ]);
  const Bar = ({ n, max, tone = "var(--purple)" }) => <div className="progress" aria-hidden="true"><i style={{ width: `${n / max * 100}%`, background: tone }} /></div>;

  return (
    <section className="section">
      <SectionHead title="Reports" sub="Headcount, joiners and leavers, attrition and leave, counted from the staff list and leave records."
        actions={<button type="button" className="btn primary" onClick={exportAll}>Download as a spreadsheet</button>} />
      <div className="rb-stats four db-strip">
        <div className="rb-stat"><span className="lbl">Headcount</span><b>{here.length}</b><span className="sub">people on the staff list</span></div>
        <div className="rb-stat"><span className="lbl">Joined, last 12 months</span><b>{joined12}</b><span className="sub">new joiners</span></div>
        <div className="rb-stat"><span className="lbl">Left, last 12 months</span><b>{left12}</b><span className="sub">with a last working day</span></div>
        <div className="rb-stat"><span className="lbl">Attrition, 12 months</span><b>{attrition}%</b><span className="sub">leavers over average headcount</span></div>
      </div>
      <div className="card"><div className="card-h"><h3>Joiners and leavers by month</h3><span className="muted">last 12 months</span></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Month</th><th>Joined</th><th style={{ width: "32%" }} aria-label="Joined, as a bar" /><th>Left</th><th style={{ width: "32%" }} aria-label="Left, as a bar" /></tr></thead>
          <tbody>{flow.map((f) => (
            <tr key={f.key}><td>{f.label}</td><td className="num-cell">{f.joined}</td><td><Bar n={f.joined} max={maxFlow} /></td><td className="num-cell">{f.left}</td><td><Bar n={f.left} max={maxFlow} tone="var(--terracotta)" /></td></tr>))}</tbody>
        </table></div>
      </div>
      <div className="grid g2">
        <div className="card"><div className="card-h"><h3>People by department</h3></div>
          <div className="db-donut"><Donut parts={depts} label="people" /><div className="db-legend">{depts.map((d) => <div key={d.label}><i style={{ background: d.color }} />{d.label}<span>{d.value}</span></div>)}</div></div>
        </div>
        <div className="card"><div className="card-h"><h3>Time at Wohlig</h3></div>
          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {bands.map((b) => <div key={b.label}><div className="row" style={{ justifyContent: "space-between" }}><span>{b.label}</span><b className="num-cell">{b.n}</b></div><Bar n={b.n} max={maxBand} /></div>)}
          </div>
        </div>
      </div>
      <div className="card"><div className="card-h"><h3>Leave taken in {thisYear}</h3><span className="muted">approved days, everyone</span></div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {leaveRows.map((r) => <div key={r.label}><div className="row" style={{ justifyContent: "space-between" }}><span>{r.label}</span><b className="num-cell">{r.days} {r.days === 1 ? "day" : "days"}</b></div><Bar n={r.days} max={maxLeave} /></div>)}
        </div>
      </div>
    </section>
  );
}

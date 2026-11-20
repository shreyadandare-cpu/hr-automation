import { useEffect, useState } from "react";
import { api, apiMsg } from "../../api.js";
import { useToast } from "../../components/toast.jsx";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth.jsx";
import BackButton from "../../components/BackButton.jsx";
import { Callout, Pill, SectionHead, Stat, ViewTabs, ListSkeleton } from "../../components/ui.jsx";
import { useList } from "../engage/shared.jsx";
import { BRAND, PRODUCT } from "../../brand.js";

const VIEWS = [["dues", "Statutory dues"], ["journal", "Payroll journal"], ["cost", "Cost"], ["gratuity", "Gratuity"], ["tax", "Annual tax"], ["contractors", "Contractors"]];
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthName = (p) => new Date(`${p}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const longDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
const fyLabel = (fy) => `${fy.slice(0, 4)} to ${Number(fy.slice(0, 4)) + 1}`;
const csv = (rows) => rows.map((r) => r.map((c) => `"${String(c == null ? "" : c).replace(/"/g, '""')}"`).join(",")).join("\n");
function saveText(name, text, mime = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
const save = (name, rows) => saveText(name, csv(rows), "text/csv");
/* A button that asks the server for a file (a portal upload, the Tally voucher, a TDS sheet) and saves it. */
function FileButton({ url, children, onWarn }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); const r = await api("GET", url); setBusy(false);
    if (!r.ok) { toast(apiMsg(r)); return; }
    const f = r.data;
    if (f.rows === 0) { toast("There is nothing to put in this file for the month."); return; }
    if (f.table) save(f.filename || `tds-${f.fy}-${f.quarter}.csv`, f.table); else saveText(f.filename, f.text, f.mime);
    if (onWarn) onWarn(f.missing || []);
  };
  return <button type="button" className="btn glass sm" onClick={go} disabled={busy}>{busy ? "Preparing…" : children}</button>;
}
const Download = ({ onClick, children = "Download as a spreadsheet", disabled }) => <button type="button" className="btn glass sm" onClick={onClick} disabled={disabled}>{children}</button>;
const NotFinal = ({ run }) => (run && !run.final ? <Callout>This month's payroll is not approved yet, so these figures can still change. Please use them only after the run is approved.</Callout> : null);
const Loading = () => <ListSkeleton />;
const NoRun = () => <div className="card"><div className="empty">Payroll has not been run for this month yet.</div></div>;
/* Tables on this page: totals in a bold last row, numbers right-aligned. */
const NUM = "num-cell text-right";
const TOTAL_ROW = "font-bold [&>td]:border-t-2 [&>td]:border-line";

/* HR > Finance reports: what the accountant needs each month and each year, read from payroll that is already
   calculated. Nothing here changes a payslip. Open to finance.view and payroll.approve, for the whole company. */
export default function FinanceReports() {
  const { canAll } = useAuth();
  const sees = canAll("finance.view") || canAll("payroll.approve");   // as the server: whole company only
  const [params, setParams] = useSearchParams();
  const { data: meta, error } = useList("/api/finance/periods");
  if (!sees) return <section className="section"><SectionHead title="Finance reports" /><div className="empty">Only the people given finance reports or payroll approval can see finance reports.</div></section>;
  const view = VIEWS.some(([k]) => k === params.get("view")) ? params.get("view") : "dues";
  const put = (k, v) => { const n = new URLSearchParams(params); n.set(k, v); setParams(n, { replace: true }); };
  const periods = (meta && meta.periods) || [], years = (meta && meta.years) || [];
  const period = periods.some((p) => p.period === params.get("period")) ? params.get("period") : (periods[0] || {}).period;
  const fy = years.includes(params.get("fy")) ? params.get("fy") : years[0];
  const monthly = view === "dues" || view === "journal" || view === "cost";

  return (
    <section className="section">
      <SectionHead title="Finance reports" sub="Statutory dues, the payroll journal, cost, gratuity and the year's tax, read from approved payroll. Nothing here changes a payslip."
        tabs={<ViewTabs label="Finance reports" views={VIEWS} view={view} onView={(k) => put("view", k)} />} />
      {error && <Callout>{error}</Callout>}
      {!meta ? <Loading /> : <>
        {monthly && periods.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="font-body text-[14px] font-bold text-ink-dim" htmlFor="fin-month">Salary month</label>
            <select id="fin-month" className="input w-auto max-w-full pr-10" value={period} onChange={(e) => put("period", e.target.value)}>{periods.map((p) => <option key={p.period} value={p.period}>{monthName(p.period)}{p.final ? "" : " (not approved)"}</option>)}</select>
          </div>)}
        {(view === "tax" || view === "contractors") && years.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="font-body text-[14px] font-bold text-ink-dim" htmlFor="fin-fy">Financial year</label>
            <select id="fin-fy" className="input w-auto max-w-full pr-10" value={fy} onChange={(e) => put("fy", e.target.value)}>{years.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select>
          </div>)}
        {monthly && !period ? <NoRun /> : null}
        {view === "dues" && period && <Dues period={period} />}
        {view === "journal" && period && <Journal period={period} />}
        {view === "cost" && period && <Cost period={period} />}
        {view === "gratuity" && <Gratuity />}
        {view === "tax" && fy && <TaxYear fy={fy} />}
        {view === "contractors" && fy && <Contractors fy={fy} />}
      </>}
    </section>
  );
}

function Dues({ period }) {
  const [missing, setMissing] = useState([]);
  useEffect(() => { setMissing([]); }, [period]);
  const { data, error } = useList(`/api/finance/statutory?period=${period}`);
  if (!data) return <Loading />;
  if (error) return <Callout>{error}</Callout>;
  if (!data.run) return <NoRun />;
  const t = data.totals, rows = data.rows;
  const heads = [
    ["Provident fund", t.pfDeposit, `Employee ${inr(t.pf)} and employer ${inr(t.employerPf)}, for ${t.pfPeople} ${t.pfPeople === 1 ? "person" : "people"}`, `Deposit by ${longDate(data.due.pf)}`],
    ["ESIC", t.esicDeposit, `Employee ${inr(t.esic)} and employer ${inr(t.employerEsic)} (3.25%, worked out here), for ${t.esicPeople} ${t.esicPeople === 1 ? "person" : "people"}`, `Deposit by ${longDate(data.due.esic)}`],
    ["Professional tax", t.pt, `For ${t.ptPeople} ${t.ptPeople === 1 ? "person" : "people"}`, "Deposit by your state's date"],
    ["TDS on salaries", t.tds, `For ${t.tdsPeople} ${t.tdsPeople === 1 ? "person" : "people"}`, `Deposit by ${longDate(data.due.tds)}`],
  ];
  const sheet = () => save(`wohlig-one-statutory-dues-${period}.csv`, [
    [`Statutory dues for ${monthName(period)}`], [],
    ["Employee number", "Name", "Work email", "Department", "PF number", "PAN", "Salary", "Basic", "PF employee", "PF employer", "ESIC employee", "ESIC employer", "Professional tax", "TDS"],
    ...rows.map((r) => [r.empNo, r.name, r.email, r.dept, r.pfNumber, r.pan, r.salary, r.basic, r.pf, r.employerPf, r.esic, r.employerEsic, r.pt, r.tds]),
    ["", "Total", "", "", "", "", t.salary, "", t.pf, t.employerPf, t.esic, t.employerEsic, t.pt, t.tds],
  ]);
  const l = data.lwf;
  return (
    <>
      <NotFinal run={data.run} />
      {missing.length > 0 && <Callout>The PF file was saved, but {missing.length === 1 ? "one person has" : `${missing.length} people have`} no 12-digit UAN in the PF number field, so the UAN is empty on {missing.length === 1 ? "that line" : "those lines"}: {missing.slice(0, 8).join(", ")}{missing.length > 8 ? " and others" : ""}. Please add the UAN before you upload the file.</Callout>}
      <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-2 max-xs:grid-cols-1">
        {heads.map(([name, amount, who, due]) => (
          <div key={name} className="card flex flex-col gap-1.5 px-5 py-[18px]">
            <span className="font-body text-[13px] font-bold text-ink-dim">{name}</span>
            <span className="font-display text-[26px] leading-[1.15] font-medium tabular-nums [overflow-wrap:anywhere]">{inr(amount)}</span>
            <span className="text-[13px] text-ink-faint">{who}</span>
            <span className="mt-1 text-[13px] font-bold text-ink-dim">{due}</span>
          </div>))}
      </div>
      <div className="card"><div className="card-h"><h3>Files for the portals</h3></div>
        <div className="card-b flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3"><FileButton url={`/api/finance/files?period=${period}&kind=ecr`} onWarn={setMissing}>PF return file (ECR)</FileButton><FileButton url={`/api/finance/files?period=${period}&kind=esic`}>ESIC contribution sheet</FileButton></div>
          <p className="m-0 text-[14px] text-ink-dim">The PF file is the text file the EPFO portal takes, one line per member. The ESIC sheet follows the portal's monthly contribution template; {PRODUCT} does not hold ESIC insurance numbers, so please fill in the IP Number column before you upload it.</p>
        </div>
      </div>
      {l && l.applies && (
        <div className="card"><div className="card-h"><h3>Labour welfare fund, Maharashtra</h3><Pill tone="warn">Due {longDate(l.due)}</Pill></div>
          <div className="card-b flex flex-col gap-2">
            <p className="m-0">{inr(l.total)} for {l.people} {l.people === 1 ? "person" : "people"}: {inr(l.employee)} from staff ({inr(l.employeeEach)} each) and {inr(l.employer)} from the company ({inr(l.employerEach)} each).</p>
            <p className="m-0 text-[14px] text-ink-dim">Payroll does not deduct the staff share by itself. Please add it to this month's run as a deduction before the run is approved, and have your accountant confirm the rates.</p>
          </div>
        </div>)}
      <div className="card"><div className="card-h"><h3>Per person, {monthName(period)}</h3><Download onClick={sheet} disabled={!rows.length} /></div>
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>Employee</th><th>PF number</th><th className="text-right">Salary</th><th className="text-right">PF employee</th><th className="text-right">PF employer</th><th className="text-right">ESIC employee</th><th className="text-right">ESIC employer</th><th className="text-right">Professional tax</th><th className="text-right">TDS</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.email}><td><b className="font-bold">{r.name}</b><div className="text-[13px] text-ink-faint">{[r.empNo, r.dept].filter(Boolean).join(", ")}</div></td><td>{r.pfNumber || "Not set"}</td>
                  <td className={NUM}>{inr(r.salary)}</td><td className={NUM}>{inr(r.pf)}</td><td className={NUM}>{inr(r.employerPf)}</td><td className={NUM}>{inr(r.esic)}</td><td className={NUM}>{inr(r.employerEsic)}</td><td className={NUM}>{inr(r.pt)}</td><td className={NUM}>{inr(r.tds)}</td></tr>))}
              <tr className={TOTAL_ROW}><td>Total, {t.people} {t.people === 1 ? "person" : "people"}</td><td /><td className={NUM}>{inr(t.salary)}</td><td className={NUM}>{inr(t.pf)}</td><td className={NUM}>{inr(t.employerPf)}</td><td className={NUM}>{inr(t.esic)}</td><td className={NUM}>{inr(t.employerEsic)}</td><td className={NUM}>{inr(t.pt)}</td><td className={NUM}>{inr(t.tds)}</td></tr>
            </tbody>
          </table></div>) : <div className="empty">This run has no payslips yet.</div>}
      </div>
      <Callout>These are the amounts payroll deducted. Please check them against the challan on each government portal before you pay; the due dates shown are the usual ones and move when the date is a holiday.</Callout>
    </>
  );
}

function Journal({ period }) {
  const { data, error } = useList(`/api/finance/journal?period=${period}`);
  if (!data) return <Loading />;
  if (error) return <Callout>{error}</Callout>;
  if (!data.run) return <NoRun />;
  const narration = `Salaries for ${monthName(period)}, ${data.people} ${data.people === 1 ? "person" : "people"}`;
  const sheet = () => save(`wohlig-one-payroll-journal-${period}.csv`, [
    ["Date", "Voucher type", "Ledger", "Debit", "Credit", "Narration"],
    ...data.lines.map((l) => [data.date, "Journal", l.ledger, l.debit || "", l.credit || "", narration]),
  ]);
  return (
    <>
      <NotFinal run={data.run} />
      <div className="card"><div className="card-h"><h3>Journal entry dated {longDate(data.date)}</h3><div className="flex flex-wrap items-center gap-3">{data.balanced ? <Pill tone="ok">Debits equal credits</Pill> : <Pill tone="bad">Does not balance</Pill>}<Download onClick={sheet} disabled={!data.lines.length} />{data.lines.length > 0 && data.balanced && <FileButton url={`/api/finance/files?period=${period}&kind=tally`}>Tally import file</FileButton>}</div></div>
        {data.lines.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>Ledger</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
            <tbody>
              {data.lines.map((l) => <tr key={l.ledger}><td>{l.ledger}</td><td className={NUM}>{l.debit ? inr(l.debit) : ""}</td><td className={NUM}>{l.credit ? inr(l.credit) : ""}</td></tr>)}
              <tr className={TOTAL_ROW}><td>Total</td><td className={NUM}>{inr(data.debit)}</td><td className={NUM}>{inr(data.credit)}</td></tr>
            </tbody>
          </table></div>) : <div className="empty">This run has no amounts to post yet.</div>}
      </div>
      {!data.balanced && <Callout>The debits and credits of this month do not match. Please do not post this entry; ask the HR team to recalculate the run.</Callout>}
      <Callout>The Tally import file is one Journal voucher: in Tally, open Import, choose Vouchers and pick the file. The ledgers must already exist in Tally under exactly these names. For Zoho Books or another package, use the spreadsheet, which has one row per ledger with the date, debit, credit and narration.</Callout>
    </>
  );
}

function Cost({ period }) {
  const { data, error, reload } = useList(`/api/finance/cost?period=${period}`);
  if (!data) return <Loading />;
  if (error) return <Callout>{error}</Callout>;
  if (!data.run) return <NoRun />;
  const sheet = () => save(`wohlig-one-cost-${period}.csv`, [
    [`Cost for ${monthName(period)}`], [],
    ["Department", "People", "Salary", "Reimbursements", "Employer PF", "Employer ESIC", "Total cost"],
    ...data.departments.map((d) => [d.name, d.people, d.salary, d.reimbursements, d.employerPf, d.employerEsic, d.total]), [],
    ["Project", "People (by share)", "Total cost"], ...data.projects.map((p) => [p.name, p.people, p.total]),
  ]);
  const share = (n) => (data.total > 0 ? `${Math.round(n / data.total * 1000) / 10}%` : "0%");
  return (
    <>
      <NotFinal run={data.run} />
      <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
        <Stat value={inr(data.total)} label={`Total cost, ${monthName(period)}`} />
        <Stat value={inr(data.employerPf + data.employerEsic)} label="Of which employer PF and ESIC" />
        <Stat value={inr(data.reimbursements)} label="Of which reimbursements" />
      </div>
      <div className="card"><div className="card-h"><h3>By department</h3><Download onClick={sheet} /></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Department</th><th className="text-right">People</th><th className="text-right">Salary</th><th className="text-right">Reimbursements</th><th className="text-right">Employer PF and ESIC</th><th className="text-right">Total cost</th><th className="text-right">Share</th></tr></thead>
          <tbody>{data.departments.map((d) => <tr key={d.name}><td>{d.name}</td><td className={NUM}>{d.people}</td><td className={NUM}>{inr(d.salary)}</td><td className={NUM}>{inr(d.reimbursements)}</td><td className={NUM}>{inr(d.employerPf + d.employerEsic)}</td><td className={NUM}><b className="font-bold">{inr(d.total)}</b></td><td className={NUM}>{share(d.total)}</td></tr>)}</tbody>
        </table></div>
      </div>
      <div className="card"><div className="card-h"><h3>By project</h3></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Project</th><th className="text-right">People</th><th className="text-right">Total cost</th><th className="text-right">Share</th></tr></thead>
          <tbody>{data.projects.map((p) => <tr key={p.name}><td>{p.name}</td><td className={NUM}>{p.people}</td><td className={NUM}><b className="font-bold">{inr(p.total)}</b></td><td className={NUM}>{share(p.total)}</td></tr>)}</tbody>
        </table></div>
      </div>
      <Shares onChange={reload} />
      <Callout>{data.allocated ? "A person's cost follows the project shares above. Where no share is set, it is split equally between their projects." : "No one is allocated to a project for this month yet, so everything shows as not allocated. Allocations are kept under Org, Allocations."} Cost is salary after loss of pay, reimbursements and the employer's PF and ESIC shares.</Callout>
    </>
  );
}

function Gratuity() {
  const { data, error } = useList("/api/finance/gratuity");
  if (!data) return <Loading />;
  if (error) return <Callout>{error}</Callout>;
  const t = data.totals, people = data.people || [];
  const service = (p) => `${p.completedYears} ${p.completedYears === 1 ? "year" : "years"}, ${p.months} ${p.months === 1 ? "month" : "months"}`;
  const sheet = () => save(`wohlig-one-gratuity-${data.asOf}.csv`, [
    [`Gratuity estimate as of ${data.asOf}`], [],
    ["Employee number", "Name", "Work email", "Department", "Joined", "Completed years", "Months beyond", "Years counted", "Monthly basic", "Payable now", "Estimate", "At the legal ceiling"],
    ...people.map((p) => [p.empNo, p.name, p.email, p.dept, p.start, p.completedYears, p.months, p.serviceYears, p.basic == null ? "" : p.basic, p.eligible ? "Yes" : "No", p.amount, p.capped ? "Yes" : "No"]),
  ]);
  return (
    <>
      <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
        <Stat value={inr(t.payable)} label={`Payable if they left today, ${t.eligible} ${t.eligible === 1 ? "person" : "people"} with five years or more`} />
        <Stat value={inr(t.building)} label="Building up for people under five years" />
        <Stat value={t.noSalary} label="People with no salary structure, shown as zero" alert={t.noSalary > 0} />
      </div>
      <div className="card"><div className="card-h"><h3>Estimate as of {longDate(data.asOf)}</h3><Download onClick={sheet} disabled={!people.length} /></div>
        {people.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>Employee</th><th>Joined</th><th>Service</th><th className="text-right">Monthly basic</th><th>Status</th><th className="text-right">Estimate</th></tr></thead>
            <tbody>{people.map((p) => (
              <tr key={p.email}><td><b className="font-bold">{p.name}</b><div className="text-[13px] text-ink-faint">{[p.empNo, p.dept].filter(Boolean).join(", ")}</div></td><td>{longDate(p.start)}</td><td>{service(p)}</td>
                <td className={NUM}>{p.basic == null ? "Not set" : inr(p.basic)}</td><td>{p.eligible ? <Pill tone="ok">Payable</Pill> : <Pill>Building up</Pill>}</td><td className={NUM}>{inr(p.amount)}{p.capped ? " (ceiling)" : ""}</td></tr>))}</tbody>
          </table></div>) : <div className="empty">No one on the staff list has a joining date yet.</div>}
      </div>
      <Callout>The estimate is 15 ÷ 26 × monthly basic × years of service, where a part year of more than six months counts as a full year, up to the ₹20,00,000 ceiling. It is payable after five completed years. This is a working figure for provisions, not a settlement: please have your accountant confirm the amount before any payment, including for anyone close to five years.</Callout>
    </>
  );
}

function TaxYear({ fy }) {
  const { data, error } = useList(`/api/finance/tax-statements?fy=${fy}`);
  if (!data) return <Loading />;
  if (error) return <Callout>{error}</Callout>;
  const people = data.people || [];
  const drafts = people.some((p) => p.draftMonths > 0);
  const sheet = () => save(`wohlig-one-tax-${fy}.csv`, [
    [`Salary and TDS for the financial year ${fyLabel(fy)}`], [],
    ["Quarter", "People with TDS", "Taxable salary", "TDS"], ...data.quarters.map((q) => [q.quarter, q.people, q.taxable, q.tds]), [],
    ["Employee number", "Name", "Work email", "PAN", "Months paid", "Salary", "Taxable salary", "PF employee", "Professional tax", "TDS"],
    ...people.map((p) => [p.empNo, p.name, p.email, p.pan, p.months, p.salary, p.taxable, p.pf, p.pt, p.tds]),
  ]);
  return (
    <>
      {drafts && <Callout>Some months of this year are not approved yet, so the year's figures can still change.</Callout>}
      <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-2 max-xs:grid-cols-1">
        {data.quarters.map((q, i) => (
          <div key={q.quarter} className="card flex flex-col gap-1.5 px-5 py-[18px]">
            <span className="font-body text-[13px] font-bold text-ink-dim">{["April to June", "July to September", "October to December", "January to March"][i]}</span>
            <span className="font-display text-[26px] leading-[1.15] font-medium tabular-nums [overflow-wrap:anywhere]">{inr(q.tds)}</span>
            <span className="text-[13px] text-ink-faint">TDS for {q.people} {q.people === 1 ? "person" : "people"}, on {inr(q.taxable)} taxable salary</span>
            <div className="mt-1"><FileButton url={`/api/finance/tds-sheet?fy=${fy}&quarter=${q.quarter}`}>Sheet for the return</FileButton></div>
          </div>))}
      </div>
      <div className="card"><div className="card-h"><h3>Per person, {fyLabel(fy)}</h3><Download onClick={sheet} disabled={!people.length} /></div>
        {people.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>Employee</th><th>PAN</th><th className="text-right">Months</th><th className="text-right">Taxable salary</th><th className="text-right">PF employee</th><th className="text-right">Professional tax</th><th className="text-right">TDS</th><th><span className="sr-only">Statement</span></th></tr></thead>
            <tbody>{people.map((p) => (
              <tr key={p.email}><td><b className="font-bold">{p.name}</b><div className="text-[13px] text-ink-faint">{p.empNo}</div></td><td>{p.pan || "Not set"}</td><td className={NUM}>{p.months}</td>
                <td className={NUM}>{inr(p.taxable)}</td><td className={NUM}>{inr(p.pf)}</td><td className={NUM}>{inr(p.pt)}</td><td className={NUM}>{inr(p.tds)}</td>
                <td className="text-right"><Link className="btn glass sm" to={`/app/finance-reports/tax/${encodeURIComponent(p.email)}?fy=${fy}`}>Open statement</Link></td></tr>))}</tbody>
          </table></div>) : <div className="empty">There are no payslips in this financial year yet.</div>}
      </div>
      <Callout>The quarter totals are what the quarterly TDS return (Form 24Q) asks for, and each quarter's sheet lists every person and month to copy into the return utility. {PRODUCT} keeps only a masked PAN, so please complete the PAN column there. The official Form 16 is issued from the tax department's TRACES portal after the last return; the statement here is a working copy to check against it.</Callout>
    </>
  );
}

/* Project shares: how much of each person's time a project takes, used by the cost-by-project table. HR sets them. */
function Shares({ onChange }) {
  const toast = useToast();
  const { data, reload } = useList("/api/finance/shares");
  const [draft, setDraft] = useState({}), [err, setErr] = useState({});
  if (!data || !data.people) return null;
  const people = data.people.filter((p) => p.projects.length > 1 || p.projects.some((a) => a.percent != null));
  if (!people.length) return null;
  const put = async (a) => {
    if (!(a.id in draft)) return;
    const r = await api("PATCH", `/api/finance/shares/${a.id}`, { percent: draft[a.id] });
    if (!r.ok) { setErr({ ...err, [a.id]: (r.data && r.data.errors && r.data.errors.percent) || apiMsg(r) }); return; }
    setErr({ ...err, [a.id]: "" }); setDraft(({ [a.id]: _gone, ...rest }) => rest);
    toast("The project share was saved."); reload(); onChange();
  };
  return (
    <div className="card"><div className="card-h"><h3>Project shares</h3><span className="muted">people on more than one project</span></div>
      <div className="tbl-wrap"><table>
        <thead><tr><th>Employee</th><th>Project</th><th>Share set, in per cent</th><th className="text-right">Share used</th></tr></thead>
        <tbody>{people.flatMap((p) => p.projects.map((a, i) => (
          <tr key={a.id}><td>{i === 0 ? <b className="font-bold">{p.name}</b> : <span className="sr-only">{p.name}</span>}</td><td>{a.project}</td>
            <td>{data.canEdit ? <>
              <input className="input w-28" inputMode="numeric" maxLength={3} placeholder="Equal" aria-label={`Share of ${p.name} on ${a.project}, in per cent`} aria-invalid={!!err[a.id]}
                value={a.id in draft ? draft[a.id] : (a.percent == null ? "" : String(a.percent))} onChange={(e) => setDraft({ ...draft, [a.id]: e.target.value })} onBlur={() => put(a)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
              {err[a.id] && <div className="ferr" role="alert">{err[a.id]}</div>}</> : (a.percent == null ? "Equal share" : `${a.percent}%`)}</td>
            <td className={NUM}>{a.effective}%</td></tr>)))}</tbody>
      </table></div>
      {data.canEdit && <div className="card-b text-[14px] text-ink-dim">Leave a box empty to share what is left equally. A change is saved when you leave the box.</div>}
    </div>
  );
}

const SECTIONS = [["194J", "194J, professional or technical fees", 10], ["194C", "194C, contract work", 2], ["194H", "194H, commission or brokerage", 2], ["194I", "194I, rent", 10]];
const BLANK = { name: "", pan: "", section: "194J", paidOn: "", amount: "", rate: "", note: "" };

/* Contractors: payments to contractors and consultants with the tax deducted, for the quarterly return (Form 26Q). */
function Contractors({ fy }) {
  const toast = useToast();
  const { data, error, reload } = useList(`/api/finance/contractors?fy=${fy}`);
  const [f, setF] = useState(BLANK), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  if (!data) return <Loading />;
  const list = data.payments || [], quarters = data.quarters || [];
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const usual = (SECTIONS.find(([k]) => k === f.section) || [])[2];
  const add = async (e) => {
    e.preventDefault(); setBusy(true);
    const r = await api("POST", "/api/finance/contractors", f); setBusy(false);
    if (!r.ok) { setErr((r.data && r.data.errors) || { form: apiMsg(r) }); return; }
    setErr({}); setF({ ...BLANK, section: f.section, paidOn: f.paidOn }); toast("The payment was recorded."); reload();
  };
  const remove = async (p) => {
    const r = await api("DELETE", `/api/finance/contractors/${p.id}`);
    if (!r.ok) { toast(apiMsg(r)); return; }
    toast("The payment was removed."); reload();
  };
  const sheet = () => save(`wohlig-one-contractor-tds-${fy}.csv`, [
    [`Contractor payments and TDS for the financial year ${fyLabel(fy)}`], [],
    ["Quarter", "Section", "Payments", "Amount paid", "TDS"], ...quarters.map((q) => [q.quarter, q.section, q.payments, q.amount, q.tds]), [],
    ["Date of payment", "Name", "PAN (masked: please complete)", "Section", "Amount paid", "Rate (%)", "TDS", "Paid after tax", "Note"],
    ...list.map((p) => [p.paidOn, p.name, p.pan, p.section, p.amount, p.rate, p.tds, p.net, p.note]),
  ]);
  const Err = ({ k }) => (err[k] ? <span className="ferr" role="alert">{err[k]}</span> : null);
  return (
    <>
      {error && <Callout>{error}</Callout>}
      {data.canEdit && <form className="card" onSubmit={add} noValidate><div className="card-h"><h3>Record a payment</h3></div>
        <div className="card-b flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
            <div className="field"><label htmlFor="cp-name">Paid to</label><input id="cp-name" className="input" maxLength={120} value={f.name} onChange={set("name")} aria-invalid={!!err.name} /><Err k="name" /></div>
            <div className="field"><label htmlFor="cp-pan">PAN</label><input id="cp-pan" className="input" maxLength={10} autoComplete="off" value={f.pan} onChange={set("pan")} aria-invalid={!!err.pan} /><span className="hint">Only the last four characters are kept. Without a PAN the rate is 20%.</span><Err k="pan" /></div>
            <div className="field"><label htmlFor="cp-section">Section</label><select id="cp-section" className="input" value={f.section} onChange={set("section")}>{SECTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select><Err k="section" /></div>
            <div className="field"><label htmlFor="cp-date">Date of payment</label><input id="cp-date" type="date" className="input" value={f.paidOn} onChange={set("paidOn")} aria-invalid={!!err.paidOn} /><Err k="paidOn" /></div>
            <div className="field"><label htmlFor="cp-amount">Amount before tax, in rupees</label><input id="cp-amount" className="input" inputMode="decimal" value={f.amount} onChange={set("amount")} aria-invalid={!!err.amount} /><Err k="amount" /></div>
            <div className="field"><label htmlFor="cp-rate">TDS rate, in per cent</label><input id="cp-rate" className="input" inputMode="decimal" placeholder={`${usual} (the usual rate)`} value={f.rate} onChange={set("rate")} aria-invalid={!!err.rate} /><Err k="rate" /></div>
          </div>
          <div className="field"><label htmlFor="cp-note">Note</label><input id="cp-note" className="input" maxLength={200} placeholder="For example: invoice number, what the work was" value={f.note} onChange={set("note")} /></div>
          {err.form && <span className="ferr" role="alert">{err.form}</span>}
          <div className="flex justify-end"><button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : "Record payment"}</button></div>
        </div>
      </form>}
      {quarters.length > 0 && (
        <div className="card"><div className="card-h"><h3>By quarter and section, {fyLabel(fy)}</h3><Download onClick={sheet} /></div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Quarter</th><th>Section</th><th className="text-right">Payments</th><th className="text-right">Amount paid</th><th className="text-right">TDS</th></tr></thead>
            <tbody>{quarters.map((q) => <tr key={q.quarter + q.section}><td>{q.quarter}</td><td>{q.section}</td><td className={NUM}>{q.payments}</td><td className={NUM}>{inr(q.amount)}</td><td className={NUM}>{inr(q.tds)}</td></tr>)}</tbody>
          </table></div>
        </div>)}
      <div className="card"><div className="card-h"><h3>Payments, {fyLabel(fy)}</h3></div>
        {list.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>Date</th><th>Paid to</th><th>Section</th><th className="text-right">Amount</th><th className="text-right">Rate</th><th className="text-right">TDS</th><th className="text-right">Paid after tax</th>{data.canEdit && <th><span className="sr-only">Remove</span></th>}</tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.id}><td>{longDate(p.paidOn)}</td><td><b className="font-bold">{p.name}</b><div className="text-[13px] text-ink-faint">{[p.hasPan ? `PAN ${p.pan}` : "No PAN", p.note].filter(Boolean).join(", ")}</div></td><td>{p.section}</td>
                <td className={NUM}>{inr(p.amount)}</td><td className={NUM}>{p.rate}%</td><td className={NUM}>{inr(p.tds)}</td><td className={NUM}>{inr(p.net)}</td>
                {data.canEdit && <td className="text-right"><button type="button" className="btn glass sm" onClick={() => remove(p)} aria-label={`Remove the payment to ${p.name} on ${longDate(p.paidOn)}`}>Remove</button></td>}</tr>))}</tbody>
          </table></div>) : <div className="empty">No contractor payments are recorded for this financial year yet.</div>}
      </div>
      <Callout>The tax is the amount multiplied by the rate, to the rupee. The yearly limits below which no tax is deducted are not applied here, so please set the rate to 0 for a payment under the limit. TDS is due by the 7th of the next month, or 30 April for March.</Callout>
    </>
  );
}

/* One person's year, month by month, to print or save as a PDF. */
export function TaxStatement() {
  const { canAll } = useAuth();
  const sees = canAll("finance.view") || canAll("payroll.approve");   // as the server: whole company only
  const { email } = useParams();
  const [params] = useSearchParams();
  const fy = params.get("fy") || "";
  const [d, setD] = useState(null), [error, setError] = useState("");
  const { data, error: loadError } = useList(`/api/finance/tax-statements/${encodeURIComponent(email)}?fy=${fy}`);
  useEffect(() => { if (data) { setD(data); setError(loadError); } }, [data, loadError]);
  const back = <BackButton to={`/app/finance-reports?view=tax&fy=${fy}`} label="Annual tax" />;
  if (!sees) return <section className="section"><div className="empty">Only the people given finance reports or payroll approval can see finance reports.</div></section>;
  if (!d) return <section className="section"><Loading /></section>;
  if (error || !d.person) return <section className="section">{back}<Callout>{error || "This statement could not be loaded."}</Callout></section>;
  const t = d.totals, p = d.person;
  const facts = [["Employee number", p.empNo || "Not set"], ["PAN", p.pan || "Not set"], ["Designation", p.title || "Not set"], ["Tax regime used by payroll", d.regime === "old" ? "Old regime" : "New regime"]];
  return (
    <section className="section">
      <div className="print:hidden">{back}</div>
      <SectionHead title={`Annual tax statement, ${fyLabel(fy)}`} sub={`${p.name}. A working copy from payroll, not the official Form 16.`}
        actions={<button type="button" className="btn primary" onClick={() => window.print()}>Print or save as PDF</button>} />
      {t.draftMonths > 0 && <Callout>{t.draftMonths === 1 ? "One month" : `${t.draftMonths} months`} of this year {t.draftMonths === 1 ? "is" : "are"} not approved yet, so the figures can still change.</Callout>}
      <article className="card flex flex-col gap-6 p-8 max-sm:p-5 print:border-0 print:p-0 print:shadow-none" aria-label={`Annual tax statement for ${p.name}`}>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><img src={BRAND.logos.light} alt={BRAND.company.name} className="lg-light h-8 w-auto" /><img src={BRAND.logos.dark} alt={BRAND.company.name} className="lg-dark h-8 w-auto print:hidden" /></div>
          <div className="text-right"><div className="font-display text-[20px] font-medium">Salary and tax deducted</div><div className="text-[14px] text-ink-dim">Financial year {fyLabel(fy)}</div></div>
        </header>
        <div><div className="font-display text-[22px] font-medium">{p.name}</div><div className="text-[14px] text-ink-dim">{p.email}</div></div>
        <dl className="m-0 grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-xs:grid-cols-1">{facts.map(([k, v]) => <div key={k}><dt className="text-[13px] font-bold text-ink-dim">{k}</dt><dd className="m-0">{v}</dd></div>)}</dl>
        {d.rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>Month</th><th className="text-right">Salary</th><th className="text-right">Taxable salary</th><th className="text-right">PF employee</th><th className="text-right">Professional tax</th><th className="text-right">TDS</th><th className="text-right">Net pay</th></tr></thead>
            <tbody>
              {d.rows.map((r) => <tr key={r.period}><td>{monthName(r.period)}{r.final ? "" : " (not approved)"}</td><td className={NUM}>{inr(r.salary)}</td><td className={NUM}>{inr(r.taxable)}</td><td className={NUM}>{inr(r.pf)}</td><td className={NUM}>{inr(r.pt)}</td><td className={NUM}>{inr(r.tds)}</td><td className={NUM}>{inr(r.net)}</td></tr>)}
              <tr className={TOTAL_ROW}><td>Total, {t.months} {t.months === 1 ? "month" : "months"}</td><td className={NUM}>{inr(t.salary)}</td><td className={NUM}>{inr(t.taxable)}</td><td className={NUM}>{inr(t.pf)}</td><td className={NUM}>{inr(t.pt)}</td><td className={NUM}>{inr(t.tds)}</td><td className={NUM}>{inr(t.net)}</td></tr>
            </tbody>
          </table></div>) : <div className="empty">There are no payslips for this person in this financial year.</div>}
        <div className="tbl-wrap"><table>
          <thead><tr><th>Quarter</th><th className="text-right">Months paid</th><th className="text-right">Taxable salary</th><th className="text-right">TDS</th></tr></thead>
          <tbody>{d.quarters.map((q, i) => <tr key={q.quarter}><td>{["April to June", "July to September", "October to December", "January to March"][i]}</td><td className={NUM}>{q.months}</td><td className={NUM}>{inr(q.taxable)}</td><td className={NUM}>{inr(q.tds)}</td></tr>)}</tbody>
        </table></div>
        <p className="m-0 text-[14px] text-ink-dim">This statement is prepared from {PRODUCT} payroll records for {BRAND.company.legalName}. It is a working copy and is not a certificate of tax deducted. The official Form 16 is issued from the TRACES portal.</p>
      </article>
    </section>
  );
}

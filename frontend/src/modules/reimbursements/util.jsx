import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api.js";
import { Smile } from "../../components/ui.jsx";

export const RB_STATUS = {
  draft: ["Draft", "p-mute"], submitted: ["Pending review", "p-warn"], under_review: ["Under review", "p-info"],
  changes_requested: ["Changes requested", "p-warn"], resubmitted: ["Resubmitted", "p-info"], approved: ["Approved", "p-ok"],
  rejected: ["Rejected", "p-bad"], payroll_pending: ["Payroll pending", "p-info"], in_payroll: ["In payroll", "p-info"], paid: ["Paid", "p-ok"],
};
export const RbPill = ({ status }) => <span className={`pill ${(RB_STATUS[status] || ["", ""])[1]}`}>{(RB_STATUS[status] || [status])[0]}</span>;

export const money = (n) => (n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fdate = (s) => { if (!s) return "—"; const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
export const dtShort = (s) => { if (!s) return "—"; const d = new Date(s); return `${d.getDate()} ${MON[d.getMonth()]}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
export const monthLabel = (p) => (p ? new Date(p + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "—");
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const lc = (s) => String(s || "").toLowerCase();

export const rbReq = (c) => (c.requestedAmount != null ? c.requestedAmount : c.amount);
export const rbElig = (c) => (c.eligibleAmount != null ? c.eligibleAmount : rbReq(c));
export const rbExp = (c) => (c.expenses && c.expenses.length ? c.expenses : [{ category: c.category, amount: c.amount }]);

const ICONS = {
  doc: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
  warn: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>, check: <path d="m5 12 5 5 9-10" />, x: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  zin: <><circle cx="11" cy="11" r="7" /><path d="m21 21-5-5M11 8v6M8 11h6" /></>, zout: <><circle cx="11" cy="11" r="7" /><path d="m21 21-5-5M8 11h6" /></>,
  open: <path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />, down: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
};
export const Ico = ({ k }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[k]}</svg>
);
export const InfoCallout = ({ children, bad }) => <div className={`callout${bad ? " bad" : ""}`}><Ico k={bad ? "warn" : "info"} /><div>{children}</div></div>;

/* The page heading the old pages use: the title may carry a highlighted tail ("Reimburse" + "ments."). */
export function Head({ eyebrow, title, accent, sub, actions }) {
  return (
    <div className="sec-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2 className="big">{title}{accent && <span className="grad">{accent}</span>}</h2>
        <Smile />
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export const Skel = ({ w, big }) => <span className={`skel${big ? " big" : ""}`} style={w ? { width: w } : undefined} />;
export const SkelRows = ({ n, cols }) => Array.from({ length: n }, (_, r) => (
  <tr key={r}>{Array.from({ length: cols }, (_, i) => <td key={i}><Skel w={`${[70, 50, 80, 40, 45, 30, 55, 40][i % 8]}%`} /></td>)}</tr>
));

/* A dialog like the shared Modal, with an optional wide variant. */
export function Dlg({ onClose, wide, children }) {
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}

export const Fld = ({ id, label, hint, error, children }) => (
  <div className="field"><label htmlFor={id}>{label}</label>{children}{hint && <span className="hint">{hint}</span>}{error && <span className="ferr" role="alert">{error}</span>}</div>
);

/* Categories, limits, reject reasons etc. are read once and shared by the three pages. */
let cache = null;
export async function loadMeta(force) {
  if (cache && !force) return cache;
  const r = await api("GET", "/api/reimbursements/categories");
  if (r.ok) cache = r.data;
  return cache;
}
export function useMeta() {
  const [meta, setMeta] = useState(cache);
  useEffect(() => { if (!cache) loadMeta().then((m) => m && setMeta(m)); }, []);
  const reload = async () => { const m = await loadMeta(true); if (m) setMeta(m); };
  return [meta, reload];
}
export const catName = (meta, k) => (((meta && meta.categories) || []).find((c) => c.key === k) || { name: k }).name;

/* The expenses of a claim as a table. In the claim page a receipt opens in the viewer; elsewhere in a new tab. */
export function LinesTable({ c, meta, compact = false, onDoc }) {
  const items = c.items || [], vi = (c.validation && c.validation.items) || {}, ei = (c.eligibility && c.eligibility.items) || {};
  if (!items.length) return null;
  const tag = (it) => {
    const m = vi[it.id] && vi[it.id].match;
    if (!it.document) return null;
    return m && m.status === "match" ? <span className="flag ok"><Ico k="check" />Matches</span>
      : m && m.status === "mismatch" ? <span className="flag" title="Amount on the invoice"><Ico k="warn" />Invoice {money(m.invoiceTotal)}</span> : null;
  };
  const rc = (it) => it.document ? <>
    {onDoc ? <button type="button" className="btn link sm nolink" onClick={() => onDoc(it.document.id)}><Ico k="doc" />View</button>
      : <a className="btn link sm nolink" href={`/api/reimbursements/${c.id}/documents/${it.document.id}`} target="_blank" rel="noopener noreferrer"><Ico k="doc" />View</a>} {tag(it)}</>
    : it.noReceipt ? <span className="pill p-mute">No receipt</span> : <span className="pill p-warn">Missing</span>;
  const small = { fontSize: 12 };
  return (
    <div className="tbl-wrap"><table className="rb-lines"><thead><tr><th>#</th><th>Category</th>
      {!compact && <><th className="hide-sm">Vendor · invoice</th><th className="hide-sm">Date</th></>}
      <th className={compact ? "" : "hide-sm hide-md"}>What for</th>{!compact && <th className="hide-sm hide-md">Paid with</th>}<th className="num">Amount</th><th>Receipt</th></tr></thead>
      <tbody>
        {items.map((it, i) => { const x = ei[it.id]; return (
          <tr key={it.id ?? i}><td className="muted">{i + 1}</td>
            <td>{catName(meta, it.category)}{it.travelClass && <div className="muted" style={small}>{it.travelClass} class</div>}
              {it.source === "excel" ? <div className="muted" style={small}>From expense sheet</div> : it.source === "document" ? <div className="muted" style={small}>Read from invoice</div> : null}</td>
            {!compact && <><td className="hide-sm">{it.vendor ? it.vendor : <span className="muted">—</span>}{it.invoiceNo && <div className="muted mono" style={small}>{it.invoiceNo}</div>}</td>
              <td className="hide-sm num-cell">{fdate(it.expenseDate)}</td></>}
            <td className={`desc ${compact ? "" : "hide-sm hide-md"}`}>{it.description || ""}</td>
            {!compact && <td className="hide-sm hide-md">{it.paymentMethod || "—"}</td>}
            <td className="num"><b>{money(it.amount)}</b>{x && x.nonEligible > 0 && <div className="muted" style={small}>eligible {money(x.eligible)}</div>}</td>
            <td>{rc(it)}</td></tr>); })}
        {items.length > 1 && <tr className="rb-total"><td></td><td colSpan={compact ? 2 : 5}><b>Total</b></td><td className="num"><b>{money(items.reduce((n, it) => n + (it.amount || 0), 0))}</b></td><td></td></tr>}
      </tbody></table></div>
  );
}

export const BudgetLink = ({ id, children }) => <Link className="btn link nolink" to={`/app/budgets/${id}`}>{children}</Link>;

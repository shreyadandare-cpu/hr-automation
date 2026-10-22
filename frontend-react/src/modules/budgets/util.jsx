import { useEffect, useState } from "react";
import { api } from "../../api.js";

export const money = (n) => (n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }));

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fdate = (s) => { if (!s) return "—"; const [y, m, d] = s.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
export const dtShort = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.getDate()} ${MON[d.getMonth()]}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export const BQ_STATUS = {
  submitted: ["Waiting for HR", "p-warn"], under_review: ["Under HR review", "p-info"], approved: ["Approved", "p-ok"],
  partially_approved: ["Partially approved", "p-ok"], rejected: ["Rejected", "p-bad"],
};
export const BqPill = ({ status }) => <span className={`pill ${(BQ_STATUS[status] || ["", ""])[1]}`}>{(BQ_STATUS[status] || [status])[0]}</span>;

/* Status pills for the final-bill claim (same as the reimbursements page). */
const RB_STATUS = {
  draft: ["Draft", "p-mute"], submitted: ["Pending review", "p-warn"], under_review: ["Under review", "p-info"],
  changes_requested: ["Changes requested", "p-warn"], resubmitted: ["Resubmitted", "p-info"], approved: ["Approved", "p-ok"],
  rejected: ["Rejected", "p-bad"], payroll_pending: ["Payroll pending", "p-info"], in_payroll: ["In payroll", "p-info"], paid: ["Paid", "p-ok"],
};
export const ClaimPill = ({ status }) => <span className={`pill ${(RB_STATUS[status] || ["", ""])[1]}`}>{(RB_STATUS[status] || [status])[0]}</span>;

const ICONS = {
  doc: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
  warn: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>,
  check: <path d="m5 12 5 5 9-10" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
};
export const Ico = ({ name }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>
);

/* Expense categories, loaded once and shared by the three pages. */
let catCache = null;
export function useCats() {
  const [cats, setCats] = useState(catCache);
  useEffect(() => {
    if (catCache) return;
    api("GET", "/api/reimbursements/categories").then((r) => { if (r.ok) { catCache = r.data.categories; setCats(catCache); } });
  }, []);
  return cats;
}
export const catName = (cats, k) => ((cats || []).find((c) => c.key === k) || { name: k }).name;

export const Kv = ({ pairs }) => (
  <dl className="rv">{pairs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || "—"}</dd></div>)}</dl>
);

export const Wf = ({ id, label, error, hint, children }) => (
  <div className="field"><label htmlFor={id}>{label}</label>{children}{hint && <span className="hint">{hint}</span>}{error && <span className="ferr" role="alert">{error}</span>}</div>
);

export const SkelRows = ({ n, cols }) => Array.from({ length: n }, (_, r) => (
  <tr key={r}>{Array.from({ length: cols }, (_, i) => <td key={i}><span className="skel" style={{ width: `${[70, 50, 80, 40, 45, 30, 55, 40][i % 8]}%` }} /></td>)}</tr>
));

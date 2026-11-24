import { Pill } from "../../components/ui.jsx";

export { money, fdate } from "../budgets/util.jsx";
export const STATUS = { pending: ["Pending HR approval", "warn"], active: ["Approved / Active", "ok"], completed: ["Completed", "info"], rejected: ["Rejected", "bad"], cancelled: ["Cancelled", "mute"] };
export const LoanPill = ({ status }) => <Pill tone={(STATUS[status] || [])[1]}>{(STATUS[status] || [status])[0]}</Pill>;

/* Repayment progress: how much of the approved amount has been deducted. */
export const Progress = ({ percent, label }) => (
  <div className="grid gap-1" style={{ minWidth: 120 }}>
    <div className="h-2 w-full overflow-hidden rounded-full bg-tint" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label || "Repayment progress"}>
      <div className="h-2 rounded-full bg-ok" style={{ width: `${percent}%` }} />
    </div>
    <span className="muted" style={{ fontSize: 12 }}>{percent}% repaid</span>
  </div>
);

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (p) => { if (!p) return "—"; const [y, m] = p.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
export const thisMonth = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
export const nextMonth = () => { const [y, m] = thisMonth().split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
export const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
/* The same rounding as the server (loans-rules.js): the installment is rounded up to the paisa so the last one is the exact remainder. The server's figure is the one that counts. */
export const monthlyOf = (amount, months) => (Number(amount) > 0 && Number(months) >= 1 ? Math.ceil(Math.round((Number(amount) / Math.floor(Number(months))) * 1e6) / 1e4) / 100 : 0);

import { Pill } from "../../components/ui.jsx";

/* Shared by the payroll pages. Every amount comes from the server (backend/src/payroll); nothing is calculated here. */
export const money = (n) => (n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }));
export const monthLabel = (p) => (p ? new Date(p + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "—");
export const thisMonth = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
export const fyOf = (p) => { const [y, m] = p.split("-").map(Number); const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; };
export const plural = (n, w, many = w + "s") => `${n} ${n === 1 ? w : many}`;
export const when = (s) => (s ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

/* The review workflow, in order, as the stepper shows it. */
export const STEPS = [["draft", "Draft"], ["calculated", "Calculated"], ["generated", "Generated"], ["pending_review", "Pending review"], ["approved", "Approved"],
  ["bank_ready", "Ready for bank"], ["paid", "Processed"]];
const TONE = { draft: "mute", calculated: "info", generated: "info", pending_review: "warn", changes_requested: "bad", rejected: "bad", approved: "ok", bank_ready: "ok", paid: "ok", processed: "ok" };
export const StatusPill = ({ run }) => (run ? <Pill tone={TONE[run.status] || "mute"}>{run.statusLabel}</Pill> : <Pill>Not started</Pill>);

export const LINE = { ready: ["Ready", "ok"], incomplete: ["Incomplete", "bad"], hold: ["On hold", "warn"] };
export const LinePill = ({ status }) => <Pill tone={LINE[status][1]}>{LINE[status][0]}</Pill>;

/** Downloads a stored payroll file through the API (the browser keeps the session cookie). */
export const fileUrl = (runId, fileId) => `/api/payroll/runs/${runId}/files/${fileId}`;

/* Small building blocks that reuse the existing page's styles, so React pages look like the rest of the app. */
export const initials = (n) => String(n || "").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export const Smile = () => (
  <svg className="smile" viewBox="0 0 34 10" fill="none" aria-hidden="true">
    <path d="M2 2c4 5 9 6.5 15 6.5S28 7 32 2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

export function SectionHead({ eyebrow, title, accent, sub, actions, big = true }) {
  return (
    <div className="sec-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2 className={big ? "big" : ""}>{title} {accent && <span className="grad">{accent}</span>}</h2>
        <Smile />
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export const Stat = ({ value, label, alert }) => (
  <div className={`card stat ${alert ? "alert" : ""}`}><span className="num">{value}</span><span className="lbl">{label}</span></div>
);

export const Callout = ({ children }) => (
  <div className="callout">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
    <div>{children}</div>
  </div>
);

export const Pill = ({ tone = "mute", children }) => <span className={`pill p-${tone}`}>{children}</span>;

export function Person({ name, sub, color = "#4254d4" }) {
  return (
    <div className="person">
      <span className="avatar" style={{ background: color }}>{initials(name)}</span>
      <div style={{ minWidth: 0 }}><b>{name}</b><span>{sub}</span></div>
    </div>
  );
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const dayLabel = (d) => {
  const [y, m, dd] = d.split("-").map(Number);
  return `${dd} ${MON[m - 1]}, ${WEEK[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]}`;
};
export const shortDate = (s) => {
  if (!s) return "";
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return `${d} ${MON[m - 1]} ${y}`;
};
export const hours = (m) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : "—");

/* Icons used by the pages (the same drawings as the older pages). */
const ICON_PATHS = {
  camera: <><path d="M4 8h3l2-2h6l2 2h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  pin: <><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  idcard: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M6 16c.5-1.6 1.7-2.4 3-2.4s2.5.8 3 2.4M14 10h4M14 14h4" /></>,
  alert: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  filedoc: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></>,
  onboard: <><circle cx="10" cy="8" r="3.5" /><path d="M3.5 20c.8-3.6 3.4-5.5 6.5-5.5 1.5 0 2.9.4 4 1.3" /><path d="M18 14v6M15 17h6" /></>,
  offboard: <><circle cx="10" cy="8" r="3.5" /><path d="M3.5 20c.8-3.6 3.4-5.5 6.5-5.5 1.5 0 2.9.4 4 1.3" /><path d="M15 17h6" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18" /></>,
};
export const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICON_PATHS[name]}</svg>
);

export const Avatar = ({ person }) => <span className="avatar" style={{ background: person.color }}>{initials(person.name)}</span>;

export function PersonCell({ person, sub }) {
  return (
    <div className="person">
      <Avatar person={person} />
      <div style={{ minWidth: 0 }}><b>{person.name}</b><span>{sub ?? person.email}</span></div>
    </div>
  );
}

export function ToolIcon({ tool, state }) {
  const cls = state === "active" ? "" : state === "failed" ? "fail" : "off";
  return <span className={`app-ic ${cls}`} style={{ background: tool.color }} title={tool.name}>{tool.mono}</span>;
}

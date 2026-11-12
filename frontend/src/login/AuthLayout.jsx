/* The sign-in and invitation pages share this: a branded panel (hidden on phones) beside the form. */
const Icon = ({ children }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const POINTS = [
  [<Icon key="a"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>, "Attendance and leave", "Punches from the office device, leave requests and approvals."],
  [<Icon key="p"><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18M16 15h2" /></Icon>, "Pay and expenses", "Payslips and reimbursements, each with its own status."],
  [<Icon key="j"><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5M17 8.5h4M19 6.5v4" /></Icon>, "Joining and leaving", "Onboarding, offboarding and the equipment people hold."],
];

export default function AuthLayout({ children }) {
  return (
    <div className="split">
      <aside className="brand">
        <i className="ring r1" aria-hidden="true" /><i className="ring r2" aria-hidden="true" />
        <span className="brand-chip"><img src="/wohlig-logo.svg" alt="wohlig" /></span>
        <div className="brand-body">
          <div className="app-name">HR Access Hub</div>
          <h2>Everything about working at wohlig, in one place.</h2>
          <ul>{POINTS.map(([ico, t, d]) => <li key={t}><span className="ico">{ico}</span><div><b>{t}</b><span>{d}</span></div></li>)}</ul>
        </div>
        <div className="brand-foot">People Ops</div>
      </aside>
      <div className="pane">{children}</div>
    </div>
  );
}

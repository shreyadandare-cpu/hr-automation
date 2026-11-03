/* The sign-in and invitation pages share this: a branded panel on the left (hidden on phones) and the form on the right. */
const POINTS = [
  ["Attendance and leave", "Punches from the office device, leave requests and approvals."],
  ["Pay and expenses", "Payslips and reimbursements, each with its own status."],
  ["Joining and leaving", "Onboarding, offboarding and the equipment people hold."],
];

export default function AuthLayout({ children }) {
  return (
    <div className="split">
      <aside className="brand" aria-hidden="false">
        <img className="brand-logo" src="/wohlig-logo-dark.png" alt="wohlig" />
        <div className="brand-body">
          <div className="app-name">HR Access Hub</div>
          <h2>Everything about working at wohlig, in one place.</h2>
          <ul>{POINTS.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}</ul>
        </div>
        <div className="brand-foot">People Ops</div>
      </aside>
      <div className="pane">{children}</div>
    </div>
  );
}

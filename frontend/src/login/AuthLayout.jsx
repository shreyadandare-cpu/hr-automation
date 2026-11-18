import { useState } from "react";
import { currentTheme, toggleTheme } from "../theme.js";

/* The sign-in and invitation pages share this layout: the maroon brand panel on the left (a short band on phones)
   and only the form on the right. Keep it clean: no sun, flower or glow shapes. Colours and fonts come from
   brand.css; the logo is the master artwork in public/ and is never redrawn here. */
const Icon = ({ children }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const POINTS = [
  [<Icon><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>, "Attendance and leave", "Daily punches, leave requests and approvals."],
  [<Icon><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18M16 15h2" /></Icon>, "Pay and expenses", "Payslips and reimbursements, with a clear status."],
  [<Icon><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5M17 8.5h4M19 6.5v4" /></Icon>, "Joining and moving on", "Onboarding, offboarding and company equipment."],
];
export default function AuthLayout({ children }) {
  const [theme, setTheme] = useState(currentTheme);
  return (
    <div className="auth">
      <aside className="auth-panel" aria-label="About HR Access Hub">
        <img className="auth-logo rise" src="/wohlig-logo-dark.svg" alt="Wohlig" />
        <div className="auth-pitch">
          <p className="auth-eyebrow rise" style={{ "--d": 1 }}>HR Access Hub</p>
          <p className="auth-headline rise" style={{ "--d": 2 }}>Your workday, made <em>wohlig.</em></p>
          <p className="auth-lede rise" style={{ "--d": 3 }}>Attendance, leave, payslips, expenses and onboarding, together in one secure place for everyone at Wohlig.</p>
          <ul className="auth-points">
            {POINTS.map(([ico, title, text], i) => <li key={title} className="rise" style={{ "--d": 4 + i }}><span className="ico">{ico}</span><div><b>{title}</b><span>{text}</span></div></li>)}
          </ul>
        </div>
      </aside>
      <div className="auth-pane">
        <button type="button" className="auth-theme" aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setTheme(toggleTheme())}>
          {theme === "dark"
            ? <Icon><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></Icon>
            : <Icon><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></Icon>}
        </button>
        <main className="auth-card rise" style={{ "--d": 2 }}>{children}</main>
      </div>
    </div>
  );
}

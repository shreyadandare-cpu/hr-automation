import { useState } from "react";
import { currentTheme, toggleTheme } from "../theme.js";

/* The sign-in and invitation pages share this layout: the maroon brand panel on the left (a short band on phones)
   and only the form on the right. Keep it clean: no sun, flower or glow shapes. Colours and fonts come from
   brand.css; the logo is the master artwork in public/ and is never redrawn here. */
const Icon = ({ children }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const POINTS = [
  [<Icon><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>, "Attendance", "Your daily office punches, day by day."],
  [<Icon><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></Icon>, "Leave", "Apply for leave and follow each approval."],
  [<Icon><path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" /></Icon>, "Payslips", "Every month's payslip, ready to download."],
  [<Icon><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18M16 15h2" /></Icon>, "Expenses", "Claim reimbursements and track their status."],
  [<Icon><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" /></Icon>, "Profile and documents", "Your details and records, kept up to date."],
  [<Icon><rect x="3" y="7" width="18" height="13" rx="3" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 13h18" /></Icon>, "Digital Kit", "Wohlig letterheads, decks and email signatures."],
];
export default function AuthLayout({ children }) {
  const [theme, setTheme] = useState(currentTheme);
  return (
    <div className="auth">
      <aside className="auth-panel" aria-label="About Wohlig One">
        <img className="auth-logo rise" src="/wohlig-logo-dark.svg" alt="Wohlig" />
        <div className="auth-pitch">
          <p className="auth-eyebrow rise" style={{ "--d": 1 }}>Wohlig One</p>
          <p className="auth-headline rise" style={{ "--d": 2 }}>Your workday, made <em>wohlig.</em></p>
          <p className="auth-lede rise" style={{ "--d": 3 }}>One secure place for everyone at Wohlig, with your attendance, leave, pay and more.</p>
          <ul className="auth-points">
            {POINTS.map(([ico, title, text], i) => <li key={title} className="rise" style={{ "--d": 4 + i * 0.5 }}><span className="ico">{ico}</span><div><b>{title}</b><span>{text}</span></div></li>)}
          </ul>
        </div>
        <div className="auth-foot rise" style={{ "--d": 8 }}>
          <p className="auth-motto">Rooted in warmth. Built for what's next.</p>
          <p className="auth-secure"><Icon><rect x="5" y="11" width="14" height="9.5" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Icon>Protected by your Wohlig Google account</p>
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

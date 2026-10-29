import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { applyTheme, currentTheme, toggleTheme } from "../theme.js";
import { initials } from "./ui.jsx";
import NotificationBell from "./NotificationBell.jsx";
import NextHolidayPopup from "./NextHolidayPopup.jsx";

/* Pages still in the older single page app are plain links (hash routes under /). Pages already in React stay in the app. */
const HR_LINKS = [["dashboard", "Dashboard"], ["employees", "Employees"], ["allocations", "Allocations"], ["onboard", "Onboarding"], ["offboard", "Offboarding"], ["leave", "Leave"], ["attendance", "Attendance"], ["finances", "Finances"], ["audit", "Audit log"]];
const EMP_LINKS = [["dashboard", "Dashboard"], ["employees", "Employees"], ["allocations", "Allocations"], ["onboard", "Onboarding"], ["offboard", "Offboarding"], ["attendance", "Attendance"], ["finances", "Finances"], ["myleave", "My leave"]];
const REACT_PAGES = {
  dashboard: "/app/dashboard", employees: "/app/employees", allocations: "/app/allocations", onboard: "/app/onboarding", offboard: "/app/offboarding", leave: "/app/leave", attendance: "/app/attendance",
  reimb: "/app/reimbursements", payroll: "/app/payroll", audit: "/app/audit", myleave: "/app/my-leave", team: "/app/team-leave",
};
/* Onboarding is HR's wizard; for employees the same menu entry is their own documents page. */
const pathFor = (key, isHr) => (key === "onboard" && !isHr ? "/app/documents" : REACT_PAGES[key]);

function ThemeButton() {
  const [t, setT] = useState(currentTheme());
  useEffect(() => { applyTheme(t); }, [t]);
  return (
    <button className="theme-btn" type="button" title="Switch theme" aria-label={t === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setT(toggleTheme())}>
      {t === "dark"
        ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
        : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>}
    </button>
  );
}

/* Finances opens a small menu with Reimbursements, My payslips and, for HR, Payroll. Placed with fixed coordinates so the scrolling link row cannot clip it. */
function FinanceMenu({ isHr }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const box = useRef(null), btn = useRef(null);
  const items = [["/app/reimbursements", "Reimbursements"], ["/app/payslips", "My payslips"], ...(isHr ? [["/app/payroll", "Payroll"]] : [])];
  const on = items.some(([to]) => pathname.startsWith(to));
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener("click", away); document.addEventListener("keydown", esc); window.addEventListener("resize", close);
    return () => { document.removeEventListener("click", away); document.removeEventListener("keydown", esc); window.removeEventListener("resize", close); };
  }, [open]);
  const toggle = () => {
    if (!open && btn.current) { const r = btn.current.getBoundingClientRect(); setPos({ left: r.left, top: r.bottom + 8 }); }
    setOpen(!open);
  };
  return (
    <span ref={box} style={{ display: "contents" }}>
      <a href="#finances" ref={btn} className={`${on || open ? "on" : ""}`} role="button" aria-haspopup="true" aria-expanded={open}
        onClick={(e) => { e.preventDefault(); toggle(); }}>Finances <span aria-hidden="true" style={{ fontSize: 10 }}>▾</span></a>
      {open && (
        <div className="acct-menu fin-menu" role="menu" style={{ position: "fixed", left: pos.left, top: pos.top, right: "auto", minWidth: 190 }}>
          {items.map(([to, label]) => <NavLink key={to} to={to} role="menuitem">{label}</NavLink>)}
        </div>)}
    </span>
  );
}

function AccountMenu({ photoV }) {
  const { user, isHr } = useAuth();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("click", away); document.removeEventListener("keydown", esc); };
  }, []);
  const photo = photoV ? `/api/profile/photo?v=${photoV}` : "";
  const face = photo ? <img src={photo} alt="" /> : initials(user.name);
  const signOut = async () => { await api("POST", "/api/logout"); location.href = "/login"; };
  return (
    <div ref={box} style={{ display: "contents" }}>
      <button className={`avatar-btn ${open ? "on" : ""}`} type="button" aria-label="Account menu" aria-haspopup="true" aria-expanded={open}
        title={`${user.name}, account menu`} style={{ background: photo ? "transparent" : undefined }} onClick={() => setOpen(!open)}>{face}</button>
      {open && (
        <div className="acct-menu" role="menu">
          <div className="acct-head">
            <span className="avatar-btn" style={{ background: photo ? "transparent" : undefined }}>{face}</span>
            <div style={{ minWidth: 0 }}><b>{user.name}</b><span>{user.email} · {isHr ? "HR" : "Employee"}</span></div>
          </div>
          <NavLink to="/app/profile" role="menuitem" onClick={() => setOpen(false)}>My profile</NavLink>
          <NavLink to="/app/payslips" role="menuitem" onClick={() => setOpen(false)}>My payslips</NavLink>
          <NavLink to="/app/account" role="menuitem" onClick={() => setOpen(false)}>Account and password</NavLink>
          {isHr && <NavLink to="/app/users" role="menuitem" onClick={() => setOpen(false)}>Manage users</NavLink>}
          <button type="button" role="menuitem" onClick={signOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}

export default function Shell() {
  const { user, isHr, isManager } = useAuth();
  const { profile } = useData();
  const photoV = (profile && profile.photoV) || null;
  const navRef = useRef(null), linksRef = useRef(null);
  /* Measures the bar instead of guessing: if the links do not fit beside the logo and buttons, they get a row of their own. */
  useLayoutEffect(() => {
    const fit = () => {
      const nav = navRef.current, ln = linksRef.current;
      if (!nav || !ln) return;
      nav.classList.remove("two-row");
      if (ln.scrollWidth > ln.clientWidth + 1 || nav.scrollWidth > nav.clientWidth + 1) nav.classList.add("two-row");
    };
    fit();
    window.addEventListener("resize", fit);
    document.fonts && document.fonts.ready.then(fit);
    return () => window.removeEventListener("resize", fit);
  });
  const links = isHr ? HR_LINKS : [...EMP_LINKS, ...(isManager ? [["team", "Team leave"]] : [])];
  return (
    <>
      <div className="wrap navbar">
        <nav className="pill-nav" aria-label="Main" ref={navRef}>
          <a className="logo" href="/app/dashboard" aria-label="wohlig HR Access Hub, dashboard">
            <img className="lg lg-light" src="/wohlig-logo.png" alt="wohlig" /><img className="lg lg-dark" src="/wohlig-logo-dark.png" alt="" /><small>HR Access Hub</small>
          </a>
          <div className="links" ref={linksRef}>
            {links.map(([k, label]) => k === "finances" ? <FinanceMenu key={k} isHr={isHr} /> : <NavLink key={k} to={pathFor(k, isHr)} className={({ isActive }) => (isActive ? "on" : "")}>{label}</NavLink>)}
          </div>
          <AccountMenu photoV={photoV} />
          <NotificationBell />
          <ThemeButton />
          {isHr && <NavLink className="btn primary sm cta" to="/app/onboarding">+ <span className="lbl-long">New onboarding</span></NavLink>}
        </nav>
      </div>
      <main className="wrap view"><Outlet /></main>
      <NextHolidayPopup />
      <footer className="wrap"><div className="foot">
        <a className="logo" href="/app/dashboard" style={{ textDecoration: "none" }}><img className="lg lg-light" src="/wohlig-logo.png" alt="wohlig" /><img className="lg lg-dark" src="/wohlig-logo-dark.png" alt="" /></a>
        <span>HR Access Hub · People Ops</span>
        <span>Signed in as <b style={{ color: "var(--ink)" }}>{user.name}</b>, {isHr ? "HR" : "Employee"}</span>
      </div></footer>
    </>
  );
}

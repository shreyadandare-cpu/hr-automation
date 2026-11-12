import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { applyTheme, currentTheme, toggleTheme } from "../theme.js";
import { initials } from "./ui.jsx";
import { useToast } from "./toast.jsx";
import NotificationBell from "./NotificationBell.jsx";
import NextHolidayPopup from "./NextHolidayPopup.jsx";

/* Pages still in the older single page app are plain links (hash routes under /). Pages already in React stay in the app. */
const HR_LINKS = [["dashboard", "Dashboard"], ["posts", "Posts"], ["workforce", "Workforce"], ["onboard", "Onboarding"], ["offboard", "Offboarding"], ["leave", "Leave"], ["attendance", "Attendance"], ["finances", "Finances"], ["payroll", "Payroll"], ["audit", "Audit log"]];
const EMP_LINKS = [["dashboard", "Dashboard"], ["posts", "Posts"], ["workforce", "Workforce"], ["attendance", "Attendance"], ["finances", "Finances"], ["myleave", "My leave"]];
const REACT_PAGES = {
  dashboard: "/app/dashboard", posts: "/app/posts", employees: "/app/employees", allocations: "/app/allocations", onboard: "/app/onboarding", offboard: "/app/offboarding", leave: "/app/leave", attendance: "/app/attendance",
  assets: "/app/assets", claude: "/app/claude-requests", reimb: "/app/reimbursements", payroll: "/app/payroll", audit: "/app/audit", myleave: "/app/my-leave", team: "/app/team-leave",
};
/* The main page of each module gets a "Back to dashboard" button above it. Detail pages and pages that already have their own Back are left out. */
const HOME_PAGES = new Set(["/app/attendance", "/app/employees", "/app/allocations", "/app/assets", "/app/audit", "/app/leave", "/app/my-leave", "/app/team-leave", "/app/onboarding", "/app/onboarding/progress", "/app/claude-requests", "/app/documents",
  "/app/reimbursements", "/app/payroll", "/app/posts", "/app/budgets"]);
/* Onboarding and Offboarding are HR's pages: employees don't get those menu entries (they upload their documents from My profile). */
const pathFor = (key) => REACT_PAGES[key];

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

/* A group opens a small menu of pages. Placed with fixed coordinates so the scrolling link row cannot clip it. */
function GroupMenu({ label, items }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const box = useRef(null), btn = useRef(null);
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
      <a href={`#${label}`} ref={btn} className={`${on || open ? "on" : ""}`} role="button" aria-haspopup="true" aria-expanded={open}
        onClick={(e) => { e.preventDefault(); toggle(); }}>{label} <span aria-hidden="true" style={{ fontSize: 10 }}>▾</span></a>
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

/* After the Claude admin has invited this person, they are asked to say when they have accepted it (nothing tells the app otherwise). */
function ClaudeInviteBanner() {
  const { user } = useAuth();
  const { people, claudeMode, reload } = useData();
  const toast = useToast();
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem("claude-invite-later") === "1"; } catch { return false; } });
  const [busy, setBusy] = useState(false);
  const me = people && people.find((p) => String(p.email).toLowerCase() === String(user.email).toLowerCase());
  if (hidden || claudeMode !== "simulated" || !me || !me.grants || me.grants.claude !== "invited") return null;
  const yes = async () => {
    setBusy(true);
    const r = await api("POST", "/api/tool-access/claude/confirm");
    setBusy(false);
    if (!r.ok) { toast(apiMsg(r)); await reload(); return; }
    toast("Thanks. Your Claude access is marked as active."); await reload();
  };
  const later = () => { try { sessionStorage.setItem("claude-invite-later", "1"); } catch { /* the banner just comes back next time */ } setHidden(true); };
  return (
    <div className="wrap" style={{ marginTop: 16 }}>
      <div className="callout"><div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", width: "100%" }}>
        <div style={{ flex: 1, minWidth: 240 }}><b>Claude invite received?</b> You have been invited to Claude at your work email. Accept the email from Claude, then click Yes.</div>
        <button type="button" className="btn primary sm" disabled={busy} onClick={yes}>{busy ? "Saving…" : "Yes, I have access"}</button>
        <button type="button" className="btn glass sm" disabled={busy} onClick={later}>Not yet</button>
      </div></div>
    </div>
  );
}

export default function Shell() {
  const { user, isHr, isManager, itAdmin, payrollReviewer } = useAuth();
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
  const { pathname } = useLocation();
  const base = isHr ? (isManager ? HR_LINKS.flatMap((l) => (l[0] === "leave" ? [l, ["team", "Team leave"]] : [l])) : HR_LINKS) : [...EMP_LINKS, ...(isManager ? [["team", "Team leave"]] : []), ...(payrollReviewer ? [["payroll", "Payroll"]] : [])];   // the payroll reviewer (PAYROLL_REVIEWERS) approves payroll
  const links = itAdmin ? [...base.filter(([k]) => k !== "audit"), ["assets", "Assets"], ...(isHr ? [] : [["claude", "Claude"]]), ...base.filter(([k]) => k === "audit")] : base;   // HR reaches the Claude requests from Onboarding; an IT admin who is not HR gets their own link
  return (
    <>
      <div className="wrap navbar">
        <nav className="pill-nav" aria-label="Main" ref={navRef}>
          <a className="logo" href="/app/dashboard" aria-label="wohlig HR Access Hub, dashboard">
            <img className="lg lg-light" src="/wohlig-logo.svg" alt="wohlig" /><img className="lg lg-dark" src="/wohlig-logo-dark.svg" alt="" /><small>HR Access Hub</small>
          </a>
          <div className="links" ref={linksRef}>
            {links.map(([k, label]) => k === "finances" ? <GroupMenu key={k} label={label} items={[["/app/reimbursements", "Reimbursements"], ["/app/payslips", "My payslips"]]} /> : k === "workforce" ? <GroupMenu key={k} label={label} items={[["/app/employees", "Employees"], ["/app/allocations", "Allocations"]]} /> : <NavLink key={k} to={pathFor(k, isHr)} className={({ isActive }) => (isActive ? "on" : "")}>{label}</NavLink>)}
          </div>
          <NotificationBell />
          <ThemeButton />
          <AccountMenu photoV={photoV} />
        </nav>
      </div>
      <ClaudeInviteBanner />
      <main className="wrap view">
        {HOME_PAGES.has(pathname.replace(/\/+$/, "")) && <Link className="back back-home" to="/app/dashboard"><span className="back-ar" aria-hidden="true">←</span>Back to dashboard</Link>}
        <Outlet />
      </main>
      <NextHolidayPopup />
      <footer className="wrap"><div className="foot">
        <a className="logo" href="/app/dashboard" style={{ textDecoration: "none" }}><img className="lg lg-light" src="/wohlig-logo.svg" alt="wohlig" /><img className="lg lg-dark" src="/wohlig-logo-dark.svg" alt="" /></a>
        <span>Signed in as <b style={{ color: "var(--ink)" }}>{user.name}</b>, {isHr ? "HR" : "Employee"}</span>
      </div></footer>
    </>
  );
}

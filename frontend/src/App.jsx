import { lazy, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Shell from "./components/Shell.jsx";
const Attendance = lazy(() => import("./pages/Attendance.jsx"));
const Payslips = lazy(() => import("./pages/Payslips.jsx"));
const Account = lazy(() => import("./pages/Account.jsx"));
const Users = lazy(() => import("./pages/Users.jsx"));
const Employees = lazy(() => import("./pages/Employees.jsx"));
const Profile = lazy(() => import("./pages/Profile.jsx"));
import Dashboard from "./pages/Dashboard.jsx";
const Audit = lazy(() => import("./pages/Audit.jsx"));
const LeaveHr = lazy(() => import("./pages/LeaveHr.jsx"));
const MyLeave = lazy(() => import("./pages/MyLeave.jsx"));
const TeamLeave = lazy(() => import("./pages/TeamLeave.jsx"));
const LeaveReview = lazy(() => import("./pages/LeaveReview.jsx"));
const Allocations = lazy(() => import("./pages/Allocations.jsx"));
const Assets = lazy(() => import("./pages/Assets.jsx"));
const LeaveApply = lazy(() => import("./pages/LeaveApply.jsx"));
const Inbox = lazy(() => import("./pages/Inbox.jsx"));
const MyTeam = lazy(() => import("./pages/MyTeam.jsx"));
const MyFinances = lazy(() => import("./pages/MyFinances.jsx"));
import { useAuth } from "./auth.jsx";

/* Every page except the dashboard (the first one people see) loads only when it is first opened, so the app starts fast;
   Shell shows a quiet placeholder meanwhile. Bigger features live in src/modules/<name>/index.jsx and export `routes = [{ path, element }]`. They are picked up here. */
const modules = import.meta.glob("./modules/*/index.jsx", { eager: true });
const moduleRoutes = Object.values(modules).flatMap((m) => m.routes || []);

/* Onboarding and offboarding are HR's pages: an employee who opens one by its address goes back to the dashboard. */
/* Pages that need a company-wide permission: anyone without it who opens one by its address goes back to the dashboard.
   (The server refuses the data anyway; this only avoids an empty page.) */
const NEEDS = { "/app/onboarding": "onboarding.manage", "/app/onboarding/progress": "onboarding.manage", "/app/offboarding": "offboarding.manage",
  "/app/offboarding/leavers": "offboarding.manage", "/app/celebrations": "celebrations.manage", "/app/access": null };
const guard = (path, element, auth) => {
  if (!(path in NEEDS)) return element;
  const ok = NEEDS[path] === null ? auth.superAdmin : auth.canAll(NEEDS[path]);
  return ok ? element : <Navigate to="/app/dashboard" replace />;
};

/* After the app has drawn, fetch the code of every other page quietly in the background (one at a time, when the browser is idle),
   so opening a page later is instant instead of waiting for its download. Skipped when the device asks to save data. */
const PAGE_CODE = { ...import.meta.glob("./pages/*.jsx"), ...import.meta.glob("./modules/*/*.jsx") };
function usePrefetchPages() {
  useEffect(() => {
    const c = navigator.connection;
    if (c && (c.saveData || /2g/.test(c.effectiveType || ""))) return undefined;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
    const loaders = Object.values(PAGE_CODE);
    let stop = false;
    const next = (i) => { if (stop || i >= loaders.length) return; idle(() => loaders[i]().catch(() => {}).finally(() => next(i + 1))); };
    const t = setTimeout(() => next(0), 1500);
    return () => { stop = true; clearTimeout(t); };
  }, []);
}

export default function App() {
  const auth = useAuth();
  usePrefetchPages();
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/app/attendance" element={<Attendance />} />
        <Route path="/app/my-attendance" element={<Attendance onlyMine />} />
        <Route path="/app/payslips" element={<Payslips />} />
        <Route path="/app/account" element={<Account />} />
        <Route path="/app/users" element={<Users />} />
        <Route path="/app/employees" element={<Employees />} />
        <Route path="/app/assets" element={<Assets />} />
        <Route path="/app/allocations" element={<Allocations />} />
        <Route path="/app/profile" element={<Profile />} />
        <Route path="/app/dashboard" element={<Dashboard />} />
        <Route path="/app/inbox" element={<Inbox />} />
        <Route path="/app/my-team" element={<MyTeam />} />
        <Route path="/app/my-finances" element={<MyFinances />} />
        <Route path="/app/audit" element={<Audit />} />
        <Route path="/app/leave" element={<LeaveHr />} />
        <Route path="/app/leave/apply" element={<LeaveApply />} />
        <Route path="/app/my-leave" element={<MyLeave />} />
        <Route path="/app/team-leave" element={<TeamLeave />} />
        <Route path="/app/leave/review/:id" element={<LeaveReview />} />
        {moduleRoutes.map((r) => <Route key={r.path} path={r.path} element={guard(r.path, r.element, auth)} />)}
      </Route>
      <Route path="*" element={<ToDashboard />} />
    </Routes>
  );
}

/** Sends any unknown address to the dashboard, keeping its query (so /app/?festival=diwali still previews). */
function ToDashboard() {
  const { search } = useLocation();
  return <Navigate to={`/app/dashboard${search}`} replace />;
}

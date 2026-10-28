import { Navigate, Route, Routes } from "react-router-dom";
import Shell from "./components/Shell.jsx";
import Attendance from "./pages/Attendance.jsx";
import Payslips from "./pages/Payslips.jsx";
import Account from "./pages/Account.jsx";
import Users from "./pages/Users.jsx";
import Employees from "./pages/Employees.jsx";
import Profile from "./pages/Profile.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Audit from "./pages/Audit.jsx";
import LeaveHr from "./pages/LeaveHr.jsx";
import MyLeave from "./pages/MyLeave.jsx";
import TeamLeave from "./pages/TeamLeave.jsx";
import Allocations from "./pages/Allocations.jsx";
import LeaveApply from "./pages/LeaveApply.jsx";

/* Bigger features live in src/modules/<name>/index.jsx and export `routes = [{ path, element }]`. They are picked up here. */
const modules = import.meta.glob("./modules/*/index.jsx", { eager: true });
const moduleRoutes = Object.values(modules).flatMap((m) => m.routes || []);

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/app/attendance" element={<Attendance />} />
        <Route path="/app/payslips" element={<Payslips />} />
        <Route path="/app/account" element={<Account />} />
        <Route path="/app/users" element={<Users />} />
        <Route path="/app/employees" element={<Employees />} />
        <Route path="/app/allocations" element={<Allocations />} />
        <Route path="/app/profile" element={<Profile />} />
        <Route path="/app/dashboard" element={<Dashboard />} />
        <Route path="/app/audit" element={<Audit />} />
        <Route path="/app/leave" element={<LeaveHr />} />
        <Route path="/app/leave/apply" element={<LeaveApply />} />
        <Route path="/app/my-leave" element={<MyLeave />} />
        <Route path="/app/team-leave" element={<TeamLeave />} />
        {moduleRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
      </Route>
      <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
    </Routes>
  );
}

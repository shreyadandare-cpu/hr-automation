import { lazy } from "react";
/* Attendance > Shifts and overtime: shifts, the roster, overtime approvals and who is paid overtime (loads only when opened). */
const Shifts = lazy(() => import("./Shifts.jsx"));

export const routes = [{ path: "/app/shifts", element: <Shifts /> }];

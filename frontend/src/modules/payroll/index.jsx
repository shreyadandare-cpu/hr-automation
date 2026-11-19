import { lazy } from "react";
/* Each page loads only when it is first opened (code splitting), so the app starts fast. */
const Payroll = lazy(() => import("./Payroll.jsx"));

export const routes = [{ path: "/app/payroll", element: <Payroll /> }];

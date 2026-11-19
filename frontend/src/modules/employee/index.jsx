import { lazy } from "react";
/* Each page loads only when it is first opened (code splitting), so the app starts fast. */
const EmployeePage = lazy(() => import("./EmployeePage.jsx"));

export const routes = [{ path: "/app/employees/:email", element: <EmployeePage /> }];

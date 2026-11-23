import { lazy } from "react";
/* Each page loads only when it is first opened (code splitting), so the app starts fast. */
const FinanceReports = lazy(() => import("./FinanceReports.jsx"));
const TaxStatement = lazy(() => import("./FinanceReports.jsx").then((m) => ({ default: m.TaxStatement })));

export const routes = [
  { path: "/app/finance-reports", element: <FinanceReports /> },
  { path: "/app/finance-reports/tax/:email", element: <TaxStatement /> },
];

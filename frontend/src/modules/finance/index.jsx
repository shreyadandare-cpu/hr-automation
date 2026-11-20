import { lazy } from "react";
import { PayGate } from "../paysecurity/PayLock.jsx";
/* Each page loads only when it is first opened (code splitting), so the app starts fast. */
const FinanceReports = lazy(() => import("./FinanceReports.jsx"));
const TaxStatement = lazy(() => import("./FinanceReports.jsx").then((m) => ({ default: m.TaxStatement })));

export const routes = [
  { path: "/app/finance-reports", element: <PayGate><FinanceReports /></PayGate> },
  { path: "/app/finance-reports/tax/:email", element: <PayGate><TaxStatement /></PayGate> },
];

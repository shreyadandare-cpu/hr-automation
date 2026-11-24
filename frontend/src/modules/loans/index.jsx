import { lazy } from "react";
/* Each page loads only when it is first opened (code splitting), so the app starts fast. */
const Loans = lazy(() => import("./Loans.jsx"));

export const routes = [
  { path: "/app/loans", element: <Loans /> },
];

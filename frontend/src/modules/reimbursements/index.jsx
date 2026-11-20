import { lazy } from "react";
/* Each page loads only when it is first opened (code splitting), so the app starts fast. */
const ReimbList = lazy(() => import("./ReimbList.jsx"));
const ClaimNew = lazy(() => import("./ClaimNew.jsx"));
const ClaimDetail = lazy(() => import("./ClaimDetail.jsx"));

// "new" is listed before ":id" so it is never read as a claim number.
export const routes = [
  { path: "/app/reimbursements", element: <ReimbList /> },
  { path: "/app/reimbursements/new", element: <ClaimNew /> },
  { path: "/app/reimbursements/:id", element: <ClaimDetail /> },
];

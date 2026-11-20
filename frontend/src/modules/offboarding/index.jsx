import { lazy } from "react";
/* Each page loads only when it is first opened (code splitting), so the app starts fast. */
const Offboarding = lazy(() => import("./Offboarding.jsx"));
const Leavers = lazy(() => import("./Leavers.jsx"));

export const routes = [
  { path: "/app/offboarding", element: <Offboarding /> },
  { path: "/app/offboarding/leavers", element: <Leavers /> },
];

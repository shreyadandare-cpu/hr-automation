import { lazy } from "react";
/* Open roles and referrals for staff (loads only when opened). */
const Jobs = lazy(() => import("./Jobs.jsx"));

export const routes = [{ path: "/app/jobs", element: <Jobs /> }];

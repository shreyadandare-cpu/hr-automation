import { lazy } from "react";
/* Manage > Tools & cost: every paid tool, its seats and monthly cost (loads only when opened). */
const Tools = lazy(() => import("./Tools.jsx"));

export const routes = [{ path: "/app/tools", element: <Tools /> }];

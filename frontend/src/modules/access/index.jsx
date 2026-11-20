import { lazy } from "react";
/* Company > Access: super admins give and remove access (loads only when opened). */
const Access = lazy(() => import("./Access.jsx"));

export const routes = [{ path: "/app/access", element: <Access /> }];

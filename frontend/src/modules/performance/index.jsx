import { lazy } from "react";
/* Performance: OKRs and 1:1 meetings (loads only when opened). */
const Performance = lazy(() => import("./Performance.jsx"));

export const routes = [{ path: "/app/performance", element: <Performance /> }];

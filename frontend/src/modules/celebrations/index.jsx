import { lazy } from "react";
/* Each page loads only when it is first opened (code splitting), so the app starts fast. */
const Celebrations = lazy(() => import("./Celebrations.jsx"));

export const routes = [{ path: "/app/celebrations", element: <Celebrations /> }];

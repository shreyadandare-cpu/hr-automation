import { lazy } from "react";
/* Each page loads only when it is first opened (code splitting), so the app starts fast. */
const Festivals = lazy(() => import("./Festivals.jsx"));

export const routes = [{ path: "/app/festivals", element: <Festivals /> }];

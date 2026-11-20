import { lazy } from "react";
/* Each page loads only when it is first opened (code splitting), so the app starts fast. */
const IdCard = lazy(() => import("./IdCard.jsx"));

export const routes = [{ path: "/app/id-card", element: <IdCard /> }];

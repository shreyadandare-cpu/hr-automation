import { lazy } from "react";
/* Each page loads only when it is first opened (code splitting), so the app starts fast. */
const Rewards = lazy(() => import("./Rewards.jsx"));

export const routes = [{ path: "/app/rewards", element: <Rewards /> }];

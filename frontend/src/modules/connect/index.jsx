import { lazy } from "react";
/* The Allow page for the Wohlig One connector in Claude (oauth.js): opened from Claude's Connect button (loads only when opened). */
const Connect = lazy(() => import("./Connect.jsx"));

export const routes = [{ path: "/app/connect/:id", element: <Connect /> }];

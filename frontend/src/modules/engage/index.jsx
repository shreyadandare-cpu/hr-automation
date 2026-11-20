import { lazy } from "react";
import { PayGate } from "../paysecurity/PayLock.jsx";
/* Each page loads only when it is first opened (code splitting), so the app starts fast. */
const Polls = lazy(() => import("./Polls.jsx"));
const Praise = lazy(() => import("./Praise.jsx"));
const Articles = lazy(() => import("./Articles.jsx"));
const ArticlePage = lazy(() => import("./Articles.jsx").then((m) => ({ default: m.ArticlePage })));
const Apps = lazy(() => import("./Apps.jsx"));
const Requests = lazy(() => import("./Requests.jsx"));
const Tax = lazy(() => import("./Tax.jsx"));
const Goals = lazy(() => import("./Goals.jsx"));

export const routes = [
  { path: "/app/polls", element: <Polls /> },
  { path: "/app/praise", element: <Praise /> },
  { path: "/app/articles", element: <Articles /> },
  { path: "/app/articles/:id", element: <ArticlePage /> },
  { path: "/app/apps", element: <Apps /> },
  { path: "/app/requests", element: <Requests /> },
  { path: "/app/hr-requests", element: <Requests all /> },
  { path: "/app/tax", element: <PayGate><Tax /></PayGate> },
  { path: "/app/goals", element: <Goals /> },
];

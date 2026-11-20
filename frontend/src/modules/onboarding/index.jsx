import { lazy } from "react";
/* Each page loads only when it is first opened (code splitting), so the app starts fast. */
const Onboarding = lazy(() => import("./Onboarding.jsx"));
const Documents = lazy(() => import("./Documents.jsx"));
const Progress = lazy(() => import("./Progress.jsx"));
const ClaudeRequests = lazy(() => import("./ClaudeRequests.jsx"));

export const routes = [
  { path: "/app/onboarding", element: <Onboarding /> },
  { path: "/app/onboarding/progress", element: <Progress /> },
  { path: "/app/claude-requests", element: <ClaudeRequests /> },
  { path: "/app/documents", element: <Documents /> },
];

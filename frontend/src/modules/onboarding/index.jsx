import Onboarding from "./Onboarding.jsx";
import Documents from "./Documents.jsx";
import Progress from "./Progress.jsx";
import ClaudeRequests from "./ClaudeRequests.jsx";

export const routes = [
  { path: "/app/onboarding", element: <Onboarding /> },
  { path: "/app/onboarding/progress", element: <Progress /> },
  { path: "/app/claude-requests", element: <ClaudeRequests /> },
  { path: "/app/documents", element: <Documents /> },
];

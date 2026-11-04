import Onboarding from "./Onboarding.jsx";
import Documents from "./Documents.jsx";
import Progress from "./Progress.jsx";

export const routes = [
  { path: "/app/onboarding", element: <Onboarding /> },
  { path: "/app/onboarding/progress", element: <Progress /> },
  { path: "/app/documents", element: <Documents /> },
];

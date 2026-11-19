import { lazy } from "react";
/* Each page loads only when it is first opened (code splitting), so the app starts fast. */
const Reports = lazy(() => import("./Reports.jsx"));
const Probation = lazy(() => import("./Probation.jsx"));
const Letters = lazy(() => import("./Letters.jsx"));
const ExitInterviews = lazy(() => import("./ExitInterviews.jsx"));
const Helpdesk = lazy(() => import("./Helpdesk.jsx"));
const TicketPage = lazy(() => import("./Helpdesk.jsx").then((m) => ({ default: m.TicketPage })));
const Hiring = lazy(() => import("./Hiring.jsx"));
const OpeningPage = lazy(() => import("./Hiring.jsx").then((m) => ({ default: m.OpeningPage })));
const Reviews = lazy(() => import("./Reviews.jsx"));

export const routes = [
  { path: "/app/hr-reports", element: <Reports /> },
  { path: "/app/probation", element: <Probation /> },
  { path: "/app/letters", element: <Letters /> },
  { path: "/app/exit-interviews", element: <ExitInterviews /> },
  { path: "/app/helpdesk", element: <Helpdesk /> },
  { path: "/app/helpdesk/:id", element: <TicketPage /> },
  { path: "/app/hr-helpdesk", element: <Helpdesk all /> },
  { path: "/app/hr-helpdesk/:id", element: <TicketPage all /> },
  { path: "/app/hiring", element: <Hiring /> },
  { path: "/app/hiring/:id", element: <OpeningPage /> },
  { path: "/app/reviews", element: <Reviews /> },
  { path: "/app/hr-reviews", element: <Reviews all /> },
];

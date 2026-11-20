import { lazy } from "react";
/* Each page loads only when it is first opened (code splitting), so the app starts fast. */
const Timesheet = lazy(() => import("./Timesheet.jsx"));
const Surveys = lazy(() => import("./Surveys.jsx"));
const SurveyPage = lazy(() => import("./Surveys.jsx").then((m) => ({ default: m.SurveyPage })));
const SurveyResults = lazy(() => import("./Surveys.jsx").then((m) => ({ default: m.SurveyResults })));
const Training = lazy(() => import("./Training.jsx"));
const TrainingPage = lazy(() => import("./Training.jsx").then((m) => ({ default: m.TrainingPage })));
const Interviews = lazy(() => import("./People.jsx").then((m) => ({ default: m.Interviews })));
const NoticePeriods = lazy(() => import("./People.jsx").then((m) => ({ default: m.NoticePeriods })));
const StandIns = lazy(() => import("./People.jsx").then((m) => ({ default: m.StandIns })));

export const routes = [
  { path: "/app/timesheet", element: <Timesheet /> },
  { path: "/app/surveys", element: <Surveys /> },
  { path: "/app/surveys/:id", element: <SurveyPage /> },
  { path: "/app/surveys/:id/results", element: <SurveyResults /> },
  { path: "/app/training", element: <Training /> },
  { path: "/app/training/:id", element: <TrainingPage /> },
  { path: "/app/interviews", element: <Interviews /> },
  { path: "/app/notice-periods", element: <NoticePeriods /> },
  { path: "/app/stand-ins", element: <StandIns /> },
];

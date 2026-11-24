import { lazy } from "react";
/* Manage > Report builder: custom reports from the datasets a person may see (loads only when opened). */
const ReportBuilder = lazy(() => import("./ReportBuilder.jsx"));

export const routes = [{ path: "/app/report-builder", element: <ReportBuilder /> }];

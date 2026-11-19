import { lazy } from "react";
/* Each page loads only when it is first opened (code splitting), so the app starts fast. */
const DigitalKit = lazy(() => import("./DigitalKit.jsx"));
const OrgDocuments = lazy(() => import("./OrgDocuments.jsx"));

export const routes = [{ path: "/app/digital-kit", element: <DigitalKit /> }, { path: "/app/org-documents", element: <OrgDocuments /> }];

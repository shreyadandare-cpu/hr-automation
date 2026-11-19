import { lazy } from "react";
/* Each page loads only when it is first opened (code splitting), so the app starts fast. */
const Budgets = lazy(() => import("./Budgets.jsx"));
const BudgetNew = lazy(() => import("./BudgetNew.jsx"));
const BudgetDetail = lazy(() => import("./BudgetDetail.jsx"));

export const routes = [
  { path: "/app/budgets", element: <Budgets /> },
  { path: "/app/budgets/new", element: <BudgetNew /> },
  { path: "/app/budgets/:id", element: <BudgetDetail /> },
];

import Budgets from "./Budgets.jsx";
import BudgetNew from "./BudgetNew.jsx";
import BudgetDetail from "./BudgetDetail.jsx";

export const routes = [
  { path: "/app/budgets", element: <Budgets /> },
  { path: "/app/budgets/new", element: <BudgetNew /> },
  { path: "/app/budgets/:id", element: <BudgetDetail /> },
];

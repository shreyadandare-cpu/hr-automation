import ReimbList from "./ReimbList.jsx";
import ClaimNew from "./ClaimNew.jsx";
import ClaimDetail from "./ClaimDetail.jsx";

// "new" is listed before ":id" so it is never read as a claim number.
export const routes = [
  { path: "/app/reimbursements", element: <ReimbList /> },
  { path: "/app/reimbursements/new", element: <ClaimNew /> },
  { path: "/app/reimbursements/:id", element: <ClaimDetail /> },
];

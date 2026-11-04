import Offboarding from "./Offboarding.jsx";
import Leavers from "./Leavers.jsx";

export const routes = [
  { path: "/app/offboarding", element: <Offboarding /> },
  { path: "/app/offboarding/leavers", element: <Leavers /> },
];

import { useLocation, useNavigate } from "react-router-dom";

/* "← Back" for pages you drill into. It returns to the page you came from (the list, a person's page, the dashboard...).
   With no earlier page in this visit, for example when the address is opened directly, it goes to `to` instead. */
export default function BackButton({ to = "/app/dashboard", label = "Back" }) {
  const nav = useNavigate(), here = useLocation();
  return <button type="button" className="back" onClick={() => (here.key !== "default" ? nav(-1) : nav(to))}>← {label}</button>;
}

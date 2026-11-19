import { useLocation, useNavigate } from "react-router-dom";

/* "← Back" for pages you drill into. With no label it returns to the page you came from (the list, a person's page, the
   dashboard...), or to `to` when the address was opened directly. With a label it names a place ("← Onboarding"), so it
   always goes to `to`: the button must land where it says. */
export default function BackButton({ to = "/app/dashboard", label = "Back" }) {
  const nav = useNavigate(), here = useLocation();
  const go = () => (label === "Back" && here.key !== "default" ? nav(-1) : nav(to));
  return <button type="button" className="back" onClick={go}><span className="back-ar" aria-hidden="true">←</span>{label}</button>;
}

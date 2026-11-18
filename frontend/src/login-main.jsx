import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Login from "./login/Login.jsx";
import Invite from "./login/Invite.jsx";
import { applyTheme, currentTheme } from "./theme.js";
import "./styles.css";

applyTheme(currentTheme());
createRoot(document.getElementById("root")).render(<StrictMode>{location.pathname.startsWith("/invite/") ? <Invite /> : <Login />}</StrictMode>);

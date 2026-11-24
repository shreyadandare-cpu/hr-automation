import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startApp } from "./lib/pwa.js";
import Login from "./login/Login.jsx";
import Invite from "./login/Invite.jsx";
import { applyTheme, currentTheme } from "./theme.js";
import "./styles.css";
import { applyBrand } from "./brand.js";

applyBrand();   // colours, fonts and the page title from brand.config.json

applyTheme(currentTheme());
startApp();   // the installable app can be added from the sign-in page too
createRoot(document.getElementById("root")).render(<StrictMode>{location.pathname.startsWith("/invite/") ? <Invite /> : <Login />}</StrictMode>);

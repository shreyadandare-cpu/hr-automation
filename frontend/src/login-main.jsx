import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Login from "./login/Login.jsx";
import Invite from "./login/Invite.jsx";
import { applyTheme, currentTheme } from "./theme.js";
import "./styles.css";
import { applyBrand } from "./brand.js";

applyBrand();   // colours, fonts and the page title from brand.config.json

applyTheme(currentTheme());
createRoot(document.getElementById("root")).render(<StrictMode>{location.pathname.startsWith("/invite/") ? <Invite /> : <Login />}</StrictMode>);

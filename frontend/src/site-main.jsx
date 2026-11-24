import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyTheme, currentTheme } from "./theme.js";
import "./styles.css";
import { applyBrand } from "./brand.js";
import Careers from "./site/Careers.jsx";
import Sign from "./site/Sign.jsx";

/* The public pages, open without signing in: the careers page (/careers, /careers/<id>) and signing a letter (/sign/<key>). */
applyBrand();
applyTheme(currentTheme());
createRoot(document.getElementById("root")).render(<StrictMode>{location.pathname.startsWith("/sign/") ? <Sign /> : <Careers />}</StrictMode>);

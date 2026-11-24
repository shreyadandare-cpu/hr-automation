import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./auth.jsx";
import { ToastProvider } from "./components/toast.jsx";
import { DataProvider } from "./data.jsx";
import { applyTheme, currentTheme } from "./theme.js";
import "./styles.css";
import { applyBrand } from "./brand.js";
import { startApp } from "./lib/pwa.js";

startApp();   // the installable app: service worker and install offer (built site only)

applyBrand();   // colours, fonts and the page title from brand.config.json

applyTheme(currentTheme());
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <DataProvider>
            <App />
          </DataProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);

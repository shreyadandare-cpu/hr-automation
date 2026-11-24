import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

// Builds into dist/, which the Express server serves: index.html under /app, login.html at /login, site.html at /careers and /sign/ (public pages).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/app/",
  // The logos in public/ are served by Express at the site root, so they are not copied into dist.
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: { index: resolve(import.meta.dirname, "index.html"), login: resolve(import.meta.dirname, "login.html"), site: resolve(import.meta.dirname, "site.html") } },
  },
  // `npm run dev` is for development: VITE_PORT is where the page is served, API_PORT where the backend runs.
  server: (() => {
    const api = `http://localhost:${process.env.API_PORT || 3000}`;
    return { port: Number(process.env.VITE_PORT || 5173), proxy: { "/api": api, "/auth": api, "/leave-rules.js": api, "/app/leave-rules.js": { target: api, rewrite: () => "/leave-rules.js" }, "/wohlig-logo.png": api, "/wohlig-logo-dark.png": api, "/wohlig-logo.svg": api, "/wohlig-logo-dark.svg": api, "/wohlig-smile-mark.svg": api, "/favicon.svg": api, "/manifest.webmanifest": api, "/sw.js": api, "/offline.html": api, "/app-icon-192.png": api, "/app-icon-512.png": api, "/app-icon-maskable-512.png": api, "/apple-touch-icon.png": api, "/invite": api, "/sig": api, "/l": api, "/p": api, "/careers": api, "/sign": api } };
  })(),
});

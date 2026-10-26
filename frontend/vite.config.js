import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Builds into dist/, which the Express server serves: index.html under /app, login.html at /login.
export default defineConfig({
  plugins: [react()],
  base: "/app/",
  // The logos in public/ are served by Express at the site root, so they are not copied into dist.
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: { index: resolve(import.meta.dirname, "index.html"), login: resolve(import.meta.dirname, "login.html") } },
  },
  // `npm run dev` is for development: VITE_PORT is where the page is served, API_PORT where the backend runs.
  server: (() => {
    const api = `http://localhost:${process.env.API_PORT || 3000}`;
    return { port: Number(process.env.VITE_PORT || 5173), proxy: { "/api": api, "/auth": api, "/leave-rules.js": api, "/app/leave-rules.js": { target: api, rewrite: () => "/leave-rules.js" }, "/wohlig-logo.png": api, "/wohlig-logo-dark.png": api, "/invite": api } };
  })(),
});

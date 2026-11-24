import { useEffect, useState } from "react";

/* The installable app (PWA). The service worker (public/sw.js) is registered on the built site only, never in the dev server.
   Browsers that can install offer it through `beforeinstallprompt`, which is kept here so a button can show it later. */
let deferred = null;
const listeners = new Set();
const tell = () => listeners.forEach((f) => f());
export function startApp() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {}); });
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; tell(); });
  window.addEventListener("appinstalled", () => { deferred = null; tell(); });
}
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
const iosSafari = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);

/** { can: the browser offers installing, ios: the iPhone way (Share, then Add to Home Screen), install() } */
export function useInstall() {
  const [, setN] = useState(0);
  useEffect(() => { const f = () => setN((n) => n + 1); listeners.add(f); return () => listeners.delete(f); }, []);
  if (standalone()) return { can: false, ios: false, install: async () => false };
  return {
    can: !!deferred, ios: !deferred && iosSafari(),
    install: async () => { if (!deferred) return false; deferred.prompt(); const r = await deferred.userChoice.catch(() => null); deferred = null; tell(); return !!r && r.outcome === "accepted"; },
  };
}

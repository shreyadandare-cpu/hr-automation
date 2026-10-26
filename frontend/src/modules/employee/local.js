import { useEffect, useState } from "react";

/* The old page kept some things only in browser memory: the onboarding task ticks, the laptop record and edited details.
   No API stores them, so they stay in memory here too, per person, until the page is reloaded. */
const store = new Map(), subs = new Set();
const key = (email) => String(email || "").toLowerCase();
export const getLocal = (email) => store.get(key(email)) || {};
export function patchLocal(email, patch) {
  store.set(key(email), { ...getLocal(email), ...patch });
  subs.forEach((f) => f());
}
export function useLocal(email) {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return getLocal(email);
}

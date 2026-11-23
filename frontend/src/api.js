/* Same contract as the older page: returns { ok, status, data } and sends you to sign in when the session has ended. */
export async function api(method, url, body) {
  let r;
  try {
    r = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // The server could not be reached (offline, or restarting). Answer like any failed request, so a page never waits forever.
    return { ok: false, status: 0, data: { error: "Wohlig One could not be reached. Please check your connection and try again." } };
  }
  const data = await r.json().catch(() => null);
  if (r.status === 401) location.href = "/login";
  return { ok: r.ok, status: r.status, data };
}
export const apiMsg = (r) => (r.data && r.data.error) || "Something went wrong. Try again.";

/* A GET that several parts of a screen ask for at the same moment (say /api/leave/today from three cards) goes to the server
   once: callers share the request while it is in flight and for a moment after it answers, never longer, so a reload after a
   change always asks again. Use it only for reads that are the same for every caller. */
const shared = new Map();
export function apiShared(url) {
  if (shared.has(url)) return shared.get(url);
  const p = api("GET", url);
  shared.set(url, p);
  p.finally(() => setTimeout(() => { if (shared.get(url) === p) shared.delete(url); }, 1000));
  return p;
}

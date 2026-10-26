/* Same contract as the older page: returns { ok, status, data } and sends you to sign in when the session has ended. */
export async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => null);
  if (r.status === 401) location.href = "/login";
  return { ok: r.ok, status: r.status, data };
}
export const apiMsg = (r) => (r.data && r.data.error) || "Something went wrong. Try again.";

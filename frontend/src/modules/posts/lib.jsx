/* Shared bits of the Posts module: icons, times, photo upload. */
export const TITLE_MAX = 120, POST_MAX = 3000, COMMENT_MAX = 1000, MAX_IMAGES = 4;
export const imgUrl = (id) => `/api/posts/images/${id}`;
export const postUrl = (id) => `${location.origin}/app/posts/${id}`;
export const errOf = (r, fallback = "Something went wrong. Try again.") =>
  (r.data && (r.data.error || Object.values(r.data.errors || {})[0])) || fallback;

const ICONS = {
  heart: <path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z" />,
  comment: <path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.4-4A8 8 0 1 1 20 11.5z" />,
  share: <><path d="M21 3 10 14" /><path d="M21 3 14.5 21l-4.5-7-7-4.5z" /></>,
  photo: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="m4 17 5-4.5 3.5 3 3-2.5L20 17" /></>,
  more: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  link: <><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  megaphone: <><path d="M3 10v4h4l7 4V6L7 10z" /><path d="M17.5 9a4 4 0 0 1 0 6" /></>,
};
export const Svg = ({ name, fill, size = 22 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>
);

/* "just now", "5m", "3h", "2d", "4w", then the date: short like a social feed, the full date on hover. */
export function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  if (s < 5 * 7 * 86400) return `${Math.floor(s / (7 * 86400))}w`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
export const fullDate = (iso) => new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
export const plural = (n, word) => `${n.toLocaleString("en-IN")} ${word}${n === 1 ? "" : "s"}`;

/* Shrinks a picked photo in the browser (longest side 1600px, JPEG) so uploads stay small and quick. */
function shrink(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read that photo."))), "image/jpeg", 0.86);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file is not a photo we can read.")); };
    img.src = url;
  });
}
export async function uploadPhoto(file) {
  const blob = await shrink(file);
  const r = await fetch("/api/posts/images", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
  const data = await r.json().catch(() => null);
  if (r.status === 401) location.href = "/login";
  if (!r.ok) throw new Error((data && data.error) || "The photo could not be uploaded.");
  return data.id;
}

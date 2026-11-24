/*
 * Web clock-in with location and a selfie, as Keka's geo-fencing: the rules, without the database (clock-in routes are in
 * attendance.js). HR lists the offices (a point and a radius); a punch made from the app carries the phone's location and,
 * when HR asks for it, a small selfie. Outside every office the punch is refused, or kept and flagged when HR allows it.
 */
const text = (v) => (typeof v === "string" ? v.trim() : "");
const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

export const SELFIE_MAX = 400 * 1024;          // the browser shrinks the picture to about 480px first; this is the hard limit
export const SELFIE_KEEP_DAYS = 90;            // selfies are deleted after this many days
export const WORST_ACCURACY_M = 1000;          // a reading less precise than this is not trusted
export const RADIUS = { min: 30, max: 5000 };

/** Metres between two points on the earth (haversine). */
export function distanceM(a, b) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}
/** "40 m" or "2.3 km", for messages. */
export const farText = (m) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

/** The location the browser sent with a punch, or null when none was sent. */
export function readPoint(b = {}) {
  if (b.lat === undefined && b.lng === undefined) return { point: null, error: "" };
  const lat = num(b.lat), lng = num(b.lng), accuracy = num(b.accuracy);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) return { point: null, error: "Your location could not be read. Please try again." };
  return { point: { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? Math.round(accuracy) : null }, error: "" };
}

/** An office HR adds: a name, the point and the radius in metres. */
export function readSite(b = {}) {
  const errors = {};
  const name = text(b.name).slice(0, 80), lat = num(b.lat), lng = num(b.lng), radius = Math.round(num(b.radius));
  if (!name) errors.name = "Please name the office.";
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.lat = "Please enter the latitude, a number from -90 to 90.";
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.lng = "Please enter the longitude, a number from -180 to 180.";
  if (!Number.isInteger(radius) || radius < RADIUS.min || radius > RADIUS.max) errors.radius = `Please enter a radius from ${RADIUS.min} to ${RADIUS.max.toLocaleString("en-IN")} metres.`;
  return { value: { name, lat, lng, radius }, errors };
}

/** HR's clock-in settings. */
export function readPolicy(b = {}) {
  return { enabled: b.enabled === true, needLocation: b.needLocation === true, needSelfie: b.needSelfie === true, allowOutside: b.allowOutside === true };
}

/** The nearest office to a point, its distance, and whether the point is inside it. */
export function nearestSite(sites, point) {
  let best = null;
  for (const s of sites) {
    const d = distanceM(point, s);
    if (!best || d < best.distance) best = { site: s, distance: d };
  }
  return best ? { ...best, inside: best.distance <= best.site.radius } : null;
}

/**
 * May this punch be saved? policy: readPolicy's shape; sites: the offices; point: readPoint's; hasSelfie: a selfie came with it.
 * Returns { ok, error } and, when there is a point, where it was: { siteId, distance, outside }.
 */
export function checkPunch(policy, sites, point, hasSelfie) {
  if (policy.needLocation && !point) return { ok: false, error: "Please allow location access in your browser, then punch again." };
  if (point && point.accuracy !== null && point.accuracy > WORST_ACCURACY_M && policy.needLocation)
    return { ok: false, error: "Your location is not precise enough. Please turn on precise location or step outside, then try again." };
  if (policy.needSelfie && !hasSelfie) return { ok: false, error: "Please take a selfie to punch." };
  if (!point || !sites.length) return { ok: true, siteId: null, distance: null, outside: false };
  const near = nearestSite(sites, point);
  if (near.inside) return { ok: true, siteId: near.site.id, distance: near.distance, outside: false };
  if (policy.needLocation && !policy.allowOutside)
    return { ok: false, error: `You are ${farText(near.distance)} from ${near.site.name}. Please punch from an office, or ask HR to add a missing punch.` };
  return { ok: true, siteId: near.site.id, distance: near.distance, outside: true };
}

/** A selfie is a JPEG or WebP picture, checked by its first bytes. */
export function selfieType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

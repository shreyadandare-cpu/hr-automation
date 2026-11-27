/*
 * Web clock-in with location, as Keka's geo-fencing: the rules, without the database (clock-in routes are in
 * attendance.js). HR lists the offices (a point and a radius); a punch made from the app carries the phone's location and,
 * Outside every office the punch is refused, or kept and flagged when HR allows it.
 */
import net from "node:net";

const text = (v) => (typeof v === "string" ? v.trim() : "");
const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

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

/* Office internet (optional), as Keka's IP restriction: HR may list the office's public internet addresses on an office. A punch
   sent from one of them is matched to that office with no location needed. An office with none listed is checked by location only. */
export const MAX_NETWORKS = 20;
/** "::ffff:1.2.3.4" (how Node writes an IPv4 caller on a dual-stack socket) becomes "1.2.3.4". */
export const plainIp = (ip) => String(ip || "").trim().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1");
/** One address or range ("203.0.113.7", "203.0.113.0/24", "2001:db8:1:2::/64"), tidied, or null when it is not one. */
export function readNetwork(v) {
  const [addr, bits, extra] = plainIp(v).split("/");
  const kind = net.isIP(addr);
  if (!kind || extra !== undefined) return null;
  const max = kind === 4 ? 32 : 128;
  if (bits === undefined) return addr.toLowerCase();
  if (!/^\d{1,3}$/.test(bits) || Number(bits) > max || Number(bits) < (kind === 4 ? 16 : 32)) return null;
  return `${addr.toLowerCase()}/${Number(bits)}`;
}
/** The address to save for "Use this office's internet": the caller's own address; for IPv6 its /64, as a phone's changes inside it. */
export function networkOf(ip) {
  const a = plainIp(ip);
  if (net.isIP(a) !== 6) return readNetwork(a);
  const groups = expand6(a).slice(0, 4);
  return readNetwork(`${groups.join(":")}::/64`);
}
function expand6(a) {
  const [head, tail = ""] = a.split("::");
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const fill = a.includes("::") ? Array(8 - h.length - t.length).fill("0") : [];
  return [...h, ...fill, ...t].map((g) => (g || "0").toLowerCase());
}
/** Is this caller address inside one of the listed addresses or ranges? */
export function onNetwork(ip, networks = []) {
  const a = plainIp(ip), kind = net.isIP(a);
  if (!kind || !networks.length) return false;
  const list = new net.BlockList();
  for (const n of networks) {
    const v = readNetwork(n);
    if (!v) continue;
    const [addr, bits] = v.split("/"), type = net.isIP(addr) === 4 ? "ipv4" : "ipv6";
    if (bits === undefined) list.addAddress(addr, type); else list.addSubnet(addr, Number(bits), type);
  }
  return list.check(a, kind === 4 ? "ipv4" : "ipv6");
}
/** The office whose internet this punch came from, or null. */
export const siteOnNetwork = (sites, ip) => sites.find((s) => onNetwork(ip, s.networks || [])) || null;

/** An office HR adds: a name, the point and the radius in metres, and optionally its internet addresses. */
export function readSite(b = {}) {
  const errors = {};
  const name = text(b.name).slice(0, 80), lat = num(b.lat), lng = num(b.lng), radius = Math.round(num(b.radius));
  const raw = (Array.isArray(b.networks) ? b.networks : String(b.networks || "").split(/[\s,]+/)).map((x) => String(x).trim()).filter(Boolean);
  const networks = [...new Set(raw.map(readNetwork))];
  if (raw.some((x) => !readNetwork(x))) errors.networks = "Please enter internet addresses such as 203.0.113.7 or 203.0.113.0/24, one per line.";
  else if (networks.length > MAX_NETWORKS) errors.networks = `Please list at most ${MAX_NETWORKS} addresses.`;
  if (!name) errors.name = "Please name the office.";
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.lat = "Please enter the latitude, a number from -90 to 90.";
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.lng = "Please enter the longitude, a number from -180 to 180.";
  if (!Number.isInteger(radius) || radius < RADIUS.min || radius > RADIUS.max) errors.radius = `Please enter a radius from ${RADIUS.min} to ${RADIUS.max.toLocaleString("en-IN")} metres.`;
  return { value: { name, lat, lng, radius, networks: errors.networks ? [] : networks }, errors };
}

/* Fingerprint or face unlock before a punch (a passkey, passkeys.js), HR's choice: "off" (never asked), "optional" (asked only
   of people who set it up on their phone) or "required" (everyone sets it up once, then is asked each time). */
export const CONFIRM_MODES = ["off", "optional", "required"];
/** HR's clock-in settings. */
export function readPolicy(b = {}) {
  return { enabled: b.enabled === true, needLocation: b.needLocation === true, allowOutside: b.allowOutside === true,
    confirm: CONFIRM_MODES.includes(b.confirm) ? b.confirm : "off" };
}
/** Must this person confirm with their fingerprint or face: "no", "yes", or "setup" (required but not set up yet). */
export function confirmNeeded(mode, hasPasskey) {
  if (mode === "required") return hasPasskey ? "yes" : "setup";
  if (mode === "optional") return hasPasskey ? "yes" : "no";
  return "no";
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
 * May this punch be saved? policy: readPolicy's shape; sites: the offices; point: readPoint's; ip: the caller's address. A punch
 * from an office's listed internet needs no location. No selfie is ever asked for.
 * Returns { ok, error } and, when there is a point, where it was: { siteId, distance, outside }.
 */
export function checkPunch(policy, sites, point, ip = "") {
  const office = siteOnNetwork(sites, ip);
  if (office) return { ok: true, siteId: office.id, distance: null, outside: false, via: "network" };
  if (policy.needLocation && !point) return { ok: false, error: "Please allow location access in your browser, then punch again." };
  if (point && point.accuracy !== null && point.accuracy > WORST_ACCURACY_M && policy.needLocation)
    return { ok: false, error: "Your location is not precise enough. Please turn on precise location or step outside, then try again." };
  if (!point || !sites.length) return { ok: true, siteId: null, distance: null, outside: false, via: point ? "location" : null };
  const near = nearestSite(sites, point);
  if (near.inside) return { ok: true, siteId: near.site.id, distance: near.distance, outside: false, via: "location" };
  if (policy.needLocation && !policy.allowOutside)
    return { ok: false, error: `You are ${farText(near.distance)} from ${near.site.name}. Please punch from an office, or ask HR to add a missing punch.` };
  return { ok: true, siteId: near.site.id, distance: near.distance, outside: true, via: "location" };
}

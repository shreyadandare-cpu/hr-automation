/* Draws the celebration posters on a canvas, in the Wohlig look: a square (1080 x 1080) in maroon or warm light, an orange rule and
   a small label, a serif headline with an italic emphasis, the person's name, the Wohlig logo and the Google Cloud partner mark.
   One layout serves every occasion; the label and the wording change. What the preview shows is exactly the PNG that is emailed. */
import { renderWelcome } from "./welcomePoster.js";
export const POSTER_W = 1080, POSTER_H = 1080;

const SERIF = (s, italic) => `${italic ? "italic " : ""}400 ${s}px "Playfair Display", "Source Serif 4", Georgia, serif`;
const SANS = (s, bold) => `${bold ? 700 : 400} ${s}px "Lato", "Helvetica Neue", Arial, sans-serif`;

export async function ensureFonts() {
  if (!document.fonts) return;
  await Promise.all([SERIF(60), SERIF(60, true), SANS(40, true), SANS(40, false)].map((f) => document.fonts.load(f, "Aa").catch(() => {})));
}

export const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("The picture could not be read."));
  img.src = src;
});

/* ---------- what each occasion says by default ---------- */
export const OCCASIONS = {
  welcome:     { name: "Welcome aboard",   emoji: "🎉", note: "Announce someone who has just joined.", label: "WELCOME ABOARD" },
  birthday:    { name: "Birthday",         emoji: "🎂", note: "Wish a colleague a happy birthday.", label: "HAPPY BIRTHDAY" },
  anniversary: { name: "Work anniversary", emoji: "🎊", note: "Celebrate years at Wohlig.", label: "WORK ANNIVERSARY" },
  certified:   { name: "Newly certified",  emoji: "🏅", note: "Congratulate a new certification.", label: "NEWLY CERTIFIED" },
  newrole:     { name: "New role",         emoji: "🚀", note: "Announce a promotion or a new role.", label: "NEW ROLE" },
};
export const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";
const yearsText = (n) => `${n} year${n === 1 ? "" : "s"}.`;

/** The wording a poster starts with, from the employee record. `msgFor` rebuilds just the greeting when the name or role is edited. */
export function defaultsFor(occasion, emp, today) {
  const base = { heading: "", emphasis: "", name: emp.name, designation: emp.title || "", detail: "", joiningDate: "", message: "" };
  const years = emp.start ? Math.max(1, Number(today.slice(0, 4)) - Number(emp.start.slice(0, 4))) : 1;
  const f = {
    welcome: { ...base, heading: "Welcome to", emphasis: "Wohlig!!", joiningDate: emp.start || today },
    birthday: { ...base, heading: "Happy", emphasis: "birthday." },
    anniversary: { ...base, heading: "Cheers to", emphasis: yearsText(years), joiningDate: emp.start || today },
    certified: { ...base, heading: "Certified", emphasis: "& proud." },
    newrole: { ...base, heading: "A new", emphasis: "chapter." },
  }[occasion];
  return { ...f, message: msgFor(occasion, f) };
}
export function msgFor(occasion, f) {
  const first = firstName(f.name);
  return {
    welcome: `We are excited to welcome ${first} to our team as our new ${f.designation || "team member"}. 🎉`,
    birthday: "May this year bring you continued success, good health, and happiness.",
    anniversary: `Thank you for everything you bring to Wohlig, ${first}.`,
    certified: `Congratulations, ${first}${f.detail ? `, on earning ${f.detail}` : ""}!`,
    newrole: `Congratulations, ${first}, on your new role${f.designation ? ` as ${f.designation}` : ""}.`,
  }[occasion];
}

const LOOK = {
  maroon: { bg: ["#8c1b40", "#520822"], glow: "rgba(247,120,29,.16)", art: "rgba(255,205,175,.20)", label: "#f6c9a8", head: "#fff7e9", emph: "#f9b27c",
    name: "#fff7e9", sub: "#f6c9a8", msg: "rgba(255,247,233,.82)", rule: "rgba(255,247,233,.22)", logo: "dark" },
  light: { bg: ["#fff7e9", "#f1e1c6"], glow: "rgba(247,120,29,.14)", art: "rgba(128,13,53,.11)", label: "#800d35", head: "#800d35", emph: "#f7781d",
    name: "#2e1a1f", sub: "#c85f44", msg: "#6b5654", rule: "rgba(128,13,53,.22)", logo: "light" },
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateText = (iso) => { const [y, m, d] = String(iso || "").split("-").map(Number); return y ? `${d} ${MONTHS[m - 1]} ${y}` : ""; };

function fit(ctx, texts, font, maxW, size, min) {   // the largest size (down to min) at which every line fits
  let s = size;
  for (; s > min; s -= 2) { if (texts.every((t) => (ctx.font = font(s), ctx.measureText(t).width <= maxW))) break; }
  return s;
}
function wrap(ctx, text, maxW) {
  const out = [];
  let cur = "";
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(t).width > maxW) { out.push(cur); cur = w; } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}
function flower(ctx, cx, cy, color) {   // eight thin overlapping petals, a faint line drawing in the corner
  ctx.save(); ctx.translate(cx, cy); ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.lineJoin = "round";
  for (let i = 0; i < 8; i++) {
    ctx.save(); ctx.rotate((i * Math.PI) / 4 + 0.2);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(70, -86, 280, -96, 340, 0); ctx.bezierCurveTo(280, 62, 70, 52, 0, 0); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** Draws a poster. o: { occasion, theme, name, heading, emphasis, designation, detail, joiningDate, message, photo, logos: { dark, light }, mark } -> canvas */
export async function renderPoster(o) {
  if (o.occasion === "welcome") return renderWelcome(o);   // new joiners and freshers: the portrait welcome card (welcomePoster.js)
  await ensureFonts();
  const canvas = document.createElement("canvas");
  canvas.width = POSTER_W; canvas.height = POSTER_H;
  const ctx = canvas.getContext("2d"), L = LOOK[o.theme] || LOOK.maroon, occ = OCCASIONS[o.occasion] || OCCASIONS.welcome;
  const X = 96, hasPhoto = !!o.photo, maxW = hasPhoto ? 500 : 880;
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";

  // background, glow and the line drawing
  const g = ctx.createLinearGradient(0, 0, POSTER_W, POSTER_H);
  g.addColorStop(0, L.bg[0]); g.addColorStop(1, L.bg[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, POSTER_W, POSTER_H);
  const r = ctx.createRadialGradient(960, 120, 0, 960, 120, 620);
  r.addColorStop(0, L.glow); r.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = r; ctx.fillRect(0, 0, POSTER_W, POSTER_H);
  flower(ctx, 960, 150, L.art);

  // label with the orange rule
  ctx.strokeStyle = "#f7781d"; ctx.lineWidth = 5; ctx.lineCap = "butt";
  ctx.beginPath(); ctx.moveTo(X, 141); ctx.lineTo(X + 56, 141); ctx.stroke();
  ctx.fillStyle = L.label; ctx.font = SANS(26, true);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "6px";
  ctx.fillText(occ.label, X + 76, 151);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

  // the photo, when there is one
  if (hasPhoto) {
    const cx = 820, cy = 585, rad = 200;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
    ctx.fillStyle = "#f7781d"; ctx.beginPath(); ctx.arc(cx, cy, rad + 12, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.clip();
    const s = Math.max((rad * 2) / o.photo.width, (rad * 2) / o.photo.height), sw = (rad * 2) / s, sh = (rad * 2) / s;
    ctx.drawImage(o.photo, (o.photo.width - sw) / 2, (o.photo.height - sh) * 0.22, sw, sh, cx - rad, cy - rad, rad * 2, rad * 2);
    ctx.restore();
  }

  // headline: the words, then the emphasis in italic on the next line
  const lines = [o.heading, o.emphasis].map((t) => String(t || "").trim());
  const size = fit(ctx, [lines[0]].filter(Boolean), (s) => SERIF(s, false), maxW, 140, 52);
  const sizeE = fit(ctx, [lines[1]].filter(Boolean), (s) => SERIF(s, true), maxW, size, 52);
  let y = 430;
  if (lines[0]) { ctx.fillStyle = L.head; ctx.font = SERIF(size, false); ctx.fillText(lines[0], X, y); if (lines[1]) y += size * 0.98; }
  if (lines[1]) { ctx.fillStyle = L.emph; ctx.font = SERIF(sizeE, true); ctx.fillText(lines[1], X, y); }

  // name, the line under it, and the greeting
  y += 125;
  const name = String(o.name || "").trim();
  ctx.fillStyle = L.name; ctx.font = SANS(fit(ctx, [name], (s) => SANS(s, true), maxW, 54, 30), true); ctx.fillText(name, X, y);
  const sub = ({ welcome: [o.designation, o.joiningDate && `Joined ${dateText(o.joiningDate)}`], anniversary: [o.designation, o.joiningDate && `Joined ${dateText(o.joiningDate)}`],
    certified: [o.detail], newrole: [o.designation], birthday: [o.designation] }[o.occasion] || []).filter(Boolean).join("  ·  ");
  if (sub) { y += 54; ctx.fillStyle = L.sub; ctx.font = SANS(fit(ctx, [sub], (s) => SANS(s, false), maxW, 30, 20), false); ctx.fillText(sub, X, y); }
  const msg = String(o.message || "").trim();
  if (msg) {
    let m = 28, ml;
    do { ctx.font = SANS(m, false); ml = wrap(ctx, msg, maxW); m -= 2; } while (y + 56 + ml.length * (m + 2) * 1.35 > 890 && m > 18);
    ctx.fillStyle = L.msg;
    ml.forEach((t, i) => ctx.fillText(t, X, y + 62 + i * (m + 2) * 1.35));
  }

  // footer: a hairline, the logo and the Google Cloud partner mark
  ctx.strokeStyle = L.rule; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(X, 920); ctx.lineTo(POSTER_W - X, 920); ctx.stroke();
  const logo = o.logos && o.logos[L.logo];
  if (logo) ctx.drawImage(logo, X - 6, 948, 200, 200 * logo.height / logo.width);
  if (o.mark) {
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.18)"; ctx.shadowBlur = 12;
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(POSTER_W - X - 38, 988, 38, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    const w = 44, h = w * o.mark.height / o.mark.width;
    ctx.drawImage(o.mark, POSTER_W - X - 38 - w / 2, 988 - h / 2, w, h);
  }
  return canvas;
}

export const canvasToBlob = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The poster could not be created."))), "image/png"));

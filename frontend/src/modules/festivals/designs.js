/* Festival greeting designs. FESTIVALS holds each festival's starting words; THEMES holds the four looks every festival is drawn in
   (7 festivals x 4 looks = 28 templates). The page itself follows the Christmas reference: a lit backdrop with falling particles, an
   illustrated centrepiece on the right (scenes.js), the words in a column on the left, and a soft white footer with the Wohlig logo.
   To add a festival: add its row to the festivals table (backend schema.sql), its words here and a scene in scenes.js. */
import { HEAD, PALETTE, drawHero } from "./heroes.js";

export const SIZE = 1080;
const SERIF = (s, italic, weight = 400) => `${italic ? "italic " : ""}${weight} ${s}px "Playfair Display", "Source Serif 4", Georgia, serif`;
const SANS = (s, bold) => `${bold ? 700 : 400} ${s}px "Lato", "Helvetica Neue", Arial, sans-serif`;
const TAU2 = Math.PI * 2;

export const FESTIVALS = {
  diwali: { short: "Diwali", emoji: "🪔", vivid: { dark: "#5a1604", mid: "#f7781d" }, wish: "a very Happy Diwali!",
    say: { heading: "Happy", emphasis: "Diwali", message: "May the Festival of Lights fill your life and your family's with joy, prosperity and success. Thank you for everything you bring to Wohlig." } },
  holi: { short: "Holi", emoji: "🎨", vivid: { dark: "#3a0a5c", mid: "#e5258a" }, wish: "a very Happy Holi!",
    say: { heading: "Happy", emphasis: "Holi", message: "May this Festival of Colours bring new energy, fresh ideas and greater happiness to all of us." } },
  "eid-ul-fitr": { short: "Eid", emoji: "🌙", vivid: { dark: "#042a2c", mid: "#0f8a6d" }, wish: "a blessed and joyful Eid!",
    say: { heading: "Eid", emphasis: "Mubarak", message: "May this Eid bring peace, happiness and countless blessings to you and your loved ones. Thank you for everything you bring to Wohlig." } },
  "eid-ul-adha": { short: "Eid-ul-Adha", emoji: "🕌", vivid: { dark: "#0a1738", mid: "#0b7a75" }, wish: "a blessed Eid-ul-Adha!",
    say: { heading: "Eid-ul-Adha", emphasis: "Mubarak", message: "May this Eid-ul-Adha fill your days with generosity, joy and togetherness. Thank you for everything you bring to Wohlig." } },
  "ganesh-chaturthi": { short: "Ganesh Chaturthi", emoji: "🌸", vivid: { dark: "#5a1408", mid: "#e8590c" }, wish: "a blessed Ganesh Chaturthi!",
    say: { heading: "Ganpati", emphasis: "Bappa Morya", message: "May Lord Ganesha bless you and your family with wisdom, prosperity and new beginnings. Thank you for everything you bring to Wohlig." } },
  navratri: { short: "Navratri", emoji: "💃", vivid: { dark: "#2c0a4a", mid: "#d6246e" }, wish: "a joyful Navratri!",
    say: { heading: "Happy", emphasis: "Navratri", message: "May the nine nights bring you strength, joy and the victory of good over evil. Thank you for everything you bring to Wohlig." } },
  muharram: { short: "Muharram", emoji: "🌙", vivid: { dark: "#0a1738", mid: "#1b3a8a" }, wish: "peace and blessings on this auspicious occasion.",
    say: { heading: "Happy", emphasis: "Muharram", message: "May this new year bring peace, prosperity and happiness to you and your family." } },
  christmas: { short: "Christmas", emoji: "🎄", vivid: { dark: "#4a0612", mid: "#c0392b" }, wish: "a joyful Christmas!",
    say: { heading: "Merry", emphasis: "Christmas", message: "Wishing you warmth, joy and good company this season. Thank you for everything you brought to Wohlig this year." } },
};

export const THEMES = [
  { id: "traditional", name: "Classic", note: "Warm cream page with the festival's colours thrown across it." },
  { id: "corporate", name: "Maroon", note: "Wohlig maroon page. Suited to clients and partners." },
  { id: "minimal", name: "Minimalist", note: "Clean white page with a light touch of colour." },
  { id: "creative", name: "Bold", note: "The festival's own bright colour as the page." },
];
export const templateName = (slug, theme) => `${theme.name} ${FESTIVALS[slug].short}`;

function fit(ctx, texts, font, maxW, size, min) {
  let s = size;
  for (; s > min; s -= 2) { if (texts.every((t) => (ctx.font = font(s), ctx.measureText(t).width <= maxW))) break; }
  return s;
}
function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let cur = "";
    for (const w of para.split(/\s+/).filter(Boolean)) { const t = cur ? `${cur} ${w}` : w; if (cur && ctx.measureText(t).width > maxW) { out.push(cur); cur = w; } else cur = t; }
    if (cur) out.push(cur);
  }
  return out;
}

/* The page colours by look: the page, the heading ink, the message ink, the script line, and which picture mode suits it.
   Classic is the reference (warm cream); Maroon and Bold put the same layout on a dark page. */
const LOOK = {
  traditional: { mode: "light", page: ["#fdf6ec", "#f4e4d0"], ink: "#24222c", msg: "#2f2c36", strong: "#800d35", script: "#800d35", logo: "light", tag: "#24222c" },
  minimal: { mode: "light", page: ["#ffffff", "#f7efe4"], ink: "#800d35", msg: "#4a3a3d", strong: "#800d35", script: "#800d35", logo: "light", tag: "#800d35", soft: 0.55 },
  corporate: { mode: "dark", page: ["#8c1b40", "#3a0618"], ink: "#fff7e9", msg: "rgba(255,247,233,.94)", strong: "#ffd9a8", script: "#ffd9a8", logo: "dark", tag: "#fff7e9" },
  creative: { mode: "dark", page: null, ink: "#ffffff", msg: "rgba(255,255,255,.96)", strong: "#ffe9a8", script: "#fff3c4", logo: "dark", tag: "#ffffff" },
};
const SCRIPT = (s) => `500 ${s}px "Dancing Script", "Brush Script MT", cursive`;
function spaced(ctx, text, x, y, gap, align = "left") {   // letters with extra space between them, like "H A P P Y"
  const ws = [...text].map((c) => ctx.measureText(c).width), total = ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
  let cx = align === "center" ? x - total / 2 : x; ctx.textAlign = "left";
  [...text].forEach((c, i) => { ctx.fillText(c, cx, y); cx += ws[i] + gap; });
  return total;
}

/** Draws a greeting. o: { slug, theme, heading, emphasis, message, sender, recipient, align: "left"|"center", photo, logos, scale } -> canvas */
export async function renderGreeting(o) {
  if (document.fonts) await Promise.all([SERIF(60, false, 700), SERIF(60, true), SANS(40, true), SANS(40, false), SCRIPT(60)].map((f) => document.fonts.load(f, "Aa").catch(() => {})));
  const F = FESTIVALS[o.slug], scale = o.scale || 1, W = SIZE, K = LOOK[o.theme] || LOOK.traditional, pal = PALETTE[o.slug];
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.round(W * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale); ctx.textBaseline = "alphabetic";
  const center = o.align === "center", hasPhoto = !!o.photo, dark = K.mode === "dark";

  /* ---- the page and the picture ---- */
  if (K.page) { const g = ctx.createLinearGradient(0, 0, W, W); g.addColorStop(0, K.page[0]); g.addColorStop(1, K.page[1]); ctx.fillStyle = g; }
  else { const g = ctx.createRadialGradient(W * 0.75, W * 0.45, 40, W * 0.75, W * 0.45, 980); g.addColorStop(0, F.vivid.mid); g.addColorStop(1, F.vivid.dark); ctx.fillStyle = g; }
  ctx.fillRect(0, 0, W, W);
  drawHero(ctx, o.slug, K.mode, { s: center ? 0.9 : 1, alpha: K.soft || 1 });
  if (!dark) { const v = ctx.createLinearGradient(0, 0, W * 0.62, 0); v.addColorStop(0, "rgba(253,246,236,.9)"); v.addColorStop(1, "rgba(253,246,236,0)"); ctx.fillStyle = v; ctx.fillRect(0, 0, W * 0.62, W); }   // keeps the words clear of the cloud

  /* ---- the logo and the tag line ---- */
  const logo = o.logos && (K.logo === "dark" ? o.logos.dark : o.logos.light);
  if (logo) ctx.drawImage(logo, center ? W / 2 - 100 : 70, 58, 200, 200 * logo.height / logo.width);
  if (!center) {
    ctx.font = SANS(17, true); ctx.fillStyle = K.tag; if ("letterSpacing" in ctx) ctx.letterSpacing = "3px"; ctx.textAlign = "right";
    const parts = ["WORK", "GROW", "CELEBRATE"]; let x = W - 70;
    for (let i = parts.length - 1; i >= 0; i--) { ctx.fillStyle = K.tag; ctx.fillText(parts[i], x, 88); x -= ctx.measureText(parts[i]).width + 22; if (i) { ctx.fillStyle = "#f7781d"; ctx.beginPath(); ctx.arc(x + 11, 82, 4, 0, TAU2); ctx.fill(); } }
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  }

  /* ---- the words ---- */
  const X = center ? W / 2 : 84, maxW = center ? 880 : hasPhoto ? 470 : 600, al = center ? "center" : "left";
  const heading = String(o.heading || "").trim().toUpperCase(), word = String(o.emphasis || "").trim();
  const dear = String(o.recipient || "").trim(), msg = String(o.message || "").trim(), from = String(o.sender || "").trim();
  const top = center ? (hasPhoto ? 480 : 330) : hasPhoto ? 380 : 340;
  ctx.fillStyle = K.ink; ctx.font = SANS(center ? 30 : 36, false); if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  let y = top;
  if (heading) { spaced(ctx, heading, X, y, center ? 22 : 28, al); y += 20; }
  let big = center ? 190 : hasPhoto ? 170 : 230;   // the festival's name, in big letters filled with the festival's colours
  for (; big > 70; big -= 4) { ctx.font = SERIF(big, false, 700); if (ctx.measureText(word).width <= maxW) break; }
  ctx.font = SERIF(big, false, 700); const ww = ctx.measureText(word).width, wx = center ? X - ww / 2 : X, wy = y + big * 0.78;
  const gr = ctx.createLinearGradient(wx, 0, wx + ww, 0); (HEAD[o.slug] || pal.slice(1).reverse()).forEach((c, i, arr) => gr.addColorStop(i / (arr.length - 1), c));
  ctx.textAlign = "left"; ctx.fillStyle = dark ? "#fff7e9" : gr; ctx.fillText(word, wx, wy);
  y = wy + 64;
  if (dear) { y += 8; ctx.fillStyle = K.ink; ctx.font = SERIF(32, true, 400); ctx.textAlign = al; ctx.fillText(`Dear ${dear},`, X, y); y += 44; }
  let m = center ? 27 : 28; ctx.font = SANS(m, false); let lines = wrap(ctx, msg, maxW), lh = m * 1.55;
  const limit = center ? 880 : 900;
  while (y + lines.length * lh > limit - 130 && m > 20) { m -= 1; ctx.font = SANS(m, false); lines = wrap(ctx, msg, maxW); lh = m * 1.55; }
  ctx.fillStyle = K.msg; ctx.textAlign = al; lines.forEach((t, i) => ctx.fillText(t, X, y + i * lh)); y += lines.length * lh - 10;
  const wish = `Wishing you and your family ${F.wish}`;   // the script line with its underline
  if (y + 120 < 960) {
    const sz = fit(ctx, [wish], SCRIPT, center ? 880 : 840, center ? 46 : 52, 26); ctx.font = SCRIPT(sz); ctx.fillStyle = K.script;
    const sl = wrapScript(ctx, wish, center ? 880 : 840); sl.forEach((t, i) => ctx.fillText(t, X, y + 56 + i * sz * 1.05));
    const ey = y + 56 + (sl.length - 1) * sz * 1.05 + 22; ctx.strokeStyle = K.script; ctx.lineWidth = 3; ctx.beginPath(); const x0 = center ? X - 120 : X + 40; ctx.moveTo(x0, ey + 6); ctx.quadraticCurveTo(x0 + 130, ey - 10, x0 + 290, ey - 6); ctx.stroke();
  }

  /* ---- the sign-off, bottom left ---- */
  if (from) {
    const fy = 1000; ctx.fillStyle = "#f7781d"; ctx.fillRect(center ? W / 2 - 150 : 84, fy - 52, 4, 62);
    ctx.textAlign = "left"; ctx.fillStyle = K.msg; ctx.font = SANS(25, false); if ("letterSpacing" in ctx) ctx.letterSpacing = "1px";
    const sx = (center ? W / 2 - 150 : 84) + 22; ctx.fillText("With warm wishes,", sx, fy - 20);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px"; ctx.fillStyle = K.strong; ctx.font = SANS(fit(ctx, [from], (s) => SANS(s, true), 420, 32, 20), true); ctx.fillText(from, sx, fy + 16);
  }

  /* ---- the photo (optional): a round picture, with a ring ---- */
  if (hasPhoto) {
    const rp = center ? 110 : 84, cx = center ? W / 2 + 270 : 84 + 84, cy = center ? 215 : 190;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.3)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8; ctx.fillStyle = "#f7781d"; ctx.beginPath(); ctx.arc(cx, cy, rp + 7, 0, TAU2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, rp, 0, TAU2); ctx.clip();
    const sc = Math.max((rp * 2) / o.photo.width, (rp * 2) / o.photo.height), sw = (rp * 2) / sc, sh = (rp * 2) / sc;
    ctx.drawImage(o.photo, (o.photo.width - sw) / 2, (o.photo.height - sh) * 0.22, sw, sh, cx - rp, cy - rp, rp * 2, rp * 2); ctx.restore();
  }
  return canvas;
}
function wrapScript(ctx, text, maxW) { return wrap(ctx, text, maxW).slice(0, 3); }

export const toBlob = (canvas, type = "image/png") => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The image could not be created."))), type));
export const loadImage = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("The picture could not be read.")); img.src = src; });

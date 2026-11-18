/* Festival greeting designs. FESTIVALS holds each festival's starting words; THEMES holds the four looks every festival is drawn in
   (7 festivals x 4 looks = 28 templates). The page itself follows the Christmas reference: a lit backdrop with falling particles, an
   illustrated centrepiece on the right (scenes.js), the words in a column on the left, and a soft white footer with the Wohlig logo.
   To add a festival: add its row to the festivals table (backend schema.sql), its words here and a scene in scenes.js. */
import { rng } from "./art.js";
import { HERO_AT, drawScene } from "./scenes.js";

export const SIZE = 1080;
const SERIF = (s, italic, weight = 400) => `${italic ? "italic " : ""}${weight} ${s}px "Playfair Display", "Source Serif 4", Georgia, serif`;
const SANS = (s, bold) => `${bold ? 700 : 400} ${s}px "Lato", "Helvetica Neue", Arial, sans-serif`;
const THANKS = "Thank you for everything you brought to Wohlig this year.";

export const FESTIVALS = {
  diwali: { short: "Diwali", emoji: "🪔", vivid: { dark: "#5a1604", mid: "#f7781d" },
    say: { heading: "Happy", emphasis: "Diwali", message: `${THANKS} May the festival of lights fill your life and your family's with joy, prosperity and success.` } },
  holi: { short: "Holi", emoji: "🎨", vivid: { dark: "#3a0a5c", mid: "#e5258a" },
    say: { heading: "Happy", emphasis: "Holi", message: `${THANKS} May your life be as colourful as the festival of colours. Wishing you joy and happiness.` } },
  "eid-ul-fitr": { short: "Eid", emoji: "🌙", vivid: { dark: "#042a2c", mid: "#0f8a6d" },
    say: { heading: "Eid", emphasis: "Mubarak", message: `${THANKS} May this Eid bring peace, happiness and countless blessings to you and your loved ones.` } },
  "eid-ul-adha": { short: "Eid-ul-Adha", emoji: "🕌", vivid: { dark: "#0a1738", mid: "#0b7a75" },
    say: { heading: "Eid-ul-Adha", emphasis: "Mubarak", message: `${THANKS} Wishing you and your family a blessed Bakrid filled with generosity, joy and togetherness.` } },
  "ganesh-chaturthi": { short: "Ganesh Chaturthi", emoji: "🌸", vivid: { dark: "#5a1408", mid: "#e8590c" },
    say: { heading: "Ganpati", emphasis: "Bappa Morya", message: `May Lord Ganesha bless you and your family with wisdom, prosperity and new beginnings. ${THANKS}` } },
  navratri: { short: "Navratri", emoji: "💃", vivid: { dark: "#2c0a4a", mid: "#d6246e" },
    say: { heading: "Happy", emphasis: "Navratri", message: `May the nine nights bring you strength, joy and the victory of good over evil. ${THANKS} Happy Dussehra!` } },
  christmas: { short: "Christmas", emoji: "🎄", vivid: { dark: "#4a0612", mid: "#c0392b" },
    say: { heading: "Merry", emphasis: "Christmas", message: `${THANKS} Wishing you and your family a joyful Christmas and a happy, successful New Year.` } },
};

export const THEMES = [
  { id: "traditional", name: "Traditional", note: "The festival's own colours, glowing, with the full illustrated scene." },
  { id: "corporate", name: "Modern Corporate", note: "Wohlig maroon with the same scene. Suited to clients and partners." },
  { id: "minimal", name: "Minimalist", note: "Warm ivory page with the scene framed in an arch." },
  { id: "creative", name: "Creative", note: "Bright, bold colour with confetti and big shapes." },
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

/* the colours of the words, by look */
const INK = {
  traditional: { head: "#fff7e9", gold: ["#fff0b8", "#ecc467", "#c99a3c"], msg: "rgba(255,255,255,.95)", dear: "#fff7e9", page: "#ffffff,#eef1f8" },
  corporate: { head: "#fff7e9", gold: ["#ffe3c0", "#f9b27c", "#e98a4a"], msg: "rgba(255,247,233,.92)", dear: "#fff7e9", page: "#fffaf0,#f2e6d2" },
  creative: { head: "#ffffff", gold: ["#fff3b0", "#ffd34d", "#ff9d1c"], msg: "rgba(255,255,255,.96)", dear: "#ffffff", page: "#ffffff,#f7f1ff" },
  minimal: { head: "#800d35", gold: ["#f9a35d", "#f7781d", "#d85f0b"], msg: "#5f4a4d", dear: "#800d35", page: "#f4e8d4,#ead9bd" },
};

function confetti(ctx, slug, V) {   // the Creative look: big soft shapes and little paper pieces
  const r = rng(slug.length * 13 + 5);
  [[930, 130, 340, "rgba(255,255,255,.10)"], [90, 850, 300, "rgba(0,0,0,.16)"], [1040, 700, 200, "rgba(255,255,255,.08)"], [-20, 140, 200, "rgba(255,255,255,.07)"]]
    .forEach(([x, y, R, c]) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill(); });
  const cols = ["#ffffff", "#ffd34d", "#ff7ab6", "#6ee7c8", "#8cc8ff"];
  for (let i = 0; i < 60; i++) { ctx.save(); ctx.translate(r() * 1080, r() * 840); ctx.rotate(r() * 6); ctx.fillStyle = cols[i % cols.length]; ctx.globalAlpha = 0.6; ctx.fillRect(-8, -3, 16, 6); ctx.restore(); }
}

/** Draws a greeting. o: { slug, theme, heading, emphasis, message, sender, recipient, align: "left"|"center", photo, logos, scale } -> canvas */
export async function renderGreeting(o) {
  if (document.fonts) await Promise.all([SERIF(60), SERIF(60, true), SERIF(60, false, 800), SANS(40, true), SANS(40, false)].map((f) => document.fonts.load(f, "Aa").catch(() => {})));
  const F = FESTIVALS[o.slug], scale = o.scale || 1, W = SIZE, theme = o.theme, K = INK[theme] || INK.traditional;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.round(W * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale); ctx.textBaseline = "alphabetic";
  const center = o.align === "center", hasPhoto = !!o.photo;

  /* ---- the picture: backdrop, particles and the centrepiece ---- */
  const hero = center ? (hasPhoto ? { x: 880, y: 250, s: 0.48 } : { x: 540, y: 285, s: 0.56 }) : { x: HERO_AT.x, y: HERO_AT.y, s: 1 };
  if (theme === "minimal") {
    ctx.fillStyle = "#fff7e9"; ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = "#f7781d"; ctx.fillRect(0, 0, W, 10);
    // the scene sits in an arch on the right (or on top, when the words are centred)
    const win = center ? (hasPhoto ? { x: 600, y: 40, w: 330, h: 400 } : { x: 290, y: 50, w: 500, h: 420 }) : { x: 575, y: 80, w: 440, h: 750 };
    ctx.save(); ctx.beginPath(); ctx.moveTo(win.x, win.y + win.h); ctx.lineTo(win.x, win.y + win.w / 2); ctx.arc(win.x + win.w / 2, win.y + win.w / 2, win.w / 2, Math.PI, 0); ctx.lineTo(win.x + win.w, win.y + win.h); ctx.closePath(); ctx.clip();
    const s = center ? (hasPhoto ? 0.46 : 0.58) : 0.86;
    drawScene(ctx, o.slug, "own", null, { hero: { x: win.x + win.w / 2, y: win.y + win.h * 0.56, s } });   // the backdrop fills the whole arch; the centrepiece is scaled into it
    ctx.restore();
    ctx.strokeStyle = "rgba(201,154,60,.7)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(win.x - 12, win.y + win.h); ctx.lineTo(win.x - 12, win.y + win.w / 2); ctx.arc(win.x + win.w / 2, win.y + win.w / 2, win.w / 2 + 12, Math.PI, 0); ctx.lineTo(win.x + win.w + 12, win.y + win.h); ctx.stroke();
  } else {
    drawScene(ctx, o.slug, theme === "corporate" ? "maroon" : theme === "creative" ? "vivid" : "own", F.vivid, { hero, between: theme === "creative" ? (c) => confetti(c, o.slug, F.vivid) : null });
  }

  /* ---- the words ---- */
  const X = center ? W / 2 : 84, maxW = center ? 860 : hasPhoto ? 430 : 465, al = center ? "center" : "left";
  ctx.textAlign = al;
  const lines = [o.heading, o.emphasis].map((t) => String(t || "").trim());
  const dear = String(o.recipient || "").trim(), msg = String(o.message || "").trim(), from = String(o.sender || "").trim();
  const bottom = 818;   // the words must end above the footer
  let top = center ? (hasPhoto ? 470 : 518) : hasPhoto ? 330 : 236, big = center ? 84 : hasPhoto ? 96 : 126, m = center ? 26 : 29;
  const one = center && lines[0] && lines[1], gap = center ? [24, 38] : [30, 56];   // centred: "Merry Christmas" on one line, tighter spacing
  let layout;
  for (let tries = 0; tries < 40; tries++) {
    let s1, s2, w1 = 0, w2 = 0;
    if (one) {
      s1 = s2 = fit(ctx, [`${lines[0]} ${lines[1]}`], (s) => SERIF(s, false, theme === "creative" ? 800 : 400), maxW, big, 40);
      ctx.font = SERIF(s1, false, theme === "creative" ? 800 : 400); w1 = ctx.measureText(`${lines[0]} `).width; ctx.font = SERIF(s2, true, 400); w2 = ctx.measureText(lines[1]).width;
    } else {
      s1 = fit(ctx, [lines[0]].filter(Boolean), (s) => SERIF(s, false, theme === "creative" ? 800 : 400), maxW, big, 44);
      s2 = fit(ctx, [lines[1]].filter(Boolean), (s) => SERIF(s, true, 400), maxW, Math.round(big * 1.08), 44);
    }
    ctx.font = SANS(m, false);
    const ml = wrap(ctx, msg, maxW), lh = m * 1.5;
    const b1 = top + s1 * 0.86, b2 = one ? b1 : lines[0] ? b1 + (lines[1] ? s2 * 0.92 : 0) : top + s2 * 0.86;
    const ruleY = b2 + gap[0], dearY = ruleY + gap[1], msgY = dearY + (dear ? 46 : 0), signY = msgY + ml.length * lh + 18 + (ml.length ? 20 : 0);
    const end = signY + (from ? 12 : -30);
    layout = { s1, s2, ml, lh, b1, b2, ruleY, dearY, msgY, signY, end, one, w1, w2 };
    if (end <= bottom) break;
    if (m > 20) m -= 1; else big -= 4; if (big < 48) break;
  }
  const L = layout;
  if (!center && !hasPhoto && L.end < 700) { const shift = Math.min(60, (700 - L.end) / 2); top += shift; Object.keys(L).forEach((k) => { if (/^(b1|b2|ruleY|dearY|msgY|signY|end)$/.test(k)) L[k] += shift; }); }   // short text sits a little lower, like the reference
  const goldAt = (x0, x1) => { const g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, K.gold[0]); g.addColorStop(0.5, K.gold[1]); g.addColorStop(1, K.gold[2]); return g; };
  ctx.save(); ctx.shadowColor = theme === "minimal" ? "transparent" : "rgba(0,0,0,.35)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 3;
  if (L.one) {   // "Merry Christmas" on one line, centred
    const x0 = X - (L.w1 + L.w2) / 2; ctx.textAlign = "left";
    ctx.fillStyle = K.head; ctx.font = SERIF(L.s1, false, theme === "creative" ? 800 : 400); ctx.fillText(lines[0], x0, L.b1);
    ctx.font = SERIF(L.s2, true, 400); ctx.fillStyle = goldAt(x0 + L.w1, x0 + L.w1 + L.w2); ctx.fillText(lines[1], x0 + L.w1, L.b2); ctx.textAlign = al;
  } else {
    if (lines[0]) { ctx.fillStyle = K.head; ctx.font = SERIF(L.s1, false, theme === "creative" ? 800 : 400); ctx.fillText(lines[0], X, L.b1); }
    if (lines[1]) { ctx.font = SERIF(L.s2, true, 400); const w = ctx.measureText(lines[1]).width, x0 = center ? X - w / 2 : X; ctx.fillStyle = goldAt(x0, x0 + w); ctx.fillText(lines[1], X, L.b2); }
  }
  ctx.restore();
  ctx.fillStyle = goldAt(X, X + 90); ctx.fillRect(center ? X - 40 : X, L.ruleY, 80, 3);
  if (dear) { ctx.fillStyle = K.dear; ctx.font = SERIF(34, true, 400); ctx.fillText(`Dear ${dear},`, X, L.dearY + 22); }
  ctx.save(); ctx.shadowColor = theme === "minimal" ? "transparent" : "rgba(0,0,0,.3)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
  ctx.fillStyle = K.msg; ctx.font = SANS(m, false);
  L.ml.forEach((t, i) => ctx.fillText(t, X, L.msgY + 20 + i * L.lh));
  if (from) { ctx.fillStyle = goldAt(X, X + 360); ctx.font = SERIF(Math.min(36, fit(ctx, [`With warm wishes, ${from}`], (s) => SERIF(s, true, 400), center ? maxW : maxW - 15, 36, 22)), true, 400); ctx.fillText(`With warm wishes, ${from}`, X, L.signY + 26); }
  ctx.restore();

  /* ---- the photo (optional): a round picture, with a ring ---- */
  if (hasPhoto) {
    const rp = center ? 120 : 84, cx = center ? 330 : 84 + 84, cy = center ? 270 : 168;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 26; ctx.shadowOffsetY = 10; ctx.fillStyle = theme === "minimal" ? "#800d35" : "#f3d27a"; ctx.beginPath(); ctx.arc(cx, cy, rp + 8, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, rp, 0, Math.PI * 2); ctx.clip();
    const sc = Math.max((rp * 2) / o.photo.width, (rp * 2) / o.photo.height), sw = (rp * 2) / sc, sh = (rp * 2) / sc;
    ctx.drawImage(o.photo, (o.photo.width - sw) / 2, (o.photo.height - sh) * 0.22, sw, sh, cx - rp, cy - rp, rp * 2, rp * 2); ctx.restore();
  }

  /* ---- the footer: a soft snow-white wave, the logo and the address ---- */
  const [p0, p1] = K.page.split(",");
  const wave = new Path2D(); wave.moveTo(0, 876); wave.bezierCurveTo(230, 838, 410, 902, 640, 868); wave.bezierCurveTo(830, 840, 960, 862, 1080, 832); wave.lineTo(1080, 1080); wave.lineTo(0, 1080); wave.closePath();
  ctx.save(); ctx.shadowColor = theme === "minimal" ? "rgba(120,60,20,.18)" : "rgba(60,0,20,.45)"; ctx.shadowBlur = 26; ctx.shadowOffsetY = -6;
  ctx.fillStyle = (() => { const g = ctx.createLinearGradient(0, 830, 0, 1080); g.addColorStop(0, p0); g.addColorStop(1, p1); return g; })(); ctx.fill(wave); ctx.restore();
  ctx.save(); ctx.clip(wave); ctx.strokeStyle = theme === "minimal" ? "rgba(201,154,60,.45)" : "rgba(232,184,200,.8)"; ctx.lineWidth = 5;
  const edge = new Path2D(); edge.moveTo(-10, 880); edge.bezierCurveTo(230, 842, 410, 906, 640, 872); edge.bezierCurveTo(830, 844, 960, 866, 1090, 836); ctx.stroke(edge); ctx.restore();
  const logo = o.logos && o.logos.light;
  if (logo) ctx.drawImage(logo, 82, 964, 176, 176 * logo.height / logo.width);
  ctx.textAlign = "right"; ctx.fillStyle = "#800d35"; ctx.font = SANS(23, true);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0.5px";
  ctx.fillText("wohlig.com", W - 84, 1012);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  return canvas;
}

export const toBlob = (canvas, type = "image/png") => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The image could not be created."))), type));
export const loadImage = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("The picture could not be read.")); img.src = src; });

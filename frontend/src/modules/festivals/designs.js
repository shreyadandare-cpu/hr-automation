/* Festival greeting designs. FESTIVALS holds each festival's look and starting words; THEMES holds the four ways every festival is
   drawn. A template is one festival in one theme (7 x 4 = 28). To add a festival: add its row to the festivals table (backend
   schema.sql) and an entry here, with a motif in art.js. To add a theme: add it to THEMES and a case in `scene`. */
import { MOTIFS, rng } from "./art.js";

export const SIZE = 1080;
const SERIF = (s, italic, weight = 400) => `${italic ? "italic " : ""}${weight} ${s}px "Playfair Display", "Source Serif 4", Georgia, serif`;
const SANS = (s, bold) => `${bold ? 700 : 400} ${s}px "Lato", "Helvetica Neue", Arial, sans-serif`;

export const FESTIVALS = {
  diwali: { short: "Diwali", emoji: "🪔", motif: "diwali", pal: { deep: "#5a1208", vivid: "#f7781d", accent: "#ffb347", gold: "#f6c453", multi: [] },
    say: { heading: "Happy", emphasis: "Diwali.", message: "May the festival of lights fill your life with joy, prosperity and success." } },
  holi: { short: "Holi", emoji: "🎨", motif: "holi", pal: { deep: "#3d1457", vivid: "#e5258a", accent: "#ffd23f", gold: "#ffd23f", multi: ["#ff2e93", "#ffd23f", "#22c997", "#3ea6ff", "#ff7a1a", "#9b5de5"] },
    say: { heading: "Happy", emphasis: "Holi.", message: "May your life be as colourful as the festival of colours. Wishing you joy and happiness." } },
  "eid-ul-fitr": { short: "Eid", emoji: "🌙", motif: "eid-ul-fitr", pal: { deep: "#0b3b34", vivid: "#0f8a6d", accent: "#f3d27a", gold: "#e8c872", multi: [] },
    say: { heading: "Eid", emphasis: "Mubarak.", message: "May this Eid bring peace, happiness and countless blessings to you and your loved ones." } },
  "eid-ul-adha": { short: "Eid-ul-Adha", emoji: "🕌", motif: "eid-ul-adha", pal: { deep: "#16294a", vivid: "#0b7a75", accent: "#f1d88a", gold: "#e3c26a", multi: [] },
    say: { heading: "Eid-ul-Adha", emphasis: "Mubarak.", message: "Wishing you and your family a blessed Bakrid filled with generosity, joy and togetherness." } },
  "ganesh-chaturthi": { short: "Ganesh Chaturthi", emoji: "🌸", motif: "ganesh-chaturthi", pal: { deep: "#7a1f0e", vivid: "#e8590c", accent: "#ffd166", gold: "#f6c453", multi: [] },
    say: { heading: "Ganpati", emphasis: "Bappa Morya.", message: "May Lord Ganesha bless you with wisdom, prosperity and new beginnings." } },
  navratri: { short: "Navratri", emoji: "💃", motif: "navratri", pal: { deep: "#4b0f3a", vivid: "#d6246e", accent: "#ffc233", gold: "#ffc233", multi: [] },
    say: { heading: "Happy", emphasis: "Navratri.", message: "May the nine nights bring you strength, joy and the victory of good over evil. Happy Dussehra!" } },
  christmas: { short: "Christmas", emoji: "🎄", motif: "christmas", pal: { deep: "#0f3d2e", vivid: "#c0392b", accent: "#f5d76e", gold: "#f5d76e", multi: [] },
    say: { heading: "Merry", emphasis: "Christmas.", message: "Wishing you a joyful Christmas and a happy, successful New Year." } },
};

export const THEMES = [
  { id: "traditional", name: "Traditional", note: "Rich festive colours, a gold frame and the full artwork." },
  { id: "corporate", name: "Modern Corporate", note: "Wohlig maroon with fine line artwork. Suited to clients and partners." },
  { id: "minimal", name: "Minimalist", note: "Clean typography on warm ivory with a single line drawing." },
  { id: "creative", name: "Creative", note: "Bold colour, big shapes and a lively feel." },
];
export const templateName = (slug, theme) => `${theme.name} ${FESTIVALS[slug].short}`;

const mix = (hex, to, t) => { const n = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const a = n(hex), b = n(to); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`; };

/* ---------- looks: background, colours, how the artwork is drawn ---------- */
function scene(ctx, theme, F, o) {
  const P = F.pal, W = SIZE, g = ctx.createLinearGradient(0, 0, W, W);
  const hasPhoto = !!o.photo;
  if (theme === "traditional") {
    g.addColorStop(0, mix(P.deep, "#ffffff", 0.08)); g.addColorStop(1, mix(P.deep, "#000000", 0.45)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, W);
    const r = ctx.createRadialGradient(W * 0.7, 250, 0, W * 0.7, 250, 520); r.addColorStop(0, "rgba(255,200,110,.22)"); r.addColorStop(1, "rgba(255,200,110,0)"); ctx.fillStyle = r; ctx.fillRect(0, 0, W, W);
    ctx.strokeStyle = P.gold; ctx.lineWidth = 3; ctx.strokeRect(34, 34, W - 68, W - 68); ctx.lineWidth = 1.4; ctx.strokeRect(48, 48, W - 96, W - 96);
    [[48, 48, 1, 1], [W - 48, 48, -1, 1], [48, W - 48, 1, -1], [W - 48, W - 48, -1, -1]].forEach(([x, y, sx, sy]) => {   // corner ornaments
      ctx.save(); ctx.translate(x, y); ctx.scale(sx, sy); ctx.strokeStyle = P.gold; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI / 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI / 2); ctx.stroke();
      ctx.fillStyle = P.gold; ctx.beginPath(); ctx.moveTo(40, 40); ctx.lineTo(48, 32); ctx.lineTo(56, 40); ctx.lineTo(48, 48); ctx.closePath(); ctx.fill(); ctx.restore();
    });
    return { label: P.gold, head: "#fff7e9", emph: P.accent, msg: "rgba(255,247,233,.9)", sub: "#f6e3b0", rule: "rgba(246,196,83,.5)", logo: "dark", ring: P.gold, motif: "rich", ink: P.gold, art: 1 };
  }
  if (theme === "corporate") {
    g.addColorStop(0, "#8c1b40"); g.addColorStop(1, "#520822"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, W);
    const r = ctx.createRadialGradient(960, 120, 0, 960, 120, 620); r.addColorStop(0, "rgba(247,120,29,.16)"); r.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = r; ctx.fillRect(0, 0, W, W);
    ctx.save(); ctx.translate(960, 150); ctx.strokeStyle = "rgba(255,205,175,.17)"; ctx.lineWidth = 2.2;   // the faint Wohlig flower line drawing
    for (let i = 0; i < 8; i++) { ctx.save(); ctx.rotate((i * Math.PI) / 4 + 0.2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(70, -86, 280, -96, 340, 0); ctx.bezierCurveTo(280, 62, 70, 52, 0, 0); ctx.stroke(); ctx.restore(); }
    ctx.restore();
    return { label: "#f6c9a8", head: "#fff7e9", emph: "#f9b27c", msg: "rgba(255,247,233,.84)", sub: "#f6c9a8", rule: "rgba(255,247,233,.22)", logo: "dark", ring: "#f7781d", motif: "line", ink: P.accent, art: 0.95 };
  }
  if (theme === "minimal") {
    g.addColorStop(0, "#fffaf0"); g.addColorStop(1, "#f6e9d2"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = "#f7781d"; ctx.fillRect(0, 0, W, 10);
    return { label: "#800d35", head: "#800d35", emph: "#f7781d", msg: "#6b5654", sub: "#2e1a1f", rule: "rgba(128,13,53,.22)", logo: "light", ring: "#800d35", motif: "mono", ink: "#800d35", art: hasPhoto ? 0.6 : 0.62 };
  }
  // creative
  g.addColorStop(0, P.vivid); g.addColorStop(1, mix(P.vivid, "#000000", 0.45)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, W);
  const r = rng(11);
  [[900, 120, 330, "rgba(255,255,255,.10)"], [140, 880, 300, "rgba(0,0,0,.14)"], [1010, 760, 190, "rgba(255,255,255,.08)"], [-30, 120, 190, "rgba(255,255,255,.07)"]].forEach(([x, y, rad, c]) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill(); });
  const confetti = P.multi.length ? P.multi : ["#ffffff", P.accent, P.gold, mix(P.vivid, "#ffffff", 0.5)];
  for (let i = 0; i < 46; i++) { ctx.save(); ctx.translate(r() * W, r() * 880); ctx.rotate(r() * 6); ctx.fillStyle = confetti[i % confetti.length]; ctx.globalAlpha = 0.55; ctx.fillRect(-7, -3, 14, 6); ctx.restore(); }
  ctx.globalAlpha = 1;
  return { label: "#fff7e9", head: "#ffffff", emph: P.accent, msg: "rgba(255,255,255,.94)", sub: "#fff7e9", rule: "rgba(255,255,255,.35)", logo: "dark", ring: "#ffffff", motif: "rich", ink: "#fff7e9", art: 1, plate: true, heavy: true };
}

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

/** Draws a greeting. o: { slug, theme, heading, emphasis, message, sender, recipient, align: "left"|"center", photo, logos, scale } -> canvas */
export async function renderGreeting(o) {
  if (document.fonts) await Promise.all([SERIF(60), SERIF(60, true), SERIF(60, false, 800), SANS(40, true), SANS(40, false)].map((f) => document.fonts.load(f, "Aa").catch(() => {})));
  const F = FESTIVALS[o.slug], scale = o.scale || 1, W = SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.round(W * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale); ctx.textBaseline = "alphabetic";
  const L = scene(ctx, o.theme, F, o), center = o.align === "center", hasPhoto = !!o.photo;
  const X = center ? W / 2 : 96, maxW = center ? 860 : 880, al = center ? "center" : "left";
  ctx.textAlign = "left";

  // the artwork, or the photo with the artwork behind it as a faint watermark
  const motif = MOTIFS[F.motif];
  const zone = center ? { x: W / 2, y: 292, s: 158 } : { x: 790, y: 268, s: 196 };
  if (hasPhoto) {
    ctx.save(); ctx.globalAlpha = o.theme === "creative" ? 0.2 : 0.13; motif(ctx, center ? 880 : 840, center ? 700 : 740, 230, F.pal, "line", L.ink); ctx.restore();
    const r = center ? 140 : 156, cx = zone.x, cy = zone.y;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.3)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10; ctx.fillStyle = L.ring; ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    const sc = Math.max((r * 2) / o.photo.width, (r * 2) / o.photo.height), sw = (r * 2) / sc, sh = (r * 2) / sc;
    ctx.drawImage(o.photo, (o.photo.width - sw) / 2, (o.photo.height - sh) * 0.22, sw, sh, cx - r, cy - r, r * 2, r * 2); ctx.restore();
  } else {
    if (L.plate) { ctx.fillStyle = "rgba(255,255,255,.14)"; ctx.beginPath(); ctx.arc(zone.x, zone.y, zone.s * 1.18, 0, Math.PI * 2); ctx.fill(); }
    ctx.save(); motif(ctx, zone.x, zone.y, zone.s * L.art, F.pal, L.motif, L.ink); ctx.restore();
  }

  // the small label with its orange rule
  const label = F.short.toUpperCase();
  ctx.fillStyle = L.label; ctx.font = SANS(26, true);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "6px";
  const lw = ctx.measureText(label).width;
  if (center) { ctx.strokeStyle = "#f7781d"; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(W / 2 - 28, 76); ctx.lineTo(W / 2 + 28, 76); ctx.stroke(); ctx.fillText(label, W / 2 - lw / 2 + 3, 124); }
  else { ctx.strokeStyle = "#f7781d"; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(X, 141); ctx.lineTo(X + 56, 141); ctx.stroke(); ctx.fillText(label, X + 76, 151); }
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

  // headline, then the emphasis in italic
  ctx.textAlign = al;
  const lines = [o.heading, o.emphasis].map((t) => String(t || "").trim());
  const weight = L.heavy ? 800 : 400;
  const size = fit(ctx, [lines[0]].filter(Boolean), (s) => SERIF(s, false, weight), maxW, 112, 50);
  const sizeE = fit(ctx, [lines[1]].filter(Boolean), (s) => SERIF(s, true, 400), maxW, size, 50);
  let y = center ? 548 : 520;
  if (lines[0]) { ctx.fillStyle = L.head; ctx.font = SERIF(size, false, weight); ctx.fillText(lines[0], X, y); if (lines[1]) y += size * 0.98; }
  if (lines[1]) { ctx.fillStyle = L.emph; ctx.font = SERIF(sizeE, true, 400); ctx.fillText(lines[1], X, y); }
  if (o.theme === "minimal") { ctx.fillStyle = "#f7781d"; ctx.fillRect(center ? W / 2 - 40 : X, y + 26, 80, 4); y += 30; }

  // "Dear ...", the message and who it is from
  const dear = String(o.recipient || "").trim(), msg = String(o.message || "").trim(), from = String(o.sender || "").trim();
  let m = 32, ml, top;
  const stack = () => { ctx.font = SANS(m, false); ml = wrap(ctx, msg, maxW); top = y + 62; return top + (dear ? 48 : 0) + ml.length * m * 1.4 + (from ? 70 : 0); };
  while (stack() > 900 && m > 19) m -= 2;
  let cy = top;
  if (dear) { ctx.fillStyle = L.head; ctx.font = SERIF(Math.min(38, m + 8), true, 400); ctx.fillText(`Dear ${dear},`, X, cy); cy += 48; }
  ctx.fillStyle = L.msg; ctx.font = SANS(m, false);
  ml.forEach((t, i) => ctx.fillText(t, X, cy + i * m * 1.4));
  cy += ml.length * m * 1.4;
  if (from) { ctx.fillStyle = L.sub; ctx.font = SERIF(Math.min(40, m + 10), true, 400); ctx.fillText(`With warm wishes, ${from}`, X, cy + 34); }

  // footer: a hairline, the Wohlig logo and the address
  ctx.textAlign = "left"; ctx.strokeStyle = L.rule; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(96, 936); ctx.lineTo(W - 96, 936); ctx.stroke();
  const logo = o.logos && o.logos[L.logo];
  if (logo) ctx.drawImage(logo, 90, 962, 190, 190 * logo.height / logo.width);
  ctx.textAlign = "right"; ctx.fillStyle = L.sub; ctx.font = SANS(24, false);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "1px";
  ctx.fillText("wohlig.com", W - 96, 1004);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  return canvas;
}

export const toBlob = (canvas, type = "image/png") => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The image could not be created."))), type));
export const loadImage = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("The picture could not be read.")); img.src = src; });

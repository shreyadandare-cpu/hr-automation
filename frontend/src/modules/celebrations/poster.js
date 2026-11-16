/* Draws the two celebration posters on a canvas. Both are laid out on the size of the reference designs (1587 x 2245) and the
   canvas is that size scaled down, so what the preview shows is exactly the PNG that is emailed. Long names shrink to fit. */
export const POSTER_W = 1240, POSTER_H = 1754;
const REF_W = 1587, REF_H = 2245, K = POSTER_W / REF_W;

const SERIF = (s) => `400 ${s}px "Bellefair", Georgia, serif`;
const SCRIPT = (s) => `400 ${s}px "Mr Dafoe", "Brush Script MT", cursive`;
const HEAVY = (s) => `400 ${s}px "Archivo Black", Impact, "Arial Black", sans-serif`;
const SANS = (s, bold) => `${bold ? 700 : 400} ${s}px "Lato", "Helvetica Neue", Arial, sans-serif`;

export async function ensureFonts() {
  if (!document.fonts) return;
  await Promise.all([SERIF(60), SCRIPT(60), HEAVY(60), SANS(40, true), SANS(40, false)].map((f) => document.fonts.load(f, "Aa").catch(() => {})));
}

export const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("The picture could not be read."));
  img.src = src;
});

/* ---------- drawing helpers (all in reference units) ---------- */
function poly(ctx, pts, radius = 0) {
  const n = pts.length, r = (i) => (Array.isArray(radius) ? radius[i] : radius) || 0;
  ctx.beginPath();
  ctx.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
  for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; ctx.arcTo(p[0], p[1], q[0], q[1], r(i)); }
  ctx.closePath();
}
function cover(ctx, img, x, y, w, h, fy = 0.3) {   // fills the box like CSS object-fit: cover, keeping faces (a little above centre)
  const s = Math.max(w / img.width, h / img.height), sw = w / s, sh = h / s;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) * fy, sw, sh, x, y, w, h);
}
function fit(ctx, text, font, maxW, size, min) {   // the largest size (down to min) at which the text fits on one line
  let s = size;
  for (; s > min; s -= 2) { ctx.font = font(s); if (ctx.measureText(text).width <= maxW) break; }
  ctx.font = font(s);
  return s;
}
function dots(ctx, cx, cy, r, gap, color, fade) {   // a halftone disc: dots shrink towards the edge named by `fade` ([dx, dy] direction)
  ctx.fillStyle = color;
  for (let y = cy - r; y <= cy + r; y += gap) for (let x = cx - r; x <= cx + r; x += gap) {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
    if (d > r) continue;
    const along = (dx * fade[0] + dy * fade[1]) / r;   // -1 .. 1
    const size = 3.6 * Math.max(0, Math.min(1, 0.55 + along * 0.55)) * (1 - d / r * 0.35);
    if (size < 0.5) continue;
    ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
  }
}
function leaf(ctx, x, y, len, wid, angle) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(wid, -len / 2, 0, -len); ctx.quadraticCurveTo(-wid, -len / 2, 0, 0);
  ctx.moveTo(0, 0); ctx.lineTo(0, -len * 0.85); ctx.stroke(); ctx.restore();
}
function branch(ctx, x, y, len, angle, leaves, color) {   // a thin stem with outlined leaves along it
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.translate(x, y); ctx.rotate(angle);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -len); ctx.stroke();
  for (let i = 0; i < leaves; i++) {
    const t = (i + 1) / (leaves + 1), ly = -len * t, s = 1 - t * 0.35;
    leaf(ctx, 0, ly, 190 * s, 52 * s, 0.75); leaf(ctx, 0, ly, 190 * s, 52 * s, -0.75);
  }
  leaf(ctx, 0, -len, 150, 42, 0);
  ctx.restore();
}
function words(text, bold) {   // [{ t, b }]: words, with those named in `bold` (a Set of lowercase words) in bold
  return String(text).split(/\s+/).filter(Boolean).map((t) => ({ t, b: bold.has(t.toLowerCase().replace(/[^a-z0-9]/g, "")) }));
}
/* Wraps and draws words that may be bold. Returns the number of lines. With draw=false it only counts. */
function rich(ctx, list, x, y, maxW, lineH, size, align, color, draw = true) {
  const lines = [];
  let cur = [], w = 0;
  const gap = () => { ctx.font = SANS(size, false); return ctx.measureText(" ").width; };
  const g = gap();
  for (const wd of list) {
    ctx.font = SANS(size, wd.b);
    const ww = ctx.measureText(wd.t).width;
    if (cur.length && w + g + ww > maxW) { lines.push({ cur, w }); cur = []; w = 0; }
    w += (cur.length ? g : 0) + ww; cur.push({ ...wd, ww });
  }
  if (cur.length) lines.push({ cur, w });
  if (!draw) return lines.length;
  ctx.fillStyle = color; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  lines.forEach((ln, i) => {
    let px = align === "center" ? x - ln.w / 2 : x;
    for (const wd of ln.cur) { ctx.font = SANS(size, wd.b); ctx.fillText(wd.t, px, y + i * lineH); px += wd.ww + g; }
  });
  return lines.length;
}
function wrapPlain(ctx, text, maxW) {
  const out = [];
  let cur = "";
  for (const w of String(text).split(/\s+/)) {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(t).width > maxW) { out.push(cur); cur = w; } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/* ---------- Template A: birthday ---------- */
function birthday(ctx, o) {
  ctx.fillStyle = "#dcdcde"; ctx.fillRect(0, 0, REF_W, REF_H);
  const tan = "#bd9c6b", ink = "#1d1b34", taupe = "#a99a8b";
  // soft shapes in the corners, with a dark line wandering through them
  ctx.fillStyle = tan;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(640, 0); ctx.bezierCurveTo(520, 40, 330, 60, 215, 150); ctx.bezierCurveTo(110, 235, 70, 360, 0, 540); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(REF_W, 1990); ctx.bezierCurveTo(1480, 2010, 1390, 2090, 1380, 2245); ctx.lineTo(REF_W, 2245); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(1587, 2060); ctx.bezierCurveTo(1480, 2080, 1330, 2130, 1330, 2245); ctx.lineTo(1587, 2245); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = ink; ctx.lineWidth = 6; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(660, 0); ctx.bezierCurveTo(430, 10, 190, 90, 135, 250); ctx.bezierCurveTo(100, 360, 190, 440, 120, 560); ctx.bezierCurveTo(70, 650, 40, 720, 0, 790); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(1587, 1990); ctx.bezierCurveTo(1520, 2040, 1470, 2120, 1495, 2190); ctx.bezierCurveTo(1510, 2230, 1450, 2245, 1380, 2245); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 520); ctx.bezierCurveTo(30, 600, 20, 700, 10, 800); ctx.stroke();
  // leaves
  branch(ctx, 1530, 600, 470, -0.1, 5, taupe); branch(ctx, 1475, 470, 330, 0.16, 3, taupe);
  branch(ctx, 80, 2245, 480, 0.34, 4, taupe); branch(ctx, 175, 2150, 420, 0.95, 3, taupe);
  // dots
  ctx.fillStyle = "#e0b987";
  [[205, 745, 22], [263, 810, 22], [165, 880, 17], [240, 880, 12], [270, 970, 14], [140, 940, 9], [200, 960, 11], [271, 1010, 12]]
    .forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); });
  [[1327, 1385, 14], [1322, 1425, 11], [1388, 1450, 9], [1435, 1458, 8], [1323, 1490, 11], [1407, 1535, 12], [1450, 1515, 12], [1300, 1560, 17], [1372, 1590, 17], [1335, 1638, 15]]
    .forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); });

  // logo and heading
  if (o.logo) ctx.drawImage(o.logo, 648, 112, 292, 292 * o.logo.height / o.logo.width);
  ctx.fillStyle = ink; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  fit(ctx, o.heading, SERIF, 1160, 215, 70);
  ctx.fillText(o.heading, REF_W / 2, 458);

  // the photo, in a polaroid
  ctx.save(); ctx.shadowColor = "rgba(40,30,20,.28)"; ctx.shadowBlur = 36; ctx.shadowOffsetY = 14;
  ctx.fillStyle = "#f4f3ee"; ctx.fillRect(345, 490, 890, 1265); ctx.restore();
  ctx.fillStyle = "#f4f3ee"; ctx.fillRect(345, 490, 890, 1265);
  ctx.fillStyle = "#e7e6e0"; ctx.fillRect(345, 1495, 890, 260);
  ctx.save(); ctx.beginPath(); ctx.rect(365, 508, 860, 978); ctx.clip();
  if (o.photo) cover(ctx, o.photo, 365, 508, 860, 978, 0.18); else { ctx.fillStyle = "#cfc7bd"; ctx.fillRect(365, 508, 860, 978); }
  ctx.restore();
  // washi tape
  ctx.save(); ctx.translate(1150, 585); ctx.rotate(0.62);
  ctx.fillStyle = "#c4a064"; ctx.fillRect(-170, -48, 340, 96);
  ctx.strokeStyle = "#f0b48c"; ctx.lineWidth = 7;
  for (let x = -140; x <= 140; x += 56) { ctx.beginPath(); ctx.moveTo(x, -48); ctx.lineTo(x, 48); ctx.stroke(); }
  for (let y = -22; y <= 22; y += 44) { ctx.beginPath(); ctx.moveTo(-170, y); ctx.lineTo(170, y); ctx.stroke(); }
  ctx.restore();
  // a dried-flower sprig over the corner of the polaroid
  ctx.save(); ctx.translate(335, 1590); ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = "#9a6b4a"; ctx.lineWidth = 7;
  [[0, 0, 14, -330, 0.04], [0, 0, -40, -230, -0.2], [0, 0, 60, -250, 0.28]].forEach(([x0, y0, x1, y1, bend]) => {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x1 * 0.4 + bend * 100, y1 * 0.55, x1, y1); ctx.stroke(); });
  [[14, -330, 0.08, 1], [-40, -230, -0.5, 0.85], [60, -250, 0.5, 0.9], [-75, -150, -0.7, 0.7], [110, -170, 0.75, 0.75]].forEach(([x, y, a, s]) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(s, s);
    ctx.fillStyle = "#ecd2a4"; ctx.strokeStyle = "#9a6b4a"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-52, -34, -48, -112, 0, -128); ctx.bezierCurveTo(48, -112, 52, -34, 0, 0); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(0, -100); ctx.moveTo(-20, -20); ctx.quadraticCurveTo(-24, -70, -8, -104); ctx.moveTo(20, -20); ctx.quadraticCurveTo(24, -70, 8, -104); ctx.stroke();
    ctx.restore();
  });
  ctx.restore();
  // the name, handwritten, in the white strip
  ctx.fillStyle = ink; ctx.textAlign = "center";
  const nm = `${o.name}!`;
  fit(ctx, nm, SCRIPT, 600, 190, 60);
  ctx.fillText(nm, 790, 1680);
  // the greeting
  ctx.fillStyle = ink;
  let size = 62, lines;
  do { ctx.font = SERIF(size); lines = wrapPlain(ctx, o.message, 1000); size -= 2; } while (lines.length > 3 && size > 34);
  lines.forEach((l, i) => ctx.fillText(l, REF_W / 2, 1912 + i * (size + 22) * 1.15));
}

/* ---------- Template B: welcome ---------- */
function welcome(ctx, o) {
  const blue = "#5764a8", navy = "#394279", grey = "#dedee0", cyan = "#0095d9", yellow = "#ffd84a";
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, REF_W, REF_H);
  // grey bands
  ctx.fillStyle = grey;
  poly(ctx, [[985, 0], [1587, 0], [1587, 395], [1060, 925], [1320, 465], [1345, 400], [1320, 340]], 0); ctx.fill();
  poly(ctx, [[0, 2245], [0, 2095], [525, 1570], [640, 1690], [100, 2245]], 0); ctx.fill();
  // the big blue shape
  ctx.fillStyle = blue;
  poly(ctx, [[0, 0], [985, 0], [1320, 340], [1345, 400], [1320, 465], [800, 990], [270, 1130], [0, 860]], [0, 0, 70, 70, 70, 0, 0, 0]); ctx.fill();
  // navy shape at the bottom
  ctx.fillStyle = navy;
  poly(ctx, [[1260, 1425], [1587, 1752], [1587, 2245], [260, 2245], [175, 2150], [195, 2085], [790, 1560]], [0, 0, 0, 0, 60, 60, 0]); ctx.fill();
  // lines and little crosses
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = blue; ctx.lineWidth = 15;
  ctx.beginPath(); ctx.moveTo(0, 1152); ctx.lineTo(138, 1006); ctx.stroke();
  ctx.strokeStyle = cyan; ctx.lineWidth = 24;
  ctx.beginPath(); ctx.moveTo(1300, 1285); ctx.lineTo(1600, 1585); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(260, 1700); ctx.lineTo(150, 1810); ctx.quadraticCurveTo(95, 1870, 150, 1955); ctx.stroke();
  ctx.strokeStyle = blue; ctx.lineWidth = 15;
  [[1468, 1193], [124, 1402]].forEach(([x, y]) => { ctx.beginPath(); ctx.moveTo(x - 33, y); ctx.lineTo(x + 33, y); ctx.moveTo(x, y - 33); ctx.lineTo(x, y + 33); ctx.stroke(); });
  dots(ctx, 1385, 830, 240, 15, "#2c3170", [-0.7, 0.7]);
  dots(ctx, 590, 2245, 220, 15, "rgba(255,255,255,.85)", [0.6, -0.8]);

  // photo in a large circle
  ctx.save(); ctx.shadowColor = "rgba(20,24,70,.35)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
  ctx.fillStyle = "#cfd3ea"; ctx.beginPath(); ctx.arc(793, 1178, 524, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(793, 1178, 524, 0, Math.PI * 2); ctx.clip();
  if (o.photo) cover(ctx, o.photo, 269, 654, 1048, 1048, 0.2); else { ctx.fillStyle = "#cfd3ea"; ctx.fillRect(269, 654, 1048, 1048); }
  ctx.restore();
  // date badge
  const [, mm, dd] = (o.joiningDate || "").split("-").map(Number);
  ctx.fillStyle = blue; ctx.beginPath(); ctx.arc(443, 1546, 249, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  if (dd) {
    ctx.font = HEAVY(270); ctx.fillText(String(dd), 443, 1560);
    ctx.font = HEAVY(120); ctx.fillText(MONTHS[mm - 1] || "", 443, 1690);
  }
  // logo
  if (o.logo) ctx.drawImage(o.logo, 1185, 62, 330, 330 * o.logo.height / o.logo.width);
  // heading, name, role
  ctx.fillStyle = "#fff"; ctx.textAlign = "left";
  const head = String(o.heading).toUpperCase();
  let hs = 118, hl;
  do { ctx.font = HEAVY(hs); hl = wrapPlain(ctx, head, 820); hs -= 4; } while (hl.length > 2 && hs > 50);
  hl.forEach((l, i) => ctx.fillText(l, 160, 250 + i * (hs + 4) * 1.1));
  const after = 250 + (hl.length - 1) * (hs + 4) * 1.1;
  ctx.fillStyle = yellow;
  fit(ctx, o.name.toUpperCase(), (s) => `800 ${s}px "Lato", Arial, sans-serif`, 1050, 100, 44);
  const nameY = Math.max(after + 150, 505);
  ctx.fillText(o.name.toUpperCase(), 160, nameY);
  const role = [o.designation, o.category && o.category !== "Employee" && !String(o.designation).toLowerCase().includes(o.category.toLowerCase()) ? o.category : ""].filter(Boolean).join("  |  ");
  if (role) { ctx.fillStyle = "#fff"; ctx.font = SANS(40, true); ctx.fillText(role.toUpperCase(), 162, nameY + 64); }
  // announcement at the bottom
  const strong = new Set([...o.name.split(/\s+/).slice(0, 1), ...String(o.designation).split(/\s+/)].map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, "")).filter(Boolean));
  const list = words(String(o.message).toUpperCase(), strong);
  let size = 68;
  while (size > 30 && rich(ctx, list, 600, 0, 880, 0, size, "left", "#fff", false) > 4) size -= 2;
  rich(ctx, list, 600, 1885, 880, size * 1.2, size, "left", "#fff");
}

/** Draws a poster. o: { template, name, heading, designation, category, joiningDate, message, photo, logo } -> canvas */
export async function renderPoster(o) {
  await ensureFonts();
  const canvas = document.createElement("canvas");
  canvas.width = POSTER_W; canvas.height = POSTER_H;
  const ctx = canvas.getContext("2d");
  ctx.scale(K, K);
  ctx.textBaseline = "alphabetic";
  (o.template === "birthday-classic" ? birthday : welcome)(ctx, { ...o, name: String(o.name || "").trim() || " ", designation: o.designation || "", message: o.message || "", heading: o.heading || "" });
  return canvas;
}

export const canvasToBlob = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The poster could not be created."))), "image/png"));

/* ---------- default wording ---------- */
export const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";
export const DEFAULTS = {
  birthday: { heading: "Happy Birthday", message: "May this year bring you continued success, good health, and happiness." },
  welcome: { heading: "Welcome to Wohlig!!" },
};
export const welcomeMessage = (name, designation) =>
  `We are excited to welcome ${firstName(name)} to our team as our new ${designation || "team member"}.`;

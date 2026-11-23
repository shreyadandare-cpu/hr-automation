/* The welcome poster for new joiners and freshers: a portrait card in maroon, grey and white with orange accents, a round photo, the
   joining date in a maroon circle and the welcome line at the bottom. It is drawn in the proportions of the supplied design
   (1587 x 2245) and scaled down, so the preview is exactly the PNG that is emailed. */
export const WELCOME_W = 1080, WELCOME_H = 1528;
const REF_W = 1587, K = WELCOME_W / REF_W;
const MAROON = "#800d35", ORANGE = "#f26a0b", GREY = "#dcdce0", YELLOW = "#ffd84a", NAVY = "#2b3675";
const HEAVY = (s) => `400 ${s}px "Archivo Black", "Arial Black", "Helvetica Neue", Arial, sans-serif`;
const TEXT = (s, bold) => `${bold ? 700 : 400} ${s}px "Archivo", "Helvetica Neue", Arial, sans-serif`;

export async function ensureWelcomeFonts() {
  if (!document.fonts) return;
  await Promise.all([HEAVY(60), TEXT(40, false), TEXT(40, true)].map((f) => document.fonts.load(f, "Aa").catch(() => {})));
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const dayAndMonth = (iso) => { const [y, m, d] = String(iso || "").split("-").map(Number); return y ? [String(d), MONTHS[m - 1]] : ["", ""]; };

/* Dots that shrink away from one side, like a halftone print. (cx, cy, r): the circle; (ax, ay): the side where the dots are largest. */
function halftone(ctx, cx, cy, r, ax, ay, color, step, big) {
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip(); ctx.fillStyle = color;
  const len = Math.hypot(ax - cx, ay - cy) || 1, ux = (ax - cx) / len, uy = (ay - cy) / len;
  for (let y = cy - r; y <= cy + r; y += step) for (let x = cx - r; x <= cx + r; x += step) {
    const t = ((x - cx) * ux + (y - cy) * uy) / r;            // -1 (far side) .. 1 (the big side)
    const d = big * Math.min(1, Math.max(0, (t + 1) / 1.6));
    if (d < 0.5) continue;
    ctx.beginPath(); ctx.arc(x, y, d, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function plus(ctx, x, y) {
  ctx.save(); ctx.strokeStyle = MAROON; ctx.lineWidth = 14; ctx.lineCap = "butt";
  ctx.beginPath(); ctx.moveTo(x - 34, y); ctx.lineTo(x + 34, y); ctx.moveTo(x, y - 34); ctx.lineTo(x, y + 34); ctx.stroke(); ctx.restore();
}
function orange(ctx, draw) {
  ctx.save(); ctx.strokeStyle = ORANGE; ctx.lineWidth = 24; ctx.lineJoin = "round"; ctx.lineCap = "butt"; ctx.beginPath(); draw(); ctx.stroke(); ctx.restore();
}

/* The words of the greeting, with the person's first name and role in bold, wrapped to the width. */
function words(message, bolds) {
  const text = String(message || ""), mark = new Array(text.length).fill(false);
  for (const b of bolds.filter(Boolean)) {
    const at = text.toUpperCase().indexOf(String(b).toUpperCase());
    if (at >= 0) mark.fill(true, at, at + b.length);
  }
  const out = [];
  for (const m of text.matchAll(/\S+/g)) out.push({ w: m[0].toUpperCase(), bold: mark.slice(m.index, m.index + m[0].length).some(Boolean) });
  return out;
}
function layout(ctx, list, size, maxW) {
  const lines = [[]]; let w = 0;
  const space = (ctx.font = TEXT(size, false), ctx.measureText(" ").width);
  for (const t of list) {
    ctx.font = TEXT(size, t.bold);
    const tw = ctx.measureText(t.w).width;
    if (lines[lines.length - 1].length && w + space + tw > maxW) { lines.push([]); w = 0; }
    lines[lines.length - 1].push({ ...t, tw }); w += (w ? space : 0) + tw;
  }
  return { lines, space };
}

/** o: { name, heading, emphasis, designation, joiningDate, message, photo, logos: { dark, light } } -> canvas */
export async function renderWelcome(o) {
  await ensureWelcomeFonts();
  const canvas = document.createElement("canvas");
  canvas.width = WELCOME_W; canvas.height = WELCOME_H;
  const ctx = canvas.getContext("2d");
  ctx.scale(K, K);                                   // from here on, the coordinates are those of the 1587 x 2245 design
  const W = REF_W, H = WELCOME_H / K;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";

  // the two grey diagonal bands
  const band = (lo, hi, y0, y1, x0 = 0) => { ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, W, H); ctx.clip(); ctx.fillStyle = GREY; ctx.beginPath(); ctx.moveTo(lo - y0, y0); ctx.lineTo(hi - y0, y0); ctx.lineTo(hi - y1, y1); ctx.lineTo(lo - y1, y1); ctx.closePath(); ctx.fill(); ctx.restore(); };
  band(600, 1985, -10, 1000, 880);   // the grey fills the corner, up to the white edge
  band(2095, 2308, 1500, H + 10);

  // dotted circle, upper right
  halftone(ctx, 1395, 830, 245, 1570, 1010, NAVY, 16, 4.6);

  // the big maroon shape across the top
  ctx.fillStyle = MAROON; ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(990, 0); ctx.lineTo(1260, 270); ctx.arcTo(1367, 377, 1260, 484, 105);
  ctx.lineTo(1000, 745); ctx.lineTo(790, 1000); ctx.lineTo(270, 1125); ctx.lineTo(0, 860); ctx.closePath(); ctx.fill();

  // the big maroon shape across the bottom
  ctx.beginPath();
  ctx.moveTo(1220, 1490); ctx.lineTo(W, 1857); ctx.lineTo(W, H); ctx.lineTo(260, H); ctx.arcTo(175, H, 175, H - 90, 85);
  ctx.lineTo(175, 2160); ctx.arcTo(175, 2135, 215, 2095, 60); ctx.lineTo(520, 1790); ctx.lineTo(700, 1500); ctx.closePath(); ctx.fill();
  halftone(ctx, 570, 2315, 232, 570, 2560, "rgba(255,255,255,.85)", 14, 4.4);   // clipped by the canvas edge

  // orange lines, one under the photo circle and the date circle
  orange(ctx, () => { ctx.moveTo(0, 625); ctx.arcTo(262, 887, 0, 1150, 85); ctx.lineTo(0, 1150); });
  orange(ctx, () => { ctx.moveTo(1305, 1288); ctx.lineTo(W, 1572); });
  orange(ctx, () => { ctx.moveTo(300, 1660); ctx.arcTo(92, 1868, 160, 1948, 80); ctx.lineTo(160, 1948); });
  plus(ctx, 1470, 1193); plus(ctx, 125, 1402);

  // the photo, round
  const pcx = 790, pcy = 1180, pr = 525;
  ctx.save(); ctx.beginPath(); ctx.arc(pcx, pcy, pr, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = "#fff"; ctx.fillRect(pcx - pr, pcy - pr, pr * 2, pr * 2);
  if (o.photo) {
    const p = o.photo, s = Math.max((pr * 2) / p.width, (pr * 2) / p.height), sw = (pr * 2) / s, sh = (pr * 2) / s;
    ctx.drawImage(p, (p.width - sw) / 2, (p.height - sh) * 0.2, sw, sh, pcx - pr, pcy - pr, pr * 2, pr * 2);
  } else {
    ctx.fillStyle = "#f3eef0"; ctx.fillRect(pcx - pr, pcy - pr, pr * 2, pr * 2);
    const ini = String(o.name || "").trim().split(/\s+/).slice(0, 2).map((x) => x[0] || "").join("").toUpperCase();
    ctx.fillStyle = MAROON; ctx.font = HEAVY(330); ctx.textAlign = "center"; ctx.fillText(ini, pcx, pcy + 120); ctx.textAlign = "left";
  }
  ctx.restore();

  // the date circle
  ctx.fillStyle = MAROON; ctx.beginPath(); ctx.arc(445, 1548, 250, 0, Math.PI * 2); ctx.fill();
  const [day, mon] = dayAndMonth(o.joiningDate);
  ctx.fillStyle = "#fff"; ctx.textAlign = "center";
  ctx.font = HEAVY(215); ctx.fillText(day, 442, 1566);
  ctx.font = HEAVY(104); ctx.fillText(mon, 442, 1668);
  ctx.textAlign = "left";

  // the headline and the name
  const lines = [o.heading, o.emphasis].map((t) => String(t || "").trim().toUpperCase()).filter(Boolean);
  let size = 150;
  while (size > 70 && lines.some((t) => (ctx.font = HEAVY(size), ctx.measureText(t).width > 800))) size -= 4;
  const lead = size * 0.95;
  ctx.fillStyle = "#fff"; ctx.font = HEAVY(size);
  lines.forEach((t, i) => ctx.fillText(t, 160, 250 + i * lead));
  const name = String(o.name || "").trim().toUpperCase();
  let ns = 94;
  while (ns > 44 && (ctx.font = HEAVY(ns), ctx.measureText(name).width > 1050)) ns -= 4;
  ctx.fillStyle = YELLOW; ctx.font = HEAVY(ns); ctx.fillText(name, 160, 250 + Math.max(0, lines.length - 1) * lead + 147);

  // the welcome line, with the first name and the role in bold
  const first = String(o.name || "").trim().split(/\s+/)[0] || "";
  const list = words(o.message, [first, String(o.designation || "").trim()]);
  let ms = 58, set;
  for (; ms >= 36; ms -= 2) { set = layout(ctx, list, ms, 920); if (set.lines.length <= 4) break; }
  ctx.fillStyle = "#fff";
  set.lines.forEach((ln, i) => {
    let x = 600; const y = 1880 + i * ms * 1.25;
    ln.forEach((t, j) => { ctx.font = TEXT(ms, t.bold); ctx.fillText(t.w, x, y); x += t.tw + (j < ln.length - 1 ? set.space : 0); });
  });

  // the Wohlig logo
  const logo = o.logos && (o.logos.light || o.logos.dark);
  if (logo) { const w = 270; ctx.drawImage(logo, 1252, 92, w, (w * logo.height) / logo.width); }
  return canvas;
}

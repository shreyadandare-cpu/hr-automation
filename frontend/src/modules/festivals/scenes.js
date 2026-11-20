/* The festival scenes: a lit backdrop, falling particles and an illustrated centrepiece for each festival, drawn with canvas paths and
   gradients (no image files). Everything is laid out on a 1080 x 1080 page with the centrepiece on the right and the text column free on the
   left, like the Christmas reference. designs.js puts the words, the footer and the logo on top. */
import { rng } from "./art.js";

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- small helpers ---------- */
function glow(ctx, x, y, r, color, a = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color.replace("A)", `${a})`)); g.addColorStop(1, color.replace("A)", "0)"));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}
const rgba = (r, g, b) => `rgba(${r},${g},${b},A)`;
const WARM = rgba(255, 214, 120), WHITE = rgba(255, 255, 255), ORANGE = rgba(255, 150, 60), PINK = rgba(255, 90, 160);
function lin(ctx, x0, y0, x1, y1, stops) { const g = ctx.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; }
function rad(ctx, x, y, r0, r1, stops, x2 = x, y2 = y) { const g = ctx.createRadialGradient(x, y, r0, x2, y2, r1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; }
function star5(ctx, x, y, r1, r2, rot = -Math.PI / 2) {
  ctx.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? r2 : r1, a = rot + (i * Math.PI) / 5; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath();
}
function twinkle(ctx, x, y, r, color) {   // a four-point star with a soft halo
  glow(ctx, x, y, r * 2.4, color, 0.35);
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = color.replace("A)", "0.95)");
  ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(0, 0, r, 0); ctx.quadraticCurveTo(0, 0, 0, r); ctx.quadraticCurveTo(0, 0, -r, 0); ctx.quadraticCurveTo(0, 0, 0, -r); ctx.fill(); ctx.restore();
}
export function sphere(ctx, x, y, r, base, light, dark) {   // a glossy bauble / ball with a cap
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = r * 0.6; ctx.shadowOffsetY = r * 0.25;
  ctx.fillStyle = rad(ctx, x - r * 0.35, y - r * 0.4, r * 0.1, r * 1.1, [[0, light], [0.45, base], [1, dark]]);
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.beginPath(); ctx.ellipse(x - r * 0.38, y - r * 0.45, r * 0.22, r * 0.12, -0.7, 0, TAU); ctx.fill();
  ctx.fillStyle = lin(ctx, x - r * 0.3, 0, x + r * 0.3, 0, [[0, "#f4d98a"], [0.5, "#c9a049"], [1, "#8f6d22"]]); ctx.fillRect(x - r * 0.22, y - r * 1.18, r * 0.44, r * 0.26);
  ctx.strokeStyle = "#c9a049"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y - r * 1.3, r * 0.14, 0, TAU); ctx.stroke();
}
function bow(ctx, x, y, s, color, dark) {
  ctx.fillStyle = color; ctx.strokeStyle = dark; ctx.lineWidth = 1.5;
  for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + k * s * 1.2, y - s * 1.3, x + k * s * 2.1, y - s * 0.1, x + k * s * 0.35, y + s * 0.15); ctx.fill(); ctx.stroke(); }
  ctx.beginPath(); ctx.arc(x, y, s * 0.3, 0, TAU); ctx.fill(); ctx.stroke();
}
function gift(ctx, x, y, w, h, box, boxDark, ribbon, ribbonDark) {   // x,y = bottom left
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,.3)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 6;
  ctx.fillStyle = lin(ctx, x, 0, x + w, 0, [[0, box], [1, boxDark]]); ctx.fillRect(x, y - h, w, h); ctx.restore();
  ctx.fillStyle = "rgba(0,0,0,.14)"; ctx.fillRect(x + w * 0.78, y - h, w * 0.22, h);
  ctx.fillStyle = lin(ctx, x, 0, x + w, 0, [[0, ribbon], [1, ribbonDark]]); ctx.fillRect(x + w * 0.42, y - h, w * 0.16, h);
  ctx.fillStyle = ribbon; ctx.fillRect(x - 2, y - h, w + 4, h * 0.16); ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fillRect(x - 2, y - h, w + 4, h * 0.04);
  bow(ctx, x + w / 2, y - h, w * 0.2, ribbon, ribbonDark);
}
function particles(ctx, r, n, kind, y1 = 900) {
  for (let i = 0; i < n; i++) {
    const x = r() * 1080, y = r() * y1, s = r();
    if (kind === "snow") { ctx.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.6})`; ctx.beginPath(); ctx.arc(x, y, 0.8 + s * s * 4, 0, TAU); ctx.fill(); if (s > 0.93) glow(ctx, x, y, 14, WHITE, 0.25); }
    else if (kind === "sparks") { const c = [WARM, ORANGE, rgba(255, 240, 200)][i % 3]; glow(ctx, x, y, 3 + s * 9, c, 0.5 + r() * 0.4); }
    else if (kind === "powder") { const c = [PINK, rgba(255, 220, 60), rgba(60, 220, 160), rgba(80, 170, 255), rgba(255, 130, 40)][i % 5]; glow(ctx, x, y, 4 + s * 12, c, 0.5); }
    else if (kind === "stars") { if (s > 0.75) twinkle(ctx, x, y * 0.85, 4 + s * 8, WARM); else { ctx.fillStyle = `rgba(255,248,220,${0.3 + r() * 0.6})`; ctx.beginPath(); ctx.arc(x, y * 0.9, 0.7 + s * 1.6, 0, TAU); ctx.fill(); } }
    else if (kind === "petals") { ctx.save(); ctx.translate(x, y); ctx.rotate(r() * 6); ctx.fillStyle = ["rgba(255,153,28,.7)", "rgba(255,200,60,.7)", "rgba(230,90,40,.65)"][i % 3]; ctx.beginPath(); ctx.ellipse(0, 0, 3 + s * 5, 1.6 + s * 2.4, 0, 0, TAU); ctx.fill(); ctx.restore(); }
  }
}

/* ---------- backdrops ---------- */
const OWN = {   // each festival's own lit background: [dark edge, middle, glow colour], glow centre
  christmas: { c: ["#58091a", "#b11f33", "rgba(255,200,120,A)"], at: [740, 360] },
  diwali: { c: ["#2a0612", "#7a1a12", "rgba(255,170,70,A)"], at: [800, 470] },
  holi: { c: ["#2b0a4e", "#a1177a", "rgba(255,200,90,A)"], at: [780, 400] },
  "eid-ul-fitr": { c: ["#03161f", "#0b4a52", "rgba(255,225,150,A)"], at: [800, 280] },
  "eid-ul-adha": { c: ["#080f26", "#1b2f66", "rgba(255,225,150,A)"], at: [800, 380] },
  "ganesh-chaturthi": { c: ["#3a0a08", "#a3350f", "rgba(255,190,80,A)"], at: [790, 430] },
  navratri: { c: ["#240a40", "#8a1a72", "rgba(255,190,90,A)"], at: [800, 450] },
};
export function paintBackdrop(ctx, slug, bg, vivid) {
  const o = OWN[slug], W = 1080;
  let dark = o.c[0], mid = o.c[1];
  if (bg === "maroon") { dark = "#3a0618"; mid = "#8c1b40"; } else if (bg === "vivid") { dark = vivid.dark; mid = vivid.mid; }
  ctx.fillStyle = rad(ctx, o.at[0], o.at[1], 40, 980, [[0, mid], [1, dark]], o.at[0], o.at[1]); ctx.fillRect(0, 0, W, W);
  ctx.fillStyle = lin(ctx, 0, 0, W, W, [[0, "rgba(0,0,0,.28)"], [0.5, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,.2)"]]); ctx.fillRect(0, 0, W, W);
  glow(ctx, o.at[0], o.at[1], 420, o.c[2], 0.32);
}

/* ---------- Christmas ---------- */
function christmasTree(ctx, r, cx, top, base) {
  const tiers = [[0, 0.3, 0.3], [0.1, 0.46, 0.45], [0.24, 0.62, 0.6], [0.38, 0.78, 0.76], [0.52, 0.9, 0.9], [0.66, 1, 1]];   // [top, bottom, half width] as fractions
  const H = base - top, maxW = 245;
  for (let t = tiers.length - 1; t >= 0; t--) {
    const [a, b, wf] = tiers[t], y0 = top + H * a, y1 = top + H * b, w = maxW * wf, n = 9;
    ctx.save(); ctx.beginPath(); ctx.moveTo(cx, y0);
    for (let k = 1; k <= n; k++) { const f = k / n; ctx.lineTo(cx + w * f + (k % 2 ? 6 : -2), y0 + (y1 - y0 - 16) * f + (k % 2 ? -3 : 4)); }
    const sc = 7;   // the scalloped bottom edge, right to left: drooping branch tips
    for (let k = 0; k < sc; k++) { const x0 = cx + w - (2 * w * k) / sc, x1 = cx + w - (2 * w * (k + 1)) / sc; ctx.quadraticCurveTo((x0 + x1) / 2, y1 + 22 + (k % 2) * 6, x1, y1 - 10 + (k % 2 ? 8 : 0)); }
    for (let k = n; k >= 1; k--) { const f = k / n; ctx.lineTo(cx - w * f - (k % 2 ? 6 : -2), y0 + (y1 - y0 - 16) * f + (k % 2 ? -3 : 4)); }
    ctx.closePath();
    ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 12;
    ctx.fillStyle = lin(ctx, cx - w, y0, cx + w, y1, [[0, "#0a4a29"], [0.45, "#1a8048"], [1, "#09381f"]]); ctx.fill(); ctx.shadowColor = "transparent";
    ctx.clip();
    const greens = ["#0c5a31", "#1a8a4c", "#2fa860", "#0a3d22", "#14703c", "#41bd72", "#0e6636"];
    for (let i = 0; i < 900; i++) {   // needles: short strokes pointing away from the trunk and down
      const py = lerp(y0, y1 + 14, Math.pow(r(), 0.85)), span = (w * (py - y0)) / Math.max(1, y1 - y0) + 8, px = cx + (r() * 2 - 1) * span;
      const ang = Math.atan2(1, ((px - cx) / Math.max(40, w)) * 2.4) + (r() - 0.5) * 0.8, len = 13 + r() * 18;
      ctx.strokeStyle = greens[(r() * greens.length) | 0]; ctx.globalAlpha = 0.5 + r() * 0.45; ctx.lineWidth = 1.4 + r() * 1.5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = lin(ctx, 0, y1 - 60, 0, y1 + 20, [[0, "rgba(0,20,10,0)"], [1, "rgba(0,20,10,.55)"]]); ctx.fillRect(cx - w - 20, y1 - 60, w * 2 + 40, 90);   // the shadow under each tier
    ctx.fillStyle = lin(ctx, cx - w, 0, cx - w * 0.2, 0, [[0, "rgba(255,255,255,0)"], [1, "rgba(150,255,190,.10)"]]); ctx.fillRect(cx - w - 10, y0, w, y1 - y0 + 30);   // light from the left
    ctx.restore();
  }
}
export function christmasScene(ctx, r) {
  const cx = 800, top = 150, base = 800;
  glow(ctx, cx, top - 10, 190, WARM, 0.6);
  ctx.fillStyle = lin(ctx, cx - 26, 0, cx + 26, 0, [[0, "#5b3418"], [1, "#2d1808"]]); ctx.fillRect(cx - 26, base - 20, 52, 54);
  christmasTree(ctx, r, cx, top, base);
  // fairy lights on a spiral
  for (let i = 0; i < 170; i++) {
    const t = i / 170, y = top + 50 + t * (base - top - 90), hw = ((y - top) / (base - top)) * 225 * 0.88, x = cx + Math.sin(t * 26) * hw;
    glow(ctx, x, y, 7.5, WARM, 0.55); ctx.fillStyle = "rgba(255,250,225,.95)"; ctx.beginPath(); ctx.arc(x, y, 1.7, 0, TAU); ctx.fill();
  }
  const RED = ["#ff5a5a", "#d3202e", "#7e0b17"], GOLD = ["#fff0a8", "#e3b341", "#8a6414"], CREAM = ["#ffffff", "#ece0c6", "#a8957a"];
  [[796, 262, 17, RED], [846, 318, 15, GOLD], [742, 372, 15, CREAM], [818, 378, 14, GOLD], [752, 446, 15, RED], [884, 450, 14, RED], [806, 500, 18, GOLD], [706, 548, 15, RED], [915, 540, 15, RED],
    [770, 596, 18, CREAM], [906, 626, 15, GOLD], [772, 660, 20, GOLD], [690, 700, 16, CREAM], [930, 706, 17, RED], [764, 742, 16, GOLD], [862, 752, 16, RED], [820, 650, 15, RED], [640, 752, 15, GOLD]]
    .forEach(([x, y, rr, c]) => sphere(ctx, x, y, rr, c[1], c[0], c[2]));
  ctx.save(); ctx.shadowColor = "rgba(255,210,100,.9)"; ctx.shadowBlur = 36;   // the star
  star5(ctx, cx, top - 14, 40, 18); ctx.fillStyle = lin(ctx, cx - 40, top - 54, cx + 40, top + 26, [[0, "#fff3b0"], [0.5, "#f2c14e"], [1, "#b8821c"]]); ctx.fill(); ctx.restore();
  star5(ctx, cx, top - 14, 40, 18); ctx.strokeStyle = "rgba(255,240,180,.7)"; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
  gift(ctx, 556, 848, 100, 92, "#c4202c", "#8b1019", "#f3d27a", "#b8902e");
  gift(ctx, 652, 842, 76, 62, "#f6efe0", "#d8cdb4", "#c4202c", "#8b1019");
  gift(ctx, 902, 838, 90, 76, "#e2b845", "#b88c24", "#c4202c", "#8b1019");
  gift(ctx, 986, 836, 66, 56, "#1d6a43", "#134b2e", "#f3d27a", "#b8902e");
}

/* ---------- Diwali ---------- */
export function flame(ctx, x, y, s) {
  glow(ctx, x, y - s * 0.7, s * 4.2, WARM, 0.55);
  ctx.beginPath(); ctx.moveTo(x, y - s * 2.2); ctx.bezierCurveTo(x + s * 0.95, y - s * 1.2, x + s * 0.8, y - s * 0.2, x, y); ctx.bezierCurveTo(x - s * 0.8, y - s * 0.2, x - s * 0.95, y - s * 1.2, x, y - s * 2.2);
  ctx.fillStyle = lin(ctx, x, y - s * 2.2, x, y, [[0, "#fff6b8"], [0.5, "#ffb52e"], [1, "#e8541a"]]); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x, y - s * 0.7, s * 0.28, s * 0.62, 0, 0, TAU); ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.fill();
}
export function diya(ctx, x, y, w, lit = true) {   // x,y = rim centre
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 16; ctx.shadowOffsetY = 8;
  ctx.beginPath(); ctx.moveTo(x - w, y); ctx.bezierCurveTo(x - w * 0.95, y + w * 0.72, x + w * 0.95, y + w * 0.72, x + w, y); ctx.quadraticCurveTo(x, y - w * 0.22, x - w, y);
  ctx.fillStyle = lin(ctx, x - w, y, x + w, y + w * 0.7, [[0, "#f0883a"], [0.55, "#c4561c"], [1, "#7a2a0c"]]); ctx.fill(); ctx.restore();
  ctx.beginPath(); ctx.ellipse(x, y, w, w * 0.2, 0, 0, TAU); ctx.fillStyle = lin(ctx, x - w, y, x + w, y, [[0, "#f6c453"], [0.5, "#fff0a0"], [1, "#b8822a"]]); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x, y + w * 0.02, w * 0.82, w * 0.13, 0, 0, TAU); ctx.fillStyle = "#3b1608"; ctx.fill();
  ctx.strokeStyle = "rgba(255,215,140,.55)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - w * 0.72, y + w * 0.28); ctx.quadraticCurveTo(x, y + w * 0.5, x + w * 0.72, y + w * 0.28); ctx.stroke();
  if (lit) flame(ctx, x + w * 0.62, y - w * 0.05, w * 0.34);
}
export function marigold(ctx, x, y, s, a = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  for (let ring = 0; ring < 3; ring++) for (let i = 0; i < 12; i++) { ctx.save(); ctx.rotate((i / 12) * TAU + ring * 0.26); ctx.fillStyle = ["#f59a0c", "#ffb82e", "#ffd25a"][ring]; ctx.beginPath(); ctx.ellipse(0, -s * (0.82 - ring * 0.22), s * 0.2, s * (0.38 - ring * 0.06), 0, 0, TAU); ctx.fill(); ctx.restore(); }
  ctx.fillStyle = "#c2610a"; ctx.beginPath(); ctx.arc(0, 0, s * 0.16, 0, TAU); ctx.fill(); ctx.restore();
}
export function lantern(ctx, x, y, w, h, c0, c1) {   // a hanging paper lantern; y = top of the cord
  ctx.strokeStyle = "rgba(255,225,160,.8)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h * 0.18); ctx.stroke();
  glow(ctx, x, y + h * 0.6, h * 1.1, WARM, 0.4);
  ctx.fillStyle = "#b8822a"; ctx.fillRect(x - w * 0.28, y + h * 0.16, w * 0.56, h * 0.07);
  ctx.beginPath(); ctx.ellipse(x, y + h * 0.58, w / 2, h * 0.36, 0, 0, TAU); ctx.fillStyle = rad(ctx, x, y + h * 0.58, 4, w * 0.7, [[0, "#fff1b0"], [0.35, c0], [1, c1]]); ctx.fill();
  ctx.strokeStyle = "rgba(120,30,10,.45)"; ctx.lineWidth = 1.6;
  for (let i = 0; i <= 2; i++) { ctx.beginPath(); ctx.ellipse(x, y + h * 0.58, Math.max(0.5, (w / 2) * (i / 2.4)), h * 0.36, 0, 0, TAU); ctx.stroke(); }
  ctx.fillStyle = "#b8822a"; ctx.fillRect(x - w * 0.28, y + h * 0.9, w * 0.56, h * 0.06);
  ctx.strokeStyle = "#e9b84a"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x, y + h * 0.96); ctx.lineTo(x, y + h * 1.16); ctx.stroke();
  ctx.fillStyle = "#e9b84a"; ctx.beginPath(); ctx.moveTo(x, y + h * 1.0); ctx.lineTo(x - 6, y + h * 1.22); ctx.lineTo(x + 6, y + h * 1.22); ctx.fill();
}
function burst(ctx, r, x, y, R, color) {
  glow(ctx, x, y, R * 1.3, color, 0.2);
  for (let i = 0; i < 26; i++) { const a = (i / 26) * TAU + r() * 0.1, l = R * (0.55 + r() * 0.45); ctx.strokeStyle = color.replace("A)", "0.85)"); ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * R * 0.28, y + Math.sin(a) * R * 0.28); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke(); glow(ctx, x + Math.cos(a) * l, y + Math.sin(a) * l, 6, color, 0.9); }
}
function diwaliScene(ctx, r) {
  burst(ctx, r, 700, 170, 80, WARM); burst(ctx, r, 940, 130, 60, PINK); burst(ctx, r, 985, 330, 48, ORANGE);
  // a string of lights across the top right
  ctx.strokeStyle = "rgba(255,225,160,.55)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(560, 40); ctx.bezierCurveTo(700, 150, 900, 150, 1080, 50); ctx.stroke();
  for (let i = 0; i <= 12; i++) { const t = i / 12, x = lerp(560, 1080, t), y = 40 + Math.sin(t * Math.PI) * 78 + (t < 0.5 ? t * 6 : (1 - t) * 6); glow(ctx, x, y + 6, 18, WARM, 0.8); ctx.fillStyle = "#fff4c4"; ctx.beginPath(); ctx.arc(x, y + 6, 4, 0, TAU); ctx.fill(); }
  lantern(ctx, 650, 120, 70, 110, "#ff8a2a", "#a3260c"); lantern(ctx, 905, 215, 86, 130, "#ff9a3a", "#b02a0e");
  // a glowing rangoli behind the diyas
  glow(ctx, 810, 600, 380, WARM, 0.4);
  ctx.globalAlpha = 0.92; ringMandala(ctx, 810, 590, 195, ["#ffb42e", "#ff6a3a", "#ff4f8b", "#ffd35a", "#e8452a"]); ctx.globalAlpha = 1;
  diya(ctx, 810, 705, 125); diya(ctx, 640, 775, 62); diya(ctx, 985, 770, 66); diya(ctx, 925, 822, 42); diya(ctx, 705, 826, 38);
  const rr = rng(5); for (let i = 0; i < 22; i++) marigold(ctx, 590 + rr() * 480, 780 + rr() * 70, 9 + rr() * 6, rr() * 6);
}

/* ---------- Holi ---------- */
function splat(ctx, r, x, y, R, c0, c1) {   // a paint splash: an irregular blob with a highlight and flying drops
  const n = 18, pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU, rr = R * (i % 2 ? 0.62 + r() * 0.18 : 0.92 + r() * 0.28); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]); }
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (!i) ctx.moveTo(m[0], m[1]); const c = pts[(i + 1) % n], d = pts[(i + 2) % n]; ctx.quadraticCurveTo(c[0], c[1], (c[0] + d[0]) / 2, (c[1] + d[1]) / 2); }
  ctx.closePath(); ctx.save(); ctx.shadowColor = c1; ctx.shadowBlur = 28;
  ctx.fillStyle = rad(ctx, x - R * 0.25, y - R * 0.3, R * 0.1, R * 1.1, [[0, c0], [1, c1]]); ctx.fill(); ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.beginPath(); ctx.ellipse(x - R * 0.3, y - R * 0.35, R * 0.28, R * 0.14, -0.6, 0, TAU); ctx.fill();
  for (let i = 0; i < 12; i++) { const a = r() * TAU, d = R * (1.05 + r() * 0.55); ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 3 + r() * 7, 0, TAU); ctx.fill(); }
}
function holiScene(ctx, r) {
  const C = [["rgba(255,46,147,A)", "#ff2e93"], ["rgba(255,210,63,A)", "#ffd23f"], ["rgba(34,201,151,A)", "#22c997"], ["rgba(62,166,255,A)", "#3ea6ff"], ["rgba(255,122,26,A)", "#ff7a1a"], ["rgba(155,93,229,A)", "#9b5de5"]];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU + r(), d = 60 + r() * 170; glow(ctx, 800 + Math.cos(a) * d, 440 + Math.sin(a) * d * 0.85, 150 + r() * 90, C[i % C.length][0], 0.55); }   // soft clouds of powder behind
  [[930, 520, 95, "#ffb36b", "#ff6a00"], [690, 520, 96, "#8fffd6", "#0fae85"], [820, 300, 90, "#d2a8ff", "#7b3fe0"], [740, 380, 112, "#ff9fd0", "#e0157f"], [880, 360, 104, "#fff08a", "#f0b400"], [810, 500, 124, "#9fd4ff", "#1a6fe0"]]
    .forEach(([x, y, R, c0, c1]) => splat(ctx, r, x, y, R, c0, c1));
  glow(ctx, 800, 420, 140, rgba(255, 255, 255), 0.25);
  for (let i = 0; i < 70; i++) { const a = r() * TAU, d = 190 + r() * 330; ctx.fillStyle = C[i % C.length][1]; ctx.globalAlpha = 0.55 + r() * 0.4; ctx.beginPath(); ctx.arc(800 + Math.cos(a) * d, 440 + Math.sin(a) * d * 0.85, 2 + r() * 6, 0, TAU); ctx.fill(); }
  ctx.globalAlpha = 1;
  const bowl = (x, y, w, c0, c1) => {   // a bowl of gulal
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.4)"; ctx.shadowBlur = 16; ctx.shadowOffsetY = 8;
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.bezierCurveTo(x - w * 0.9, y + w * 0.75, x + w * 0.9, y + w * 0.75, x + w, y); ctx.closePath(); ctx.fillStyle = lin(ctx, x - w, y, x + w, y + w, [[0, "#e7a057"], [0.6, "#b9692c"], [1, "#7a3d15"]]); ctx.fill(); ctx.restore();
    ctx.beginPath(); ctx.moveTo(x - w * 0.95, y); ctx.bezierCurveTo(x - w * 0.55, y - w * 0.95, x + w * 0.55, y - w * 0.95, x + w * 0.95, y); ctx.quadraticCurveTo(x, y + w * 0.22, x - w * 0.95, y); ctx.fillStyle = rad(ctx, x - w * 0.2, y - w * 0.55, 4, w, [[0, c0], [1, c1]]); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x, y, w, w * 0.18, 0, 0, TAU); ctx.strokeStyle = "#f3c888"; ctx.lineWidth = 3; ctx.stroke();
  };
  bowl(640, 790, 82, "#ff6fb5", "#c4126d"); bowl(810, 800, 92, "#ffe56a", "#e0a800"); bowl(980, 785, 78, "#5be3b6", "#0d9a73"); bowl(725, 850, 48, "#6db8ff", "#1a6fd0"); bowl(905, 855, 46, "#ff9d4a", "#d65a00");
}

/* ---------- Eid-ul-Fitr and Eid-ul-Adha ---------- */
export function fanoos(ctx, x, y, s) {   // a hanging Arabic lantern; y = top of the cord
  ctx.strokeStyle = "rgba(255,225,160,.8)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + s * 0.5); ctx.stroke();
  glow(ctx, x, y + s * 1.5, s * 2.3, WARM, 0.45);
  const gold = lin(ctx, x - s * 0.5, 0, x + s * 0.5, 0, [[0, "#8a6414"], [0.5, "#f6d46c"], [1, "#8a6414"]]);
  ctx.fillStyle = gold; ctx.beginPath(); ctx.moveTo(x - s * 0.22, y + s * 0.95); ctx.quadraticCurveTo(x, y + s * 0.5, x + s * 0.22, y + s * 0.95); ctx.lineTo(x + s * 0.5, y + s * 1.1); ctx.lineTo(x - s * 0.5, y + s * 1.1); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - s * 0.5, y + s * 1.1); ctx.lineTo(x - s * 0.62, y + s * 1.9); ctx.lineTo(x - s * 0.36, y + s * 2.45); ctx.lineTo(x, y + s * 2.65); ctx.lineTo(x + s * 0.36, y + s * 2.45); ctx.lineTo(x + s * 0.62, y + s * 1.9); ctx.lineTo(x + s * 0.5, y + s * 1.1); ctx.closePath();
  ctx.fillStyle = rad(ctx, x, y + s * 1.7, 2, s, [[0, "#fff6c8"], [0.5, "#ffd26a"], [1, "#c98a1e"]]); ctx.fill(); ctx.strokeStyle = gold; ctx.lineWidth = 3; ctx.stroke();
  ctx.strokeStyle = "rgba(110,60,10,.6)"; ctx.lineWidth = 2;
  [-0.2, 0.2].forEach((k) => { ctx.beginPath(); ctx.moveTo(x + k * s, y + s * 1.1); ctx.quadraticCurveTo(x + k * s * 2.6, y + s * 1.9, x + k * s * 0.9, y + s * 2.5); ctx.stroke(); });
  ctx.beginPath(); ctx.moveTo(x - s * 0.58, y + s * 1.75); ctx.lineTo(x + s * 0.58, y + s * 1.75); ctx.stroke();
  ctx.fillStyle = gold; ctx.beginPath(); ctx.moveTo(x, y + s * 2.65); ctx.lineTo(x - 7, y + s * 2.9); ctx.lineTo(x + 7, y + s * 2.9); ctx.fill(); ctx.beginPath(); ctx.arc(x, y + s * 3.0, 5, 0, TAU); ctx.fill();
}
export function crescentMoon(ctx, x, y, R) {
  glow(ctx, x, y, R * 2.4, WARM, 0.5);
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.clip();   // the cut-out circle can't leave a sliver outside the moon
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.arc(x + R * 0.4, y - R * 0.1, R * 0.82, 0, TAU, true);
  ctx.fillStyle = lin(ctx, x - R, y - R, x + R, y + R, [[0, "#fff4b8"], [0.5, "#f1c94e"], [1, "#b8821c"]]); ctx.fill("evenodd"); ctx.restore();
  star5(ctx, x + R * 0.58, y - R * 0.1, R * 0.2, R * 0.085); ctx.fillStyle = "#ffe9a0"; ctx.fill();
}
function skyline(ctx, base, kind) {   // a mosque along the horizon: a dark silhouette for Eid, a lit one with gold edges for Eid-ul-Adha
  const adha = kind === "adha";
  ctx.lineWidth = 2.5; ctx.strokeStyle = "rgba(255,214,120,.7)"; ctx.fillStyle = adha ? lin(ctx, 0, base - 250, 0, base, [[0, "#3a5aa6"], [1, "#101f4a"]]) : "rgba(4,14,24,.88)";
  const paint = () => { ctx.fill(); if (adha) ctx.stroke(); };
  const dome = (x, w, h) => {
    ctx.beginPath(); ctx.moveTo(x - w, base); ctx.lineTo(x - w, base - h * 0.55); ctx.bezierCurveTo(x - w, base - h * 1.15, x + w, base - h * 1.15, x + w, base - h * 0.55); ctx.lineTo(x + w, base); ctx.closePath(); paint();
    ctx.strokeStyle = "#e9b84a"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, base - h * 0.98); ctx.lineTo(x, base - h * 1.3); ctx.stroke(); ctx.fillStyle = "#f6d46c"; ctx.beginPath(); ctx.arc(x, base - h * 1.33, 5, 0, TAU); ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = "rgba(255,214,120,.7)"; ctx.fillStyle = adha ? lin(ctx, 0, base - 250, 0, base, [[0, "#3a5aa6"], [1, "#101f4a"]]) : "rgba(4,14,24,.88)";
  };
  const minaret = (x, w, h) => {
    ctx.beginPath(); ctx.rect(x - w, base - h, w * 2, h); paint();
    ctx.beginPath(); ctx.moveTo(x - w * 1.5, base - h); ctx.lineTo(x, base - h - w * 4.5); ctx.lineTo(x + w * 1.5, base - h); ctx.closePath(); paint();
    ctx.beginPath(); ctx.rect(x - w * 1.9, base - h * 0.72, w * 3.8, w * 0.9); paint();
    if (adha) { ctx.fillStyle = "#f6d46c"; ctx.beginPath(); ctx.arc(x, base - h - w * 4.9, 4, 0, TAU); ctx.fill(); ctx.fillStyle = lin(ctx, 0, base - 250, 0, base, [[0, "#3a5aa6"], [1, "#101f4a"]]); }
  };
  if (adha) {
    glow(ctx, 800, base - 90, 300, WARM, 0.3);
    dome(800, 100, 165); dome(685, 44, 85); dome(915, 44, 85); minaret(570, 11, 250); minaret(1030, 11, 250);
    ctx.beginPath(); ctx.rect(560, base - 8, 500, 70); paint();
    ctx.fillStyle = "rgba(255,218,130,.95)";   // lit arched windows
    [-60, -20, 20, 60].forEach((dx) => { ctx.beginPath(); ctx.moveTo(800 + dx - 8, base); ctx.lineTo(800 + dx - 8, base - 44); ctx.arc(800 + dx, base - 44, 8, Math.PI, 0); ctx.lineTo(800 + dx + 8, base); ctx.closePath(); ctx.fill(); });
    [685, 915].forEach((x) => { ctx.beginPath(); ctx.moveTo(x - 6, base); ctx.lineTo(x - 6, base - 28); ctx.arc(x, base - 28, 6, Math.PI, 0); ctx.lineTo(x + 6, base); ctx.closePath(); ctx.fill(); });
  } else { dome(700, 60, 90); dome(820, 80, 120); dome(960, 50, 75); minaret(610, 8, 170); minaret(1040, 8, 160); minaret(890, 6, 130); ctx.fillRect(560, base, 520, 60); }
}
function eidScene(ctx, r, kind) {
  if (kind === "fitr") { crescentMoon(ctx, 840, 300, 150); fanoos(ctx, 660, 30, 42); fanoos(ctx, 980, 40, 34); fanoos(ctx, 760, 520, 22); skyline(ctx, 830, "fitr"); }
  else { crescentMoon(ctx, 930, 190, 80); fanoos(ctx, 640, 30, 40); fanoos(ctx, 770, 20, 28); fanoos(ctx, 1030, 270, 24); skyline(ctx, 830, "adha");
    for (let i = 0; i < 5; i++) twinkle(ctx, 640 + i * 90, 360 + (i % 2) * 50, 10, WARM); }
}

/* ---------- Ganesh Chaturthi ---------- */
export function lotus(ctx, x, y, R) {   // a layered lotus seen from the front; x,y = centre of the flower
  glow(ctx, x, y, R * 2, rgba(255, 190, 120), 0.35);
  const layer = (n, spread, len, wid, c0, c1, dy) => {
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? 0 : -spread + (i * 2 * spread) / (n - 1);
      ctx.save(); ctx.translate(x, y + dy); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(wid, -len * 0.25, wid * 0.7, -len * 0.85, 0, -len); ctx.bezierCurveTo(-wid * 0.7, -len * 0.85, -wid, -len * 0.25, 0, 0);
      ctx.fillStyle = lin(ctx, 0, 0, 0, -len, [[0, c0], [1, c1]]); ctx.fill(); ctx.strokeStyle = "rgba(190,60,110,.35)"; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -len * 0.08); ctx.lineTo(0, -len * 0.82); ctx.strokeStyle = "rgba(190,60,110,.22)"; ctx.stroke(); ctx.restore();
    }
  };
  layer(9, 1.38, R * 1.15, R * 0.34, "#f9b4d0", "#fff1f6", R * 0.45); layer(7, 1.05, R * 1.02, R * 0.34, "#f48fb9", "#ffe0ee", R * 0.4);
  layer(5, 0.7, R * 0.88, R * 0.32, "#ee6aa0", "#ffd0e4", R * 0.34); layer(3, 0.34, R * 0.72, R * 0.28, "#e8508c", "#ffc2dc", R * 0.28);
  ctx.fillStyle = "#f7c948"; ctx.beginPath(); ctx.arc(x, y - R * 0.3, R * 0.16, 0, TAU); ctx.fill();
}
export function modak(ctx, x, y, s) {
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 5;
  ctx.beginPath(); ctx.moveTo(x, y - s * 1.3); ctx.bezierCurveTo(x + s * 0.3, y - s * 0.9, x + s * 1.1, y - s * 0.3, x + s * 0.95, y + s * 0.3); ctx.quadraticCurveTo(x, y + s * 0.85, x - s * 0.95, y + s * 0.3); ctx.bezierCurveTo(x - s * 1.1, y - s * 0.3, x - s * 0.3, y - s * 0.9, x, y - s * 1.3);
  ctx.fillStyle = lin(ctx, x - s, y - s, x + s, y + s, [[0, "#fff0b0"], [0.6, "#f2b83a"], [1, "#b97812"]]); ctx.fill(); ctx.restore();
  ctx.strokeStyle = "rgba(140,80,10,.45)"; ctx.lineWidth = 1.8; [-0.45, -0.15, 0.15, 0.45].forEach((k) => { ctx.beginPath(); ctx.moveTo(x, y - s * 1.2); ctx.quadraticCurveTo(x + k * s * 1.6, y - s * 0.1, x + k * s * 1.15, y + s * 0.4); ctx.stroke(); });
}
function ringMandala(ctx, x, y, R, cols) {
  for (let ring = 0; ring < 4; ring++) { const n = 12 + ring * 4, rr = R * (1 - ring * 0.17);
    for (let i = 0; i < n; i++) { ctx.save(); ctx.translate(x, y); ctx.rotate((i / n) * TAU + ring * 0.13); ctx.translate(0, -rr);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(R * 0.09, R * 0.1, R * 0.07, R * 0.26, 0, R * 0.34); ctx.bezierCurveTo(-R * 0.07, R * 0.26, -R * 0.09, R * 0.1, 0, 0);
      ctx.fillStyle = cols[(i + ring) % cols.length]; ctx.globalAlpha = 0.9 - ring * 0.1; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = "rgba(255,240,200,.5)"; ctx.lineWidth = 1.4; ctx.stroke(); ctx.restore(); } }
  ctx.fillStyle = "rgba(255,225,150,.9)"; ctx.beginPath(); ctx.arc(x, y, R * 0.16, 0, TAU); ctx.fill();
}
function ganeshScene(ctx, r) {
  glow(ctx, 800, 440, 300, WARM, 0.35);
  ctx.strokeStyle = "rgba(255,215,120,.55)"; ctx.lineWidth = 3;
  [240, 215, 190].forEach((R) => { ctx.beginPath(); ctx.arc(800, 440, R, 0, TAU); ctx.stroke(); });
  for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU; ctx.beginPath(); ctx.moveTo(800 + Math.cos(a) * 246, 440 + Math.sin(a) * 246); ctx.lineTo(800 + Math.cos(a) * 270, 440 + Math.sin(a) * 270); ctx.stroke(); }
  for (let i = 0; i < 17; i++) { const t = i / 16; marigold(ctx, lerp(570, 1070, t), 200 + Math.sin(t * Math.PI) * 60 - t * 40, 22, i); }
  lotus(ctx, 800, 560, 175);
  diya(ctx, 640, 790, 62); diya(ctx, 975, 785, 64);
  [[690, 745], [745, 770], [855, 780], [915, 750]].forEach(([x, y], i) => modak(ctx, x, y, 24 + (i % 2) * 4));
}

/* ---------- Navratri / Dussehra ---------- */
function navratriScene(ctx, r) {
  glow(ctx, 800, 440, 340, WARM, 0.35);
  const stick = (x1, y1, x2, y2) => { ctx.save(); ctx.lineCap = "round"; ctx.strokeStyle = "#7a3a12"; ctx.lineWidth = 15; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.strokeStyle = lin(ctx, x1, y1, x2, y2, [[0, "#ffd36a"], [0.5, "#e8573d"], [1, "#ffd36a"]]); ctx.lineWidth = 9; ctx.stroke();
    ctx.setLineDash([6, 26]); ctx.strokeStyle = "#fff4c4"; ctx.lineWidth = 11; ctx.stroke(); ctx.restore(); };
  stick(610, 800, 1010, 250); stick(990, 800, 600, 250);   // the dandiya sticks cross behind everything
  ringMandala(ctx, 800, 430, 205, ["#ffc233", "#ff5aa5", "#7c5cff", "#2fd0a0", "#ff7a3a"]);
  for (let i = 0; i < 16; i++) { const t = i / 15; marigold(ctx, lerp(570, 1070, t), 130 + Math.sin(t * Math.PI) * 48, 20, i); }
  // the kalash, in front: a copper pot with mango leaves and a coconut
  ctx.save(); ctx.translate(800, 800); ctx.scale(0.86, 0.86); ctx.translate(-800, -800);
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 14;
  ctx.beginPath(); ctx.moveTo(760, 560); ctx.quadraticCurveTo(696, 640, 720, 742); ctx.quadraticCurveTo(800, 794, 880, 742); ctx.quadraticCurveTo(904, 640, 840, 560); ctx.closePath();
  ctx.fillStyle = lin(ctx, 700, 0, 900, 0, [[0, "#a85a1a"], [0.35, "#f6c05f"], [0.6, "#d98a2a"], [1, "#7a3a0e"]]); ctx.fill(); ctx.restore();
  ctx.strokeStyle = "rgba(255,235,170,.75)"; ctx.lineWidth = 3; [616, 668, 716].forEach((y, i) => { ctx.beginPath(); ctx.ellipse(800, y, 60 + (i === 1 ? 14 : -i * 3), 9, 0, 0, Math.PI); ctx.stroke(); });
  ctx.fillStyle = "#d62f4e"; ctx.beginPath(); ctx.moveTo(756, 560); ctx.quadraticCurveTo(800, 520, 844, 560); ctx.lineTo(852, 582); ctx.lineTo(748, 582); ctx.fill();
  for (let i = -3; i <= 3; i++) { ctx.save(); ctx.translate(800, 548); ctx.rotate(i * 0.3); ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(24, -26, 22, -70, 0, -95); ctx.bezierCurveTo(-22, -70, -24, -26, 0, 0); ctx.fillStyle = i % 2 ? "#1f9a55" : "#2fb86a"; ctx.fill(); ctx.restore(); }
  ctx.fillStyle = rad(ctx, 790, 510, 2, 36, [[0, "#d29a5a"], [1, "#6b3a14"]]); ctx.beginPath(); ctx.arc(800, 520, 34, 0, TAU); ctx.fill();
  ctx.fillStyle = "#f7c948"; ctx.beginPath(); ctx.arc(800, 484, 8, 0, TAU); ctx.fill();
  ctx.restore();
  diya(ctx, 640, 805, 62); diya(ctx, 980, 800, 64); diya(ctx, 700, 852, 38); diya(ctx, 915, 852, 38);
}

const FALL = { christmas: ["snow", 130, 900], diwali: ["sparks", 70, 900], holi: ["powder", 90, 900], "eid-ul-fitr": ["stars", 110, 760], "eid-ul-adha": ["stars", 110, 760], "ganesh-chaturthi": ["petals", 70, 900], navratri: ["petals", 60, 900] };
export const SCENES = {
  christmas: christmasScene, diwali: diwaliScene, holi: holiScene, "eid-ul-fitr": (c, r) => eidScene(c, r, "fitr"), "eid-ul-adha": (c, r) => eidScene(c, r, "adha"),
  "ganesh-chaturthi": ganeshScene, navratri: navratriScene,
};
/** Where the centrepiece sits on the page: its middle is about (800, 470). */
export const HERO_AT = { x: 800, y: 470 };
/**
 * Draws one festival: the lit backdrop, the falling particles over the whole page, then the centrepiece.
 *   bg      "own" (the festival's colours) | "maroon" (Wohlig) | "vivid" (bright, with `vivid` = { dark, mid })
 *   hero    { x, y, s }: where the middle of the centrepiece goes and how big it is (default: where it was designed, full size); null = no centrepiece
 *   between a function drawn after the backdrop and before the centrepiece (confetti, shapes)
 */
export function drawScene(ctx, slug, bg = "own", vivid = null, { hero = { x: HERO_AT.x, y: HERO_AT.y, s: 1 }, between = null } = {}) {
  paintBackdrop(ctx, slug, bg, vivid);
  if (between) between(ctx);
  const r = rng(slug.length * 97 + 3), [kind, n, y1] = FALL[slug];
  particles(ctx, rng(slug.length * 31 + 7), n, kind, y1);
  if (!hero) return;
  ctx.save(); ctx.translate(hero.x, hero.y); ctx.scale(hero.s, hero.s); ctx.translate(-HERO_AT.x, -HERO_AT.y);
  SCENES[slug](ctx, r);
  ctx.restore();
}

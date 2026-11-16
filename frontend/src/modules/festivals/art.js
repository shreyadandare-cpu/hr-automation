/* The festival artwork, drawn with canvas paths so it stays sharp at any size and needs no image files.
   Every motif is drawn around (cx, cy), about `s` units from the centre to its edge, in one of three modes:
     "rich"  filled, in the festival's colours      "line"  thin outlines in `ink`      "mono"  thicker outlines in `ink`. */

export function rng(seed) {   // a small seeded random generator, so a poster always looks the same
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const TAU = Math.PI * 2;

function style(ctx, mode, ink, fill, lw = 3) {   // fills in rich mode, strokes in line and mono
  if (mode === "rich") { ctx.fillStyle = fill; ctx.fill(); }
  else { ctx.strokeStyle = ink; ctx.lineWidth = mode === "mono" ? lw * 1.6 : lw; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke(); }
}
function star(ctx, x, y, r1, r2, n, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = rot + (i * Math.PI) / n; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  ctx.closePath();
}
function sparkle(ctx, x, y, r, color) {   // a four-point twinkle
  ctx.beginPath(); ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.quadraticCurveTo(x, y, x, y + r); ctx.quadraticCurveTo(x, y, x - r, y); ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fillStyle = color; ctx.fill();
}
function lin(ctx, x0, y0, x1, y1, a, b) { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; }
function petal(ctx, w, h) {   // a pointed petal from (0,0) up to (0,-h)
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(w, -h * 0.3, w * 0.55, -h * 0.9, 0, -h); ctx.bezierCurveTo(-w * 0.55, -h * 0.9, -w, -h * 0.3, 0, 0); ctx.closePath();
}

/* ---------- Diwali: three lit diyas, a rangoli star and sparkles ---------- */
function diwali(ctx, cx, cy, s, P, mode, ink) {
  ctx.save(); ctx.translate(cx, cy);
  if (mode === "rich") {
    const g = ctx.createRadialGradient(0, -s * 0.15, 0, 0, -s * 0.15, s * 1.15);
    g.addColorStop(0, "rgba(255,214,120,.55)"); g.addColorStop(1, "rgba(255,214,120,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -s * 0.15, s * 1.15, 0, TAU); ctx.fill();
  }
  // rangoli
  ctx.beginPath(); for (let i = 0; i < 16; i++) { const a = (i * TAU) / 16, r = i % 2 ? s * 0.78 : s * 1.02; ctx.lineTo(Math.cos(a) * r, s * 0.34 + Math.sin(a) * r * 0.42); } ctx.closePath();
  style(ctx, mode, ink, "rgba(247,196,83,.20)", 2.5);
  const diya = (x, y, w, flame) => {
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.bezierCurveTo(x - w * 0.9, y + w * 0.62, x + w * 0.9, y + w * 0.62, x + w, y); ctx.quadraticCurveTo(x, y + w * 0.16, x - w, y); ctx.closePath();
    style(ctx, mode, ink, lin(ctx, x, y, x, y + w * 0.6, "#e0701c", "#9a3412"), 3);
    ctx.beginPath(); ctx.ellipse(x, y, w, w * 0.14, 0, 0, TAU); style(ctx, mode, ink, "#f6c453", 2.5);
    if (flame) {
      ctx.beginPath(); ctx.moveTo(x, y - w * 1.05); ctx.bezierCurveTo(x + w * 0.34, y - w * 0.62, x + w * 0.26, y - w * 0.18, x, y - w * 0.1); ctx.bezierCurveTo(x - w * 0.26, y - w * 0.18, x - w * 0.34, y - w * 0.62, x, y - w * 1.05);
      style(ctx, mode, ink, lin(ctx, x, y - w, x, y - w * 0.1, "#fff3b0", "#ff9d1c"), 2.5);
      if (mode === "rich") { ctx.beginPath(); ctx.ellipse(x, y - w * 0.34, w * 0.07, w * 0.17, 0, 0, TAU); ctx.fillStyle = "#fff"; ctx.fill(); }
    }
  };
  diya(0, s * 0.18, s * 0.5, true); diya(-s * 0.78, s * 0.42, s * 0.3, true); diya(s * 0.78, s * 0.42, s * 0.3, true);
  [[-0.5, -0.78, 0.1], [0.55, -0.7, 0.13], [0.02, -1.02, 0.08], [-0.95, -0.2, 0.08], [0.98, -0.1, 0.09]].forEach(([x, y, r]) => sparkle(ctx, x * s, y * s, r * s, mode === "rich" ? "#ffe29a" : ink));
  ctx.restore();
}

/* ---------- Holi: a burst of colour ---------- */
function holi(ctx, cx, cy, s, P, mode, ink) {
  const r = rng(7), cols = P.multi;
  ctx.save(); ctx.translate(cx, cy);
  if (mode === "rich") {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + r() * 0.5, d = s * (0.3 + r() * 0.35), rad = s * (0.34 + r() * 0.26);
      ctx.globalAlpha = 0.82; ctx.fillStyle = cols[i % cols.length];
      ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, rad, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 26; i++) {
      const a = r() * TAU, d = s * (0.95 + r() * 0.45), rad = s * (0.02 + r() * 0.07);
      ctx.fillStyle = cols[i % cols.length]; ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, rad, 0, TAU); ctx.fill();
    }
  } else {
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(0, 0, s * (0.25 + i * 0.19), 0, TAU); style(ctx, mode, ink, "", 2.5 - i * 0.2); }
    for (let i = 0; i < 18; i++) { const a = r() * TAU, d = s * (1 + r() * 0.35); ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, s * (0.03 + r() * 0.05), 0, TAU); style(ctx, mode, ink, "", 2.5); }
  }
  ctx.restore();
}

/* ---------- Eid-ul-Fitr: crescent, star and a hanging lantern ---------- */
function crescent(ctx, x, y, R, mode, ink, fill) {
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.arc(x + R * 0.36, y - R * 0.08, R * 0.82, 0, TAU, true);
  ctx.save(); if (mode === "rich") { ctx.fillStyle = fill; ctx.fill("evenodd"); } else { ctx.strokeStyle = ink; ctx.lineWidth = mode === "mono" ? 5 : 3; ctx.stroke(); } ctx.restore();
}
function lantern(ctx, x, y, w, mode, ink, P) {
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = mode === "rich" ? P.gold : ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -w * 1.6); ctx.lineTo(0, -w * 0.82); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -w * 0.9, w * 0.1, 0, TAU); style(ctx, mode, ink, P.gold, 3);
  ctx.beginPath(); ctx.moveTo(-w * 0.2, -w * 0.72); ctx.quadraticCurveTo(0, -w * 0.98, w * 0.2, -w * 0.72); ctx.lineTo(w * 0.34, -w * 0.5); ctx.lineTo(-w * 0.34, -w * 0.5); ctx.closePath(); style(ctx, mode, ink, P.gold, 3);
  ctx.beginPath(); ctx.moveTo(-w * 0.34, -w * 0.5); ctx.lineTo(-w * 0.5, w * 0.1); ctx.lineTo(-w * 0.34, w * 0.62); ctx.lineTo(0, w * 0.82); ctx.lineTo(w * 0.34, w * 0.62); ctx.lineTo(w * 0.5, w * 0.1); ctx.lineTo(w * 0.34, -w * 0.5); ctx.closePath();
  style(ctx, mode, ink, lin(ctx, 0, -w * 0.5, 0, w * 0.8, "rgba(255,226,140,.95)", "rgba(224,170,60,.9)"), 3);
  ctx.strokeStyle = mode === "rich" ? "rgba(90,50,10,.55)" : ink; ctx.lineWidth = 2.2;
  [-0.17, 0.17].forEach((k) => { ctx.beginPath(); ctx.moveTo(k * w, -w * 0.5); ctx.quadraticCurveTo(k * w * 2.2, w * 0.1, k * w, w * 0.7); ctx.stroke(); });
  ctx.beginPath(); ctx.moveTo(-w * 0.46, w * 0.1); ctx.lineTo(w * 0.46, w * 0.1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, w * 0.82); ctx.lineTo(0, w * 1.02); ctx.stroke(); ctx.beginPath(); ctx.arc(0, w * 1.08, w * 0.06, 0, TAU); style(ctx, mode, ink, P.gold, 2.5);
  ctx.restore();
}
function eidFitr(ctx, cx, cy, s, P, mode, ink) {
  ctx.save(); ctx.translate(cx, cy);
  if (mode === "rich") { const g = ctx.createRadialGradient(s * 0.1, -s * 0.1, 0, s * 0.1, -s * 0.1, s * 1.1); g.addColorStop(0, "rgba(243,210,122,.35)"); g.addColorStop(1, "rgba(243,210,122,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s * 0.1, -s * 0.1, s * 1.1, 0, TAU); ctx.fill(); }
  crescent(ctx, s * 0.12, -s * 0.05, s * 0.78, mode, ink, lin(ctx, 0, -s, 0, s, "#fbe7a1", "#d9a93a"));
  star(ctx, s * 0.5, -s * 0.18, s * 0.17, s * 0.07, 5); style(ctx, mode, ink, P.gold, 2.5);
  lantern(ctx, -s * 0.82, -s * 0.2, s * 0.34, mode, ink, P);
  lantern(ctx, s * 0.88, s * 0.1, s * 0.22, mode, ink, P);
  [[-0.2, -0.95, 0.07], [0.8, -0.75, 0.06], [-0.5, 0.78, 0.06]].forEach(([x, y, r]) => sparkle(ctx, x * s, y * s, r * s, mode === "rich" ? "#f6e3a3" : ink));
  ctx.restore();
}

/* ---------- Eid-ul-Adha: a mosque against the night, with a crescent ---------- */
function eidAdha(ctx, cx, cy, s, P, mode, ink) {
  ctx.save(); ctx.translate(cx, cy);
  const fill = mode === "rich" ? lin(ctx, 0, -s * 0.2, 0, s * 0.9, "#f1d88a", "#c99a35") : "";
  crescent(ctx, -s * 0.48, -s * 0.72, s * 0.3, mode, ink, "#f3dc94");
  star(ctx, -s * 0.2, -s * 0.78, s * 0.1, s * 0.04, 5); style(ctx, mode, ink, P.gold, 2.5);
  const minaret = (x, h, w) => {
    ctx.beginPath(); ctx.moveTo(x - w, s * 0.8); ctx.lineTo(x - w * 0.8, s * 0.8 - h); ctx.lineTo(x, s * 0.8 - h - w * 1.6); ctx.lineTo(x + w * 0.8, s * 0.8 - h); ctx.lineTo(x + w, s * 0.8); ctx.closePath(); style(ctx, mode, ink, fill, 3);
    ctx.beginPath(); ctx.rect(x - w * 1.25, s * 0.8 - h * 0.7, w * 2.5, w * 0.35); style(ctx, mode, ink, fill, 2.5);
  };
  minaret(-s * 0.95, s * 1.05, s * 0.09); minaret(s * 0.95, s * 1.05, s * 0.09);
  const dome = (x, w, h, y) => { ctx.beginPath(); ctx.moveTo(x - w, y); ctx.bezierCurveTo(x - w, y - h * 1.15, x + w, y - h * 1.15, x + w, y); ctx.closePath(); style(ctx, mode, ink, fill, 3); };
  dome(0, s * 0.5, s * 0.62, s * 0.35); dome(-s * 0.58, s * 0.22, s * 0.3, s * 0.42); dome(s * 0.58, s * 0.22, s * 0.3, s * 0.42);
  ctx.strokeStyle = mode === "rich" ? P.gold : ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -s * 0.52); ctx.lineTo(0, -s * 0.78); ctx.stroke(); ctx.beginPath(); ctx.arc(0, -s * 0.82, s * 0.05, 0, TAU); style(ctx, mode, ink, P.gold, 2.5);
  ctx.beginPath(); ctx.rect(-s * 0.74, s * 0.35, s * 1.48, s * 0.45); style(ctx, mode, ink, fill, 3);
  ctx.fillStyle = mode === "rich" ? "rgba(40,24,6,.5)" : "transparent"; ctx.strokeStyle = ink; ctx.lineWidth = 2.2;
  [-0.5, -0.17, 0.17, 0.5].forEach((x) => { ctx.beginPath(); ctx.moveTo((x - 0.07) * s, s * 0.8); ctx.lineTo((x - 0.07) * s, s * 0.6); ctx.arc(x * s, s * 0.6, s * 0.07, Math.PI, 0); ctx.lineTo((x + 0.07) * s, s * 0.8); ctx.closePath(); if (mode === "rich") ctx.fill(); else ctx.stroke(); });
  [[0.3, -0.85, 0.06], [0.7, -0.6, 0.05], [-0.8, -0.35, 0.05]].forEach(([x, y, r]) => sparkle(ctx, x * s, y * s, r * s, mode === "rich" ? "#f6e3a3" : ink));
  ctx.restore();
}

/* ---------- Ganesh Chaturthi: a lotus with modaks ---------- */
function ganesh(ctx, cx, cy, s, P, mode, ink) {
  ctx.save(); ctx.translate(cx, cy);
  if (mode === "rich") {   // a halo of rays
    ctx.strokeStyle = "rgba(255,209,102,.5)"; ctx.lineWidth = 4; ctx.lineCap = "round";
    for (let i = 0; i < 28; i++) { const a = (i / 28) * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * s * 0.9, Math.sin(a) * s * 0.9 - s * 0.1); ctx.lineTo(Math.cos(a) * s * (i % 2 ? 1.08 : 1.22), Math.sin(a) * s * (i % 2 ? 1.08 : 1.22) - s * 0.1); ctx.stroke(); }
  } else { ctx.beginPath(); ctx.arc(0, -s * 0.1, s * 0.95, 0, TAU); style(ctx, mode, ink, "", 2); }
  const layer = (n, spread, w, h, c0, c1, y) => {
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? 0 : -spread + (i * 2 * spread) / (n - 1);
      ctx.save(); ctx.translate(0, y); ctx.rotate(a); petal(ctx, w, h); style(ctx, mode, ink, lin(ctx, 0, 0, 0, -h, c0, c1), 2.6); ctx.restore();
    }
  };
  layer(7, 1.25, s * 0.28, s * 0.95, "#f472b6", "#fb923c", s * 0.62);
  layer(5, 0.85, s * 0.27, s * 0.86, "#f9a8d4", "#fdba74", s * 0.62);
  layer(3, 0.42, s * 0.24, s * 0.72, "#fbcfe8", "#fde68a", s * 0.62);
  ctx.beginPath(); ctx.ellipse(0, s * 0.66, s * 0.62, s * 0.12, 0, 0, TAU); style(ctx, mode, ink, "#15803d", 2.5);
  const modak = (x, y, w) => {
    ctx.beginPath(); ctx.moveTo(x, y - w * 1.15); ctx.bezierCurveTo(x + w * 0.2, y - w * 0.8, x + w, y - w * 0.3, x + w * 0.85, y + w * 0.3); ctx.quadraticCurveTo(x, y + w * 0.75, x - w * 0.85, y + w * 0.3); ctx.bezierCurveTo(x - w, y - w * 0.3, x - w * 0.2, y - w * 0.8, x, y - w * 1.15);
    style(ctx, mode, ink, lin(ctx, x, y - w, x, y + w * 0.6, "#fde68a", "#f59e0b"), 2.5);
    ctx.strokeStyle = mode === "rich" ? "rgba(146,64,14,.45)" : ink; ctx.lineWidth = 2; [-0.4, 0, 0.4].forEach((k) => { ctx.beginPath(); ctx.moveTo(x, y - w * 1.05); ctx.quadraticCurveTo(x + k * w * 1.4, y - w * 0.1, x + k * w * 1.1, y + w * 0.4); ctx.stroke(); });
  };
  modak(-s * 0.95, s * 0.72, s * 0.2); modak(s * 0.95, s * 0.72, s * 0.2);
  ctx.restore();
}

/* ---------- Navratri / Dussehra: a mandala and crossed dandiya sticks ---------- */
function navratri(ctx, cx, cy, s, P, mode, ink) {
  const cols = ["#f59e0b", "#e11d74", "#7c3aed", "#10b981", "#ef4444"];
  ctx.save(); ctx.translate(cx, cy);
  const stick = (ang) => {
    ctx.save(); ctx.rotate(ang);
    ctx.beginPath(); ctx.roundRect(-s * 0.05, -s * 1.12, s * 0.1, s * 2.24, s * 0.05); style(ctx, mode, ink, lin(ctx, 0, -s, 0, s, "#fbbf24", "#b45309"), 3);
    [-0.7, -0.5, 0.5, 0.7].forEach((y, i) => { ctx.beginPath(); ctx.rect(-s * 0.055, y * s - s * 0.03, s * 0.11, s * 0.06); style(ctx, mode, ink, cols[(i + 1) % cols.length], 2); });
    ctx.restore();
  };
  stick(Math.PI / 4); stick(-Math.PI / 4);
  const ring = (n, r, w, h, color) => { for (let i = 0; i < n; i++) { ctx.save(); ctx.rotate((i * TAU) / n); ctx.translate(0, -r); petal(ctx, w, h); style(ctx, mode, ink, color(i), 2.2); ctx.restore(); } };
  ctx.beginPath(); ctx.arc(0, 0, s * 0.78, 0, TAU); style(ctx, mode, ink, "rgba(255,255,255,.14)", 2.5);
  ring(16, s * 0.28, s * 0.1, s * 0.52, (i) => cols[i % cols.length]);
  ring(12, s * 0.2, s * 0.12, s * 0.4, (i) => cols[(i + 2) % cols.length]);
  ring(8, s * 0.1, s * 0.1, s * 0.26, (i) => (i % 2 ? "#fde68a" : "#fff7e9"));
  ctx.beginPath(); ctx.arc(0, 0, s * 0.09, 0, TAU); style(ctx, mode, ink, "#f59e0b", 2.5);
  for (let i = 0; i < 24; i++) { const a = (i * TAU) / 24; ctx.beginPath(); ctx.arc(Math.cos(a) * s * 0.82, Math.sin(a) * s * 0.82, s * 0.028, 0, TAU); style(ctx, mode, ink, "#fde68a", 2); }
  ctx.restore();
}

/* ---------- Christmas: a decorated tree, a star and snowflakes ---------- */
function snowflake(ctx, x, y, r, color, lw) {
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = "round";
  for (let i = 0; i < 6; i++) { ctx.rotate(Math.PI / 3); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r); ctx.moveTo(0, -r * 0.55); ctx.lineTo(r * 0.22, -r * 0.8); ctx.moveTo(0, -r * 0.55); ctx.lineTo(-r * 0.22, -r * 0.8); ctx.stroke(); }
  ctx.restore();
}
function christmas(ctx, cx, cy, s, P, mode, ink) {
  ctx.save(); ctx.translate(cx, cy);
  const tier = (y, w, h) => { ctx.beginPath(); ctx.moveTo(0, y - h); ctx.quadraticCurveTo(w * 0.35, y - h * 0.35, w, y); ctx.quadraticCurveTo(0, y + h * 0.1, -w, y); ctx.quadraticCurveTo(-w * 0.35, y - h * 0.35, 0, y - h); ctx.closePath(); style(ctx, mode, ink, lin(ctx, 0, y - h, 0, y, "#1f9d62", "#0e6b3f"), 3); };
  ctx.beginPath(); ctx.rect(-s * 0.1, s * 0.7, s * 0.2, s * 0.3); style(ctx, mode, ink, "#8b5a2b", 3);
  tier(s * 0.78, s * 0.72, s * 0.62); tier(s * 0.38, s * 0.58, s * 0.56); tier(s * 0.0, s * 0.44, s * 0.5);
  star(ctx, 0, -s * 0.66, s * 0.2, s * 0.085, 5); style(ctx, mode, ink, lin(ctx, 0, -s * 0.9, 0, -s * 0.4, "#fff3b0", "#f5b82e"), 3);
  const bauble = (x, y, r, c) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); style(ctx, mode, ink, c, 2.5); if (mode === "rich") { ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.22, 0, TAU); ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.fill(); } };
  [[-0.12, -0.08, "#e11d48"], [0.22, 0.12, "#f5b82e"], [-0.34, 0.42, "#f5b82e"], [0.1, 0.5, "#e11d48"], [0.42, 0.62, "#60a5fa"], [-0.42, 0.72, "#e11d48"], [0.0, 0.72, "#f5b82e"], [0.16, -0.28, "#60a5fa"]]
    .forEach(([x, y, c]) => bauble(ctx, x * s, y * s, s * 0.07, c));
  const flake = mode === "rich" ? "rgba(255,255,255,.85)" : ink;
  [[-0.98, -0.5, 0.2], [0.98, -0.28, 0.16], [-0.86, 0.35, 0.12], [0.9, 0.5, 0.2], [0.55, -0.85, 0.11]].forEach(([x, y, r]) => snowflake(ctx, x * s, y * s, r * s, flake, mode === "mono" ? 4 : 2.6));
  ctx.restore();
}

export const MOTIFS = { diwali, holi, "eid-ul-fitr": eidFitr, "eid-ul-adha": eidAdha, "ganesh-chaturthi": ganesh, navratri, christmas };
export { star, sparkle, snowflake };

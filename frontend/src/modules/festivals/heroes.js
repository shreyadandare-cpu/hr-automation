/* The picture on the right of each festival greeting, in the style of the Holi reference: a cloud of fine coloured particles
   thrown across the page, and the festival's own things resting in the bottom right corner. Drawn with canvas (no image files).
   designs.js puts the cream page, the words and the logo around it. `mode` is "light" (cream page, colours press into it) or
   "dark" (maroon or coloured page, colours glow). */
import { rng } from "./art.js";
import { christmasScene, diya, marigold, crescentMoon, lotus, modak } from "./scenes.js";

const TAU = Math.PI * 2;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`; };
const pick = (cols, t) => { const x = Math.min(0.999, Math.max(0, t)) * (cols.length - 1), i = Math.floor(x); return mix(cols[i], cols[i + 1], x - i); };

/* each festival's colours, from the plume's root to its tip */
/* the festival name is filled from the first to the last colour here (the pale plume colours would fade on cream) */
export const HEAD = { christmas: ["#1f7a4a", "#b3262b"] };
export const PALETTE = {
  holi: ["#ffc21a", "#ff7a1a", "#e5258a", "#7b2ff7"],
  diwali: ["#ffe08a", "#ffb52e", "#ff7a1a", "#d9381e"],
  "eid-ul-fitr": ["#f1e2a0", "#58d3b0", "#0f8a6d", "#0a5a63"],
  "eid-ul-adha": ["#f1e2a0", "#6fc7e8", "#2f6fc0", "#0b7a75"],
  "ganesh-chaturthi": ["#ffe08a", "#ffb52e", "#f2661a", "#d6246e"],
  navratri: ["#ffd24d", "#ff9a1a", "#d6246e", "#8a3ff0"],
  christmas: ["#f6dd9a", "#e9a23b", "#d8403a", "#1f7a4a"],
};

/** A thrown cloud: thousands of fine dots that thicken near the root and scatter toward the tip, over a few soft masses of colour. */
function plume(ctx, r, cols, mode, o) {
  const { x, y, dx, dy, len, spread, dots } = o, nx = -dy, ny = dx, light = mode === "light";
  ctx.save(); ctx.globalCompositeOperation = light ? "multiply" : "lighter";
  for (let i = 0; i < 44; i++) {   // soft masses
    const t = Math.pow(r(), 1.4), w = spread * (0.25 + t * 0.9), off = (r() - 0.5) * w, px = x + dx * t * len + nx * off, py = y + dy * t * len + ny * off, R = 50 + r() * 110 * (1 - t * 0.5);
    const g = ctx.createRadialGradient(px, py, 0, px, py, R), c = pick(cols, t * 0.9 + r() * 0.15);
    g.addColorStop(0, c.replace("rgb", "rgba").replace(")", `,${light ? 0.62 : 0.17})`)); g.addColorStop(1, c.replace("rgb", "rgba").replace(")", ",0)"));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, R, 0, TAU); ctx.fill();
  }
  for (let i = 0; i < dots; i++) {   // fine particles
    const t = Math.pow(r(), 1.7), w = spread * (0.12 + t * 1.05), off = (r() + r() + r() - 1.5) * w * 0.9, px = x + dx * t * len + nx * off, py = y + dy * t * len + ny * off;
    const s = 0.7 + Math.pow(r(), 3) * (3.4 - t * 1.6);
    ctx.globalAlpha = (light ? 0.35 : 0.2) + r() * (light ? 0.5 : 0.4); ctx.fillStyle = pick(cols, t + (r() - 0.5) * 0.25);
    ctx.beginPath(); ctx.arc(px, py, s, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/** A heap of fine powder in a bowl (Holi), seen from the side. */
function bowl(ctx, r, x, y, w, color) {
  ctx.save(); ctx.shadowColor = "rgba(60,30,10,.35)"; ctx.shadowBlur = 22; ctx.shadowOffsetY = 12;
  ctx.beginPath(); ctx.moveTo(x - w, y); ctx.bezierCurveTo(x - w * 0.92, y + w * 0.62, x + w * 0.92, y + w * 0.62, x + w, y); ctx.closePath();
  const g = ctx.createLinearGradient(x - w, y, x + w, y + w * 0.6); g.addColorStop(0, "#e2b15e"); g.addColorStop(0.45, "#a9772a"); g.addColorStop(1, "#6b4514"); ctx.fillStyle = g; ctx.fill(); ctx.restore();
  ctx.strokeStyle = "rgba(255,230,160,.75)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, y, w, w * 0.16, 0, 0, TAU); ctx.stroke();
  heap(ctx, r, x, y, w * 0.92, w * 0.62, color);
}
function heap(ctx, r, x, y, w, h, color) {   // a mound built from grains, lit from the upper left
  ctx.save(); ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x - w * 0.5, y - h * 1.15, x, y - h); ctx.quadraticCurveTo(x + w * 0.5, y - h * 1.15, x + w, y); ctx.quadraticCurveTo(x, y + h * 0.16, x - w, y); ctx.closePath(); ctx.clip();
  ctx.fillStyle = color; ctx.fillRect(x - w, y - h * 1.2, w * 2, h * 1.5);
  for (let i = 0; i < 1400; i++) {
    const px = x + (r() * 2 - 1) * w, py = y - r() * h * 1.1, side = (px - x) / w - (py - (y - h * 0.5)) / h * 0.35;
    ctx.fillStyle = side < -0.1 ? "rgba(255,255,255,.28)" : side > 0.35 ? "rgba(0,0,0,.2)" : "rgba(255,255,255,.07)"; ctx.fillRect(px, py, 1.6 + r() * 1.6, 1.6 + r() * 1.6);
  }
  ctx.restore();
  for (let i = 0; i < 70; i++) { ctx.fillStyle = color; ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.arc(x + (r() * 2 - 1) * w * 1.3, y + r() * 24, 1 + r() * 3, 0, TAU); ctx.fill(); }
  ctx.globalAlpha = 1;
}

/* ---------- what rests in the corner, per festival ---------- */
const PROPS = {
  holi: (ctx, r) => { bowl(ctx, r, 1010, 905, 82, "#6e2cc9"); bowl(ctx, r, 905, 940, 96, "#f3b400"); bowl(ctx, r, 770, 985, 112, "#d6196b"); },
  diwali: (ctx, r) => {
    for (let i = 0; i < 16; i++) marigold(ctx, 640 + r() * 470, 935 + r() * 60, 11 + r() * 8, r() * 6);
    diya(ctx, 960, 930, 74); diya(ctx, 800, 960, 56); diya(ctx, 1040, 985, 44); diya(ctx, 690, 985, 38);
  },
  "eid-ul-fitr": (ctx) => { crescentMoon(ctx, 935, 215, 88); },
  "eid-ul-adha": (ctx) => { crescentMoon(ctx, 935, 215, 88); },
  "ganesh-chaturthi": (ctx, r) => { lotus(ctx, 880, 880, 150); [[690, 960], [775, 985], [995, 985], [1050, 950]].forEach(([x, y], i) => modak(ctx, x, y, 26 + (i % 2) * 4)); for (let i = 0; i < 14; i++) marigold(ctx, 600 + r() * 480, 1000 + r() * 20, 14 + r() * 6, r() * 6); },
  navratri: (ctx, r) => {
    const stick = (x, y, a, c) => { ctx.save(); ctx.translate(x, y); ctx.rotate(a); const g = ctx.createLinearGradient(-8, 0, 8, 0); g.addColorStop(0, "#e8a14a"); g.addColorStop(0.5, "#fbd58a"); g.addColorStop(1, "#a8661f"); ctx.fillStyle = g; ctx.fillRect(-7, -190, 14, 380);
      for (let i = -6; i <= 6; i++) { ctx.fillStyle = i % 2 ? c : "#fff4c8"; ctx.fillRect(-7, i * 24 - 5, 14, 9); } ctx.restore(); };
    stick(880, 870, -0.42, "#d6246e"); stick(960, 880, 0.38, "#7a35d6");
    for (let i = 0; i < 12; i++) marigold(ctx, 700 + r() * 380, 990 + r() * 20, 12 + r() * 6, r() * 6);
  },
  christmas: (ctx, r) => { ctx.save(); ctx.translate(940, 1036); ctx.scale(0.52, 0.52); ctx.translate(-800, -800); christmasScene(ctx, r); ctx.restore(); },   // the tree with its star, lights, baubles and gifts, set in the corner
};

/** Draws the picture. box = { x, y, s } places the plume's root; s scales the whole picture (1 = full page). */
export function drawHero(ctx, slug, mode = "light", { s = 1, props = true, alpha = 1 } = {}) {
  const r = rng(slug.length * 131 + 11), cols = PALETTE[slug];
  ctx.save(); ctx.globalAlpha = alpha;
  const sc = (v) => v * s, root = { x: 1120 - (1 - s) * 260, y: 540 - (1 - s) * 140 };
  plume(ctx, r, cols, mode, { x: root.x, y: root.y, dx: -0.9, dy: -0.43, len: sc(800), spread: sc(330), dots: Math.round(11000 * s) });
  plume(ctx, r, cols, mode, { x: root.x, y: root.y + sc(80), dx: -0.5, dy: 0.75, len: sc(380), spread: sc(220), dots: Math.round(2600 * s) });
  ctx.restore();
  if (props) { ctx.save(); ctx.globalAlpha = alpha; PROPS[slug](ctx, rng(slug.length * 17 + 3)); ctx.restore(); }
}

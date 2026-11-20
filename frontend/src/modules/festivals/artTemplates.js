/* Greetings made from the supplied pictures (./art). The picture is the template: its colours come in four versions, and its words are
   cleared and written again from what the person types, in the same place and style. Where a picture has no words of its own
   (a text-free version), leave `erase` empty and the words are simply written on it.
   Each entry: file name, the part of the picture to use (a square, in fractions of the file), the areas holding the picture's own words
   (x, y, w, h in fractions of the square) and how the words are laid out (fractions of the square). */
const FILES = import.meta.glob("./art/*.{png,jpg,jpeg,webp}", { eager: true, query: "?url", import: "default" });
const SIZE = 1080, TAU = Math.PI * 2;
const GOLD = ["#fbe39a", "#e9b94b", "#c8922a"], SERIF = (s, italic, w = 400) => `${italic ? "italic " : ""}${w} ${s}px "Playfair Display", Georgia, serif`;
const SANS = (s, bold) => `${bold ? 700 : 400} ${s}px "Lato", "Helvetica Neue", Arial, sans-serif`, SCRIPT = (s) => `600 ${s}px "Dancing Script", cursive`;

/* the four colour versions: a turn of the colour wheel and a little more or less colour */
const V = (name, hue, sat = 1, light = 1) => ({ id: name.toLowerCase().replace(/\W+/g, "-"), name, hue, sat, light });

const COMMON = { x: 0.085, msg: { size: 0.036, color: "#ffffff", w: 0.5 }, head: { color: "#ffffff" }, wish: { size: 0.034, color: "#ffffff", w: 0.5 }, rule: GOLD[1] };
export const ART = {
  christmas: { logoKind: "dark", file: "christmas", ...COMMON, erase: [[0.02, 0.17, 0.65, 0.76, "light"], [0.62, 0.5, 0.13, 0.15, "light"]], msgY: 0.205, headY: 0.43, headSize: 0.11, emphY: 0.585, emphSize: 0.125, ruleY: 0.635, wishY: 0.69,
    versions: [V("Ruby red", 0), V("Emerald green", 135), V("Royal blue", 225), V("Amber", 38, 1.1)] },
  "eid-ul-fitr": { logoKind: "dark", file: "eid", ...COMMON, erase: [[0.02, 0.19, 0.55, 0.66, "light"]], msgY: 0.23, headY: 0.515, headSize: 0.12, emphY: 0.64, emphSize: 0.13, ruleY: 0.69, wishY: 0.75,
    versions: [V("Teal", 0), V("Royal blue", 38), V("Forest green", -45), V("Violet", 105)] },
  holi: { logoKind: "light", file: "holi", x: 0.07, msg: { size: 0.036, color: "#26224a", w: 0.5 }, head: { color: "#26224a" }, wish: { size: 0.03, color: "#26224a", w: 0.5 }, rule: "#c026d3", erase: [[0.02, 0.19, 0.55, 0.62, "fill"], [0.02, 0.82, 0.48, 0.15, "fill"]],
    msgY: 0.235, headY: 0.49, headSize: 0.095, emphY: 0.69, emphSize: 0.21, emphScript: true, emphGrad: ["#9333ea", "#ec4899", "#f97316"], ruleY: 0, wishY: 0.85,
    versions: [V("Pink", 0), V("Blue", 200), V("Green", 110), V("Rose", 330, 1.1)] },
  muharram: { logoKind: "dark", file: "muharram", ...COMMON, erase: [[0.02, 0.19, 0.56, 0.72, "light"], [0.55, 0.5, 0.25, 0.2, "light"], [0.5, 0.74, 0.1, 0.12, "light"]], msgY: 0.24, headY: 0.525, headSize: 0.11, emphY: 0.66, emphSize: 0.125, ruleY: 0.71, wishY: 0.77,
    versions: [V("Navy blue", 0), V("Teal", -50), V("Violet", 60), V("Maroon", 150)] },
  "ganesh-chaturthi": { logoKind: "light", file: "ganesh-chaturthi", x: 0.08, msg: { size: 0.036, color: "#4a2b22", w: 0.48 }, head: { color: "#7a1530" }, wish: { size: 0.034, color: "#4a2b22", w: 0.48 }, rule: "#7a1530",
    erase: [[0.02, 0.19, 0.53, 0.53, "fill"], [0.02, 0.73, 0.53, 0.21, "fill"]], msgY: 0.23, headY: 0.44, headSize: 0.075, emphY: 0.58, emphSize: 0.115, emphColor: "#7a1530", emph2: true, ruleY: 0.74, wishY: 0.82,
    versions: [V("Saffron", 0), V("Rose pink", 330), V("Green", 80), V("Sky blue", 170)] },
  navratri: { logoKind: "dark", file: "navratri", ...COMMON, erase: [[0.02, 0.19, 0.56, 0.7, "light"]], msgY: 0.24, headY: 0.525, headSize: 0.09, emphY: 0.65, emphSize: 0.125, ruleY: 0.7, wishY: 0.77,
    versions: [V("Plum", 0), V("Amber", 70), V("Green", 130), V("Indigo", -50)] },
  diwali: { logoKind: "dark", file: "diwali", crop: [0.195, 0, 0.667, 1], x: 0.07, msg: { size: 0.036, color: "#ffffff", w: 0.5 }, head: { color: "#ffffff" }, wish: { size: 0.032, color: "#ffffff", w: 0.5 }, rule: GOLD[1], logo: true, sign: true,
    erase: [[0, 0.03, 0.3, 0.15, "light"], [0, 0.17, 0.6, 0.45, "light"], [0, 0.62, 0.4, 0.37, "light"]], msgY: 0.215, headY: 0.475, headSize: 0.085, emphY: 0.62, emphSize: 0.115, ruleY: 0.385, wishY: 0.80,
    versions: [V("Purple", 0), V("Green", 52), V("Teal", 150), V("Crimson", -50)] },
};
export const artFor = (slug) => (ART[slug] && Object.entries(FILES).some(([p]) => p.includes(`/${ART[slug].file}.`)) ? ART[slug] : null);
const fileUrl = (a) => Object.entries(FILES).find(([p]) => p.includes(`/${a.file}.`))[1];
const loadImg = (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("The picture could not be read.")); i.src = src; });

/* Removes the picture's own words, and only the letters: inside each area, anything lighter (or darker) than the picture around it, thinner
   than the letters are thick, is found, grown a little and painted with the surrounding colours. Bokeh, glow and gradients stay as they are. */
function sliding(src, w, h, r, pick, horizontal) {   // the lightest or darkest value within r, along rows or columns
  const out = new Float32Array(src.length), n = horizontal ? w : h, m = horizontal ? h : w;
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
    let v = pick === "min" ? 1e9 : -1e9; const lo = Math.max(0, i - r), hi = Math.min(n - 1, i + r);
    for (let k = lo; k <= hi; k++) { const q = src[horizontal ? j * w + k : k * w + j]; v = pick === "min" ? (q < v ? q : v) : (q > v ? q : v); }
    out[horizontal ? j * w + i : i * w + j] = v;
  }
  return out;
}
function boxBlur(src, w, h, r) {
  const t = new Float32Array(src.length), o = new Float32Array(src.length);
  for (let y = 0; y < h; y++) { let s = 0, c = 0; for (let x = -r; x < w; x++) { const add = x + r, rem = x - r - 1; if (add < w) { s += src[y * w + add]; c++; } if (rem >= 0) { s -= src[y * w + rem]; c--; } if (x >= 0) t[y * w + x] = s / c; } }
  for (let x = 0; x < w; x++) { let s = 0, c = 0; for (let y = -r; y < h; y++) { const add = y + r, rem = y - r - 1; if (add < h) { s += t[add * w + x]; c++; } if (rem >= 0) { s -= t[rem * w + x]; c--; } if (y >= 0) o[y * w + x] = s / c; } }
  return o;
}
/* A plain background (cream, peach): the area is repainted from the four edges around it. */
function fillPatch(d, x0, y0, w, h) {
  const at = (x, y) => (Math.min(SIZE - 1, Math.max(0, y)) * SIZE + Math.min(SIZE - 1, Math.max(0, x))) * 4;
  const avg = (pts) => { const s = [0, 0, 0]; pts.forEach((p) => { for (let c = 0; c < 3; c++) s[c] += d[p + c]; }); return s.map((v) => v / pts.length); };
  const T = [], B = [], Lf = [], Rt = [], sm = (arr) => arr.map((_, i) => { const s = [0, 0, 0]; let n = 0; for (let j = -10; j <= 10; j++) { const v = arr[i + j]; if (v) { n++; for (let c = 0; c < 3; c++) s[c] += v[c]; } } return s.map((v) => v / n); });
  for (let x = 0; x < w; x++) { T.push(avg([...Array(8).keys()].map((k) => at(x0 + x, y0 - 3 - k)))); B.push(avg([...Array(8).keys()].map((k) => at(x0 + x, y0 + h + 2 + k)))); }
  for (let y = 0; y < h; y++) { Lf.push(avg([...Array(8).keys()].map((k) => at(x0 - 3 - k, y0 + y)))); Rt.push(avg([...Array(8).keys()].map((k) => at(x0 + w + 2 + k, y0 + y)))); }
  const t = sm(T), b = sm(B), l = sm(Lf), r = sm(Rt);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / (w - 1), v = y / (h - 1), p = at(x0 + x, y0 + y), n = (Math.random() - 0.5) * 3;
    for (let c = 0; c < 3; c++) {
      const hor = l[y][c] * (1 - u) + r[y][c] * u, ver = t[x][c] * (1 - v) + b[x][c] * v, cor = t[0][c] * (1 - u) * (1 - v) + t[w - 1][c] * u * (1 - v) + b[0][c] * (1 - u) * v + b[w - 1][c] * u * v;
      d[p + c] = hor + ver - cor + n;
    }
  }
}
function clear(ctx, rects) {
  const img = ctx.getImageData(0, 0, SIZE, SIZE), d = img.data;
  for (const [fx, fy, fw, fh, mode, rad] of rects) {
    if (mode === "fill") { fillPatch(d, Math.round(fx * SIZE), Math.round(fy * SIZE), Math.round(fw * SIZE), Math.round(fh * SIZE)); continue; }
    const R = rad || 13;
    const x0 = Math.round(fx * SIZE), y0 = Math.round(fy * SIZE), w = Math.round(fw * SIZE), h = Math.round(fh * SIZE), pick = mode === "dark" ? "max" : "min";
    const ch = [0, 1, 2].map((c) => { const a = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = d[((y0 + y) * SIZE + x0 + x) * 4 + c]; return a; });
    const back = pick === "min" ? "max" : "min";
    const bg = ch.map((a) => boxBlur(sliding(sliding(sliding(sliding(a, w, h, R, pick, true), w, h, R, pick, false), w, h, R, back, true), w, h, R, back, false), w, h, 4));   // an opening: the picture without thin strokes, at its own brightness
    let mask = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) { let m = 0; for (let c = 0; c < 3; c++) { const diff = mode === "dark" ? bg[c][i] - ch[c][i] : ch[c][i] - bg[c][i]; if (diff > m) m = diff; } mask[i] = m > 16 ? 1 : 0; }
    mask = boxBlur(sliding(sliding(mask, w, h, 5, "max", true), w, h, 5, "max", false), w, h, 3);   // grow it a little and soften the edge
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, a = Math.min(1, mask[i] * 1.6), p = ((y0 + y) * SIZE + x0 + x) * 4;
      if (a > 0.02) for (let c = 0; c < 3; c++) d[p + c] = d[p + c] * (1 - a) + bg[c][i] * a;
    }
  }
  ctx.putImageData(img, 0, 0);
}
/** Turns the colours of the picture round the colour wheel. */
function tint(ctx, hue, sat, light) {
  if (!hue && sat === 1 && light === 1) return;
  const img = ctx.getImageData(0, 0, SIZE, SIZE), d = img.data, a = (hue * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const m = [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283, 0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072];
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * m[0] + d[i + 1] * m[1] + d[i + 2] * m[2], g = d[i] * m[3] + d[i + 1] * m[4] + d[i + 2] * m[5], b = d[i] * m[6] + d[i + 1] * m[7] + d[i + 2] * m[8];
    const y = 0.299 * r + 0.587 * g + 0.114 * b; r = (y + (r - y) * sat) * light; g = (y + (g - y) * sat) * light; b = (y + (b - y) * sat) * light;
    d[i] = r < 0 ? 0 : r > 255 ? 255 : r; d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g; d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
  ctx.putImageData(img, 0, 0);
}
function wrap(ctx, text, maxW) {
  const out = []; let cur = "";
  for (const w of String(text).split(/\s+/).filter(Boolean)) { const t = cur ? `${cur} ${w}` : w; if (cur && ctx.measureText(t).width > maxW) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur); return out;
}

/** The picture with the chosen colours and the person's words on it. o: { slug, version (id), heading, emphasis, message, wish, sender, recipient, photo, logos, scale } */
export async function renderArt(o) {
  const A = ART[o.slug], ver = A.versions.find((v) => v.id === o.version) || A.versions[0], scale = o.scale || 1;
  if (document.fonts) await Promise.all([SERIF(60), SERIF(60, true), SERIF(60, false, 700), SANS(40, true), SANS(40, false), SCRIPT(60)].map((f) => document.fonts.load(f, "Aa").catch(() => {})));
  const img = await loadImg(fileUrl(A));
  const work = document.createElement("canvas"); work.width = work.height = SIZE; const w = work.getContext("2d");
  const [cx, cy, cw, ch] = A.crop || [0, 0, 1, 1];
  w.drawImage(img, cx * img.naturalWidth, cy * img.naturalHeight, cw * img.naturalWidth, ch * img.naturalHeight, 0, 0, SIZE, SIZE);
  const logoArea = A.logoKind === "dark" && A.logo ? null : [0.03, 0.035, 0.31, 0.13, "fill"];   // the picture's own logo is replaced by the official file
  if (A.erase && A.erase.length) clear(w, [...(logoArea && o.logos ? [logoArea] : []), ...A.erase]); else if (logoArea && o.logos) clear(w, [logoArea]);
  tint(w, ver.hue, ver.sat, ver.light);
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = Math.round(SIZE * scale);
  const ctx = canvas.getContext("2d"); ctx.scale(scale, scale); ctx.drawImage(work, 0, 0); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";

  const X = A.x * SIZE, px = (f) => f * SIZE, hasPhoto = !!o.photo;
  const lg = o.logos && (A.logoKind === "light" ? o.logos.light : o.logos.dark);
  if (lg) ctx.drawImage(lg, 70, 58, 230, 230 * lg.height / lg.width);
  let my = px(A.msgY);
  const dear = String(o.recipient || "").trim();
  if (dear) { ctx.fillStyle = A.msg.color; ctx.font = SERIF(px(0.034), true); ctx.fillText(`Dear ${dear},`, X, my - px(0.05)); }
  let ms = px(A.msg.size), ml; for (; ms > px(0.022); ms -= 1) { ctx.font = SANS(ms); ml = wrap(ctx, o.message || "", px(A.msg.w)); if (ml.length <= 3) break; }
  ctx.fillStyle = A.msg.color; ml.slice(0, 3).forEach((t, i) => ctx.fillText(t, X, my + i * ms * 1.4));
  const gold = (x0, x1) => { const g = ctx.createLinearGradient(x0, 0, x1, 0); GOLD.forEach((c, i) => g.addColorStop(i / 2, c)); return g; };
  if (o.heading) { ctx.fillStyle = A.head.color; ctx.font = SERIF(px(A.headSize)); ctx.fillText(o.heading, X, px(A.headY)); }
  if (o.emphasis) {
    const size = px(A.emphSize); ctx.font = A.emphScript ? SCRIPT(size * 1.1) : A.emph2 ? SERIF(size, false, 700) : SERIF(size, true); const wd = ctx.measureText(o.emphasis).width, avail = px(0.6) - X;
    const k = wd > avail ? avail / wd : 1; if (k < 1) ctx.font = ctx.font.replace(/[\d.]+px/, `${(A.emphScript ? size * 1.1 : size) * k}px`);
    if (A.emphGrad) { const g = ctx.createLinearGradient(X, 0, X + wd * k, 0); A.emphGrad.forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c)); ctx.fillStyle = g; } else ctx.fillStyle = A.emphColor || gold(X, X + wd * k);
    ctx.fillText(o.emphasis, X, px(A.emphY));
  }
  if (A.ruleY) { ctx.fillStyle = A.rule; ctx.fillRect(X, px(A.ruleY), px(0.28), 2.5); }
  ctx.fillStyle = A.wish.color; ctx.font = SANS(px(A.wish.size)); const wl = wrap(ctx, o.wish || "", px(A.wish.w)); wl.slice(0, 3).forEach((t, i) => ctx.fillText(t, X, px(A.wishY) + i * px(A.wish.size) * 1.4));
  const from = String(o.sender || "").trim();
  if (from && (A.sign || from !== "Team Wohlig")) {
    const fy = px(A.sign ? 0.945 : 0.93), sx = X + (hasPhoto ? px(0.12) : 0); ctx.fillStyle = "#f7781d"; ctx.fillRect(X, fy - px(0.05), 4, px(0.065));
    ctx.fillStyle = A.msg.color; ctx.font = SANS(px(0.026)); ctx.fillText("With warm wishes,", sx + 18, fy - px(0.016)); ctx.fillStyle = A.sign ? GOLD[1] : A.head.color; ctx.font = SANS(px(0.034), true); ctx.fillText(from, sx + 18, fy + px(0.02));
  }
  if (hasPhoto) {
    const r = px(0.075), pcx = X + r + 4, pcy = px(0.9);
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 18; ctx.fillStyle = "#f7781d"; ctx.beginPath(); ctx.arc(pcx, pcy, r + 5, 0, TAU); ctx.fill(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(pcx, pcy, r, 0, TAU); ctx.clip();
    const sc = Math.max((r * 2) / o.photo.width, (r * 2) / o.photo.height), sw = (r * 2) / sc, sh = (r * 2) / sc;
    ctx.drawImage(o.photo, (o.photo.width - sw) / 2, (o.photo.height - sh) * 0.22, sw, sh, pcx - r, pcy - r, r * 2, r * 2); ctx.restore();
  }
  return canvas;
}

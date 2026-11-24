/* The birthday poster, "Wohlig birthday": a portrait card on soft grey with maroon curves in two corners, thin line drawings of leaves, the Wohlig logo, a serif headline,
   a framed (polaroid) photo with a strip of tape, the first name in script under it and the wish at the bottom. It is drawn in the proportions of the supplied design
   (1149 x 1624) and scaled down, so the preview is exactly the PNG that is emailed. */
export const BIRTHDAY_W = 1080, BIRTHDAY_H = 1527;
const REF_W = 1149, REF_H = 1624, K = BIRTHDAY_W / REF_W;
const MAROON = "#800d35", INK = "#1d1b2e", GREY = "#dcdcdc", LEAF = "#b7a18c", TAN = "#e0b78c";
const SERIF = (s) => `400 ${s}px "Playfair Display", "Source Serif 4", Georgia, serif`;
const SCRIPT = (s) => `600 ${s}px "Dancing Script", "Brush Script MT", cursive`;

export async function ensureBirthdayFonts() {
  if (!document.fonts) return;
  await Promise.all([SERIF(60), SCRIPT(60)].map((f) => document.fonts.load(f, "Aa").catch(() => {})));
}

/* One outlined leaf from (x, y), pointing at `ang`, `L` long and `w` wide, with its centre vein. */
function leaf(ctx, x, y, ang, L, w) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(L * 0.25, -w, L * 0.7, -w * 0.8, L, 0); ctx.bezierCurveTo(L * 0.7, w * 0.8, L * 0.25, w, 0, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L * 0.9, 0); ctx.stroke();
  ctx.restore();
}
/* A stem (a curve from p0 to p1 bent towards c) with leaves on alternate sides and one at the tip. */
function sprig(ctx, p0, p1, c, n, L, w) {
  const at = (t) => [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]];
  const dir = (t) => { const dx = 2 * (1 - t) * (c[0] - p0[0]) + 2 * t * (p1[0] - c[0]), dy = 2 * (1 - t) * (c[1] - p0[1]) + 2 * t * (p1[1] - c[1]); return Math.atan2(dy, dx); };
  ctx.beginPath(); ctx.moveTo(...p0); ctx.quadraticCurveTo(...c, ...p1); ctx.stroke();
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1), [x, y] = at(t), a = dir(t), s = i % 2 ? 1 : -1, size = L * (1.1 - t * 0.35);
    leaf(ctx, x, y, a + s * 0.85, size, w);
  }
  const [x, y] = at(1); leaf(ctx, x, y, dir(1), L * 0.8, w);
}

/** o: { name, message, photo, logos: { dark, light } } -> canvas */
export async function renderBirthday(o) {
  await ensureBirthdayFonts();
  const canvas = document.createElement("canvas");
  canvas.width = BIRTHDAY_W; canvas.height = BIRTHDAY_H;
  const ctx = canvas.getContext("2d");
  ctx.scale(K, K);
  const W = REF_W, H = REF_H;
  ctx.fillStyle = GREY; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";

  // maroon curves in the top-left and bottom-right corners, each with a thin dark line running beside it
  ctx.fillStyle = MAROON;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(455, 0); ctx.bezierCurveTo(470, 50, 390, 75, 300, 92); ctx.bezierCurveTo(190, 112, 70, 105, 60, 175); ctx.bezierCurveTo(52, 240, 45, 280, 0, 312); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(W, 1338); ctx.bezierCurveTo(1110, 1352, 1085, 1420, 1068, 1498); ctx.bezierCurveTo(1050, 1575, 900, 1560, 760, 1624); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 3.2; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(372, 0); ctx.bezierCurveTo(250, 48, 70, 70, 96, 205); ctx.bezierCurveTo(118, 300, 20, 360, 0, 420); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 520); ctx.bezierCurveTo(24, 540, 18, 575, 0, 598); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W, 1082); ctx.bezierCurveTo(1078, 1096, 1118, 1190, 1088, 1296); ctx.bezierCurveTo(1062, 1392, 1105, 1488, 960, 1552); ctx.bezierCurveTo(880, 1585, 820, 1590, 790, 1624); ctx.stroke();

  // leaf line drawings: top-right and bottom-left
  ctx.strokeStyle = LEAF; ctx.lineWidth = 4;
  sprig(ctx, [W, 30], [1010, 150], [1085, 40], 5, 98, 30);
  sprig(ctx, [W, 205], [1000, 265], [1080, 215], 4, 90, 28);
  sprig(ctx, [1135, 250], [1092, 425], [1150, 340], 4, 84, 26);
  sprig(ctx, [0, 1490], [170, 1592], [75, 1500], 5, 92, 28);
  sprig(ctx, [0, 1330], [58, 1445], [40, 1370], 3, 78, 24);
  sprig(ctx, [60, 1624], [215, 1485], [190, 1590], 4, 88, 26);

  // dots
  ctx.fillStyle = TAN;
  for (const [x, y, r] of [[160, 548, 11], [140, 588, 11], [195, 600, 12], [122, 630, 9], [187, 652, 7], [94, 652, 9], [145, 690, 7], [108, 690, 5], [196, 700, 7], [196, 727, 7],
    [962, 1004, 7], [957, 1031, 7], [1006, 1049, 7], [1042, 1055, 6], [958, 1079, 7], [1050, 1095, 8], [1019, 1112, 9], [943, 1129, 11], [994, 1150, 12], [966, 1186, 11]]) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // the logo and the headline
  const logo = o.logos && (o.logos.light || o.logos.dark);
  if (logo) { const w = 218; ctx.drawImage(logo, W / 2 - w / 2, 80, w, (w * logo.height) / logo.width); }
  ctx.fillStyle = INK; ctx.textAlign = "center";
  let hs = 128; while (hs > 70 && (ctx.font = SERIF(hs), ctx.measureText("Happy Birthday").width > 880)) hs -= 4;
  ctx.font = SERIF(hs); ctx.fillText("Happy Birthday", W / 2, 272);

  // the framed photo with a strip of tape
  ctx.save(); ctx.shadowColor = "rgba(40,30,30,.22)"; ctx.shadowBlur = 26; ctx.shadowOffsetY = 9;
  ctx.fillStyle = "#f7f6f2"; ctx.fillRect(250, 356, 640, 914); ctx.restore();
  const px = 262, py = 366, pw = 618, ph = 710;
  ctx.save(); ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
  if (o.photo) {
    const p = o.photo, s = Math.max(pw / p.width, ph / p.height), sw = pw / s, sh = ph / s;
    ctx.drawImage(p, (p.width - sw) / 2, (p.height - sh) * 0.2, sw, sh, px, py, pw, ph);   // fills the frame, keeping the top (the face)
  } else {
    ctx.fillStyle = "#ece4e6"; ctx.fillRect(px, py, pw, ph);
    const ini = String(o.name || "").trim().split(/\s+/).slice(0, 2).map((x) => x[0] || "").join("").toUpperCase();
    ctx.fillStyle = MAROON; ctx.font = SERIF(260); ctx.fillText(ini, px + pw / 2, py + ph / 2 + 90);
  }
  ctx.restore();
  // tape
  ctx.save(); ctx.translate(835, 432); ctx.rotate(0.56);
  ctx.beginPath(); ctx.rect(-148, -34, 296, 68); ctx.clip();
  ctx.fillStyle = "#cfa878"; ctx.fillRect(-148, -34, 296, 68);
  ctx.strokeStyle = "rgba(246,214,176,.9)"; ctx.lineWidth = 7;
  for (let x = -160; x <= 160; x += 24) { ctx.beginPath(); ctx.moveTo(x, -40); ctx.lineTo(x, 40); ctx.stroke(); }
  for (let y = -34; y <= 40; y += 22) { ctx.beginPath(); ctx.moveTo(-150, y); ctx.lineTo(150, y); ctx.stroke(); }
  ctx.restore();
  // a tulip sprig over the corner of the frame
  ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = "#b08560"; ctx.fillStyle = "#e1b48a"; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(296, 1160); ctx.bezierCurveTo(290, 1060, 270, 980, 262, 900); ctx.stroke();
  for (const [x, y, a, s] of [[222, 862, -0.25, 1], [296, 838, 0.2, 1.05], [262, 905, 0.02, 0.9]]) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(s, s);
    ctx.beginPath(); ctx.moveTo(-26, 0); ctx.bezierCurveTo(-34, -46, -20, -80, 0, -92); ctx.bezierCurveTo(20, -80, 34, -46, 26, 0); ctx.bezierCurveTo(14, 26, -14, 26, -26, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -92); ctx.lineTo(0, 12); ctx.moveTo(-12, -80); ctx.bezierCurveTo(-14, -40, -8, -12, -4, 12); ctx.moveTo(12, -80); ctx.bezierCurveTo(14, -40, 8, -12, 4, 12); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // the first name, in script, with an exclamation mark
  const first = String(o.name || "").trim().split(/\s+/)[0] || "";
  ctx.fillStyle = INK; ctx.textAlign = "center";
  let ns = 150; while (ns > 60 && (ctx.font = SCRIPT(ns), ctx.measureText(`${first}!`).width > 520)) ns -= 4;
  ctx.font = SCRIPT(ns); ctx.fillText(`${first}!`, 572, 1196);

  // the wish
  const text = String(o.message || "").trim();
  let ms = 42, lines = [];
  for (; ms >= 26; ms -= 2) {
    ctx.font = SERIF(ms); lines = [];
    let cur = "";
    for (const w of text.split(/\s+/).filter(Boolean)) { const t = cur ? `${cur} ${w}` : w; if (cur && ctx.measureText(t).width > 790) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    if (lines.length <= 2) break;
  }
  ctx.font = SERIF(ms);
  lines.forEach((ln, i) => ctx.fillText(ln, W / 2, 1362 + i * ms * 1.3));
  return canvas;
}

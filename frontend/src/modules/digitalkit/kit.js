import { BRAND } from "../../brand.js";
/* Digital Kit helpers: placeholders, and the brand designs drawn on a canvas from the person's own details.
   Colours and layout follow the Wohlig brand guidelines: warm ivory and deep maroon, sunset orange as the accent, the shipped logo files only. */
export const C = { maroon: "#800d35", maroonDeep: "#5c0926", orange: "#f7781d", orangeDeep: "#d9630f", terracotta: "#c85f44", beige: "#ead9c2", ivory: "#fff7e9", ink: "#2e1a1f", inkDim: "#6b5654" };
export const LOGO_LIGHT = BRAND.logos.light;   // maroon lettering, for ivory and white
export const LOGO_DARK = BRAND.logos.dark;   // ivory lettering, for maroon and dark backgrounds
export const EMAIL_LOGO = "https://wohlig.com/assets/brand/wohlig-logo.png";
export const ICON_PROD = "https://hr.wohlig.com/sig";   // the signature icons on the live site
export const BADGE_URL = "https://wohlig.com/assets/clients/google-cloud-premier-partner.png";   // the same badge, hosted on the public site, so it loads in every mail program   // an address mail programs can fetch from anywhere
export const SITE = "wohlig.com";

/* ---------- text ---------- */
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/** Puts the person's details into {{name}}, {{title}}, {{email}}, {{phone}}. {{phone_line}} is a new line with the phone, or nothing. */
export const fill = (text, p) => String(text || "")
  .replace(/\{\{name\}\}/g, p.name).replace(/\{\{title\}\}/g, p.title || "[your designation]").replace(/\{\{email\}\}/g, p.email)
  .replace(/\{\{phone_line\}\}/g, p.phone ? `\n${p.phone}` : "").replace(/\{\{phone\}\}/g, p.phone || "[your phone]");
export const fileSafe = (s) => String(s || "wohlig").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "wohlig";
export const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/* ---------- files ---------- */
export function saveBlob(blob, name) {
  const a = document.createElement("a"), url = URL.createObjectURL(blob);
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const saveText = (text, name, type = "text/plain;charset=utf-8") => saveBlob(new Blob([text], { type }), name);
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  const t = document.createElement("textarea");
  t.value = text; t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch { ok = false; }
  t.remove(); return ok;
}
/** Copies formatted HTML (what an email signature box needs), with the plain text as a fallback. */
export async function copyHtml(html, plain) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([plain], { type: "text/plain" }) })]);
    return true;
  } catch { return copyText(plain); }
}

/* ---------- drawing ---------- */
export async function loadFonts() {
  try {
    await Promise.all(['300 40px "Source Serif 4"', '400 40px "Source Serif 4"', '600 40px "Source Serif 4"', 'italic 400 40px "Source Serif 4"', "400 20px Lato", "700 20px Lato"].map((f) => document.fonts.load(f)));
  } catch { /* the page still draws with the fallback fonts */ }
}
const imgs = new Map();
export function loadImage(src) {
  if (!imgs.has(src)) imgs.set(src, new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`Could not load ${src}`)); i.src = src; }));
  return imgs.get(src);
}
export const newCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
export const toBlob = (canvas, type = "image/png", q = 0.92) => new Promise((res) => canvas.toBlob(res, type, q));
const SERIF = '"Source Serif 4", Georgia, serif', SANS = 'Lato, "Helvetica Neue", Arial, sans-serif';
const fit = (ctx, text, maxW, size, weight, family, min = 10) => {   // the largest size at which the text fits one line
  let s = size; do { ctx.font = `${weight} ${s}px ${family}`; if (ctx.measureText(text).width <= maxW || s <= min) break; s -= 2; } while (true); return s;
};
function wrap(ctx, text, maxW) {
  const out = []; let cur = "";
  for (const w of String(text).split(/\s+/)) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur); return out;
}
/** Draws the logo at a height, keeping its shape. Returns the width used. */
function logo(ctx, img, x, y, h) { const w = h * (img.naturalWidth / img.naturalHeight || 2.715); ctx.drawImage(img, x, y, w, h); return w; }
function arcs(ctx, w, h, color, alpha = 0.5) {   // the brand's soft concentric arcs, kept at the edges
  ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = Math.max(2, w / 600);
  for (const [cx, cy, r] of [[w * 0.98, h * 0.05, h * 0.62], [w * 0.98, h * 0.05, h * 0.9], [w * 0.98, h * 0.05, h * 1.2]]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}
const lines = (p) => [p.email, p.phone, p.location].filter(Boolean);

/** Business card, 3.5 x 2 inches at 300 dpi. Front: ivory with the maroon logo. Back: deep maroon with the ivory logo. */
export async function drawCard(p, side) {
  const [W, H] = [1050, 600], c = newCanvas(W, H), x = c.getContext("2d");
  await loadFonts();
  if (side === "back") {
    const g = await loadImage(LOGO_DARK);
    x.fillStyle = C.maroon; x.fillRect(0, 0, W, H); arcs(x, W, H, C.ivory, 0.12);
    const lw = 520, lh = lw / (g.naturalWidth / g.naturalHeight || 2.715);
    x.drawImage(g, (W - lw) / 2, (H - lh) / 2 - 20, lw, lh);
    x.fillStyle = C.orange; x.fillRect(W / 2 - 40, H / 2 + lh / 2 + 18, 80, 5);
    x.fillStyle = C.beige; x.font = `700 26px ${SANS}`; x.textAlign = "center"; x.fillText(SITE, W / 2, H - 70); x.textAlign = "left";
    return c;
  }
  const g = await loadImage(LOGO_LIGHT);
  x.fillStyle = C.ivory; x.fillRect(0, 0, W, H); arcs(x, W, H, C.beige, 0.7);
  logo(x, g, 70, 62, 70);
  x.fillStyle = C.maroon; const ns = fit(x, p.name, W - 140, 62, 600, SERIF, 36); x.font = `600 ${ns}px ${SERIF}`; x.fillText(p.name, 70, 290);
  if (p.title) { x.fillStyle = C.terracotta; const ts = fit(x, p.title.toUpperCase(), W - 140, 26, 700, SANS, 16); x.font = `700 ${ts}px ${SANS}`; x.letterSpacing = "3px"; x.fillText(p.title.toUpperCase(), 70, 338); x.letterSpacing = "0px"; }
  x.fillStyle = C.orange; x.fillRect(70, 372, 90, 5);
  x.fillStyle = C.ink; x.font = `400 27px ${SANS}`;
  [...lines(p), SITE].forEach((t, i) => x.fillText(t, 70, 430 + i * 40));
  return c;
}

/** A 1920 x 1080 background for a video call: the logo top left, a faint flower on the right, and your name low on the left. The middle stays clear for you. */
export async function drawBackground({ theme = "light", name = "", title = "", showName = true } = {}) {
  const [W, H] = [1920, 1080], c = newCanvas(W, H), x = c.getContext("2d");
  await loadFonts();
  const dark = theme === "maroon", g = await loadImage(dark ? LOGO_DARK : LOGO_LIGHT);
  const bg = x.createLinearGradient(0, 0, W, H);
  if (dark) { bg.addColorStop(0, "#6e0a2d"); bg.addColorStop(1, C.maroonDeep); } else { bg.addColorStop(0, "#fff7e9"); bg.addColorStop(0.55, "#fbe9d6"); bg.addColorStop(1, "#f6d3b8"); }
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W * 0.98, H * 0.92, 20, W * 0.98, H * 0.92, 760);
  glow.addColorStop(0, dark ? "rgba(247,120,29,.18)" : "rgba(247,140,90,.28)"); glow.addColorStop(1, "rgba(247,120,29,0)");
  x.fillStyle = glow; x.fillRect(0, 0, W, H);
  const line = dark ? C.ivory : C.terracotta;
  x.save(); x.strokeStyle = line; x.lineWidth = 2; x.globalAlpha = dark ? 0.08 : 0.12;   // two soft arches, low on the left
  for (const r of [430, 580]) { x.beginPath(); x.arc(250, H, r, Math.PI, 0); x.stroke(); }
  x.restore();
  x.save(); x.beginPath(); x.rect(0, 0, W, H); x.clip();
  flower(x, 1690, 455, 430, 0.12, line, dark ? 0.2 : 0.32, 2.4);
  flower(x, 1690, 455, 300, 0.12 + Math.PI / 8, line, dark ? 0.12 : 0.18, 1.8);
  x.restore();
  const lh = 100; logo(x, g, 100, 86, lh);
  if (showName && name) {
    x.fillStyle = C.orange; x.fillRect(100, 748, 66, 5);
    x.fillStyle = dark ? C.ivory : C.maroon; const size = fit(x, name, 980, 96, 600, SERIF, 48); x.font = `600 ${size}px ${SERIF}`; x.fillText(name, 100, 868);
    let y = 925;
    if (title) { x.fillStyle = dark ? C.orange : C.terracotta; x.font = `700 28px ${SANS}`; x.letterSpacing = "4px"; x.fillText(title.toUpperCase(), 100, y); x.letterSpacing = "0px"; y += 56; }
    x.fillStyle = dark ? C.beige : C.inkDim; x.font = `400 30px ${SANS}`; x.fillText("Wohlig · Google Cloud Premier Partner", 100, y);
  }
  return c;
}

/** The LinkedIn profile banner, 1584 x 396: a flower motif on the left, the headline and your name on the right, the logo and badge below.
    LinkedIn lays the profile photo over the lower left, so nothing is drawn there; the dashed circle ("guide") shows where, in the preview only. */
export const BANNER_THEMES = [["light", "Warm light"], ["maroon", "Maroon"]];
export const BANNER_PRESETS = [
  { label: "Feels wohlig", h: "Enterprise tech that feels", e: "wohlig." },
  { label: "Ship, not slideware", h: "AI agents that ship, not", e: "slideware." },
  { label: "Meaningful change", h: "AI agents that make", e: "meaningful change." },
];
function flower(x, cx, cy, R, rot, color, alpha, lw) {   // eight petals, outlines only: the brand's flower motif, kept faint
  x.save(); x.strokeStyle = color; x.globalAlpha = alpha; x.lineWidth = lw; x.lineJoin = "round";
  for (let i = 0; i < 8; i++) {
    const a = rot + (i * Math.PI) / 4, ux = Math.cos(a), uy = Math.sin(a), px = -uy, py = ux, w = R * 0.34;
    x.beginPath(); x.moveTo(cx, cy);
    x.quadraticCurveTo(cx + ux * R * 0.55 + px * w, cy + uy * R * 0.55 + py * w, cx + ux * R, cy + uy * R);
    x.quadraticCurveTo(cx + ux * R * 0.55 - px * w, cy + uy * R * 0.55 - py * w, cx, cy); x.stroke();
  }
  x.restore();
}
export async function drawBanner({ theme = "light", headline = "", emphasis = "", name = "", guide = false } = {}) {
  const [W, H] = [1584, 396], c = newCanvas(W, H), x = c.getContext("2d");
  await loadFonts();
  const dark = theme === "maroon";
  const [logoImg, badge] = await Promise.all([loadImage(dark ? LOGO_DARK : LOGO_LIGHT), loadImage("/wohlig-premier-partner-badge.png")]);
  // the ground: warm ivory fading to peach, or deep maroon
  const g = x.createLinearGradient(0, 0, W, H * 0.6);
  if (dark) { g.addColorStop(0, "#6e0a2d"); g.addColorStop(1, C.maroonDeep); } else { g.addColorStop(0, "#fff7e9"); g.addColorStop(0.55, "#fbe9d6"); g.addColorStop(1, "#f7d6bb"); }
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W * 0.92, H * 0.2, 10, W * 0.92, H * 0.2, 520);
  glow.addColorStop(0, dark ? "rgba(247,120,29,.16)" : "rgba(247,150,80,.20)"); glow.addColorStop(1, "rgba(247,120,29,0)");
  x.fillStyle = glow; x.fillRect(0, 0, W, H);
  // the flower motif, once, as a watermark
  x.save(); x.beginPath(); x.rect(0, 0, W, H); x.clip();
  const line = dark ? C.ivory : C.terracotta;
  flower(x, 171, 64, 430, 0.18, line, dark ? 0.2 : 0.42, 2.2);
  flower(x, 171, 64, 300, 0.18 + Math.PI / 8, line, dark ? 0.12 : 0.22, 1.6);
  x.restore();

  // the words
  const X = 480, maxW = W - X - 70, ink = dark ? C.ivory : C.maroon;
  x.fillStyle = C.orange; x.fillRect(X, 85, 44, 4);
  x.fillStyle = dark ? C.beige : C.maroon; x.font = `800 17px ${SANS}`; x.letterSpacing = "4px"; x.fillText("WOHLIG  ·  GOOGLE CLOUD PREMIER PARTNER", X + 66, 95); x.letterSpacing = "0px";
  const h = String(headline || "").trim(), em = String(emphasis || "").trim();
  let size = 68; const gap = h && em ? 16 : 0;
  const measure = (sz) => { x.font = `600 ${sz}px ${SERIF}`; const a = x.measureText(h).width; x.font = `italic 400 ${sz}px ${SERIF}`; return a + gap + x.measureText(em).width; };
  while (size > 30 && measure(size) > maxW) size -= 2;
  x.font = `600 ${size}px ${SERIF}`; x.fillStyle = ink; x.fillText(h, X, 170);
  const hw = x.measureText(h).width;
  x.font = `italic 400 ${size}px ${SERIF}`; x.fillStyle = dark ? C.orange : "rgba(128,13,53,.78)"; x.fillText(em, X + hw + gap, 170);
  x.fillStyle = dark ? C.beige : C.inkDim; x.font = `400 23px ${SANS}`; x.fillText(`AI agents  ·  Agentic workflows  ·  Gemini Enterprise  ·  ${SITE}`, X, 226);
  // logo and badge
  const lh = 62, lw = lh * (logoImg.naturalWidth / logoImg.naturalHeight || 2.715);
  x.drawImage(logoImg, X, 296, lw, lh);
  x.fillStyle = dark ? "rgba(255,247,233,.35)" : "rgba(128,13,53,.18)"; x.fillRect(X + lw + 20, 302, 2, 50);
  const bh = 58, bw = bh * (badge.naturalWidth / badge.naturalHeight || 1); x.drawImage(badge, X + lw + 40, 297, bw, bh);

  if (guide) {   // where LinkedIn puts the profile photo (a guide for the preview only)
    x.save(); x.setLineDash([9, 8]); x.strokeStyle = dark ? "rgba(255,247,233,.7)" : "rgba(128,13,53,.55)"; x.lineWidth = 2.6;
    x.beginPath(); x.arc(198, 396, 150, 0, Math.PI * 2); x.stroke(); x.setLineDash([]);
    x.fillStyle = dark ? C.ivory : C.maroon; x.font = `700 26px ${SANS}`; x.textAlign = "center"; x.fillText("Your photo", 198, 290); x.textAlign = "left"; x.restore();
  }
  return c;
}

/* Welcome & celebrations: a square LinkedIn card and a ready caption for the moments worth sharing. */
export const CELEBRATIONS = {
  welcome: { label: "Welcome aboard", eyebrow: "WELCOME TO THE TEAM", h: "Welcome to", e: "Wohlig,", tags: ["#Wohlig", "#NewBeginnings", "#WelcomeAboard", "#GoogleCloud"],
    caption: "I'm excited to share that I've joined Wohlig as [your role]!\n\nWohlig is a Google Cloud Premier Partner that builds AI agents and agentic workflows, and I'm looking forward to [what you'll be working on].\n\nThank you to everyone who has made me feel welcome already. Excited for what comes next." },
  anniversary: { label: "Work anniversary", eyebrow: "WORK ANNIVERSARY", h: "Another year of", e: "wohlig.", tags: ["#WorkAnniversary", "#Wohlig", "#Gratitude", "#Teamwork"],
    caption: "Today marks [number] year(s) at Wohlig!\n\nLooking back, I'm grateful for [a project or lesson that mattered] and for the people I get to build with.\n\nHere's to what we ship next." },
  certified: { label: "Newly certified", eyebrow: "NEWLY CERTIFIED", h: "Certified and", e: "ready.", tags: ["#Certified", "#GoogleCloud", "#Learning", "#Wohlig"],
    caption: "I'm happy to share that I've earned the [certification name] certification!\n\nThank you to my team at Wohlig for the support along the way. I'm excited to put it to work on [what it helps you do]." },
  role: { label: "New role", eyebrow: "NEW ROLE", h: "A new chapter at", e: "Wohlig.", tags: ["#NewRole", "#Wohlig", "#CareerGrowth", "#Teamwork"],
    caption: "I'm excited to share that I've taken on a new role as [your new role] at Wohlig!\n\nThank you to [the people who helped] for the trust and support. Looking forward to [what's next]." },
};
/** "a Software Developer Engineer", "an HR Manager": the person's own designation with the right article. Empty when there is no designation. */
export function roleWithArticle(title) {
  const t = String(title || "").trim();
  if (!t) return "";
  return `${/^(?:[aeiou]|hr\b|sde\b|ai\b|ml\b|ui\b|ux\b|it\b)/i.test(t) ? "an" : "a"} ${t}`;
}
/** The caption for an occasion with the person's own role filled in. Anything still unknown stays in [brackets] for them to complete. */
export function captionFor(kind, p) {
  const role = roleWithArticle(p && p.title);
  return (CELEBRATIONS[kind] || CELEBRATIONS.welcome).caption.replace("[your role]", role || "[your role]").replace("[your new role]", role || "[your new role]");
}
export async function drawCelebrate({ occasion = "welcome", theme = "maroon", headline = "", emphasis = "", name = "", title = "", photoUrl = "" } = {}) {
  const O = CELEBRATIONS[occasion] || CELEBRATIONS.welcome, [W, H] = [1080, 1080], c = newCanvas(W, H), x = c.getContext("2d");
  await loadFonts();
  const dark = theme !== "light";
  const [logoImg, badge] = await Promise.all([loadImage(dark ? LOGO_DARK : LOGO_LIGHT), loadImage("/wohlig-premier-partner-badge.png")]);
  const g = x.createLinearGradient(0, 0, W * 0.55, H);
  if (dark) { g.addColorStop(0, "#7d1535"); g.addColorStop(1, "#4e0820"); } else { g.addColorStop(0, "#fff7e9"); g.addColorStop(0.6, "#fbe9d6"); g.addColorStop(1, "#f7d6bb"); }
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.save(); x.beginPath(); x.rect(0, 0, W, H); x.clip();
  const line = dark ? C.ivory : C.terracotta;
  flower(x, W * 0.93, H * 0.1, 470, 0.2, line, dark ? 0.2 : 0.4, 2.4);
  flower(x, W * 0.93, H * 0.1, 330, 0.2 + Math.PI / 8, line, dark ? 0.12 : 0.22, 1.8);
  x.restore();
  const L = 98, ink = dark ? C.ivory : C.maroon;
  // the eyebrow
  x.fillStyle = C.orange; x.fillRect(L, 138, 60, 4);
  x.fillStyle = dark ? C.beige : C.maroon; x.font = `800 22px ${SANS}`; x.letterSpacing = "5px"; x.fillText(O.eyebrow, L + 86, 150); x.letterSpacing = "0px";
  // the headline, on two lines: the words, then the emphasis in italic
  const h = String(headline || "").trim() || O.h, em = String(emphasis || "").trim() || O.e, maxW = photoUrl ? 520 : 860;
  let size = 150;
  const widest = (sz) => { x.font = `600 ${sz}px ${SERIF}`; const a = x.measureText(h).width; x.font = `italic 400 ${sz}px ${SERIF}`; return Math.max(a, x.measureText(em).width); };
  while (size > 56 && widest(size) > maxW) size -= 2;
  x.font = `600 ${size}px ${SERIF}`; x.fillStyle = ink; x.fillText(h, L, 440);
  x.font = `italic 400 ${size}px ${SERIF}`; x.fillStyle = dark ? "#f4a06c" : "rgba(128,13,53,.8)"; x.fillText(em, L, 440 + size * 1.04);
  // the person
  const ny = 440 + size * 1.04 + 130;
  x.fillStyle = ink; const ns = fit(x, String(name || "").slice(0, 60), maxW, 50, 700, SANS, 28); x.font = `700 ${ns}px ${SANS}`; x.fillText(String(name || "").slice(0, 60), L, ny);
  if (title) { x.fillStyle = dark ? C.beige : C.inkDim; const ts = fit(x, title, maxW, 28, 400, SANS, 16); x.font = `400 ${ts}px ${SANS}`; x.fillText(title, L, ny + 46); }
  // the photo, if one was added: it is drawn only into the download and never leaves the device
  if (photoUrl) {
    const cx = W - 262, cy = 640, r = 168;
    x.save(); x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.closePath(); x.clip();
    try { const im = await loadImage(photoUrl), s = Math.min(im.naturalWidth, im.naturalHeight); x.drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, cx - r, cy - r, r * 2, r * 2); } catch { x.fillStyle = C.beige; x.fillRect(cx - r, cy - r, r * 2, r * 2); }
    x.restore(); x.strokeStyle = dark ? "rgba(255,247,233,.85)" : C.maroon; x.lineWidth = 6; x.beginPath(); x.arc(cx, cy, r + 8, 0, Math.PI * 2); x.stroke();
  }
  // the footer: a rule, the logo and the partner badge
  x.fillStyle = dark ? "rgba(255,247,233,.28)" : "rgba(128,13,53,.22)"; x.fillRect(L, 918, W - L * 2, 2);
  const lh = 74; logo(x, logoImg, L, 954, lh);
  x.fillStyle = C.ivory; x.beginPath(); x.arc(W - L - 52, 992, 54, 0, Math.PI * 2); x.fill();
  const bh = 86, bw = bh * (badge.naturalWidth / badge.naturalHeight || 1); x.drawImage(badge, W - L - 52 - bw / 2, 992 - bh / 2, bw, bh);
  return c;
}

/** The employee badge, 600 x 900. Uses the profile photo when there is one. */
export async function drawBadge(p, photoUrl) {
  const [W, H] = [600, 900], c = newCanvas(W, H), x = c.getContext("2d");
  await loadFonts();
  const g = await loadImage(LOGO_DARK);
  x.fillStyle = C.ivory; x.fillRect(0, 0, W, H);
  x.fillStyle = C.maroon; x.fillRect(0, 0, W, 250); arcs(x, W, 250, C.ivory, 0.12);
  const lw = 300, lh = lw / (g.naturalWidth / g.naturalHeight || 2.715); x.drawImage(g, (W - lw) / 2, 70, lw, lh);
  x.fillStyle = C.orange; x.fillRect(0, 250, W, 8);
  const cx = W / 2, cy = 400, r = 110;
  x.save(); x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.closePath(); x.clip();
  let drew = false;
  if (photoUrl) { try { const im = await loadImage(photoUrl), s = Math.min(im.naturalWidth, im.naturalHeight); x.drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, cx - r, cy - r, r * 2, r * 2); drew = true; } catch { drew = false; } }
  if (!drew) { x.fillStyle = C.beige; x.fillRect(cx - r, cy - r, r * 2, r * 2); x.fillStyle = C.maroon; x.font = `600 80px ${SERIF}`; x.textAlign = "center"; x.fillText(p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase(), cx, cy + 28); x.textAlign = "left"; }
  x.restore(); x.strokeStyle = C.beige; x.lineWidth = 8; x.beginPath(); x.arc(cx, cy, r + 4, 0, Math.PI * 2); x.stroke();
  x.textAlign = "center"; x.fillStyle = C.maroon;
  const ns = fit(x, p.name, W - 80, 52, 600, SERIF, 30); x.font = `600 ${ns}px ${SERIF}`; x.fillText(p.name, cx, 590);
  if (p.title) { x.fillStyle = C.terracotta; const ts = fit(x, p.title.toUpperCase(), W - 80, 24, 700, SANS, 14); x.font = `700 ${ts}px ${SANS}`; x.letterSpacing = "3px"; x.fillText(p.title.toUpperCase(), cx, 640); x.letterSpacing = "0px"; }
  x.fillStyle = C.ink; x.font = `400 26px ${SANS}`;
  if (p.empNo) x.fillText(p.empNo, cx, 720);
  x.fillStyle = C.inkDim; x.font = `400 22px ${SANS}`; x.fillText(p.email, cx, 764);
  x.fillStyle = C.maroon; x.fillRect(0, H - 70, W, 70); x.fillStyle = C.beige; x.font = `700 20px ${SANS}`; x.letterSpacing = "3px"; x.fillText("WOHLIG TRANSFORMATIONS", cx, H - 28); x.letterSpacing = "0px";
  x.textAlign = "left"; return c;
}

/** Company letterhead, A4 at 150 dpi. The page is left empty for writing. */
export async function drawLetterhead() {
  const [W, H] = [1240, 1754], c = newCanvas(W, H), x = c.getContext("2d");
  await loadFonts();
  const g = await loadImage(LOGO_LIGHT);
  x.fillStyle = "#ffffff"; x.fillRect(0, 0, W, H);
  logo(x, g, 90, 80, 78);
  x.fillStyle = C.orange; x.fillRect(90, 80 + 78 + 30, W - 180, 5);
  x.fillStyle = C.inkDim; x.font = `400 21px ${SANS}`; x.fillText("Wohlig Transformations Private Limited", 90, H - 96); x.textAlign = "right"; x.fillText(SITE, W - 90, H - 96); x.textAlign = "left";
  x.fillStyle = C.beige; x.fillRect(90, H - 130, W - 180, 2);
  return c;
}

/* ---------- LinkedIn text ---------- */
export function headlines(p) {
  const t = p.title || "Wohlig";
  const out = [
    ...(p.linkedinHeadline ? [{ text: p.linkedinHeadline, tag: "Set by HR" }] : []),
    { text: p.title ? `${t} at Wohlig | AI agents, agentic workflows, Google Cloud` : "Wohlig | AI agents, agentic workflows, Google Cloud" },
    { text: p.title ? `${t} | Making AI agents, automation and data simply work | Wohlig` : "Making AI agents, automation and data simply work | Wohlig" },
    { text: p.title ? `${t} at Wohlig, Google Cloud Premier Partner` : "Wohlig, Google Cloud Premier Partner" },
  ];
  return out.map((h) => ({ ...h, text: h.text.slice(0, 220) }));
}
export function hashtags(p) {
  const t = String(p.title || "").toLowerCase(), base = ["#Wohlig", "#GoogleCloud", "#AIAgents", "#AgenticWorkflows", "#GenerativeAI"];
  const more = [];
  if (/develop|engineer|software|devops|architect|tech/.test(t)) more.push("#SoftwareEngineering", "#CloudEngineering");
  if (/data|analyt|ml|ai\b|genai/.test(t)) more.push("#DataAnalytics", "#DataEngineering");
  if (/sales|business|growth|partner/.test(t)) more.push("#Partnerships", "#B2B");
  if (/hr|people|talent|recruit/.test(t)) more.push("#PeopleOps", "#Hiring");
  if (/design|ux|creative|content|market/.test(t)) more.push("#Design", "#Marketing");
  if (/lead|head|director|manager/.test(t)) more.push("#Leadership");
  if (/intern|trainee/.test(t)) more.push("#Internship", "#Learning");
  return [...new Set([...base, ...more])].slice(0, 10);
}
export function aboutText(p) {
  return `${p.title ? `I'm a ${p.title} at Wohlig.` : "I work at Wohlig."} Wohlig is the Google Cloud Premier Partner that India's boldest enterprises call when AI agents, automation and data need to simply work, minus the drama, the jargon and the heavy lifting.

[One or two sentences about what you work on and what you enjoy about it.]

[One sentence about what you would like to talk about with people who reach out.]

Say hello at ${p.email}.`;
}

/* ---------- email signature ---------- */
export const CASE_STUDIES_URL = "https://insights.wohlig.com/t/casestudy";
export const OFFICES = "Mumbai · Bangalore · London";
export const COMPANY = "Wohlig Transformations Pvt. Ltd.";
export const PARTNER_LINE = "Google Cloud Premier Partner · AI agents, agentic workflows & Gemini Enterprise";
export const CONFIDENTIALITY = "This email and any attachments are confidential and meant only for the person it is addressed to. If it reached you by mistake, please tell the sender and delete it.";
/** Only web links are kept (never javascript: or anything else). Adds https:// when it is missing. Returns "" when it is not usable. */
export function webLink(v, host) {
  const t = String(v || "").trim(); if (!t) return "";
  try { const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`); if (!/^https?:$/.test(u.protocol)) return ""; if (host && !host.test(u.hostname)) return ""; return u.href; } catch { return ""; }
}
export const SIG_STYLES = [["classic", "Classic"], ["executive", "Executive"], ["compact", "Compact — replies"]];
export const SIG_DEFAULT_OPTS = { style: "classic", badge: true, cases: true, offices: true, conf: false };

/** s: { name, title, email, phone, linkedin, booking } as typed in the form. o: the style and which optional parts to show. Everything typed is escaped.
    Classic: logo beside the details. Executive: logo on top, a larger name. Compact: text only, for replies (no picture, so no badge). */
export function signatureHtml(s, o = SIG_DEFAULT_OPTS, forPreview = false, iconsLive = true) {
  const style = o.style || "classic";
  const link = (href, text, extra = "") => `<a href="${esc(href)}" style="color:#800d35;text-decoration:none;${extra}">${esc(text)}</a>`;
  const li = webLink(s.linkedin, /(^|\.)linkedin\.com$/i), bk = webLink(s.booking);
  const font = "font-family:Lato,Arial,Helvetica,sans-serif;color:#2e1a1f;font-size:14px;line-height:1.4";
  const serif = "font-family:Georgia,'Times New Roman',serif;font-weight:bold;color:#800d35";
  const sep = '<span style="color:#c4a99f"> &nbsp;|&nbsp; </span>';
  const links = [o.cases ? link(CASE_STUDIES_URL, "Case studies", "font-weight:bold") : "", bk ? link(bk, "Book a meeting", "font-weight:bold") : "", li ? link(li, "LinkedIn", "font-weight:bold") : ""].filter(Boolean).join(sep);
  const tel = s.phone ? `<a href="tel:${esc(s.phone.replace(/[^+\d]/g, ""))}" style="color:#2e1a1f;text-decoration:none">${esc(s.phone)}</a>` : "";
  const mail = link(`mailto:${s.email}`, s.email, "color:#2e1a1f");
  const web = link("https://wohlig.com", "wohlig.com", "font-weight:bold");
  const row = (k, html) => `<tr><td style="width:26px;padding:2px 8px 2px 0;font-size:12px;font-weight:bold;color:#7a645f;vertical-align:top">${k}</td><td style="padding:2px 0;font-size:14px;color:#2e1a1f">${html}</td></tr>`;
  const rows = [row("E", mail), s.phone ? row("M", tel) : "", row("W", web), o.offices ? row("A", esc(OFFICES)) : ""].join("");
  const logoImg = (w) => `<a href="https://${SITE}"><img src="${EMAIL_LOGO}" width="${w}" alt="Wohlig" style="display:block;border:0;width:${w}px;height:auto"></a>`;
  const foot = o.badge && style !== "compact" ? `<table cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;border-top:1px solid #ead9c2;width:100%"><tr><td style="padding-top:10px;width:34px;vertical-align:middle"><img src="${BADGE_URL}" width="28" alt="Google Cloud Premier Partner" style="display:block;border:0;width:28px;height:auto"></td><td style="padding-top:10px;padding-left:8px;font-size:12px;color:#6b5654;vertical-align:middle">${esc(PARTNER_LINE)}</td></tr></table>` : "";
  const conf = o.conf ? `<div style="margin-top:12px;font-size:11px;line-height:1.4;color:#7a645f;max-width:520px">${esc(CONFIDENTIALITY)}</div>` : "";
  const wrapT = (inner, w) => `<table cellpadding="0" cellspacing="0" border="0"${w ? ` width="${w}"` : ""} style="${font}${w ? `;width:${w}px;max-width:100%` : ""}">${inner}</table>`;

  if (style === "compact") {
    const line1 = `<span style="${serif};font-size:16px">${esc(s.name)}</span><span style="color:#6b5654"> &nbsp;|&nbsp; ${s.title ? `${esc(s.title)}, ` : ""}Wohlig</span>`;
    const line2 = [mail, tel, web].filter(Boolean).join('<span style="color:#c4a99f"> &nbsp;·&nbsp; </span>');
    return wrapT(`<tr><td style="border-left:3px solid #f7781d;padding-left:12px"><div>${line1}</div><div style="margin-top:3px;font-size:13px">${line2}</div>`
      + `${o.offices ? `<div style="font-size:12px;color:#6b5654">${esc(OFFICES)}</div>` : ""}${links ? `<div style="margin-top:3px;font-size:13px">${links}</div>` : ""}</td></tr>`) + conf;
  }
  if (style === "executive") {
    // Line icons are small pictures that must load from the internet. The preview uses this site's copies; a copied signature uses the live site's,
    // and falls back to the letters E, M, W, A while those are not online yet (iconsLive is false).
    const showIcons = forPreview || iconsLive;
    const iconBase = forPreview && typeof location !== "undefined" ? `${location.origin}/sig` : ICON_PROD;
    const ic = (name, alt) => `<img src="${iconBase}/icon-${name}.png" width="18" height="18" alt="${alt}" style="display:block;border:0;width:18px;height:18px">`;
    const irow = (name, letter, html, pad = 3) => `<tr><td style="width:32px;padding:${pad}px 0;vertical-align:middle">${showIcons ? ic(name, letter) : (letter ? `<span style="font-size:12px;font-weight:bold;color:#7a645f">${letter}</span>` : "")}</td><td style="padding:${pad}px 0;font-size:15px;color:#2e1a1f;vertical-align:middle">${html}</td></tr>`;
    const contact = [irow("mail", "E", mail), s.phone ? irow("phone", "M", tel) : "", irow("web", "W", web), o.offices ? irow("pin", "A", `<span style="color:#6b5654">${esc(OFFICES)}</span>`) : ""].join("");
    const more = [o.cases ? irow("case", "", link(CASE_STUDIES_URL, "Case studies", "font-weight:bold")) : "", bk ? irow("calendar", "", link(bk, "Book a meeting", "font-weight:bold")) : "", li ? irow("linkedin", "", link(li, "LinkedIn", "font-weight:bold")) : ""].join("");
    const badge = o.badge ? `<td align="right" style="padding-top:16px;padding-left:24px;vertical-align:middle;white-space:nowrap"><table cellpadding="0" cellspacing="0" border="0" align="right"><tr><td style="vertical-align:middle"><img src="${BADGE_URL}" width="40" alt="Google Cloud Premier Partner" style="display:block;border:0;width:40px;height:auto"></td><td style="padding-left:10px;font-size:15px;line-height:1.3;vertical-align:middle;white-space:nowrap"><div style="font-weight:bold;color:#800d35">Google Cloud</div><div style="color:#6b5654">Premier Partner</div></td></tr></table></td>` : "";
    return wrapT(`<tr><td><div style="${serif};font-size:24px;line-height:1.2">${esc(s.name)}</div>`
      + `${s.title ? `<div style="font-size:15px;font-weight:bold;color:#2e1a1f;margin-top:2px">${esc(s.title)}</div>` : ""}<div style="font-size:15px;color:#6b5654;margin-top:2px">${esc(COMPANY)}</div>`
      + `<div style="width:56px;height:3px;line-height:3px;font-size:3px;background-color:#f7781d;margin:14px 0 14px">&nbsp;</div>`
      + `<table cellpadding="0" cellspacing="0" border="0">${contact}</table>${more ? `<table cellpadding="0" cellspacing="0" border="0" style="margin-top:8px">${more}</table>` : ""}`
      + `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:16px;border-top:1px solid #ead9c2"><tr><td align="left" style="padding-top:16px;vertical-align:middle;width:100%">${logoImg(140)}</td>${badge}</tr></table></td></tr>`, 480) + conf;
  }
  return wrapT(`<tr><td style="padding-right:18px;border-right:3px solid #f7781d;vertical-align:middle">${logoImg(150)}</td>`
    + `<td style="padding-left:18px;vertical-align:top"><div style="${serif};font-size:19px">${esc(s.name)}</div>`
    + `${s.title ? `<div style="font-size:14px;color:#2e1a1f;font-weight:bold;margin-top:1px">${esc(s.title)}</div>` : ""}<div style="font-size:14px;color:#6b5654;margin-bottom:8px">${esc(COMPANY)}</div>`
    + `<table cellpadding="0" cellspacing="0" border="0">${rows}</table>${links ? `<div style="margin-top:8px">${links}</div>` : ""}</td></tr>`) + foot + conf;
}
export function signaturePlain(s, o = SIG_DEFAULT_OPTS) {
  const li = webLink(s.linkedin, /(^|\.)linkedin\.com$/i), bk = webLink(s.booking);
  const block = (...x) => x.filter(Boolean).join("\n");
  const linkLines = block(o.cases && `Case studies: ${CASE_STUDIES_URL}`, bk && `Book a meeting: ${bk}`, li && `LinkedIn: ${li}`);
  if ((o.style || "classic") === "compact") {
    return [`${s.name} | ${s.title ? `${s.title}, ` : ""}Wohlig`, [s.email, s.phone, SITE].filter(Boolean).join(" · "), o.offices && OFFICES, linkLines, o.conf && CONFIDENTIALITY].filter(Boolean).join("\n");
  }
  return [
    block(s.name, [s.title, COMPANY].filter(Boolean).join(", ")),
    block(`E  ${s.email}`, s.phone && `M  ${s.phone}`, `W  ${SITE}`, o.offices && `A  ${OFFICES}`),
    linkLines,
    o.badge && PARTNER_LINE,
    o.conf && CONFIDENTIALITY,
  ].filter(Boolean).join("\n\n");
}

/* ---------- PDF: pages that are each one JPEG, sized in points (no library needed) ---------- */
export function pdfFromJpegs(pages, ptW, ptH) {
  const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
  const push = (x) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const n = pages.length, pageId = (i) => 3 + i * 3, imgId = (i) => 4 + i * 3, contId = (i) => 5 + i * 3;
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const start = (id) => { offs[id] = len; push(`${id} 0 obj\n`); };
  start(1); push(`<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  start(2); push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(" ")}] >>\nendobj\n`);
  pages.forEach((pg, i) => {
    start(pageId(i)); push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] /Resources << /XObject << /Im0 ${imgId(i)} 0 R >> >> /Contents ${contId(i)} 0 R >>\nendobj\n`);
    start(imgId(i)); push(`<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`); push(pg.jpeg); push("\nendstream\nendobj\n");
    const cs = `q ${ptW} 0 0 ${ptH} 0 0 cm /Im0 Do Q`;
    start(contId(i)); push(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream\nendobj\n`);
  });
  const total = 2 + n * 3 + 1, xref = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let id = 1; id < total; id++) push(`${String(offs[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}
/** JPEG bytes of a canvas, on a white page (a PDF image has no transparency). */
export async function jpegOf(canvas) {
  const flat = newCanvas(canvas.width, canvas.height), f = flat.getContext("2d");
  f.fillStyle = "#fff"; f.fillRect(0, 0, flat.width, flat.height); f.drawImage(canvas, 0, 0);
  const b = await toBlob(flat, "image/jpeg", 0.95); return new Uint8Array(await b.arrayBuffer());
}

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BRAND } from "../brand.js";
import { currentTheme } from "../theme.js";

/* The festival look. From a few days before a festival date through the day itself (the server decides: GET /api/festival-look,
   set in brand.config.json festivalLook.daysBefore, switched off by HR on Festival wishes), the whole portal takes that festival's
   feel: its three colours (festivalLook.festivals in brand.config.json) on a ribbon at the top of every page and on a chip in the
   top bar, its lit scene on the sign-in page and the dashboard banner, a festive greeting, and once a day a short celebration
   (sparks rise for Diwali, colours burst for Holi, snow falls for Christmas, confetti otherwise) that plays for about three
   seconds and stops. Nothing loops, and with reduced motion switched on the celebration does not play at all.
   Add ?festival=<slug> to any address to preview one (for example ?festival=diwali); the preview stays on in that tab until
   ?festival=off, and plays the celebration on every page load. */
let cached = null;
const pending = {};
/* A preview stays on while you move around the portal in that browser tab (session storage), until ?festival=off. */
function previewSlug() {
  const asked = new URLSearchParams(window.location.search).get("festival");
  try {
    if (asked === "off") { sessionStorage.removeItem("festival-preview"); return ""; }
    if (asked) { sessionStorage.setItem("festival-preview", asked); return asked; }
    return sessionStorage.getItem("festival-preview") || "";
  } catch { return asked && asked !== "off" ? asked : ""; }
}
export function useFestivalLook() {
  const preview = previewSlug();
  const [look, setLook] = useState(preview ? null : cached);
  useEffect(() => {
    if (!preview && cached) return;
    let live = true;
    const url = `/api/festival-look${preview ? `?preview=${encodeURIComponent(preview)}` : ""}`;
    // The top bar and the dashboard ask at the same moment: one request, shared.
    if (!pending[url]) pending[url] = fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null).finally(() => setTimeout(() => { delete pending[url]; }, 1000));
    pending[url].then((d) => { const f = d && d.festival ? d.festival : null; if (!preview) cached = f; if (live) setLook(f); });
    return () => { live = false; };
  }, [preview]);
  return look;
}

/** A festival's colours, celebration and greeting from brand.config.json. */
export function festivalTheme(slug) {
  const L = BRAND.festivalLook || {};
  const own = (L.festivals || {})[slug] || {};
  const def = L.default || { colors: ["#f7781d", "#c85f44", "#800d35"], burst: "confetti" };
  return { colors: own.colors || def.colors, burst: own.burst || def.burst, greeting: own.greeting || "" };
}

/** The greeting for a festival, in its usual words. */
export function festivalGreeting(f) {
  if (!f) return "";
  const g = festivalTheme(f.slug).greeting;
  if (g) return g;
  if (/^eid/.test(f.slug)) return "Eid Mubarak";
  return `Happy ${f.name.replace(/\s*\(.*\)$/, "").split(" / ")[0]}`;
}
export const festivalFrom = (f) => `${festivalGreeting(f)} from everyone at ${BRAND.company.name}`;
/** "Diwali in 2 days", "Diwali tomorrow" or, on the day, the greeting. */
export function festivalWhen(f) {
  if (!f) return "";
  const short = f.name.replace(/\s*\(.*\)$/, "").split(" / ")[0];
  if (!f.inDays) return festivalGreeting(f);
  return f.inDays === 1 ? `${short} is tomorrow` : `${short} in ${f.inDays} days`;
}

/** The festival's lit scene, drawn once into a canvas that covers its box. Decorative: hidden from screen readers. */
export function FestivalArt({ slug, className = "", hero = { x: 760, y: 520, s: 0.9 } }) {
  const ref = useRef(null);
  useEffect(() => {
    let live = true;
    import("../modules/festivals/scenes.js").then(({ drawScene }) => {
      const c = ref.current;
      if (!live || !c) return;
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, 1080, 1080);
      try { drawScene(ctx, slug, "own", null, { hero }); } catch { /* an unknown festival simply draws nothing */ }
    });
    return () => { live = false; };
  }, [slug]);   // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} width={1080} height={1080} aria-hidden="true" className={`pointer-events-none absolute inset-0 size-full object-cover ${className}`} />;
}

const ribbon = (colors) => `linear-gradient(90deg, ${colors[0]}, ${colors[1]} 50%, ${colors[2]})`;

/** Puts the festival on the page root (data-festival and the --fest-a/b/c colours), draws the ribbon and plays the day's celebration. */
export function FestiveFrame({ fest }) {
  useEffect(() => {
    const root = document.documentElement;
    if (!fest) { delete root.dataset.festival; return undefined; }
    const [a, b, c] = festivalTheme(fest.slug).colors;
    root.dataset.festival = fest.slug;
    root.style.setProperty("--fest-a", a); root.style.setProperty("--fest-b", b); root.style.setProperty("--fest-c", c);
    return () => { delete root.dataset.festival; ["--fest-a", "--fest-b", "--fest-c"].forEach((k) => root.style.removeProperty(k)); };
  }, [fest && fest.slug]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!fest) return null;
  return <>
    <div aria-hidden="true" className="print:hidden! pointer-events-none fixed inset-x-0 top-0 z-40 h-[3px]" style={{ background: ribbon(festivalTheme(fest.slug).colors) }} />
    <Celebration fest={fest} />
  </>;
}

/** The festival chip in the top bar: three colour dots and "Diwali in 2 days" (or the greeting on the day). Opens Festival wishes. */
export function FestivalChip({ fest }) {
  if (!fest) return null;
  const cols = festivalTheme(fest.slug).colors;
  return (
    <Link to="/app/festivals" className="ml-3 inline-flex min-h-9 flex-none animate-fest-chip items-center gap-2 rounded-full border border-line bg-surface/80 px-3.5 font-display text-[14.5px] text-ink no-underline transition hover:-translate-y-px hover:border-edge hover:text-maroon focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange max-xl:hidden dark:hover:text-ivory"
      title="Send festival wishes">
      <span aria-hidden="true" className="flex -space-x-1">{cols.map((c) => <i key={c} className="size-2.5 rounded-full ring-2 ring-surface" style={{ background: c }} />)}</span>
      {festivalWhen(fest)}
    </Link>
  );
}

/* The celebration: about three and a half seconds of the festival's own motion, drawn on a canvas over the page, then removed.
   Once a day per festival for each browser (a preview plays on every page load). Off under reduced motion.
   Each festival picks one in brand.config.json (festivalLook.festivals.<slug>.burst):
     lanterns  lit sky lanterns float up with gold sparks (Diwali)
     colours   bursts of colour powder from several points (Holi)
     snow      snow falls and sways (Christmas)
     crescents gold crescent moons and small lights drift down (Eid)
     gulal     red and saffron powder rises in plumes from the bottom (Ganesh Chaturthi)
     dandiya   pairs of bright dandiya sticks tumble down (Navratri)
     sparks    gold sparks rise
     confetti  confetti falls (any other festival) */
export const BURSTS = ["lanterns", "colours", "snow", "crescents", "gulal", "dandiya", "sparks", "confetti"];

/* Small pictures drawn once per colour and stamped many times: a lit lantern and a crescent moon. */
function sprite(kind, color, size) {
  const c = document.createElement("canvas"), px = Math.ceil(size * 2.4);
  c.width = px; c.height = px;
  const g = c.getContext("2d"), m = px / 2;
  if (kind === "lantern") {
    const w = size, h = size * 1.3, x = m - w / 2, y = m - h / 2, r = w * .28;
    g.fillStyle = color; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
    g.fillStyle = "rgba(255,240,200,.55)"; g.beginPath(); g.roundRect(x + w * .22, y + h * .18, w * .56, h * .64, r * .6); g.fill();   // the lit middle
    g.fillStyle = "rgba(46,26,31,.55)"; g.fillRect(x + w * .2, y - 1.5, w * .6, 2.5); g.fillRect(x + w * .2, y + h - 1, w * .6, 2.5);  // top and base rims
  } else if (kind === "crescent") {
    g.fillStyle = color; g.beginPath(); g.arc(m, m, size, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "destination-out"; g.beginPath(); g.arc(m + size * .42, m - size * .18, size * .86, 0, Math.PI * 2); g.fill();
  }
  return c;
}

function makeParts(burst, W, H, colors, dark) {
  const R = Math.random, pick = () => colors[Math.floor(R() * colors.length)];
  const n = Math.round(Math.min(170, Math.max(70, W / 8)));
  const many = (k, f) => Array.from({ length: k }, (_, i) => f(i));
  const spark = () => ({ x: R() * W, y: H + R() * 40, vx: (R() - .5) * 1.2, vy: -(4 + R() * 6), g: .06, s: 1.4 + R() * 2.2, c: pick(), d: R() * 900, life: 1500 + R() * 1000, kind: "dot", twinkle: R() * 6 });
  if (burst === "lanterns") {
    const lit = { sprites: {} };
    return [...many(Math.round(n * .55), spark), ...many(Math.max(10, Math.round(W / 55)), () => {
      const c = pick(), sz = 12 + R() * 10; const key = c + Math.round(sz);
      lit.sprites[key] = lit.sprites[key] || sprite("lantern", c, sz);
      return { x: R() * W, y: H * (.55 + R() * .55), vx: (R() - .5) * .4, vy: -(2.2 + R() * 2), g: 0, s: sz, img: lit.sprites[key], d: R() * 700, life: 3200, kind: "img", sway: R() * 6 };
    })];
  }
  if (burst === "colours") return many(n, (i) => { const o = [[.2, .35], [.8, .3], [.5, .7], [.15, .8], [.85, .78], [.5, .2]][i % 6]; const a = R() * Math.PI * 2, sp = 2 + R() * 7; return { x: o[0] * W, y: o[1] * H, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: .03, s: 3 + R() * 7, c: pick(), d: (i % 6) * 170, life: 1400 + R() * 800, kind: "dot", drag: .962 }; });
  if (burst === "snow") return many(n, () => ({ x: R() * W, y: -10 + R() * H * .35, vx: (R() - .5) * .6, vy: 1.6 + R() * 2, g: 0, s: 1.5 + R() * 3, c: dark && R() < .7 ? "#ffffff" : pick(), d: R() * 600, life: 2800, kind: "dot", sway: R() * 6 }));
  if (burst === "crescents") {
    const cache = {};
    return [...many(Math.round(n * .5), () => ({ x: R() * W, y: -10 + R() * H * .3, vx: (R() - .5) * .4, vy: 1.2 + R() * 1.6, g: 0, s: 1.3 + R() * 2, c: pick(), d: R() * 800, life: 2800, kind: "dot", twinkle: R() * 6 })),
      ...many(Math.max(10, Math.round(W / 60)), () => { const c = pick(), sz = 7 + R() * 9, key = c + Math.round(sz); cache[key] = cache[key] || sprite("crescent", c, sz);
        return { x: R() * W, y: -30 + R() * H * .25, vx: (R() - .5) * .5, vy: 1 + R() * 1.4, g: 0, s: sz, img: cache[key], d: R() * 700, life: 3000, kind: "img", rot: (R() - .5) * .8, vr: (R() - .5) * .01, sway: R() * 6 }; })];
  }
  if (burst === "gulal") return many(n, (i) => { const x0 = ((i % 5) + .5) / 5 * W + (R() - .5) * 60; return { x: x0, y: H + 10, vx: (R() - .5) * 2.6, vy: -(5 + R() * 7), g: .05, s: 3 + R() * 7, c: pick(), d: (i % 5) * 220 + R() * 200, life: 1600 + R() * 800, kind: "dot", drag: .975 }; });
  if (burst === "dandiya") return many(Math.round(n * .3), () => ({ x: R() * W, y: -20 + R() * H * .3, vx: (R() - .5) * 1.6, vy: 3 + R() * 3, g: .04, s: 22 + R() * 14, c: pick(), c2: pick(), d: R() * 600, life: 2600, kind: "stick", rot: R() * 6, vr: (R() - .5) * .16 }));
  if (burst === "sparks") return many(n, spark);
  return many(n, () => ({ x: R() * W, y: -20 - R() * H * .4, vx: (R() - .5) * 2, vy: 2 + R() * 3, g: .05, s: 5 + R() * 5, c: pick(), d: R() * 500, life: 2600, kind: "bit", rot: R() * 6, vr: (R() - .5) * .3 }));
}

function drawPart(ctx, p, age) {
  if (p.twinkle) ctx.globalAlpha *= .65 + .35 * Math.sin(age / 90 + p.twinkle);
  if (p.kind === "img") { ctx.save(); ctx.translate(p.x, p.y); if (p.rot) ctx.rotate(p.rot += p.vr || 0); ctx.drawImage(p.img, -p.img.width / 2, -p.img.height / 2); ctx.restore(); return; }
  ctx.fillStyle = p.c;
  if (p.kind === "bit") { p.rot += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); return; }
  if (p.kind === "stick") {   // a dandiya pair: two sticks crossed, coloured, with gold bands at the ends
    p.rot += p.vr; ctx.save(); ctx.translate(p.x, p.y);
    for (const [turn, col] of [[p.rot, p.c], [p.rot + 1.1, p.c2]]) {
      ctx.save(); ctx.rotate(turn); ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(-p.s / 2, -2, p.s, 4, 2); ctx.fill();
      ctx.fillStyle = "#e8c36a"; ctx.fillRect(-p.s / 2 + 2, -2, 3, 4); ctx.fillRect(p.s / 2 - 5, -2, 3, 4); ctx.restore();
    }
    ctx.restore(); return;
  }
  ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2); ctx.fill();
}

function Celebration({ fest }) {
  const ref = useRef(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const key = `fest-burst:${fest.slug}:${new Date().toISOString().slice(0, 10)}`;
    if (!fest.preview) {
      try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch { /* storage blocked: play anyway */ }
    }
    setShow(true);
  }, [fest.slug, fest.preview]);
  useEffect(() => {
    if (!show) return undefined;
    const c = ref.current; if (!c) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = window.innerWidth, H = window.innerHeight;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
    const { colors, burst } = festivalTheme(fest.slug);
    const parts = makeParts(burst, W, H, colors, currentTheme() === "dark");   // white snow only on a dark page
    let raf = 0; const t0 = performance.now(), END = 3700;
    const tick = (now) => {
      const t = now - t0;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        const age = t - p.d; if (age < 0 || age > p.life) continue;
        p.vy += p.g; if (p.drag) { p.vx *= p.drag; p.vy *= p.drag; }
        p.x += p.vx + (p.sway ? Math.sin(age / 400 + p.sway) * .45 : 0); p.y += p.vy;
        const k = age / p.life; ctx.globalAlpha = k < .12 ? k / .12 : 1 - Math.max(0, (k - .62) / .38);
        drawPart(ctx, p, age);
      }
      ctx.globalAlpha = 1;
      if (t < END) raf = requestAnimationFrame(tick); else setShow(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [show, fest.slug]);
  return show ? <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[70] size-full print:hidden!" /> : null;
}

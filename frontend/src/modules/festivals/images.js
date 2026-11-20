/* Ready-made greeting pictures. A festival that has a picture in ./art (named after the festival, for example holi.png) is shown exactly as
   that picture: nothing is redrawn and the words in it cannot be changed. Eid-ul-Fitr and Eid-ul-Adha share eid.png. A festival without a
   picture here is drawn by designs.js. */
const FILES = import.meta.glob("./art/*.{png,jpg,jpeg,webp}", { eager: true, query: "?url", import: "default" });
const SHARED = { "eid-ul-fitr": "eid", "eid-ul-adha": "eid" };

export const artFor = (slug) => {
  const key = SHARED[slug] || slug, hit = Object.entries(FILES).find(([path]) => path.replace(/^.*\//, "").replace(/\.\w+$/, "") === key);
  return hit ? hit[1] : null;
};

/** The picture on a square canvas at its own size. A picture that is not square keeps all of itself, centred on a soft blur of itself, so nothing is cut off. */
export async function artCanvas(url) {
  const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("The picture could not be read.")); i.src = url; });
  const w = img.naturalWidth, h = img.naturalHeight, side = Math.max(w, h), c = document.createElement("canvas");
  c.width = c.height = side; const ctx = c.getContext("2d");
  if (w !== h) {
    const k = side / Math.min(w, h); ctx.save(); if ("filter" in ctx) ctx.filter = "blur(40px) brightness(.8)";
    ctx.drawImage(img, (side - w * k) / 2, (side - h * k) / 2, w * k, h * k); ctx.restore();
  }
  ctx.drawImage(img, (side - w) / 2, (side - h) / 2);
  return c;
}

/** A small square copy of the picture for cards and template buttons. */
export async function artThumb(url, size = 420) {
  const full = await artCanvas(url), c = document.createElement("canvas"); c.width = c.height = size;
  c.getContext("2d").drawImage(full, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.85);
}

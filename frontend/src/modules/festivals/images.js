/* Ready-made greeting pictures. A festival that has a picture in ./art (named after the festival, for example holi.png) is shown exactly as
   that picture: nothing is redrawn and the words in it cannot be changed. Eid-ul-Fitr and Eid-ul-Adha share eid.png. A festival without a
   picture here is drawn by designs.js. */
const FILES = import.meta.glob("./art/*.{png,jpg,jpeg,webp}", { eager: true, query: "?url", import: "default" });
const SHARED = { "eid-ul-fitr": "eid", "eid-ul-adha": "eid" };

export const artFor = (slug) => {
  const key = SHARED[slug] || slug, hit = Object.entries(FILES).find(([path]) => path.replace(/^.*\//, "").replace(/\.\w+$/, "") === key);
  return hit ? hit[1] : null;
};

/** The picture as a PNG file at its own size (so it can be downloaded, copied and emailed whatever format it was saved in). */
export async function artBlob(url) {
  const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("The picture could not be read.")); i.src = url; });
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext("2d").drawImage(img, 0, 0);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("The image could not be created."))), "image/png"));
}

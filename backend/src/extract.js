import zlib from "node:zlib";

/*
 * Receipt and invoice checks.
 *
 * checkFile()   - is it a real PDF/JPG/PNG (decided by the file's first bytes), within the size limit, and can it be opened.
 * readInvoice() - pulls vendor, invoice number, date, subtotal, tax and total out of the document.
 *
 * Built-in reader: text-based PDFs (what billing systems and email invoices produce). Photos and scanned PDFs have no
 * text layer, so they need an OCR provider. To add one, put a function in PROVIDERS that returns { text } for a
 * buffer and set OCR_PROVIDER to its name; everything after the text (field parsing, amount match, duplicate checks)
 * stays the same.
 */
export const MAX_BYTES = 10 * 1024 * 1024;

export const sniff = (b) =>
  b.subarray(0, 5).toString("latin1") === "%PDF-" ? { mime: "application/pdf", ext: "pdf", kind: "pdf" }
  : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? { mime: "image/jpeg", ext: "jpg", kind: "image" }
  : b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? { mime: "image/png", ext: "png", kind: "image" }
  : null;

function imageSize(b, mime) {
  if (mime === "image/png") return b.length > 24 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null;
  for (let i = 2; i + 9 < b.length; ) {        // JPEG: walk the markers to the frame header
    if (b[i] !== 0xff) return null;
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

/** Text drawn in a PDF: inflates its content streams and collects the strings shown with Tj / TJ, one line per text row.
    Handles plain strings and the glyph codes most PDF generators use (decoded through the fonts' ToUnicode maps). */
export function pdfText(b) {
  const src = b.toString("latin1"), streams = [];
  const re = /<<([^]*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length, end = src.indexOf("endstream", start);
    if (end < 0) break;
    let data = Buffer.from(src.slice(start, end), "latin1");
    if (/\/FlateDecode/.test(m[1])) { try { data = zlib.inflateSync(data); } catch { continue; } }
    else if (/\/Filter/.test(m[1])) continue;          // other encodings (images, fonts) are not text
    streams.push(data.toString("latin1"));
  }
  // Glyph code -> text, from every ToUnicode map in the file.
  const cmap = new Map(); let codeLen = 4;
  const hexText = (h) => { let t = ""; for (let i = 0; i + 3 < h.length; i += 4) t += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return t; };
  for (const s of streams.filter((x) => /begincmap/.test(x))) {
    for (const blk of s.matchAll(/beginbfchar([^]*?)endbfchar/g))
      for (const x of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) { cmap.set(x[1].toUpperCase(), hexText(x[2])); codeLen = x[1].length; }
    for (const blk of s.matchAll(/beginbfrange([^]*?)endbfrange/g))
      for (const x of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
        const lo = parseInt(x[1], 16), hi = parseInt(x[2], 16), w = x[1].length; codeLen = w;
        const arr = x[3].startsWith("[") ? [...x[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((y) => y[1]) : null;
        const base = arr ? 0 : parseInt(x[3].slice(1, -1), 16);
        for (let c = lo; c <= hi && c - lo < 5000; c++)
          cmap.set(c.toString(16).toUpperCase().padStart(w, "0"), arr ? hexText(arr[c - lo] || "") : String.fromCharCode(base + c - lo));
      }
  }
  const unesc = (t) => t.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e) =>
    ({ n: "\n", r: "\r", t: "\t", b: "", f: "", "(": "(", ")": ")", "\\": "\\" })[e] ?? String.fromCharCode(parseInt(e, 8)));
  const fromHex = (h) => {
    h = h.replace(/\s+/g, "").toUpperCase();
    if (!cmap.size) { let t = ""; for (let i = 0; i + 1 < h.length; i += 2) t += String.fromCharCode(parseInt(h.slice(i, i + 2), 16)); return t; }
    let t = ""; for (let i = 0; i + codeLen <= h.length; i += codeLen) t += cmap.get(h.slice(i, i + codeLen)) ?? ""; return t;
  };
  const str = (tok) => (tok.startsWith("(") ? unesc(tok.slice(1, -1)) : fromHex(tok.slice(1, -1)));
  const out = [];
  for (const s of streams) {
    if (!/T[Jj]/.test(s)) continue;
    // A new row starts when the text moves down (Td/TD with a y offset, a Tm on another baseline, or T*);
    // moves along the same baseline (kerning, word positions) stay on the same row.
    let line = "", y = null;
    const nl = () => { if (line.trim()) out.push(line.trim()); line = ""; };
    const ops = /\[((?:\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]*>|[^\]])*)\]\s*TJ|(\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]*>)\s*Tj|(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]\b|((?:-?[\d.]+\s+){5})(-?[\d.]+)\s+Tm\b|\b(T\*)/g;
    for (const tok of s.matchAll(ops)) {
      if (tok[3] !== undefined) { if (Math.abs(Number(tok[4])) > 0.5) { nl(); y = null; } continue; }
      if (tok[6] !== undefined) { const ny = Number(tok[6]); if (y !== null && Math.abs(ny - y) > 0.5) nl(); y = ny; continue; }
      if (tok[7]) { nl(); continue; }
      if (tok[2] !== undefined) line += str(tok[2]);
      else for (const piece of tok[1].matchAll(/\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]*>|(-?\d+(?:\.\d+)?)/g)) {
        if (piece[1] !== undefined) { if (Number(piece[1]) < -200) line += " "; }   // a wide gap inside TJ is a space
        else line += str(piece[0]);
      }
    }
    nl();
  }
  return out.join("\n");
}

const PROVIDERS = {
  pdftext: async (buf, type) => (type.kind === "pdf" ? { text: pdfText(buf) } : null),
  // e.g. ocrspace: async (buf, type) => ({ text: await callOcrService(buf, type.mime) }),
};

const money = (s) => { const n = Number(String(s).replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
function isoDate(s) {
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);        // Indian invoices: day first
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  m = s.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/);
  if (m) { const i = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()); if (i >= 0) return `${m[3]}-${String(i + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  return null;
}

/** Fields from invoice text. Anything not found stays null; nothing here decides a claim. */
export function parseInvoice(text) {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const amt = String.raw`(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)`;
  const last = (re) => { let v = null; for (const l of lines) { const m = l.match(re); if (m) v = m; } return v; };
  const total = last(new RegExp(String.raw`^(?!.*sub\s*-?\s*total).*\b(?:grand\s+total|total\s+amount|amount\s+payable|net\s+payable|total)\b\s*[:\-]?\s*${amt}`, "i"));
  const subtotal = last(new RegExp(String.raw`\bsub\s*-?\s*total\b\s*[:\-]?\s*${amt}`, "i"));
  let tax = 0, taxSeen = false;
  for (const l of lines) {
    const m = l.match(new RegExp(String.raw`\b(cgst|sgst|igst|gst|vat|tax)\b(?:\s*@?\s*\d+(?:\.\d+)?\s*%)?[^\d₹]{0,20}${amt}\s*$`, "i"));
    if (m && !/total/i.test(l)) { tax += money(m[2]) || 0; taxSeen = true; }
  }
  const inv = last(/\b(?:invoice|bill|receipt)\s*(?:no\.?|number|#)\s*[:\-#]?\s*([A-Za-z0-9][A-Za-z0-9\-/]{1,30})/i);
  const dateLine = lines.find((l) => /\b(?:invoice|bill|receipt)?\s*date\b/i.test(l) && isoDate(l)) || lines.find((l) => isoDate(l));
  const vendor = lines.find((l) => /[A-Za-z]{3}/.test(l) && !/\b(invoice|bill|receipt|tax|date|total|gst|no\.?|number|to:|from:)\b/i.test(l)) || null;
  return {
    vendor: vendor ? vendor.slice(0, 80) : null,
    invoiceNo: inv ? inv[1] : null,
    invoiceDate: dateLine ? isoDate(dateLine) : null,
    subtotal: subtotal ? money(subtotal[1]) : null,
    tax: taxSeen ? Math.round(tax * 100) / 100 : null,
    total: total ? money(total[1]) : null,
  };
}

export async function checkFile(buf) {
  const checks = [];
  if (!Buffer.isBuffer(buf) || !buf.length) return { ok: false, checks: [{ ok: false, label: "The file is empty." }] };
  if (buf.length > MAX_BYTES) return { ok: false, checks: [{ ok: false, label: "The file is larger than 10 MB." }] };
  const type = sniff(buf);
  if (!type) return { ok: false, checks: [{ ok: false, label: "Only PDF, JPG or PNG files are allowed." }] };
  checks.push({ ok: true, label: `File type: ${type.ext.toUpperCase()}` });
  checks.push({ ok: true, label: `Size: ${(buf.length / 1024).toFixed(0)} KB (limit 10 MB)` });
  let opens = false, detail = "";
  if (type.kind === "pdf") {
    const pages = (buf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) || []).length;
    opens = /%%EOF\s*$/.test(buf.subarray(-1024).toString("latin1")) && pages > 0;
    detail = opens ? `PDF opens, ${pages} page${pages === 1 ? "" : "s"}` : "The PDF looks damaged or incomplete";
  } else {
    const d = imageSize(buf, type.mime);
    opens = !!(d && d.w > 0 && d.h > 0);
    detail = opens ? `Image opens, ${d.w}×${d.h}` : "The image looks damaged";
  }
  checks.push({ ok: opens, label: detail });
  return { ok: opens, type, checks };
}

/** Reads invoice fields with the configured provider(s). Returns how it was read so HR knows how far to trust it. */
export async function readInvoice(buf, type) {
  const order = [process.env.OCR_PROVIDER, "pdftext"].filter((p, i, a) => p && PROVIDERS[p] && a.indexOf(p) === i);
  for (const name of order) {
    try {
      const r = await PROVIDERS[name](buf, type);
      if (r && r.text && r.text.trim()) return { method: name, readable: true, fields: parseInvoice(r.text), text: r.text.slice(0, 3000) };
    } catch (err) {
      console.error(`Invoice reader ${name} failed:`, err.message);
    }
  }
  return {
    method: null, readable: false, fields: null,
    note: type.kind === "image"
      ? "Text in photos is not read yet (no OCR provider configured). Check the amount by eye."
      : "No text found in this PDF (it may be a scan). Check the amount by eye.",
  };
}

/*
 * The holiday list as a sheet: HR fills in one row per holiday (any year, any number of years), uploads it, the app shows what
 * would be added or changed, and HR confirms. Each row becomes a holiday in the same shape as the 2026 list: a date, a name and an
 * optional type. Pure functions (no database), so every case is testable.
 *
 *   Date          | Holiday            | Type
 *   26-Jan-2027   | Republic Day       | National
 *
 * Dates may be real Excel dates or text: 2027-01-26, 26-01-2027, 26/01/2027, 26 Jan 2027, 26-Jan-27 (day first, as in India).
 */
import ExcelJS from "exceljs";

export const HEADERS = ["Date", "Holiday", "Type"];
export const MAX_ROWS = 400;
const MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");

/** A real calendar date as "YYYY-MM-DD", or null. */
function iso(y, m, d) {
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}
const year4 = (y) => (y < 100 ? 2000 + y : y);

/** A date from an Excel date cell, an Excel serial number or text. Null when it is not a real date. */
export function parseDate(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === "number") return v > 20000 && v < 80000 ? parseDate(new Date(Math.round((v - 25569) * 86400000))) : null;
  const s = String(v == null ? "" : v).trim();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(s))) return iso(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(s))) return iso(year4(+m[3]), +m[2], +m[1]);
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-/,.]*([A-Za-z]{3,9})\.?[\s\-/,.]*(\d{2}|\d{4})$/.exec(s))) return MONTH[m[2].slice(0, 3).toLowerCase()] ? iso(year4(+m[3]), MONTH[m[2].slice(0, 3).toLowerCase()], +m[1]) : null;
  if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s))) return MONTH[m[1].slice(0, 3).toLowerCase()] ? iso(+m[3], MONTH[m[1].slice(0, 3).toLowerCase()], +m[2]) : null;
  return null;
}

const cellValue = (v) => {
  if (v && typeof v === "object" && !(v instanceof Date)) { if ("result" in v) return cellValue(v.result); if ("richText" in v) return v.richText.map((t) => t.text).join(""); if ("text" in v) return v.text; }
  return v == null ? "" : v;
};
function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === "," || c === ";" || c === "\t") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** The cells of an uploaded Excel (.xlsx) or CSV file, row by row (the first sheet). */
export async function readTable(buf) {
  if (buf.subarray(0, 2).toString("latin1") === "PK") {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf); } catch { throw new Error("That Excel file could not be opened. Please save it as .xlsx or .csv and try again."); }
    const ws = wb.worksheets[0];
    if (!ws) throw new Error("The Excel file has no sheet.");
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => { rows[n - 1] = Array.from({ length: 6 }, (_, i) => cellValue(row.getCell(i + 1).value)); });
    return Array.from(rows, (r) => r || []);
  }
  return parseCsv(buf.toString("utf8").replace(/^﻿/, ""));
}

/** Rows of cells → holidays, plus the problems found (each with its row number in the file). Nothing is dropped silently. */
export function parseHolidays(rows) {
  const errors = [], holidays = [];
  const head = rows.findIndex((r, i) => i < 10 && (r || []).some((c) => /^date\b/i.test(String(c).trim())));
  if (head < 0) return { holidays, errors: [{ row: 1, message: "The first row must have the headings Date and Holiday. Please use the template." }] };
  const cols = (rows[head] || []).map((c) => String(c).trim().toLowerCase());
  const at = (re) => cols.findIndex((c) => re.test(c));
  const dateCol = at(/^date\b/), nameCol = at(/^(holiday|name|occasion|festival|description)/), typeCol = at(/^(type|category|kind)/);
  if (nameCol < 0) return { holidays, errors: [{ row: head + 1, message: "The sheet needs a column headed Holiday (the name of each holiday)." }] };
  const seen = new Map();
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r.some((c) => String(c).trim() !== "")) continue;
    const n = i + 1, raw = r[dateCol], name = String(cellValue(r[nameCol])).trim().replace(/\s+/g, " "), type = typeCol >= 0 ? String(cellValue(r[typeCol])).trim() : "";
    const day = parseDate(raw);
    if (holidays.length + errors.length >= MAX_ROWS) { errors.push({ row: n, message: `Only ${MAX_ROWS} holidays can be uploaded at a time.` }); break; }
    if (!day) { errors.push({ row: n, message: `"${String(raw).trim() || "(empty)"}" is not a date. Use a date like 26-Jan-2027.` }); continue; }
    if (!name) { errors.push({ row: n, message: `The holiday on ${day} has no name.` }); continue; }
    if (name.length > 80) { errors.push({ row: n, message: `The name of the holiday on ${day} is longer than 80 characters.` }); continue; }
    if (type.length > 40) { errors.push({ row: n, message: `The type of the holiday on ${day} is longer than 40 characters.` }); continue; }
    if (seen.has(day)) { errors.push({ row: n, message: `${day} is listed twice (row ${seen.get(day)} and row ${n}). Keep one.` }); continue; }
    seen.set(day, n);
    holidays.push({ day, name, type: type || null });
  }
  if (!holidays.length && !errors.length) errors.push({ row: head + 1, message: "No holidays were found under the headings." });
  holidays.sort((a, b) => (a.day < b.day ? -1 : 1));
  return { holidays, errors };
}

/** Marks each holiday as new, changed or the same as what is saved (`saved` maps "YYYY-MM-DD" to { name, type }). */
export function compare(holidays, saved) {
  return holidays.map((h) => {
    const s = saved.get(h.day);
    return { ...h, status: !s ? "new" : s.name === h.name && (s.type || null) === (h.type || null) ? "same" : "changed", was: s ? { name: s.name, type: s.type || null } : null };
  });
}

const INSTRUCTIONS = [
  "How to fill in the holiday list",
  "One row per holiday. Keep the column headings (Date, Holiday, Type) as they are.",
  "Date: a real date or text like 26-Jan-2027, 26-01-2027 or 2027-01-26 (day first). You can list holidays of any year, even several years in one file.",
  "Holiday: the name, up to 80 characters. Type is optional, up to 40 characters (for example National, Festival, Optional).",
  "A date that is already a holiday is updated with the name and type in the sheet. Holidays that are not in the sheet are left as they are.",
  "Nothing is saved until you check the preview in the app and confirm. Rows with a problem are listed and are not saved.",
];

/** The template as an Excel file: this year's current list (to edit) or an empty sheet, and a page of instructions. */
export async function templateXlsx(year, current = []) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Holidays ${year}`);
  ws.addRow(HEADERS);
  ws.columns = [{ width: 16 }, { width: 38 }, { width: 18 }];
  for (const h of current) ws.addRow([new Date(`${h.day}T00:00:00Z`), h.name, h.type || ""]);
  ws.getColumn(1).numFmt = "dd-mmm-yyyy";
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAD9C2" } }; });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const help = wb.addWorksheet("Instructions");
  help.getColumn(1).width = 110;
  INSTRUCTIONS.forEach((t, i) => { help.addRow([t]); if (!i) help.getRow(1).font = { bold: true }; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

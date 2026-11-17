/*
 * Tax rules as a sheet: the CA fills in (or edits) one table, HR uploads it, the app shows what would change, and HR confirms.
 * Pure functions (no database), so every figure is testable. The sheet has one row per rule:
 *
 *   Financial year | Regime | Item               | Limit (₹)        | Rate (%) | Amount (₹)     | Note
 *   2026-27        | New    | Standard deduction |                  |          | 75000          |
 *   2026-27        | New    | Slab               | 400000           | 0        |                | income up to the limit; empty limit = the top slab
 *   2026-27        | New    | Rebate 87A         | 1200000          |          | 60000          | Marginal relief: Yes
 *   2026-27        | New    | Surcharge          | 5000000          | 10       |                | income above the limit
 *   2026-27        | New    | Cess               |                  | 4        |                |
 *   2026-27        | Old    | Cap 80C            |                  |          | 150000         |
 *
 * An item that is missing from the sheet keeps its current value (or the last year's, for a new year). Slabs and surcharge bands
 * are replaced as a whole list when the sheet has any. Which deductions each regime allows is not in the sheet (edit that with
 * the form), so it carries over too.
 */
import ExcelJS from "exceljs";
import { DEFAULT_TAX_RULES } from "./tax-defaults.js";
import { rulesProblems, annualTax } from "./tax.js";

export const HEADERS = ["Financial year", "Regime", "Item", "Limit (₹)", "Rate (%)", "Amount (₹)", "Note"];
const CAPS = { section80C: "Cap 80C", section80D: "Cap 80D", homeLoanInterest: "Cap Home loan interest", nps80CCD1B: "Cap 80CCD(1B)" };
const inr = (n) => "₹" + Number(n).toLocaleString("en-IN");

/* ---------- rules → rows (for the template) ---------- */
export function rowsOf(fy, regime, rules) {
  const R = regime === "old" ? "Old" : "New", rows = [];
  const add = (item, limit = "", rate = "", amount = "", note = "") => rows.push([fy, R, item, limit, rate, amount, note]);
  add("Standard deduction", "", "", rules.standardDeduction ?? 0);
  (rules.slabs || []).forEach((s) => add("Slab", s.upTo ?? "", s.rate, "", s.upTo == null ? "Top slab: no upper limit" : ""));
  if (rules.rebate) add("Rebate 87A", rules.rebate.maxIncome, "", rules.rebate.maxRebate, `Marginal relief: ${rules.rebate.marginalRelief ? "Yes" : "No"}`);
  (rules.surcharge || []).forEach((s) => add("Surcharge", s.above, s.rate, "", "On income above the limit"));
  add("Cess", "", rules.cessRate ?? 4, "");
  for (const [k, v] of Object.entries(rules.caps || {})) if (CAPS[k]) add(CAPS[k], "", "", v);
  return rows;
}

const INSTRUCTIONS = [
  "How to fill in this sheet",
  "One row per rule. Keep the column headings as they are.",
  "Financial year: like 2026-27. Regime: New or Old.",
  "Standard deduction: put the yearly amount in Amount.",
  "Slab: put the income the slab goes up to in Limit and its rate in Rate. Leave Limit empty on the last (top) slab. List slabs from lowest to highest.",
  "Rebate 87A: Limit = taxable income up to which the rebate applies; Amount = the largest rebate; Note = Marginal relief: Yes or No.",
  "Surcharge: Limit = income above which the rate applies; Rate = the surcharge percentage. One row per band.",
  "Cess: put the percentage in Rate (normally 4).",
  "Cap 80C, Cap 80D, Cap Home loan interest, Cap 80CCD(1B): the yearly limit in Amount (old regime deductions).",
  "A rule you leave out keeps its current value. Nothing is saved until HR checks the preview in the app and confirms.",
];

/** The template as an Excel file: the sheet with the current rules, and a page of instructions. */
export async function templateXlsx(sets) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Tax rules");
  ws.addRow(HEADERS).font = { bold: true };
  ws.columns = [{ width: 16 }, { width: 10 }, { width: 24 }, { width: 16 }, { width: 10 }, { width: 14 }, { width: 38 }];
  for (const s of sets) for (const r of rowsOf(s.fy, s.regime, s.rules)) ws.addRow(r);
  ws.getRow(1).eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAD9C2" } }; });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const help = wb.addWorksheet("Instructions");
  help.columns = [{ width: 120 }];
  INSTRUCTIONS.forEach((t, i) => { const row = help.addRow([t]); if (!i) row.font = { bold: true, size: 14 }; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const csvCell = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function templateCsv(sets) {
  const lines = [HEADERS, ...sets.flatMap((s) => rowsOf(s.fy, s.regime, s.rules))];
  return "﻿" + lines.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/* ---------- file → rows ---------- */
function parseCsv(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}
const cellText = (v) => {
  if (v == null) return "";
  if (typeof v === "object") return String(v.result ?? v.text ?? (Array.isArray(v.richText) ? v.richText.map((t) => t.text).join("") : "")).trim();
  return String(v).trim();
};
/** The rows of the first sheet of an .xlsx, or of a CSV, as arrays of text. */
export async function readRows(buf) {
  if (buf.subarray(0, 2).toString("latin1") === "PK") {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf); } catch { throw new Error("That Excel file could not be opened. Save it as .xlsx or .csv and try again."); }
    const ws = wb.worksheets[0];
    if (!ws) throw new Error("The Excel file has no sheet.");
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => rows.push(Array.from({ length: 7 }, (_, i) => cellText(row.getCell(i + 1).value))));
    return rows.filter((r) => r.some((x) => x));
  }
  return parseCsv(buf.toString("utf8")).map((r) => r.map((x) => String(x).trim()));
}

/* ---------- rows → rules ---------- */
const num = (s) => {
  const t = String(s ?? "").replace(/[₹,\s%]/g, "");
  if (t === "") return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
};
const fyOfText = (s) => {
  const m = /(\d{4})\s*[-–/]\s*(\d{2}|\d{4})/.exec(String(s));
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2].slice(-2));
  return b === (a + 1) % 100 ? `${a}-${String(b).padStart(2, "0")}` : null;
};
const capKey = (name) => {
  const n = name.toLowerCase();
  if (/80\s*ccd/.test(n) || /nps/.test(n)) return "nps80CCD1B";
  if (/80\s*c\b/.test(n) || /80c$/.test(n)) return "section80C";
  if (/80\s*d\b/.test(n) || /80d$/.test(n)) return "section80D";
  if (/home|24\s*\(?b/.test(n)) return "homeLoanInterest";
  return null;
};

/**
 * Turns the sheet's rows into rule sets, each with the changes against what is saved.
 *   rows     arrays of text, header row included
 *   current  [{ fy, regime, rules }] what is saved now
 * Returns { sets: [{ fy, regime, rules, isNew, changes, problems }], errors: ["Row 7: …"] }. Nothing here saves anything.
 */
export function buildSets(rows, current = []) {
  const errors = [];
  const hi = rows.findIndex((r) => r.some((c) => /^item$/i.test(String(c).trim())));
  if (hi < 0) return { sets: [], errors: ["The sheet needs a header row with the columns: " + HEADERS.join(", ") + "."] };
  const head = rows[hi].map((c) => String(c).trim().toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const ix = { fy: col(/year/), regime: col(/regime/), item: col(/^item/), limit: col(/limit/), rate: col(/rate/), amount: col(/amount/), note: col(/note/) };
  for (const k of ["fy", "regime", "item"]) if (ix[k] < 0) return { sets: [], errors: [`The header row has no "${k === "fy" ? "Financial year" : k === "regime" ? "Regime" : "Item"}" column.`] };

  const groups = new Map();
  rows.slice(hi + 1).forEach((r, k) => {
    const line = hi + k + 2, g = (i) => (i >= 0 ? String(r[i] ?? "").trim() : "");
    if (!r.some((c) => String(c).trim())) return;
    const fy = fyOfText(g(ix.fy)), regime = /^old/i.test(g(ix.regime)) ? "old" : /^new/i.test(g(ix.regime)) ? "new" : null;
    if (!fy) return errors.push(`Row ${line}: the financial year "${g(ix.fy)}" should look like 2026-27.`);
    if (!regime) return errors.push(`Row ${line}: the regime "${g(ix.regime)}" should be New or Old.`);
    const limit = num(g(ix.limit)), rate = num(g(ix.rate)), amount = num(g(ix.amount));
    for (const [label, v] of [["Limit", limit], ["Rate", rate], ["Amount", amount]]) if (Number.isNaN(v)) return errors.push(`Row ${line}: ${label} must be a number.`);
    const item = g(ix.item), low = item.toLowerCase();
    const key = `${fy}|${regime}`;
    if (!groups.has(key)) groups.set(key, { fy, regime, slabs: [], surcharge: [], std: undefined, cess: undefined, rebate: undefined, caps: {} });
    const t = groups.get(key);
    if (/^standard/.test(low)) { if (amount == null) return errors.push(`Row ${line}: the standard deduction needs an Amount.`); t.std = amount; }
    else if (/^slab/.test(low)) { if (rate == null) return errors.push(`Row ${line}: a slab needs a Rate.`); t.slabs.push({ upTo: limit, rate }); }
    else if (/rebate|87a/.test(low)) {
      if (limit == null || amount == null) return errors.push(`Row ${line}: the rebate needs a Limit (income up to) and an Amount (largest rebate).`);
      t.rebate = { maxIncome: limit, maxRebate: amount, marginalRelief: /yes|true|y\b/i.test(g(ix.note)) };
    } else if (/^surcharge/.test(low)) { if (limit == null || rate == null) return errors.push(`Row ${line}: a surcharge band needs a Limit (income above) and a Rate.`); t.surcharge.push({ above: limit, rate }); }
    else if (/^cess/.test(low)) { if (rate == null) return errors.push(`Row ${line}: cess needs a Rate.`); t.cess = rate; }
    else if (/^cap/.test(low)) {
      const k2 = capKey(low);
      if (!k2) return errors.push(`Row ${line}: "${item}" is not a cap this app knows (80C, 80D, Home loan interest, 80CCD(1B)).`);
      if (amount == null) return errors.push(`Row ${line}: a cap needs an Amount.`);
      t.caps[k2] = amount;
    } else errors.push(`Row ${line}: "${item}" is not an item this app knows (Standard deduction, Slab, Rebate 87A, Surcharge, Cess, or a Cap).`);
  });
  if (!groups.size && !errors.length) errors.push("The sheet has no rules in it.");

  const sets = [];
  for (const t of groups.values()) {
    const saved = current.find((c) => c.fy === t.fy && c.regime === t.regime);
    const earlier = current.filter((c) => c.regime === t.regime && c.fy < t.fy).sort((a, b) => (a.fy < b.fy ? 1 : -1))[0];
    const base = (saved || earlier || DEFAULT_TAX_RULES.find((d) => d.regime === t.regime && d.fy === "2026-27")).rules;
    // slabs: ascending, the last one open
    t.slabs.sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
    const rules = {
      ...base,
      ...(t.std !== undefined ? { standardDeduction: t.std } : {}),
      ...(t.cess !== undefined ? { cessRate: t.cess } : {}),
      ...(t.slabs.length ? { slabs: t.slabs } : {}),
      ...(t.rebate ? { rebate: t.rebate } : {}),
      ...(t.surcharge.length ? { surcharge: [...t.surcharge].sort((a, b) => a.above - b.above) } : {}),
      caps: { ...(base.caps || {}), ...t.caps },
    };
    const problems = rulesProblems(rules);
    if (!problems.length && !Number.isFinite(annualTax(rules, 1500000).total)) problems.push("These rules don't produce a tax amount.");
    sets.push({ fy: t.fy, regime: t.regime, rules, isNew: !saved, changes: saved ? changesBetween(saved.rules, rules) : ["New financial year / regime"], problems, copiedFrom: !saved && earlier ? earlier.fy : null });
  }
  return { sets: sets.sort((a, b) => (a.fy < b.fy ? 1 : a.fy > b.fy ? -1 : a.regime < b.regime ? -1 : 1)), errors };
}

/* The database hands JSON back with its keys in a different order, so compare by content, not by how it is written down. */
const stable = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const slabText = (slabs, i) => `${slabs[i].rate}% ${slabs[i].upTo == null ? `above ${inr(slabs[i - 1] ? slabs[i - 1].upTo : 0)}` : `up to ${inr(slabs[i].upTo)}`}`;
/** What differs between the saved rules and the uploaded ones, in plain words. */
export function changesBetween(a, b) {
  const out = [];
  if (a.standardDeduction !== b.standardDeduction) out.push(`Standard deduction ${inr(a.standardDeduction ?? 0)} → ${inr(b.standardDeduction ?? 0)}`);
  if (a.cessRate !== b.cessRate) out.push(`Cess ${a.cessRate}% → ${b.cessRate}%`);
  if (stable(a.slabs) !== stable(b.slabs)) out.push(`Slabs: ${b.slabs.map((_, i) => slabText(b.slabs, i)).join(", ")}`);
  if (stable(a.rebate || null) !== stable(b.rebate || null)) out.push(b.rebate ? `Rebate 87A: up to ${inr(b.rebate.maxRebate)} for income up to ${inr(b.rebate.maxIncome)}${b.rebate.marginalRelief ? " (marginal relief)" : ""}` : "Rebate 87A removed");
  if (stable(a.surcharge || []) !== stable(b.surcharge || [])) out.push(`Surcharge: ${(b.surcharge || []).map((s) => `${s.rate}% above ${inr(s.above)}`).join(", ") || "none"}`);
  for (const k of new Set([...Object.keys(a.caps || {}), ...Object.keys(b.caps || {})])) {
    if ((a.caps || {})[k] !== (b.caps || {})[k]) out.push(`${CAPS[k] || k}: ${(a.caps || {})[k] != null ? inr(a.caps[k]) : "none"} → ${(b.caps || {})[k] != null ? inr(b.caps[k]) : "none"}`);
  }
  return out;
}

/** Read an uploaded file and return the preview. */
export async function previewFromFile(buf, current) {
  return buildSets(await readRows(buf), current);
}

/*
 * The employee details sheet for onboarding: HR downloads it, fills one row per person (who they are, then the details collected at onboarding: date of birth, Aadhaar, PAN,
 * bank account, IFSC, PF/UAN number, phone, address), uploads it, checks the preview and confirms. The values go into the person's profile. Pure functions (no database), so every
 * case is testable. A blank cell never changes what is already saved.
 *
 * Aadhaar and PAN are kept masked (only the last digits stay readable), like everywhere else in onboarding. A full bank account number goes to Payroll (encrypted) for
 * someone who may add bank accounts; the profile only ever shows it masked.
 */
import ExcelJS from "exceljs";
import { V, maskAadhaar, maskAcct, maskPan } from "./validate.js";
import { cellValue, parseDate } from "./holiday-import.js";

export const MAX_ROWS = 500;
/** The columns, in the order of the template. key: what the code calls it; match: how an uploaded heading is recognised; width: template column width. */
export const COLUMNS = [
  { key: "workEmail", header: "Work email", match: /^(work|official|company)?\s*e-?mail/i, width: 30, note: "Who this row is for. Use the work email (or the Employee ID)." },
  { key: "empNo", header: "Employee ID", match: /^employee\s*(id|no|number)|^emp\.?\s*(id|no)/i, width: 14, note: "Use this when you do not have the work email." },
  { key: "name", header: "Name (for your reference)", match: /^(full\s*)?name(\s|\(|$)/i, width: 26, note: "Not saved. It only helps you find the person." },
  { key: "dob", header: "Date of birth", match: /date\s*of\s*birth|^dob/i, width: 16, note: "For example 14-Mar-1998. Age 16 to 80." },
  { key: "aadhaar", header: "Aadhaar number", match: /aadhaa?r/i, width: 18, text: true, note: "12 digits." },
  { key: "pan", header: "PAN number", match: /^pan\b/i, width: 14, text: true, note: "Like ABCDE1234F." },
  { key: "holder", header: "Bank account holder name", match: /holder|name\s*as\s*on/i, width: 28, note: "As on the bank account." },
  { key: "bankName", header: "Bank name", match: /^bank(\s*name)?$/i, width: 22, note: "For example HDFC Bank." },
  { key: "account", header: "Bank account number", match: /account\s*(no|number|num)/i, width: 22, text: true, note: "9 to 18 digits." },
  { key: "ifsc", header: "IFSC code", match: /ifsc/i, width: 14, text: true, note: "Like HDFC0001234." },
  { key: "pfNumber", header: "PF / UAN number", match: /\b(pf|uan)\b|provident/i, width: 20, text: true, note: "Optional." },
  { key: "phone", header: "Mobile number", match: /mobile|phone|contact\s*no/i, width: 16, text: true, note: "10 digits." },
  { key: "address", header: "Current address", match: /address/i, width: 40, note: "Optional." },
];
export const FIELD_LABEL = { dob: "Date of birth", aadhaar: "Aadhaar", pan: "PAN", holder: "Bank account holder", bankName: "Bank name", account: "Bank account", ifsc: "IFSC", pfNumber: "PF / UAN number", phone: "Mobile number", address: "Address" };
const DETAIL_KEYS = ["dob", "aadhaar", "pan", "holder", "bankName", "account", "ifsc", "pfNumber", "phone", "address"];

export const digits = (s) => String(s || "").replace(/\D/g, "");

/** A cell as trimmed text. A long number that Excel turned into a number (it keeps only 15 digits) is refused, so a wrong value is never saved. */
export function text(v, field, problems) {
  const x = cellValue(v);
  if (typeof x === "number") {
    if (!Number.isSafeInteger(x) || x >= 1e15) { problems[field] = "Excel has shortened this number. Format the column as Text and type it again."; return ""; }
    return String(x);
  }
  if (x instanceof Date) return "";
  return String(x == null ? "" : x).trim();
}

/** Rows of cells → people with cleaned, validated details. Each row keeps its row number; a problem is listed on the row and nothing is dropped silently. */
export function parseProfiles(rows) {
  const head = rows.findIndex((r, i) => i < 12 && (r || []).some((c) => /e-?mail/i.test(String(cellValue(c)))) && (r || []).some((c) => /aadhaa?r|\bpan\b|ifsc|bank/i.test(String(cellValue(c)))));
  if (head < 0) return { people: [], errors: [{ row: 1, message: "The first row must have the headings from the template (Work email, Aadhaar number, PAN number and so on). Please use the template." }] };
  const heads = (rows[head] || []).map((c) => String(cellValue(c)).trim());
  const col = {};
  for (const c of COLUMNS) { const i = heads.findIndex((h, n) => c.match.test(h) && !Object.values(col).includes(n)); if (i >= 0) col[c.key] = i; }
  if (col.workEmail === undefined && col.empNo === undefined) return { people: [], errors: [{ row: head + 1, message: "The sheet needs a Work email or Employee ID column to know who each row is for." }] };
  const people = [], errors = [], seen = new Map();
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i] || [], n = i + 1;
    if (!r.some((c) => String(cellValue(c)).trim() !== "")) continue;
    if (people.length >= MAX_ROWS) { errors.push({ row: n, message: `Only ${MAX_ROWS} people can be uploaded at a time.` }); break; }
    const problems = {}, get = (k) => (col[k] === undefined ? "" : text(r[col[k]], k, problems));
    const email = get("workEmail").toLowerCase(), empNo = get("empNo").toUpperCase();
    const f = {};
    if (!email && !empNo) { errors.push({ row: n, message: "This row has no work email or Employee ID, so it is not known who it is for." }); continue; }
    if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) problems.workEmail = "That is not an email address.";
    const dobRaw = col.dob === undefined ? "" : cellValue(r[col.dob]);
    if (String(dobRaw).trim() !== "") { const d = parseDate(dobRaw); if (!d) problems.dob = `"${String(dobRaw).trim()}" is not a date. Use a date like 14-Mar-1998.`; else if (!V.dob(d)) problems.dob = "The date of birth should make the person 16 to 80 years old."; else f.dob = d; }
    const aad = get("aadhaar"); if (aad) { if (!V.aadhaar(aad)) problems.aadhaar ||= "Aadhaar must be 12 digits."; else f.aadhaar = digits(aad); }
    const pan = get("pan").toUpperCase().replace(/\s/g, ""); if (pan) { if (!V.pan(pan)) problems.pan = "PAN must look like ABCDE1234F."; else f.pan = pan; }
    const holder = get("holder").replace(/\s+/g, " "); if (holder) { if (!/^[A-Za-z .'&-]{2,80}$/.test(holder)) problems.holder = "Enter the name as on the bank account (letters only)."; else f.holder = holder; }
    const bank = get("bankName"); if (bank) { if (bank.length < 2 || bank.length > 80) problems.bankName = "Enter the bank's name."; else f.bankName = bank; }
    const acct = get("account"); if (acct) { if (!V.acct(acct)) problems.account ||= "Bank account number must be 9 to 18 digits."; else f.account = digits(acct); }
    const ifsc = get("ifsc").toUpperCase().replace(/\s/g, ""); if (ifsc) { if (!V.ifsc(ifsc)) problems.ifsc = "IFSC must look like HDFC0001234."; else f.ifsc = ifsc; }
    const pf = get("pfNumber"); if (pf) { if (!/^[A-Za-z0-9/ .-]{3,30}$/.test(pf)) problems.pfNumber = "Use letters, digits, / - and . only, up to 30 characters."; else f.pfNumber = pf; }
    const ph = get("phone"); if (ph) { if (!V.phone(ph)) problems.phone = "Enter a valid 10-digit mobile number."; else { let d = digits(ph); if (d.length === 12) d = d.slice(2); f.phone = d; } }
    const addr = get("address").replace(/\s+/g, " "); if (addr) { if (addr.length > 300) problems.address = "The address is longer than 300 characters."; else f.address = addr; }
    const key = email || empNo;
    if (seen.has(key)) { problems.workEmail = `${key} is listed twice (row ${seen.get(key)} and row ${n}). Keep one row for each person.`; } else seen.set(key, n);
    people.push({ row: n, email, empNo, fields: f, problems });
  }
  if (!people.length && !errors.length) errors.push({ row: head + 1, message: "No people were found under the headings." });
  return { people, errors };
}

/** What a row would add or replace on a profile, shown masked. `current` is the saved profile of the person. */
export function describe(fields, current = {}) {
  const shown = {
    dob: fields.dob, aadhaar: maskAadhaar(fields.aadhaar), pan: maskPan(fields.pan), account: maskAcct(fields.account), ifsc: fields.ifsc, holder: fields.holder, bankName: fields.bankName,
    pfNumber: fields.pfNumber, phone: fields.phone, address: fields.address,
  };
  const was = { dob: current.dob, aadhaar: current.aadhaar_masked, pan: current.pan_masked, account: current.acct_masked, ifsc: current.ifsc, pfNumber: current.pf_number, phone: current.phone, address: current.address };
  return DETAIL_KEYS.filter((k) => fields[k] !== undefined).map((k) => {
    const mask = ["aadhaar", "pan", "account"].includes(k), same = mask ? was[k] && was[k] === shown[k] : was[k] != null && String(was[k]) === String(shown[k]);
    return { key: k, label: FIELD_LABEL[k], value: shown[k], status: same ? "same" : was[k] ? "replaces" : "new" };
  });
}

const INSTRUCTIONS = [
  "How to fill in the employee details sheet",
  "One row per person. Keep the column headings as they are. Fill in as many columns as you have: a blank cell leaves what is already saved as it is.",
  "Work email (or Employee ID): who the row is for. The person must already be in the employee list.",
  "Date of birth: a real date or text like 14-Mar-1998, 14-03-1998 or 1998-03-14 (day first). Age 16 to 80.",
  "Aadhaar number: 12 digits. PAN: like ABCDE1234F. IFSC: like HDFC0001234. Bank account number: 9 to 18 digits. Mobile: 10 digits.",
  "The long number columns are formatted as Text so Excel does not shorten them. Do not change that.",
  "Aadhaar and PAN are saved masked (only the last digits can be read). A full bank account number is added to Payroll, encrypted, for people who may manage bank accounts; the profile shows it masked.",
  "Nothing is saved until you check the preview in the app and confirm. Rows with a problem are listed and are not saved; the others are.",
  "The uploaded file itself is not kept. Delete your copy when you are done, because it holds personal numbers.",
];

/** The template as an Excel file: the headings (and, when given, the people still needing details) and a page of instructions. `people`: [{ email, empNo, name }].
 *  `keep`: the detail columns to include (the bank sheet in Payroll has only what payroll needs); the three "who" columns are always there. */
export async function templateXlsx(people = [], keep = null) {
  const cols = COLUMNS.filter((c) => ["workEmail", "empNo", "name"].includes(c.key) || !keep || keep.includes(c.key));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Employee details");
  ws.addRow(cols.map((c) => c.header));
  cols.forEach((c, i) => { const col = ws.getColumn(i + 1); col.width = c.width; if (c.text) col.numFmt = "@"; if (c.key === "dob") col.numFmt = "dd-mmm-yyyy"; });
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: "middle", wrapText: true };
  ws.getRow(1).height = 32;
  ws.getRow(1).eachCell((c, n) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: n <= 3 ? "FFD9E8D4" : "FFEAD9C2" } }; c.note = cols[n - 1].note; });
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  for (const p of people) { const row = ws.addRow([p.email || "", p.empNo || "", p.name || ""]); row.getCell(2).numFmt = "@"; }
  const help = wb.addWorksheet("Instructions");
  help.getColumn(1).width = 120;
  INSTRUCTIONS.forEach((t, i) => { help.addRow([t]); if (!i) help.getRow(1).font = { bold: true }; help.getRow(i + 1).alignment = { wrapText: true }; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

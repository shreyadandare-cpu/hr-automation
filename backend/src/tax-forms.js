/*
 * Form No. 124 (Rule 205, Income-tax Rules 2026; earlier Form 12BB under Rule 26C) from a person's tax declaration, as a PDF
 * for them to sign and give to payroll. Part A: who they are. Part B: house rent (with the landlord's name, address, PAN and
 * relationship), leave travel, home loan interest (with the lender) and deductions. An annexure lists the previous employer's
 * salary and TDS and other income (the particulars of Form No. 122, earlier Form 12B). Built with the payslips' PDF library.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { COMPANY_LEGAL, PRODUCT } from "./brand.js";

const LOGO = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/public/wohlig-logo.png");
const rs = (minor) => `Rs. ${(Number(minor) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;   // the PDF's standard fonts have no rupee sign
const DEDUCTIONS = ["80C", "80D", "80D parents", "NPS", "80E", "80EEA", "80G", "80GG", "80TTA", "80DD", "80DDB", "80U", "Other"];
const INCOME = ["Previous employer salary", "Previous employer TDS", "Income from other sources"];

export function form124Pdf({ fy, email, person = {}, declaration }) {
  const modern = fy >= 2026;   // tax year 2026-27 onwards: Form 124 under the Income-tax Act, 2025
  const items = declaration.items || [];
  const of = (section) => items.filter((i) => i.section === section);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 45, info: { Title: `Form ${modern ? "124" : "12BB"} ${fy}-${String(fy + 1).slice(2)}`, Author: PRODUCT } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    const L = 45, W = 505, ink = "#000000", grey = "#555555", rule = "#cccccc";
    try { doc.image(LOGO, L + W - 110, 40, { width: 110 }); } catch { /* the form works without the logo */ }
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(15).text(`FORM NO. ${modern ? "124" : "12BB"}`, L, 48);
    doc.font("Helvetica").fontSize(9).fillColor(grey).text(modern ? "[See rule 205 of the Income-tax Rules, 2026]" : "[See rule 26C of the Income-tax Rules, 1962]", L, 68);
    doc.fillColor(ink).fontSize(10).text(`Statement showing particulars of claims by an employee for deduction of tax under section ${modern ? "392(5)(b) of the Income-tax Act, 2025" : "192 of the Income-tax Act, 1961"}`, L, 88, { width: W - 120 });
    doc.moveDown(1.2);

    const heading = (t) => { doc.moveDown(0.6); doc.font("Helvetica-Bold").fontSize(10.5).fillColor(ink).text(t, L, doc.y, { width: W }); doc.moveDown(0.3); };
    const row = (label, value, opts = {}) => {
      const y = doc.y;
      doc.font("Helvetica").fontSize(9.5).fillColor(grey).text(label, L, y, { width: 190 });
      const h1 = doc.y - y;
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fillColor(ink).text(value || "________________________", L + 200, y, { width: W - 200 });
      doc.y = Math.max(doc.y, y + h1) + 3;
    };
    const line = () => { doc.moveTo(L, doc.y).lineTo(L + W, doc.y).strokeColor(rule).lineWidth(0.5).stroke(); doc.moveDown(0.4); };

    heading("Part A: Details of the employee");
    row("1. Name of the employee", person.name || email);
    row("2. Address of the employee", person.address || "");
    row("3. PAN of the employee", person.pan_masked ? `${person.pan_masked}  (please write your PAN in full)` : "");
    row("4. Email", email);
    row("5. Contact number", person.phone || "");
    row(modern ? "6. Tax year" : "6. Financial year", `${fy}-${String(fy + 1).slice(2)}`);
    row("Employer", COMPANY_LEGAL);
    row("Tax regime chosen", declaration.regime === "old" ? "Old regime" : "New regime (default)");
    line();

    heading("Part B: Particulars of claims");
    const hra = of("HRA");
    doc.font("Helvetica-Bold").fontSize(9.5).text("1. House rent allowance", L, doc.y); doc.moveDown(0.2);
    if (!hra.length) row("Rent paid to the landlord", "Nil");
    hra.forEach((i, n) => {
      const p = i.party || {};
      row(`Rent paid${hra.length > 1 ? ` (landlord ${n + 1})` : ""}`, rs(i.amountMinor), { bold: true });
      row("Name of the landlord", p.name); row("Address of the landlord", p.address);
      row("PAN of the landlord", p.pan || "Not given (needed when the year's rent is above Rs. 1,00,000)");
      row("Relationship with the landlord, if any", p.relationship || "None");
      if (p.metro) row("City", "Delhi, Mumbai, Kolkata, Chennai, Bengaluru, Hyderabad, Pune or Ahmedabad");
    });
    doc.font("Helvetica-Bold").fontSize(9.5).text("2. Leave travel concession or assistance", L, doc.y); doc.moveDown(0.2);
    const lta = of("Leave travel");
    if (!lta.length) row("Amount", "Nil");
    const MODE = { air: "Air, economy class", rail: "Rail, AC first class", road: "Road, first class or deluxe bus" };
    lta.forEach((i, n) => {
      const p = i.party || {};
      row(`Fare claimed${lta.length > 1 ? ` (journey ${n + 1})` : ""}`, rs(i.amountMinor), { bold: true });
      row("Journey", [p.from, p.to].filter(Boolean).join(" to "));
      row("Dates", [p.startOn, p.endOn].filter(Boolean).join(" to "));
      row("Mode of travel", MODE[p.mode] || "");
      row("Who travelled", p.travellers || "");
      if (p.carryForward) row("Journey carried over", "From the previous block of four years");
    });
    if (lta.length) { doc.font("Helvetica").fontSize(8).fillColor(grey).text("Travel in India only. Tickets or boarding passes for each journey are attached.", L, doc.y, { width: W }); doc.fillColor(ink); doc.moveDown(0.3); }
    const loan = of("Home loan interest");
    doc.font("Helvetica-Bold").fontSize(9.5).text("3. Deduction of interest on borrowing (house property)", L, doc.y); doc.moveDown(0.2);
    if (!loan.length && !of("Let-out property").length) row("Interest payable or paid", "Nil");
    loan.forEach((i) => { const p = i.party || {}; row("Interest payable or paid", rs(i.amountMinor), { bold: true }); row("Name of the lender", p.name); row("Address of the lender", p.address); row("PAN of the lender", p.pan); });
    of("Let-out property").forEach((i) => {
      const p = i.party || {};
      row("Let-out house", p.address || "", { bold: true }); row("Rent received for the year", rs(i.amountMinor)); row("Municipal tax paid", rs(p.municipalTaxMinor || 0));
      row("Interest payable or paid", rs(p.interestMinor || 0));
      if (p.interestMinor) { row("Name of the lender", p.lender); row("Address of the lender", p.lenderAddress); row("PAN of the lender", p.lenderPan); }
    });
    doc.font("Helvetica-Bold").fontSize(9.5).text(`4. Deductions under Chapter ${modern ? "VIII" : "VI-A"}`, L, doc.y); doc.moveDown(0.2);
    const ded = items.filter((i) => DEDUCTIONS.includes(i.section));
    if (!ded.length) row("Deductions claimed", "Nil");
    ded.forEach((i) => row(`${i.section}${i.description ? `: ${i.description}` : ""}`, rs(i.amountMinor)));
    if (modern && ded.length) { doc.font("Helvetica").fontSize(8).fillColor(grey).text("Sections are shown as declared in " + PRODUCT + "; the Income-tax Act, 2025 numbers them differently. Evidence for each claim is attached.", L, doc.y, { width: W }); doc.moveDown(0.3); }
    line();

    const income = items.filter((i) => INCOME.includes(i.section));
    if (income.length) {
      heading(`Annexure: Income from a previous employer and other sources (particulars of Form No. ${modern ? "122" : "12B"})`);
      income.forEach((i) => row(`${i.section}${i.description ? `: ${i.description}` : ""}`, rs(i.amountMinor)));
      line();
    }

    heading("Verification");
    doc.font("Helvetica").fontSize(9.5).fillColor(ink).text(`I, ${person.name || "________________"}, do hereby certify that the information given above is complete and correct.`, L, doc.y, { width: W });
    doc.moveDown(2);
    const y = doc.y;
    doc.text("Place: ____________________", L, y); doc.text("Signature of the employee: ____________________", L + 230, y);
    doc.moveDown(1.2);
    doc.text("Date: ____________________", L, doc.y);
    doc.moveDown(2);
    doc.fontSize(8).fillColor(grey).text(`Prepared by ${PRODUCT} from the declaration ${declaration.status === "submitted" ? `submitted on ${new Date(declaration.submitted_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}` : "saved as a draft (not yet submitted)"}. Please sign it and give it to the payroll team with your evidence.`, L, doc.y, { width: W });
    doc.end();
  });
}

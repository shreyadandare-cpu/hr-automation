import ExcelJS from "exceljs";
import L from "../../frontend/leave-rules.cjs";
import { BRAND } from "./brand.js";

/*
 * The company leave workbook HR downloads (GET /api/leave/export?year=). Built from the same leave rules the Leave pages use
 * (leave-rules.cjs), so every balance here is the one HR sees on screen. Sheets:
 *   1. Leave Quota    HR's "Leave Balance YTD of Default Leave Plan" layout: one row per current employee, with sick, casual, comp off and unpaid
 *                      leave (Accrued, Consumed, Balance, AnnualQuota, Unit), the same columns and order as the old system's report
 *   2. Pending         requests waiting for a decision, and who decides them
 *   3. All requests    every leave request that starts in the year, with status, deciding person and loss-of-pay days
 *   4. Comp offs       comp-off credits earned in the year
 *   5. Holidays        the holiday calendar for the year
 * Pure given its inputs: no database here, so the layout can be tested.
 */
const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF800D35" } };
const thin = { style: "thin", color: { argb: "FFE3D9C8" } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };
const n1 = "0.0";

function sheet(wb, name, subtitle, columns, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 3 }] });
  ws.mergeCells(1, 1, 1, columns.length); ws.mergeCells(2, 1, 2, columns.length);
  Object.assign(ws.getCell(1, 1), { value: `${BRAND.company.legalNameShort}: ${name}`, font: { bold: true, size: 14, color: { argb: "FF800D35" } } });
  Object.assign(ws.getCell(2, 1), { value: subtitle, font: { size: 10, color: { argb: "FF6B6B6B" } } });
  const head = ws.getRow(3);
  columns.forEach((c, i) => { head.getCell(i + 1).value = c.header; ws.getColumn(i + 1).width = c.width || 14; });
  head.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = HEAD_FILL; c.border = BORDER; c.alignment = { vertical: "middle", wrapText: true }; });
  head.height = 30;
  for (const r of rows) {
    const row = ws.addRow(columns.map((c) => r[c.key] ?? ""));
    row.eachCell((cell, i) => { cell.border = BORDER; if (columns[i - 1].days) cell.numFmt = n1; });
  }
  if (rows.length) ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: columns.length } };
  else ws.addRow(["Nothing to show."]);
  return ws;
}

const D = { days: true, width: 11 };
const TYPE = (t) => (L.TYPES[t] ? L.TYPES[t].name : t);
const STATUS = { pending: "Pending", approved: "Approved", declined: "Declined", cancelled: "Cancelled" };
const range = (r) => (r.half ? `${r.from} (${L.HALVES[r.half]})` : r.from === r.to ? r.from : `${r.from} to ${r.to}`);

/**
 * data = { year, today, employees: [{ email, name, empNo, dept, title, status, start, manager, casualOpening, openings }],
 *          requests: [toRequest…], compOffs: [toCompOff…], holidays: [{ day, name }], approvers: { email: approverEmail|"hr" } }
 * Returns the workbook's buffer.
 */
export async function buildLeaveWorkbook(data, meta = {}) {
  const { year, employees, requests, compOffs, holidays, approvers = {} } = data;
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.generatedBy || BRAND.company.legalNameShort;
  wb.created = new Date();
  const lc = (s) => String(s || "").toLowerCase();
  const nameOf = new Map(employees.map((e) => [lc(e.email), e.name]));
  const who = (email) => nameOf.get(lc(email)) || email || "";
  const reqsOf = new Map(), compsOf = new Map();
  for (const r of requests) (reqsOf.get(lc(r.email)) || reqsOf.set(lc(r.email), []).get(lc(r.email))).push(r);
  for (const c of compOffs) (compsOf.get(lc(c.email)) || compsOf.set(lc(c.email), []).get(lc(c.email))).push(c);
  const stamp = `Leave year ${year}. Prepared ${data.today}${meta.generatedBy ? ` by ${meta.generatedBy}` : ""}. Balances follow the leave policy shown in Wohlig One.`;

  // First sheet: HR's "Leave Balance YTD of Default Leave Plan" layout, the same columns and order as the leave quota report from the old system,
  // so it can be filed or compared next to it. One row per current employee, sorted by name. "Accrued" is 0 in that report (the yearly quota is shown
  // as AnnualQuota); Casual Balance includes days carried over. Unpaid leave has no quota, so its balance is the days taken, below zero.
  const current = employees.filter((e) => e.status !== "offboarded").sort((a, b) => a.name.localeCompare(b.name));
  const quotaRows = current.map((e) => {
    const b = L.balances(year, { start: e.start, casualOpening: e.casualOpening, openings: e.openings }, reqsOf.get(lc(e.email)) || [], compsOf.get(lc(e.email)) || []);
    const unpaid = b.consumed.unpaid || 0;
    return [e.empNo || "", e.name, e.title || "", BRAND.company.legalNameShort, e.dept || "", "", e.location || "", "", e.manager || "",
      0, b.sick.used, b.sick.left, b.sick.quota, "Days",
      0, b.casual.used, b.casual.left, b.casual.quota, "Days",
      0, b.compoff.used, b.compoff.left, 0, "Days",
      0, unpaid, -unpaid, 0, "Days"];
  });
  const heads = ["Employee Number", "Employee Name", "Job Title", "Business Unit", "Department", "Sub Department", "Location", "Cost Center", "Reporting Manager",
    ...["Sick Leave", "Casual Leave", "Comp Offs", "Unpaid Leave"].flatMap((t) => ["Accrued", "Consumed", "Balance", "AnnualQuota", "Unit"].map((h) => `${t} - ${h}`))];
  const quota = wb.addWorksheet("Leave Quota", { views: [{ state: "frozen", xSplit: 2, ySplit: 3 }] });
  const last = heads.length;
  quota.mergeCells(1, 1, 1, last); quota.mergeCells(2, 1, 2, last);
  const t1 = quota.getCell(1, 1), t2 = quota.getCell(2, 1);
  t1.value = BRAND.company.legalName.toUpperCase(); t1.font = { bold: true, size: 12 }; t1.alignment = { horizontal: "center", vertical: "middle" };
  t1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFBFBFBF" } };
  t2.value = `Employees Leave Balance YTD of Default Leave Plan ( 01-Jan-${year}  - 31-Dec-${year} )`; t2.font = { bold: true }; t2.alignment = { horizontal: "center" };
  const hr = quota.getRow(3);
  heads.forEach((h, i) => { const c = hr.getCell(i + 1); c.value = h; c.font = { bold: true }; c.border = { bottom: { style: "medium", color: { argb: "FF999999" } } }; c.alignment = { vertical: "middle" }; });
  hr.height = 22;
  // Wide enough for the bold heading (about one character per unit, plus room for the filter arrow) and for the longest value below it.
  const rows = quotaRows;
  heads.forEach((h, i) => { quota.getColumn(i + 1).width = Math.min(48, Math.max(h.length + 5, ...rows.map((r) => String(r[i] ?? "").length + 2))); });
  for (const r of quotaRows) quota.addRow(r);
  if (!quotaRows.length) quota.addRow(["Nothing to show."]);

  const reqRow = (r) => ({ name: who(r.email), email: r.email, type: TYPE(r.type), dates: range(r), from: r.from, days: r.days, status: STATUS[r.status] || r.status,
    paid: r.paidDays, lop: r.lopDays, reason: r.reason, applied: r.createdAt ? String(r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt).slice(0, 10) : "",
    decidedBy: r.decidedBy ? who(r.decidedBy) : "", decidedOn: r.decidedAt ? String(r.decidedAt instanceof Date ? r.decidedAt.toISOString() : r.decidedAt).slice(0, 10) : "" });
  const reqCols = [
    { header: "Name", key: "name", width: 26 }, { header: "Work email", key: "email", width: 30 }, { header: "Leave type", key: "type", width: 15 },
    { header: "Dates", key: "dates", width: 24 }, { header: "Days", key: "days", ...D }, { header: "Status", key: "status", width: 12 },
    { header: "Paid days", key: "paid", ...D }, { header: "Loss of pay days", key: "lop", ...D }, { header: "Reason", key: "reason", width: 40 },
    { header: "Applied on", key: "applied", width: 12 }, { header: "Decided by", key: "decidedBy", width: 24 }, { header: "Decided on", key: "decidedOn", width: 12 },
  ];
  const inYear = (r) => String(r.from).slice(0, 4) === String(year);
  const pendingAll = requests.filter((r) => r.status === "pending").sort((a, b) => (a.from < b.from ? -1 : 1));
  sheet(wb, "Pending", `${stamp} Every request still waiting for a decision, in any year.`, [
    ...reqCols.slice(0, 6), { header: "Waiting for", key: "waiting", width: 24 }, ...reqCols.slice(8, 10),
  ], pendingAll.map((r) => ({ ...reqRow(r), waiting: approvers[lc(r.email)] && approvers[lc(r.email)] !== "hr" ? who(approvers[lc(r.email)]) : "HR team" })));
  sheet(wb, "All requests", `${stamp} Requests that start in ${year}, newest first.`, reqCols,
    requests.filter(inYear).sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : 0)).map(reqRow));

  sheet(wb, "Comp offs", `${stamp} Comp-off credits for days worked in ${year}.`, [
    { header: "Name", key: "name", width: 26 }, { header: "Work email", key: "email", width: 30 }, { header: "Worked on", key: "workedOn", width: 12 },
    { header: "Days", key: "days", ...D }, { header: "Status", key: "status", width: 12 }, { header: "Reason", key: "reason", width: 40 }, { header: "Decided by", key: "decidedBy", width: 24 },
  ], compOffs.filter((c) => String(c.workedOn).slice(0, 4) === String(year)).sort((a, b) => (a.workedOn < b.workedOn ? 1 : -1))
    .map((c) => ({ name: who(c.email), email: c.email, workedOn: c.workedOn, days: c.days, status: STATUS[c.status] || c.status, reason: c.reason, decidedBy: c.decidedBy ? who(c.decidedBy) : "" })));

  sheet(wb, "Holidays", `${stamp}`, [{ header: "Date", key: "day", width: 14 }, { header: "Holiday", key: "name", width: 36 }],
    holidays.filter((h) => String(h.day).slice(0, 4) === String(year)).map((h) => ({ day: String(h.day).slice(0, 10), name: h.name })));

  return wb.xlsx.writeBuffer();
}

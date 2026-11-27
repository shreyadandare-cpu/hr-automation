import { openJson } from "./secret-box.js";
/*
 * The custom report builder, as Keka's: the kinds of data a report can be made from, their columns and filters, and how a
 * request is checked. Every column and filter is a fixed piece of SQL listed here; what the person sends only chooses among
 * them, and every value goes in as a query parameter. Routes are in report-builder.js.
 *
 * A dataset: perm (who may use it), team (the permission can be given for a reporting team: rows are then limited to it),
 * email (the person column used for that limit), from (the tables), order, columns { key: { label, sql, type } } and
 * filters { key: { label, type: "select" | "dates", sql, options } }. A column of type "dept" is worked out from the
 * department and job title, as everywhere else (payroll/store.js deptOf), so it is filtered after the query.
 */
const STATUS_EMP = [["active", "Working"], ["onboarding", "Joining"], ["offboarding", "Leaving"], ["offboarded", "Left"]];
const LEAVE_TYPES = [["casual", "Casual"], ["sick", "Sick"], ["compoff", "Comp off"], ["unpaid", "Unpaid"]];
const LEAVE_STATUS = [["pending", "Waiting"], ["approved", "Approved"], ["declined", "Declined"]];
const CLAIM_STATUS = [["draft", "Draft"], ["submitted", "Submitted"], ["under_review", "Under review"], ["changes_requested", "Changes asked"],
  ["resubmitted", "Sent again"], ["approved", "Approved"], ["rejected", "Rejected"], ["payroll_pending", "Waiting for payroll"], ["in_payroll", "In payroll"], ["paid", "Paid"]];
const ASSET_STATUS = [["In stock", "In stock"], ["Assigned", "Assigned"], ["In repair", "In repair"], ["Retired", "Retired"]];
const REVIEW_STATUS = [["self-pending", "Waiting for self-review"], ["manager-pending", "Waiting for manager"], ["hr-pending", "Waiting for HR"], ["done", "Finished"]];
const SOURCES = [["web", "App"], ["device", "Office device"], ["hr", "Added by HR"]];
const day = (sql) => `to_char(${sql},'YYYY-MM-DD')`;

export const DATASETS = {
  people: {
    label: "Employees", hint: "Everyone on the staff list, with their job, manager and dates.", perm: "people.view", team: true, email: "e.work_email",
    from: "employees e LEFT JOIN employees m ON lower(m.work_email) = lower(e.manager_email)", order: "e.name", always: ["e.title AS _title"],
    columns: {
      empNo: { label: "Employee number", sql: "e.emp_no" }, name: { label: "Name", sql: "e.name" }, email: { label: "Work email", sql: "e.work_email" },
      dept: { label: "Department", sql: "e.dept", type: "dept" }, title: { label: "Job title", sql: "e.title" }, manager: { label: "Reporting manager", sql: "m.name" },
      status: { label: "Status", sql: "e.status", type: "label", labels: STATUS_EMP }, type: { label: "Employment type", sql: "e.employment_type" },
      location: { label: "Work location", sql: "e.work_location" }, joined: { label: "Joining date", sql: day("e.start_date"), type: "date" },
      lastDay: { label: "Last day", sql: day("e.last_day"), type: "date" }, phone: { label: "Phone", sql: "COALESCE(NULLIF(e.phone, ''), e.person_sealed)", sealed: "phone" },
    },
    filters: {
      status: { label: "Status", type: "select", sql: "e.status", options: STATUS_EMP },
      dept: { label: "Department", type: "select", column: "dept", options: "depts" },
      joined: { label: "Joined", type: "dates", sql: "e.start_date" },
    },
    defaults: ["empNo", "name", "dept", "title", "manager", "joined", "status"],
  },
  leave: {
    label: "Leave", hint: "Leave requests with their days, status and loss of pay.", perm: "leave.manage", team: false, email: "l.work_email",
    from: "leave_requests l LEFT JOIN employees e ON lower(e.work_email) = lower(l.work_email)", order: "l.from_date DESC, l.id DESC",
    columns: {
      name: { label: "Name", sql: "COALESCE(e.name, l.work_email)" }, email: { label: "Work email", sql: "l.work_email" },
      type: { label: "Leave type", sql: "l.type", type: "label", labels: LEAVE_TYPES }, from: { label: "From", sql: day("l.from_date"), type: "date" },
      to: { label: "To", sql: day("l.to_date"), type: "date" }, days: { label: "Days", sql: "l.days::float8", type: "number" },
      half: { label: "Half day", sql: "l.half" }, status: { label: "Status", sql: "l.status", type: "label", labels: LEAVE_STATUS },
      paid: { label: "Paid days", sql: "l.paid_days::float8", type: "number" }, lop: { label: "Loss of pay days", sql: "l.lop_days::float8", type: "number" },
      reason: { label: "Reason", sql: "l.reason" }, applied: { label: "Applied on", sql: day("l.created_at AT TIME ZONE 'Asia/Kolkata'"), type: "date" },
    },
    filters: {
      status: { label: "Status", type: "select", sql: "l.status", options: LEAVE_STATUS },
      type: { label: "Leave type", type: "select", sql: "l.type", options: LEAVE_TYPES },
      from: { label: "Leave starting", type: "dates", sql: "l.from_date" },
    },
    defaults: ["name", "type", "from", "to", "days", "status", "lop"],
  },
  expenses: {
    label: "Expense claims", hint: "Claims with their amount, category and status.", perm: "expenses.approve", team: true, email: "r.work_email",
    from: "reimbursements r LEFT JOIN employees e ON lower(e.work_email) = lower(r.work_email)", order: "r.expense_date DESC, r.id DESC",
    columns: {
      claimNo: { label: "Claim number", sql: "r.claim_no" }, name: { label: "Name", sql: "COALESCE(e.name, r.work_email)" }, email: { label: "Work email", sql: "r.work_email" },
      category: { label: "Category", sql: "r.category" }, amount: { label: "Amount", sql: "COALESCE(r.reimb_sealed, r.amount::text)", sealed: "amount", type: "number" }, currency: { label: "Currency", sql: "r.currency" },
      date: { label: "Expense date", sql: day("r.expense_date"), type: "date" }, vendor: { label: "Vendor", sql: "r.vendor" }, invoice: { label: "Invoice number", sql: "r.invoice_no" },
      status: { label: "Status", sql: "r.status", type: "label", labels: CLAIM_STATUS }, description: { label: "Description", sql: "r.description" },
    },
    filters: {
      status: { label: "Status", type: "select", sql: "r.status", options: CLAIM_STATUS },
      date: { label: "Expense date", type: "dates", sql: "r.expense_date" },
    },
    defaults: ["claimNo", "name", "category", "amount", "date", "status"],
  },
  assets: {
    label: "Assets", hint: "Company devices and who has them.", perm: "assets.manage", team: false, email: "e.work_email",
    from: "assets a LEFT JOIN employees e ON e.id = a.assigned_to", order: "a.tag",
    columns: {
      tag: { label: "Asset tag", sql: "a.tag" }, category: { label: "Category", sql: "a.category" }, name: { label: "Asset", sql: "a.name" }, serial: { label: "Serial number", sql: "a.serial_no" },
      status: { label: "Status", sql: "a.status" }, holder: { label: "Assigned to", sql: "e.name" }, holderEmail: { label: "Their work email", sql: "e.work_email" },
      assigned: { label: "Assigned on", sql: day("a.assigned_on"), type: "date" }, purchased: { label: "Bought on", sql: day("a.purchased_on"), type: "date" },
      warranty: { label: "Warranty until", sql: day("a.warranty_until"), type: "date" },
    },
    filters: {
      status: { label: "Status", type: "select", sql: "a.status", options: ASSET_STATUS },
      warranty: { label: "Warranty ending", type: "dates", sql: "a.warranty_until" },
    },
    defaults: ["tag", "category", "name", "status", "holder", "warranty"],
  },
  reviews: {
    label: "Performance reviews", hint: "Reviews with the manager's, calibrated and final ratings.", perm: "reviews.manage", team: true, email: "r.email",
    from: "reviews r LEFT JOIN employees e ON lower(e.work_email) = lower(r.email) LEFT JOIN employees m ON lower(m.work_email) = lower(r.manager_email)", order: "r.period DESC, e.name",
    columns: {
      name: { label: "Name", sql: "COALESCE(e.name, r.email)" }, email: { label: "Work email", sql: "r.email" }, period: { label: "Review period", sql: "r.period" },
      manager: { label: "Manager", sql: "COALESCE(m.name, r.manager_email)" }, status: { label: "Status", sql: "r.status", type: "label", labels: REVIEW_STATUS },
      managerRating: { label: "Manager's rating", sql: "r.manager_rating", type: "number" }, calibrated: { label: "Calibrated rating", sql: "r.calibrated_rating", type: "number" },
      potential: { label: "Potential", sql: "r.potential", type: "label", labels: [[1, "Low"], [2, "Medium"], [3, "High"]] }, rating: { label: "Final rating", sql: "r.rating", type: "number" },
    },
    filters: {
      status: { label: "Status", type: "select", sql: "r.status", options: REVIEW_STATUS },
      period: { label: "Review period", type: "select", sql: "r.period", options: "periods" },
    },
    defaults: ["name", "period", "manager", "managerRating", "calibrated", "rating", "status"],
  },
  punches: {
    label: "Attendance punches", hint: "Every punch in and out, with where a punch from the app was made.", perm: "attendance.view", team: true, email: "e.work_email",
    from: "attendance_punches p JOIN employees e ON e.id = p.employee_id", order: "p.work_date DESC, e.name, p.punch_time", needsDates: "date",
    columns: {
      name: { label: "Name", sql: "e.name" }, email: { label: "Work email", sql: "e.work_email" }, date: { label: "Date", sql: day("p.work_date"), type: "date" },
      time: { label: "Time", sql: "to_char(p.punch_time,'HH24:MI')" }, direction: { label: "In or out", sql: "p.direction" },
      source: { label: "Recorded by", sql: "p.source", type: "label", labels: SOURCES }, office: { label: "Office", sql: "p.site_name" },
      distance: { label: "Metres from the office", sql: "p.distance_m", type: "number" }, outside: { label: "Outside the offices", sql: "CASE WHEN p.outside THEN 'Yes' ELSE '' END" },
    },
    filters: {
      date: { label: "Date", type: "dates", sql: "p.work_date" },
      source: { label: "Recorded by", type: "select", sql: "p.source", options: SOURCES },
    },
    defaults: ["name", "date", "time", "direction", "source", "office"],
  },
};

export const PREVIEW_ROWS = 100, CSV_ROWS = 10000, MAX_DATE_SPAN_DAYS = 400;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s) => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * A report request: { dataset, columns: [keys], filters: { key: value | { from, to } } }, checked against the dataset.
 * Returns { ds, columns, where: [sql], params, after: [js filters], errors }. `options` holds the lists worked out from the data
 * (departments, review periods), against which select values are checked.
 */
export function readReport(b = {}, options = {}) {
  const errors = {};
  const ds = DATASETS[b.dataset];
  if (!ds) return { errors: { dataset: "Please choose what the report is about." } };
  const cols = Array.isArray(b.columns) ? [...new Set(b.columns.map(String))] : [];
  if (!cols.length) errors.columns = "Please choose at least one column.";
  else if (cols.some((c) => !ds.columns[c])) errors.columns = "One of the columns is not available for this report.";
  else if (cols.length > 25) errors.columns = "Please choose 25 columns at most.";
  const where = [], params = [], after = [], f = b.filters && typeof b.filters === "object" ? b.filters : {};
  for (const [key, val] of Object.entries(f)) {
    const def = ds.filters[key];
    if (!def) { errors[key] = "This filter is not available for this report."; continue; }
    if (def.type === "select") {
      const v = String(val ?? "").trim();
      if (!v) continue;
      const list = Array.isArray(def.options) ? def.options.map(([k]) => String(k)) : (options[def.options] || []);
      if (!list.includes(v)) { errors[key] = `Please choose a ${def.label.toLowerCase()} from the list.`; continue; }
      if (def.column) after.push({ column: def.column, value: v });
      else { params.push(v); where.push(`${def.sql} = $${params.length}`); }
    } else {
      const from = String((val && val.from) || ""), to = String((val && val.to) || "");
      if (!from && !to) continue;
      if ((from && !validDate(from)) || (to && !validDate(to))) { errors[key] = "Please enter dates as day, month and year."; continue; }
      if (from && to && from > to) { errors[key] = "The start date must be on or before the end date."; continue; }
      if (from) { params.push(from); where.push(`${def.sql} >= $${params.length}`); }
      if (to) { params.push(to); where.push(`${def.sql} <= $${params.length}`); }
    }
  }
  if (ds.needsDates && !errors[ds.needsDates]) {
    const v = f[ds.needsDates] || {};
    if (!v.from || !v.to) errors[ds.needsDates] = `Please choose the ${ds.filters[ds.needsDates].label.toLowerCase()} range: from and to.`;
    else if ((Date.parse(v.to) - Date.parse(v.from)) / 86400000 > MAX_DATE_SPAN_DAYS) errors[ds.needsDates] = "Please choose at most 400 days at a time.";
  }
  return { ds, columns: cols, where, params, after, errors };
}

/** The SELECT for a checked request. scopeIndex: the parameter number holding the team's emails, when the rows are limited to a team. */
export function reportSql(ds, columns, where, scopeIndex = null, limit = CSV_ROWS) {
  const select = [...columns.map((c) => `${ds.columns[c].sql} AS "${c}"`), ...(ds.always || [])];
  // A department filter needs the department even when it is not shown.
  if (Object.values(ds.filters).some((x) => x.column) && !columns.includes("dept")) select.push(`${ds.columns.dept.sql} AS "dept"`);
  const conds = [...where, ...(scopeIndex ? [`lower(${ds.email}) = ANY($${scopeIndex})`] : [])];
  return `SELECT ${select.join(", ")} FROM ${ds.from}${conds.length ? ` WHERE ${conds.join(" AND ")}` : ""} ORDER BY ${ds.order} LIMIT ${Math.min(Math.max(1, limit), CSV_ROWS) + 1}`;
}

/** Rows as people read them: labels for codes, the department worked out, and only the chosen columns. */
export function shapeRows(ds, columns, rows, after, deptOf) {
  const out = [];
  for (const row of rows) {
    if (ds.columns.dept && "dept" in row) row.dept = deptOf(row.dept, row._title);
    if (after.some((a) => String(row[a.column]) !== a.value)) continue;
    out.push(columns.map((c) => {
      const def = ds.columns[c];
      // A figure stored sealed (secret-box.js) is read as its sealed column and opened here.
      // (Or the plain value, for a row not sealed yet.)
      const raw = def.sealed && row[c] != null ? (String(row[c]).startsWith("s1:") ? openJson(row[c])[def.sealed] : row[c]) : row[c];
      const v = def.sealed && def.type === "number" ? (raw == null ? null : Number(raw)) : raw;
      if (def.type === "label") { const hit = def.labels.find(([k]) => String(k) === String(v)); return hit ? hit[1] : v ?? ""; }
      return v ?? "";
    }));
  }
  return out;
}

/** CSV with a byte-order mark for Excel. A cell that starts like a formula gets a leading apostrophe, so a spreadsheet never runs it. */
export function toCsv(header, rows) {
  const cell = (v) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** A saved report: a name and the same request. */
export function readSaved(b = {}, options = {}) {
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 80) : "";
  const r = readReport(b, options);
  const errors = { ...r.errors };
  if (!name) errors.name = "Please name the report.";
  return { name, report: { dataset: b.dataset, columns: r.columns || [], filters: b.filters && typeof b.filters === "object" ? b.filters : {} }, errors };
}

/** What the page needs to build a report: the datasets this person may use, with columns and filters (and the lists for them). */
export const describe = (allowed, options) => Object.entries(DATASETS).filter(([k]) => allowed.includes(k)).map(([key, ds]) => ({
  key, label: ds.label, hint: ds.hint, defaults: ds.defaults, needsDates: ds.needsDates || null,
  columns: Object.entries(ds.columns).map(([k, c]) => ({ key: k, label: c.label })),
  filters: Object.entries(ds.filters).map(([k, x]) => ({ key: k, label: x.label, type: x.type,
    options: x.type === "select" ? (Array.isArray(x.options) ? x.options.map(([v, l]) => ({ value: String(v), label: l })) : (options[x.options] || []).map((v) => ({ value: v, label: v }))) : undefined })),
}));

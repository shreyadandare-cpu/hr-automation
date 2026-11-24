import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { COLUMNS, describe, parseProfiles, templateXlsx } from "../src/onboarding-import.js";
import { readTable } from "../src/holiday-import.js";

const HEAD = COLUMNS.map((c) => c.header);
const row = (o) => COLUMNS.map((c) => o[c.key] ?? "");
const one = (o, rowsBefore = []) => parseProfiles([HEAD, ...rowsBefore, row(o)]);
const good = { workEmail: "a.b@wohlig.com", dob: "14-Mar-1998", aadhaar: "2345 6789 0123", pan: "abcde1234f", holder: "Asha Bhatt", bankName: "HDFC Bank", account: "123456789012", ifsc: "hdfc0001234", pfNumber: "MH/BAN/12345/001", phone: "98765 43210", address: "12 Test Road, Mumbai" };

test("the template has every heading and the people given", async () => {
  const buf = await templateXlsx([{ email: "x@wohlig.com", empNo: "WT/9", name: "Xena" }]);
  assert.equal(buf.subarray(0, 2).toString(), "PK");
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const ws = wb.getWorksheet("Employee details");
  assert.deepEqual(ws.getRow(1).values.slice(1), HEAD);
  for (const h of ["Aadhaar number", "PAN number", "Bank account number", "IFSC code", "Date of birth"]) assert.ok(HEAD.includes(h), h);
  assert.equal(ws.getRow(2).getCell(1).value, "x@wohlig.com");
  assert.equal(ws.getRow(2).getCell(2).value, "WT/9");
  assert.equal(ws.getColumn(5).numFmt, "@", "the Aadhaar column is Text so Excel keeps all its digits");
  assert.ok(wb.getWorksheet("Instructions"));
  const empty = new ExcelJS.Workbook(); await empty.xlsx.load(await templateXlsx());
  assert.equal(empty.getWorksheet("Employee details").rowCount, 1);
});

test("a filled row is read and cleaned", () => {
  const { people, errors } = one(good);
  assert.deepEqual(errors, []);
  const p = people[0];
  assert.deepEqual(p.problems, {});
  assert.deepEqual(p.fields, { dob: "1998-03-14", aadhaar: "234567890123", pan: "ABCDE1234F", holder: "Asha Bhatt", bankName: "HDFC Bank", account: "123456789012", ifsc: "HDFC0001234", pfNumber: "MH/BAN/12345/001", phone: "9876543210", address: "12 Test Road, Mumbai" });
  assert.equal(p.email, "a.b@wohlig.com");
});

test("a real Excel date and numbers are accepted; a blank cell adds nothing", async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("s");
  ws.addRow(HEAD); ws.addRow(["a.b@wohlig.com", "", "", new Date(Date.UTC(1999, 0, 5)), 234567890123, "", "", "", 123456789012, "", "", 9876543210, ""]);
  const table = await readTable(Buffer.from(await wb.xlsx.writeBuffer()), 13);
  const { people } = parseProfiles(table);
  assert.deepEqual(people[0].problems, {});
  assert.deepEqual(people[0].fields, { dob: "1999-01-05", aadhaar: "234567890123", account: "123456789012", phone: "9876543210" });
});

test("every bad value is named on its row and nothing is guessed", () => {
  const { people } = one({ workEmail: "a.b@wohlig.com", dob: "31-Feb-1998", aadhaar: "1234", pan: "ABC", holder: "R2D2", account: "12345", ifsc: "NOPE", pfNumber: "!", phone: "12345" });
  assert.deepEqual(Object.keys(people[0].problems).sort(), ["aadhaar", "account", "dob", "holder", "ifsc", "pan", "pfNumber", "phone"]);
  assert.match(people[0].problems.dob, /not a date/);
  assert.deepEqual(people[0].fields, {});
  assert.match(one({ workEmail: "a@wohlig.com", dob: "2015-01-01" }).people[0].problems.dob, /16 to 80/);
});

test("a long number Excel turned into a shortened number is refused, not saved wrong", () => {
  const rows = [HEAD, COLUMNS.map((c) => (c.key === "workEmail" ? "a@wohlig.com" : c.key === "account" ? 1.2345678901234568e17 : ""))];
  assert.match(parseProfiles(rows).people[0].problems.account, /Text/);
});

test("a row needs to say who it is for, and a person appears once", () => {
  const r = parseProfiles([HEAD, row({ pan: "ABCDE1234F" })]);
  assert.equal(r.people.length, 0);
  assert.match(r.errors[0].message, /no work email or Employee ID/);
  const d = parseProfiles([HEAD, row({ workEmail: "a@wohlig.com", pan: "ABCDE1234F" }), row({ workEmail: "A@wohlig.com", pan: "ABCDE1234G" })]);
  assert.match(d.people[1].problems.workEmail, /listed twice/);
  assert.equal(parseProfiles([HEAD, row({ empNo: "wt/12", pan: "ABCDE1234F" })]).people[0].empNo, "WT/12");
});

test("headings are found in any order and a sheet without them is refused", () => {
  const shuffled = [["PAN number", "Work email", "IFSC code"], ["ABCDE1234F", "a@wohlig.com", "HDFC0001234"]];
  const { people } = parseProfiles(shuffled);
  assert.deepEqual(people[0].fields, { pan: "ABCDE1234F", ifsc: "HDFC0001234" });
  assert.match(parseProfiles([["Foo", "Bar"], ["1", "2"]]).errors[0].message, /headings/);
  assert.match(parseProfiles([HEAD]).errors[0].message, /No people/);
});

test("the preview shows ID numbers masked and says what is new or replaced", () => {
  const f = one(good).people[0].fields;
  const out = describe(f, { aadhaar_masked: "•••• •••• 9999", pan_masked: "AB••••••4F", acct_masked: null, ifsc: "HDFC0001234", pf_number: null });
  const by = Object.fromEntries(out.map((x) => [x.key, x]));
  assert.equal(by.aadhaar.value, "•••• •••• 0123");
  assert.equal(by.aadhaar.status, "replaces");
  assert.equal(by.pan.value, "AB••••••4F");
  assert.equal(by.pan.status, "same");
  assert.equal(by.account.value, "•••• 9012");
  assert.equal(by.account.status, "new");
  assert.equal(by.ifsc.status, "same");
  assert.ok(!JSON.stringify(out).includes("234567890123") && !JSON.stringify(out).includes("123456789012") && !JSON.stringify(out).includes("ABCDE1234F"), "no full number in the preview");
});

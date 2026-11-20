import test from "node:test";
import assert from "node:assert/strict";
import { compare, parseDate, parseHolidays, readTable, templateXlsx } from "../src/holiday-import.js";

test("dates are read day first, from text or Excel", () => {
  const ok = { "26-Jan-2027": "2027-01-26", "26 Jan 2027": "2027-01-26", "26/01/2027": "2027-01-26", "26-01-27": "2027-01-26", "2027-01-26": "2027-01-26", "1st May 2027": "2027-05-01", "Jan 26, 2027": "2027-01-26", "03.03.2027": "2027-03-03" };
  for (const [t, d] of Object.entries(ok)) assert.equal(parseDate(t), d, t);
  assert.equal(parseDate(new Date(Date.UTC(2027, 0, 26))), "2027-01-26");
  assert.equal(parseDate(46413), "2027-01-26");   // the Excel serial number of that day
  for (const bad of ["", "soon", "31-02-2027", "32/01/2027", "2027-13-01", "26-Foo-2027", "12", null, 5]) assert.equal(parseDate(bad), null, String(bad));
});

test("a sheet becomes holidays in the same shape as the 2026 list", () => {
  const { holidays, errors } = parseHolidays([["Date", "Holiday", "Type"], ["15-Aug-2027", "Independence Day", "National"], ["26/01/2027", "  Republic   Day ", ""], [], ["2027-10-21", "Dasara"]]);
  assert.deepEqual(errors, []);
  assert.deepEqual(holidays, [{ day: "2027-01-26", name: "Republic Day", type: null }, { day: "2027-08-15", name: "Independence Day", type: "National" }, { day: "2027-10-21", name: "Dasara", type: null }]);
});

test("the headings may sit lower, in any order, with other names", () => {
  const { holidays, errors } = parseHolidays([["Wohlig holidays 2027"], [], ["Occasion", "Date", "Category", "Day"], ["Holi", "22-03-2027", "Festival", "Monday"]]);
  assert.deepEqual(errors, []);
  assert.deepEqual(holidays, [{ day: "2027-03-22", name: "Holi", type: "Festival" }]);
});

test("problems are listed with their row, and good rows still come through", () => {
  const { holidays, errors } = parseHolidays([["Date", "Holiday"], ["26-Jan-2027", "Republic Day"], ["soon", "Mystery"], ["02-10-2027", ""], ["26-Jan-2027", "Again"], ["03-03-2027", "x".repeat(81)]]);
  assert.equal(holidays.length, 1);
  assert.deepEqual(errors.map((e) => e.row), [3, 4, 5, 6]);
  assert.match(errors[0].message, /not a date/);
  assert.match(errors[1].message, /no name/);
  assert.match(errors[2].message, /listed twice/);
  assert.match(errors[3].message, /80 characters/);
});

test("a sheet without the headings, or without holidays, is refused with a clear message", () => {
  assert.match(parseHolidays([["26-Jan-2027", "Republic Day"]]).errors[0].message, /headings Date and Holiday/);
  assert.match(parseHolidays([["Date", "Type"], ["26-Jan-2027", "National"]]).errors[0].message, /Holiday/);
  assert.match(parseHolidays([["Date", "Holiday"]]).errors[0].message, /No holidays/);
});

test("each holiday is compared with what is saved", () => {
  const saved = new Map([["2027-01-26", { name: "Republic Day", type: null }], ["2027-08-15", { name: "Independence", type: null }]]);
  const out = compare([{ day: "2027-01-26", name: "Republic Day", type: null }, { day: "2027-08-15", name: "Independence Day", type: "National" }, { day: "2027-10-21", name: "Dasara", type: null }], saved);
  assert.deepEqual(out.map((h) => h.status), ["same", "changed", "new"]);
  assert.deepEqual(out[1].was, { name: "Independence", type: null });
});

test("the template reads back as the same holidays (Excel and CSV)", async () => {
  const current = [{ day: "2027-01-26", name: "Republic Day", type: "National" }, { day: "2027-10-21", name: "Dasara", type: null }];
  const back = parseHolidays(await readTable(await templateXlsx(2027, current)));
  assert.deepEqual(back.errors, []);
  assert.deepEqual(back.holidays, current);
  const csv = parseHolidays(await readTable(Buffer.from('﻿Date,Holiday,Type\n26/01/2027,"Republic Day, India",National\n')));
  assert.deepEqual(csv.holidays, [{ day: "2027-01-26", name: "Republic Day, India", type: "National" }]);
  assert.deepEqual(parseHolidays(await readTable(await templateXlsx(2028, []))).errors.length, 1);   // an empty template has no holidays yet
});

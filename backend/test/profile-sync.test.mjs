import test from "node:test";
import assert from "node:assert/strict";
import { employeeFieldsFrom } from "../src/profile.js";

test("a saved profile writes the filled-in details onto the employee record, and never the name", () => {
  const f = employeeFieldsFrom({
    primary: { first: "Asha", last: "Shah", dob: "1999-05-17" },
    contact: { personalEmail: "asha@gmail.com", phone: "9876543210" },
    addresses: { current: { line: "12 MG Road", city: "Pune", state: "Maharashtra", pin: "411001", country: "India" } },
  });
  assert.deepEqual(f, { personal_email: "asha@gmail.com", phone: "9876543210", dob: "1999-05-17", address: "12 MG Road, Pune, Maharashtra, 411001, India" });
});

test("a profile with nothing filled in writes nothing, so HR's details are never blanked", () => {
  assert.deepEqual(employeeFieldsFrom({ primary: { first: "Asha" }, contact: {}, addresses: {} }), {});
  assert.deepEqual(employeeFieldsFrom({}), {});
});

test("a date of birth that is not a date is not written", () => {
  assert.deepEqual(employeeFieldsFrom({ primary: { dob: "17/05/1999" } }), {});
});

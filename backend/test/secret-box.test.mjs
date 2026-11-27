import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { SEALED, emailIndex, indexesOf, openJson, openSealedResult, openSealedRow, sealFields, sealJson } from "../src/secret-box.js";

const withEnv = async (env, fn) => {
  const before = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { await fn(); } finally { for (const [k, v] of Object.entries(before)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
};
const KEY = { PAYROLL_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex") };

test("a salary row is sealed whole and its plain columns are left empty", () => withEnv(KEY, () => {
  const slip = { summary: { net: 48000, gross: 50000 }, incomplete: [] };
  const { sealed, plain } = sealFields("item_sealed", { base_salary: "50000.00", lop_deduction: 0, reimbursement_total: 0, payable: 48000, slip, inputs: { hold: false, bonus: 2500 } });
  assert.match(sealed, /^s1:/);
  assert.ok(!sealed.includes("48000") && !sealed.includes("bonus"), "nothing readable in the stored value");
  assert.deepEqual(plain, { base_salary: null, lop_deduction: null, reimbursement_total: null, payable: null, slip: null, inputs: "{}" }, "NOT NULL columns get their empty value");
  assert.deepEqual(openJson(sealed), { base_salary: "50000.00", lop_deduction: 0, reimbursement_total: 0, payable: 48000, slip, inputs: { hold: false, bonus: 2500 } });
}));

test("a read gets every figure back under its own name, and the sealed column is removed", () => withEnv(KEY, () => {
  const row = { id: 7, work_email: "a@wohlig.com", payable: null, slip: null, inputs: {}, item_sealed: sealJson({ payable: 48000, slip: { a: 1 }, inputs: { hold: true } }) };
  assert.deepEqual(openSealedRow(row), { id: 7, work_email: "a@wohlig.com", payable: 48000, slip: { a: 1 }, inputs: { hold: true } });
  const plainRow = { id: 8, payable: "100.00", item_sealed: null };
  assert.deepEqual(openSealedRow(plainRow), { id: 8, payable: "100.00" }, "a row saved before encryption reads as it is");
  const joined = { pay_sealed: sealJson({ monthly_gross: 61000 }), run_sealed: sealJson({ totals: { net: 9 } }), monthly_gross: null, totals: null };
  assert.deepEqual(openSealedRow(joined), { monthly_gross: 61000, totals: { net: 9 } }, "two sealed columns in one joined row");
  const res = { fields: [{ name: "item_sealed" }], rows: [{ item_sealed: sealJson({ payable: 1 }) }, { item_sealed: null, payable: 2 }] };
  assert.deepEqual(openSealedResult(res).rows, [{ payable: 1 }, { payable: 2 }]);
  const other = { fields: [{ name: "x" }], rows: [{ x: "s1:not-touched" }] };
  assert.deepEqual(openSealedResult(other).rows, [{ x: "s1:not-touched" }], "results without a sealed column are left alone");
}));

test("a changed value or another key is refused, never read wrong", () => withEnv(KEY, async () => {
  const s = sealJson({ payable: 48000 });
  const parts = s.split(":"); const body = Buffer.from(parts[3], "base64"); body[0] ^= 1; parts[3] = body.toString("base64");
  assert.throws(() => openJson(parts.join(":")));
  await withEnv({ PAYROLL_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex") }, () => assert.throws(() => openJson(s)));
  await withEnv({ PAYROLL_ENCRYPTION_KEY: undefined }, () => assert.throws(() => openJson(s), /PAYROLL_ENCRYPTION_KEY/));
}));

test("without the key: refused on the live server, plain only in local development", () => withEnv({ PAYROLL_ENCRYPTION_KEY: undefined }, async () => {
  await withEnv({ NODE_ENV: "production" }, () => assert.throws(() => sealFields("adjustment_sealed", { amount: 500 }), (e) => e.status === 503));
  await withEnv({ NODE_ENV: "development" }, () => assert.deepEqual(sealFields("adjustment_sealed", { amount: 500 }), { sealed: null, plain: { amount: 500 } }));
}));

test("every salary table and figure is covered", () => {
  assert.deepEqual(Object.values(SEALED).map((x) => x.table).sort(),
    ["advance_recoveries", "advance_requests", "budget_request_events", "budget_requests", "contractor_payments", "employee_advances", "employees", "employees", "loan_events", "loans",
      "offboarding_clearances", "offer_letters", "payroll_adjustments", "payroll_audit", "payroll_files", "payroll_items", "payroll_runs", "profiles", "reimbursement_documents", "reimbursement_events",
      "reimbursement_items", "reimbursements", "salary_structures", "tax_declaration_requests", "tax_declarations"]);
  assert.ok(SEALED.clearance_sealed.fields.includes("net_salary") && SEALED.offer_sealed.fields.includes("ctc_annual") && SEALED.offer_sealed.fields.includes("letter_text"));
  assert.ok(SEALED.item_sealed.fields.includes("payable") && SEALED.item_sealed.fields.includes("slip") && SEALED.item_sealed.fields.includes("inputs"));
  assert.ok(SEALED.structure_sealed.fields.includes("earnings") && SEALED.structure_sealed.fields.includes("annual_ctc"));
});

test("amounts are rounded to paise, as the database used to", () => withEnv(KEY, () => {
  const { sealed } = sealFields("pay_sealed", { monthly_gross: 50000.555 });
  assert.equal(openJson(sealed).monthly_gross, 50000.56);
  assert.deepEqual(openJson(sealFields("item_sealed", { payable: 100.004, slip: { net: 100.004 } }).sealed), { payable: 100, slip: { net: 100.004 } }, "only money columns, not the payslip inside");
}));

test("plain figures written by an older release win over a stale sealed copy", () => withEnv(KEY, () => {
  const row = { payable: "52000.00", slip: { summary: { net: 52000 } }, inputs: {}, item_sealed: sealJson({ payable: 48000, slip: { summary: { net: 48000 } }, inputs: {} }) };
  assert.deepEqual(openSealedRow(row), { payable: "52000.00", slip: { summary: { net: 52000 } }, inputs: {} });
}));

test("a monthly gross that can't be decrypted is left empty, so pages about other things keep working", () => withEnv(KEY, async () => {
  const v = sealJson({ monthly_gross: 61000 });
  await withEnv({ PAYROLL_ENCRYPTION_KEY: undefined }, () => {
    assert.deepEqual(openSealedRow({ name: "A", monthly_gross: null, pay_sealed: v }), { name: "A", monthly_gross: null });
    assert.throws(() => openSealedRow({ item_sealed: v }), "payroll's own tables refuse instead");
  });
}));

test("old notices and audit lines lose their amounts, and keep their words", async () => {
  const { redactMoney } = await import("../src/payroll/sealing.js");
  assert.equal(redactMoney("Payroll for Oct: ₹48,000 net for 3 people"), "Payroll for Oct: [amount removed] net for 3 people");
  assert.equal(redactMoney("Offer prepared for A: Engineer, CTC 1200000, joining 2026-12-01"), "Offer prepared for A: Engineer, [amount removed], joining 2026-12-01");
  assert.equal(redactMoney("final salary ₹43,210.50, payout Rs. 500"), "final salary [amount removed], payout [amount removed]");
  assert.equal(redactMoney("REIM-2026-0001: Approved by HR (3 expenses)"), "REIM-2026-0001: Approved by HR (3 expenses)");
});

test("personal details are sealed: contact details, date of birth, masked IDs and bank, the PF number and the whole profile", () => {
  for (const f of ["personal_email", "phone", "address", "dob", "aadhaar_masked", "pan_masked", "acct_masked", "ifsc"]) assert.ok(SEALED.person_sealed.fields.includes(f), f);
  assert.ok(SEALED.pay_sealed.fields.includes("pf_number"));
  assert.deepEqual(SEALED.profile_sealed, { table: "profiles", fields: ["data"], key: "email" });
});

test("personal details are opened field by field, and only the fields the query asked for", () => withEnv(KEY, () => {
  const { sealed, plain } = sealFields("person_sealed", { personal_email: "a@gmail.com", phone: "9876543210", address: "12 MG Road, Pune", dob: "1998-03-14", pan_masked: "XXXXXX234F" });
  assert.ok(!/gmail|9876543210|MG Road|1998|234F/.test(sealed), "nothing readable in the stored value");
  assert.deepEqual(plain, { personal_email: null, phone: null, address: null, dob: null, pan_masked: null });
  // A roster reading only the phone never also carries the address or the date of birth.
  assert.deepEqual(openSealedRow({ name: "A", phone: null, person_sealed: sealed }), { name: "A", phone: "9876543210" });
  // A phone an older release wrote after sealing wins; the other fields still come from the sealed copy.
  assert.deepEqual(openSealedRow({ phone: "9000000000", address: null, dob: null, person_sealed: sealed }), { phone: "9000000000", address: "12 MG Road, Pune", dob: "1998-03-14" });
  // The profile record, with its empty JSON default.
  const p = sealFields("profile_sealed", { data: { contact: { phone: "9876543210" } } });
  assert.deepEqual(p.plain, { data: "{}" });
  assert.deepEqual(openSealedRow({ data: {}, profile_sealed: p.sealed }), { data: { contact: { phone: "9876543210" } } });
}));

test("personal details that can't be decrypted are left empty, so the portal keeps working", () => withEnv(KEY, async () => {
  const v = sealJson({ phone: "9876543210" });
  await withEnv({ PAYROLL_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex") }, () => {
    assert.deepEqual(openSealedRow({ name: "A", phone: null, person_sealed: v }), { name: "A", phone: null });
  });
}));

test("a personal email is found by a keyed hash: the same address gives the same hash, another key another one, none without the key", () => withEnv(KEY, async () => {
  const h = emailIndex("Asha@Gmail.com ");
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(emailIndex("asha@gmail.com"), h, "case and spaces do not matter");
  assert.notEqual(emailIndex("other@gmail.com"), h);
  assert.deepEqual(indexesOf("person_sealed", { personal_email: "asha@gmail.com" }), { personal_email_hash: h });
  assert.deepEqual(indexesOf("profile_sealed", { data: { contact: { personalEmail: "ASHA@gmail.com" } } }), { personal_email_hash: h });
  assert.deepEqual(indexesOf("person_sealed", { phone: "1" }), {}, "a change that leaves the email alone leaves its hash alone");
  await withEnv({ PAYROLL_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex") }, () => assert.notEqual(emailIndex("asha@gmail.com"), h));
  await withEnv({ PAYROLL_ENCRYPTION_KEY: undefined }, () => assert.equal(emailIndex("asha@gmail.com"), null));
}));

test("the date of birth on the person's own profile wins over HR's, and the profile is not passed on", async () => {
  const { dobOf } = await import("../src/sealed-rows.js");
  assert.deepEqual(dobOf({ name: "A", dob: "1990-01-02", data: { primary: { dob: "1991-05-06" }, contact: { phone: "1" } } }), { name: "A", dob: "1991-05-06" });
  assert.deepEqual(dobOf({ name: "A", dob: "1990-01-02", data: { primary: { dob: "" } } }), { name: "A", dob: "1990-01-02" });
  assert.deepEqual(dobOf({ name: "A", dob: null, data: null }), { name: "A", dob: null });
});

test("a save never seals over personal details it could not read (wrong key): it stops instead", () => withEnv(KEY, async () => {
  const { updateSealed } = await import("../src/sealed-rows.js");
  const stored = sealJson({ phone: "9876543210", address: "12 MG Road" });
  const written = [];
  const fakeDb = { query: async (sql, args) => { if (/^SELECT/.test(sql)) return { rows: [openSealedRow({ id: 1, phone: null, address: null, person_sealed: stored, sealed_now: stored })] }; written.push(args); return { rows: [{}] }; } };
  await withEnv({ PAYROLL_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex") }, async () => {
    await assert.rejects(updateSealed(fakeDb, "person_sealed", 1, { pan_masked: "XXXXXX111A" }));
  });
  assert.equal(written.length, 0, "nothing was written");
}));

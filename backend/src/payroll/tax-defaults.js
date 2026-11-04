/*
 * Starting tax rules, copied into the tax_rules table the first time the payroll database is set up (never overwriting
 * a row HR or the CA has edited). After that the table is the source; edit rules in Payroll → Settings.
 *
 * FY 2025-26 per the Finance Act 2025. Budget 2026 (February 2026) left slabs, rebate, standard deduction, surcharge and
 * cess unchanged for FY 2026-27 (the first year under the Income-tax Act 2025, which renumbers the sections). Have the CA
 * confirm each year's row before the first payroll of that year.
 */
const NEW_REGIME = {
  label: "New regime (115BAC) – default",
  standardDeduction: 75000,
  slabs: [
    { upTo: 400000, rate: 0 }, { upTo: 800000, rate: 5 }, { upTo: 1200000, rate: 10 }, { upTo: 1600000, rate: 15 },
    { upTo: 2000000, rate: 20 }, { upTo: 2400000, rate: 25 }, { upTo: null, rate: 30 },
  ],
  rebate: { maxIncome: 1200000, maxRebate: 60000, marginalRelief: true },
  surcharge: [{ above: 5000000, rate: 10 }, { above: 10000000, rate: 15 }, { above: 20000000, rate: 25 }],
  cessRate: 4,
  allowedDeductions: ["employerNps"],
  caps: {},
};

const OLD_REGIME = {
  label: "Old regime (opted out of 115BAC)",
  standardDeduction: 50000,
  slabs: [{ upTo: 250000, rate: 0 }, { upTo: 500000, rate: 5 }, { upTo: 1000000, rate: 20 }, { upTo: null, rate: 30 }],
  rebate: { maxIncome: 500000, maxRebate: 12500, marginalRelief: false },
  surcharge: [{ above: 5000000, rate: 10 }, { above: 10000000, rate: 15 }, { above: 20000000, rate: 25 }, { above: 50000000, rate: 37 }],
  cessRate: 4,
  allowedDeductions: ["professionalTax", "hraExemption", "section80C", "section80D", "homeLoanInterest", "nps80CCD1B", "employerNps", "otherDeductions"],
  caps: { section80C: 150000, section80D: 100000, homeLoanInterest: 200000, nps80CCD1B: 50000 },
  note: "Basic exemption shown is for residents below 60. Senior citizens (₹3,00,000) and super seniors (₹5,00,000) need their own rule or a TDS override.",
};

export const DEFAULT_TAX_RULES = [
  { fy: "2025-26", regime: "new", rules: NEW_REGIME, source: "Finance Act 2025" },
  { fy: "2025-26", regime: "old", rules: OLD_REGIME, source: "Finance Act 2025" },
  { fy: "2026-27", regime: "new", rules: NEW_REGIME, source: "Finance Act 2026: no change to slabs, rebate or standard deduction" },
  { fy: "2026-27", regime: "old", rules: OLD_REGIME, source: "Finance Act 2026: no change to slabs, rebate or standard deduction" },
];

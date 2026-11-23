/* HR's "Salary breakup format": how a monthly gross is split into salary lines, by the size of the yearly salary.
   The same rules are in backend/src/payroll-calc.js (splitGross); keep the two in step.
     up to ₹7,00,000 a year   Basic 50%, HRA 50% of Basic, Statutory Bonus 8.33% of Basic, Special Allowance the rest
     ₹7,00,001 to ₹12,00,000  adds Medical ₹1,250 and Conveyance ₹1,600
     above ₹12,00,000         adds Fuel ₹1,800, LTA (same as the bonus), Driver ₹900, Books ₹1,200, Mobile/Data ₹500
   PF is ₹3,000 and Professional Tax ₹200 in every band. Amounts are whole rupees. */
export const BAND_LIMITS = { low: 700000, mid: 1200000 };
export function splitGross(monthlyGross) {
  const g = Math.round(Number(monthlyGross));
  if (!(g > 0)) return [];
  const annual = g * 12, band = annual <= BAND_LIMITS.low ? "low" : annual <= BAND_LIMITS.mid ? "mid" : "high";
  const basic = Math.round(g / 2), hra = Math.round(basic / 2), bonus = Math.ceil(basic * 0.0833);
  const fixed = [["Basic", basic], ["HRA", hra]];
  if (band !== "low") fixed.push(["Medical Allowance", 1250], ["Conveyance Allowance", 1600]);
  if (band === "high") fixed.push(["Fuel Reimbursement", 1800], ["LTA", bonus], ["Driver Salary Reimbursement", 900], ["Books & Periodicals", 1200]);
  fixed.push(["Statutory Bonus", bonus]);
  if (band === "high") fixed.push(["Mobile/Data Reimbursement", 500]);
  const used = fixed.reduce((n, [, a]) => n + a, 0);
  fixed.push(["Special Allowance", Math.max(0, g - used)]);
  return fixed.map(([name, amount]) => ({ name, amount }));
}

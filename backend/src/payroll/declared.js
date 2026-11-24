/*
 * An employee's own declaration (Pay > Tax declaration) as the tax details payroll uses, for anyone payroll has not entered
 * tax details for itself. Pure, so it is tested without a database (test/tax-declaration.test.mjs).
 *
 * As in Keka: declared amounts count until HR decides on the proof; a rejected line counts nothing; a line approved for less
 * counts the approved amount; after the proof due date only verified claims count. Rent becomes the HRA exemption, worked out
 * from the salary structure's Basic and HRA for the months worked in the year; leave travel fares become the leave travel
 * exemption, up to the leave travel allowance (an "LTA" salary line) paid in those months.
 */
import { kindOf } from "./engine.js";
import { fyMonths, hraExemption, isLtaLine, ltaExemption, payrollFieldsFrom } from "./tax.js";

/** Months of the financial year ("2026-27") the person is employed: from the joining month to the leaving month. */
export function monthsEmployed(fy, start, lastDay) {
  const from = start ? String(start instanceof Date ? start.toISOString() : start).slice(0, 7) : null;
  const to = lastDay ? String(lastDay instanceof Date ? lastDay.toISOString() : lastDay).slice(0, 7) : null;
  return fyMonths(fy).filter((m) => (!from || m >= from) && (!to || m <= to)).length;
}

/** { regime, declaration, hra, lta } from a submitted request { regime, items, proofs }. */
export function fromEmployee({ request, structure, fy, start, lastDay, proofsFinal = false }) {
  const regime = request.regime === "old" ? "old" : "new";
  const { fields, rentDeclared, metro, faresDeclared } = payrollFieldsFrom(request.items || [], regime, { proofs: request.proofs || {}, proofsFinal });
  const declaration = { ...fields };
  const earnings = (structure && structure.earnings) || [];
  const months = monthsEmployed(fy, start, lastDay);
  let hra = null, lta = null;
  if (regime === "old" && rentDeclared > 0) {
    const monthly = (k) => earnings.filter((x) => kindOf(x.name) === k).reduce((n, x) => n + (Number(x.amount) || 0), 0);
    const basic = monthly("basic") * months, received = monthly("hra") * months;
    const exemption = hraExemption({ rent: rentDeclared, basic, hra: received, metro });
    if (exemption) declaration.hraExemption = exemption;
    hra = { rent: rentDeclared, basic, received, metro, exemption };
  }
  if (regime === "old" && faresDeclared > 0) {
    const received = earnings.filter((x) => isLtaLine(x.name)).reduce((n, x) => n + (Number(x.amount) || 0), 0) * months;
    const exemption = ltaExemption({ fares: faresDeclared, received });
    if (exemption) declaration.ltaExemption = exemption;
    lta = { fares: faresDeclared, received, exemption };
  }
  return { regime, declaration, hra, lta };
}

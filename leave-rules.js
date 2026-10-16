/* Leave rules shared by the server (Node) and the HR Access Hub page (browser), so both count days,
   balances and salary cuts the same way. Dates are plain "YYYY-MM-DD" strings throughout. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LeaveRules = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const POLICY = {
    startYear: 2026,      // first year tracked here; earlier leave sits in each person's opening balance
    casualPerYear: 14,    // casual leave days a year, pro-rated in the year someone joins
    sickPerYear: 6,       // sick leave days a year, pro-rated the same way
    lopDivisor: 30,       // salary cut per loss-of-pay day = monthly gross / 30
  };
  // casual carries over to next year; sick leave and comp offs lapse on 31 Dec
  const TYPES = {
    casual: { name: "Casual leave", paid: true },
    sick: { name: "Sick leave", paid: true },
    compoff: { name: "Comp off", paid: true },
    unpaid: { name: "Unpaid leave", paid: false },
  };

  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const fmt = (d) => d.toISOString().slice(0, 10);
  const validDate = (s) => typeof s === "string" && ISO.test(s) && fmt(parse(s)) === s;
  const isWeekend = (s) => { const w = parse(s).getUTCDay(); return w === 0 || w === 6; };
  const half = (n) => Math.round(n * 2) / 2;

  /** Working dates from `from` to `to` inclusive: Saturdays, Sundays and listed holidays are skipped. */
  function workingDates(from, to, holidays = []) {
    const off = new Set(holidays);
    const out = [];
    for (let d = parse(from), end = parse(to); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const s = fmt(d);
      if (!isWeekend(s) && !off.has(s)) out.push(s);
    }
    return out;
  }

  /** Yearly quota: the full amount, or pro-rated by month for the year someone joins (rounded to half days). */
  function quota(perYear, year, joinDate) {
    if (!joinDate || !validDate(joinDate)) return perYear;
    const jy = Number(joinDate.slice(0, 4)), jm = Number(joinDate.slice(5, 7));
    if (jy > year) return 0;
    if (jy < year) return perYear;
    return half((perYear * (13 - jm)) / 12);
  }
  const casualQuota = (year, joinDate) => quota(POLICY.casualPerYear, year, joinDate);

  /** Days a request takes: 0.5 for a half day on a working day, otherwise the working days in the range. */
  function requestDays(from, to, halfDay, holidays = []) {
    if (halfDay) return workingDates(from, from, holidays).length ? 0.5 : 0;
    return workingDates(from, to, holidays).length;
  }
  const HALVES = { first: "first half", second: "second half" };

  const yearOf = (s) => Number(s.slice(0, 4));
  const sum = (xs, f) => xs.reduce((n, x) => n + Number(f(x) || 0), 0);

  /**
   * Balances for one person in `year`.
   * emp: { start, casualOpening }  requests: that person's requests  compOffs: that person's comp-off credits
   * Approved requests count by their stored paid_days; pending ones are shown separately and not deducted.
   */
  function balances(year, emp, requests, compOffs) {
    const first = Math.max(POLICY.startYear, emp.start && validDate(emp.start) ? yearOf(emp.start) : POLICY.startYear);
    const approved = requests.filter((r) => r.status === "approved");
    let carry = Number(emp.casualOpening || 0), casual = null;
    for (let y = first; y <= year; y++) {
      const quota = casualQuota(y, emp.start);
      const used = sum(approved.filter((r) => r.type === "casual" && yearOf(r.from) === y), (r) => r.paidDays);
      casual = { carried: carry, quota, used, left: carry + quota - used };
      carry = Math.max(0, casual.left);   // unused casual leave carries over in full
    }
    if (!casual) casual = { carried: 0, quota: 0, used: 0, left: 0 };   // year before tracking or before joining
    const inYear = (r) => yearOf(r.from) === year;
    const sickQuota = quota(POLICY.sickPerYear, year, emp.start);
    const sickUsed = sum(approved.filter((r) => r.type === "sick" && inYear(r)), (r) => r.paidDays);
    const earned = sum(compOffs.filter((c) => (c.status || "approved") === "approved" && yearOf(c.workedOn) === year), (c) => c.days);
    const compUsed = sum(approved.filter((r) => r.type === "compoff" && inYear(r)), (r) => r.paidDays);
    return {
      casual,
      sick: { quota: year < POLICY.startYear ? 0 : sickQuota, used: sickUsed, left: (year < POLICY.startYear ? 0 : sickQuota) - sickUsed },
      compoff: { earned, used: compUsed, left: earned - compUsed },
      lopDays: sum(approved.filter(inYear), (r) => r.lopDays),
      pendingDays: sum(requests.filter((r) => r.status === "pending" && inYear(r)), (r) => r.days),
      consumed: Object.fromEntries(Object.keys(TYPES).map((t) => [t, sum(approved.filter((r) => r.type === t && inYear(r)), (r) => r.days)])),
    };
  }

  /** Split a request into paid and loss-of-pay days against what is left of its leave type. */
  function allocate(type, days, bal) {
    if (!TYPES[type].paid) return { paid: 0, lop: days };
    const left = Math.max(0, bal[type].left);
    const paid = Math.min(days, left);
    return { paid, lop: days - paid };
  }

  /** Loss-of-pay days per month for one approved request. The last working days of the request are the unpaid ones. */
  function lopByMonth(req, holidays) {
    let left = Number(req.lopDays || 0);
    const out = {};
    for (const d of workingDates(req.from, req.half ? req.from : req.to, holidays).reverse()) {
      if (left <= 0) break;
      const take = Math.min(1, left);
      out[d.slice(0, 7)] = (out[d.slice(0, 7)] || 0) + take;
      left -= take;
    }
    return out;
  }

  const salaryCut = (monthlyGross, lopDays) => Math.round((Number(monthlyGross) / POLICY.lopDivisor) * lopDays);

  /**
   * Final settlement leave figures for someone leaving on lastDay.
   * Unused casual leave is paid out. In the leaving year the casual quota only counts the months worked (up to and
   * including the leaving month). Loss-of-pay days in the leaving month are deducted. Sick leave and comp offs are not paid.
   */
  function exitSettlement({ emp, lastDay, requests = [], compOffs = [], monthlyGross = null, holidays = [] }) {
    if (!validDate(lastDay)) return null;
    const year = yearOf(lastDay), exitMonth = Number(lastDay.slice(5, 7));
    const taken = requests.filter((r) => r.status === "approved" && r.from <= lastDay);
    const bal = balances(year, emp, taken, compOffs);
    const full = casualQuota(year, emp.start);
    const jy = emp.start && validDate(emp.start) ? yearOf(emp.start) : 0;
    const firstMonth = jy === year ? Number(emp.start.slice(5, 7)) : 1;
    const months = Math.max(0, exitMonth - firstMonth + 1);
    const quota = jy > year ? 0 : half((POLICY.casualPerYear * months) / 12);
    const casualLeft = Math.max(0, bal.casual.left - full + quota);
    const month = lastDay.slice(0, 7);
    const lopDays = taken.reduce((n, r) => n + (lopByMonth(r, holidays)[month] || 0), 0);
    const gross = monthlyGross ? Number(monthlyGross) : null;
    const encashment = gross ? salaryCut(gross, casualLeft) : null;
    const deduction = gross ? salaryCut(gross, lopDays) : null;
    return { casualLeft, quota, carried: bal.casual.carried, used: bal.casual.used, lopDays, month,
      monthlyGross: gross, encashment, deduction, net: gross ? encashment - deduction : null };
  }

  /** Problems with a new leave request, as { field: message }. Empty object means it can be saved. */
  function requestProblems({ emp, type, from, to, half: halfDay, reason, holidays = [], existing = [], bal }) {
    const e = {};
    if (halfDay && !HALVES[halfDay]) e.half = "Pick the first or second half.";
    if (halfDay) to = from;
    if (!emp) e.email = "Pick an employee.";
    else if (emp.status === "offboarded") e.email = `${emp.name} has left, so leave can't be added.`;
    if (!TYPES[type]) e.type = "Pick a leave type.";
    if (!validDate(from)) e.from = "Enter a start date.";
    if (!validDate(to)) e.to = "Enter an end date.";
    if (!String(reason || "").trim()) e.reason = "Add a short reason.";
    if (e.from || e.to) return e;
    if (to < from) return { ...e, to: "The end date is before the start date." };
    if (from.slice(0, 4) !== to.slice(0, 4)) return { ...e, to: "Leave can't cross into a new year. Split it into two requests." };
    const days = requestDays(from, to, halfDay, holidays);
    if (!days) return halfDay ? { ...e, from: "That day is a weekend or holiday, so no leave is needed." }
      : { ...e, to: "These dates are all weekends or holidays, so no leave is needed." };
    const otherHalf = (r) => halfDay && r.half && r.from === from && r.half !== halfDay;   // morning off and afternoon off can both be booked
    const clash = existing.find((r) => (r.status === "pending" || r.status === "approved") && r.from <= to && r.to >= from && !otherHalf(r));
    if (clash) e.from = `Overlaps an existing ${clash.status === "pending" ? "waiting" : "approved"} request (${clash.from === clash.to ? clash.from : `${clash.from} to ${clash.to}`}${clash.half ? `, ${HALVES[clash.half]}` : ""}).`;
    if (type === "compoff" && bal && bal.compoff.left < days)
      e.type = bal.compoff.left > 0 ? `Only ${bal.compoff.left} comp off day${bal.compoff.left === 1 ? "" : "s"} available. Use casual leave for the rest.`
        : "No comp off days available. Comp offs are earned by working on a weekend or holiday.";
    return e;
  }

  /** Problems with a comp-off credit: it must be for a weekend or holiday that has already happened. */
  function compOffProblems({ emp, workedOn, reason, holidays = [], today, existing = [] }) {
    const e = {};
    if (!emp) e.email = "Pick an employee.";
    if (!validDate(workedOn)) e.workedOn = "Enter the date they worked.";
    else if (today && workedOn > today) e.workedOn = "That date hasn't happened yet.";
    else if (!isWeekend(workedOn) && !holidays.includes(workedOn)) e.workedOn = "Comp offs are only for working on a Saturday, Sunday or holiday.";
    else if (existing.some((c) => c.workedOn === workedOn && c.status !== "declined")) e.workedOn = "A comp off for this date is already recorded or waiting for approval.";
    if (!String(reason || "").trim()) e.reason = "Add what they worked on.";
    return e;
  }

  return { POLICY, TYPES, HALVES, validDate, isWeekend, workingDates, requestDays, casualQuota, balances, allocate, lopByMonth, salaryCut, exitSettlement,
    requestProblems, compOffProblems };
});

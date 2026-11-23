import { useMemo } from "react";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { R } from "./leave.js";
import { teamUnder } from "./people.js";

export const lc = (s) => String(s || "").toLowerCase();
/** The people a permission covers, from useAuth().access: null for the whole company (or a super admin),
 *  otherwise a Set of lower-case emails below the team roots it was given for (the root itself is not included, as on the server). */
export function scopeSet({ superAdmin, access }, perm, people) {
  const a = (access || {})[perm];
  if (superAdmin || a === "company") return null;
  return new Set((Array.isArray(a) ? a : []).flatMap((root) => teamUnder(people, root).team.map((p) => lc(p.email))));
}
export const dd = (n) => `${n} day${n === 1 ? "" : "s"}`;
export const inr = (n) => "₹" + Number(n).toLocaleString("en-IN");
export const LTYPE = R ? Object.fromEntries(Object.entries(R.TYPES).map(([k, v]) => [k, v.name])) : {};
export const LSTAT = { pending: ["Waiting", "warn"], approved: ["Approved", "ok"], declined: ["Declined", "mute"], cancelled: ["Cancelled", "mute"] };

/* Everything the leave pages work out from the server's leave data: balances, who approves whom, what a request would cost. */
export function useLeave() {
  const { people, leave } = useData();
  const { user } = useAuth();
  return useMemo(() => {
    const L = leave || { today: new Date().toISOString().slice(0, 10), requests: [], compOffs: [], holidays: [], pay: [], approvers: {} };
    const pay = Object.fromEntries((L.pay || []).map((p) => [lc(p.email), p]));
    const empBy = (email) => (people || []).find((p) => lc(p.email) === lc(email));
    const reqsOf = (email) => L.requests.filter((r) => lc(r.email) === lc(email));
    const compsOf = (email) => L.compOffs.filter((c) => lc(c.email) === lc(email));
    const payOf = (email) => pay[lc(email)] || { monthlyGross: null, casualOpening: 0, openings: null };
    const holDays = L.holidays.map((h) => h.day);
    const approverOf = (email) => (L.approvers || {})[lc(email)] || "hr";
    const approverName = (email) => { const a = approverOf(email); return a === "hr" ? "a super admin" : (empBy(a) || {}).name || a; };
    // The server's approvers map names this person for every request they may decide: everyone below them in the reporting lines,
    // the teams they stand in for, and everyone for a super admin. Nobody decides their own.
    const approvedByMe = (email) => lc(email) !== lc(user.email) && approverOf(email) === lc(user.email);
    const canDecide = approvedByMe;
    const bal = (p, year) => R.balances(year, { start: p.start, casualOpening: payOf(p.email).casualOpening, openings: payOf(p.email).openings }, reqsOf(p.email), compsOf(p.email));
    const preview = (r) => {
      const p = empBy(r.email), days = R.requestDays(r.from, r.to, r.half, holDays);
      return p ? R.allocate(r.type, days, bal(p, Number(r.from.slice(0, 4)))) : { paid: 0, lop: days };
    };
    const lopDaysIn = (month, email) => L.requests.filter((r) => r.status === "approved" && r.lopDays && (!email || lc(r.email) === lc(email)))
      .reduce((n, r) => n + (R.lopByMonth(r, holDays)[month] || 0), 0);
    return { L, today: L.today, requests: L.requests, compOffs: L.compOffs, holidays: L.holidays, empBy, reqsOf, compsOf, payOf, holDays, approverOf, approverName, approvedByMe, canDecide, bal, preview, lopDaysIn };
  }, [people, leave, user]);
}

/* "5 Nov 2026" and "5 Nov 2026 – 7 Nov 2026" / "(first half)" the way the older pages write dates. */
export const rangeText = (l, fmt) => (l.half ? `${fmt(l.from)} (${R.HALVES[l.half]})` : l.from === l.to ? fmt(l.from) : `${fmt(l.from)} – ${fmt(l.to)}`);

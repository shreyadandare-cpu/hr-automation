/* The app's menu: the sidebar draws it and quick search (Ctrl+K) searches it. */
/* The menu, in sections (the rail) and their pages (the strip under the top bar; the full list in the phone drawer). Each item is
   [path, label, icon, other paths that belong to it]. Items a person may not use are left out: everything follows access
   (useAuth().can / canAll, the permissions a super admin ticked on Company > Access), plus "My team" for reporting managers. */
/* Pages kept out of the menu (and quick search) for now. The pages and their addresses still work. To bring one back, delete its path here. */
const OFF_MENU = new Set(["/app/timesheet", "/app/goals", "/app/reviews", "/app/training", "/app/interviews", "/app/helpdesk", "/app/praise", "/app/apps", "/app/profile", "/app/org-documents", "/app/id-card", "/app/polls", "/app/surveys", "/app/articles", "/app/hr-reports", "/app/hr-reviews", "/app/hiring", "/app/exit-interviews"]);

export function menuFor({ user, isManager, superAdmin, can = () => false, canAll = () => false, canAny = () => false }) {
  const hidden = (user && user.hidden) || [];   // pages HR has turned off for this person (Users > Manage)
  const payroll = canAny("payroll.prepare", "payroll.approve", "payroll.bank", "payroll.view");
  const groups = [
    { label: "Home", icon: "home", items: [["/app/dashboard", "Dashboard", "house"]] },
    { label: "My work", icon: "user", items: [
      [canAny("attendance.view", "attendance.edit") ? "/app/my-attendance" : "/app/attendance", "Attendance", "attendance"],
      ["/app/my-leave", "Leave", "luggage", ["/app/leave/apply"]],
      !canAny("expenses.approve", "budgets.approve") && ["/app/reimbursements", "Expenses", "receipt", ["/app/budgets"]],
      ["/app/requests", "Requests", "send"],
      ["/app/timesheet", "Timesheet", "timer"],
      ["/app/performance", "OKRs and 1:1s", "target"],
      ["/app/jobs", "Open roles", "hire"],
      ["/app/goals", "Goals", "target"],
      ["/app/reviews", "Reviews", "star"],
      ["/app/training", "Training", "cap"],
      ["/app/interviews", "Interviews", "chat"],
      ["/app/helpdesk", "Helpdesk", "lifebuoy"],
      ["/app/praise", "Praise", "medal"],
      ["/app/apps", "Apps", "grid"],
      ["/app/profile", "Profile", "user", ["/app/account"]],
      ["/app/digital-kit", "Digital Kit", "idcard"],
      ["/app/id-card", "ID card", "idcard"],
      !canAll("documents.view") && ["/app/documents", "Documents", "folder"],
    ] },
    { label: "To do", icon: "mail", items: [["/app/inbox", "To do", "inbox"]] },
    isManager && { label: "My team", icon: "team", items: [["/app/my-team", "Overview", "people"], ["/app/team-leave", "Team leave", "luggage"], ["/app/stand-ins", "Approval cover", "handoff"]] },
    { label: "Pay", icon: "bank", items: [
      ["/app/my-finances", "Overview", "wallet"],
      ["/app/payslips", "My pay", "payslip"],
      ["/app/tax", "Tax declaration", "tax"],
      payroll && ["/app/payroll", "Payroll", "bank"],
      (canAll("finance.view") || canAll("payroll.approve")) && ["/app/finance-reports", "Finance reports", "chart"],
    ] },
    { label: "Company", icon: "people", items: [
      ["/app/employees", "Employees", "people"],
      ["/app/org-documents", "Documents", "folder"],
      ["/app/allocations", "Allocations", "project"],
      ["/app/project-reports", "Project reports", "chart"],
    ] },
    { label: "Community", icon: "feed", items: [
      ["/app/posts", "Announcements", "megaphone"],
      !hidden.includes("polls") && ["/app/polls", "Polls", "poll"],
      !hidden.includes("surveys") && ["/app/surveys", "Surveys", "survey"],
      !hidden.includes("articles") && ["/app/articles", "Articles", "book"],
      canAll("celebrations.manage") && ["/app/celebrations", "Celebrations", "cake"],
      ["/app/festivals", "Festival wishes", "gift"],
    ] },
    { label: "Manage", icon: "settings", items: [
      canAny("attendance.view", "attendance.edit") && ["/app/attendance", "Attendance", "attendance"],
      (canAll("shifts.manage") || can("overtime.approve")) && ["/app/shifts", "Shifts and overtime", "clock"],
      canAny("leave.approve", "leave.manage") && ["/app/leave", "Leave", "luggage", ["/app/leave/review"]],
      canAny("expenses.approve", "budgets.approve") && ["/app/reimbursements", "Expenses", "receipt", ["/app/budgets"]],
      canAny("advances.approve", "attendance.edit") && ["/app/hr-requests", "Requests", "send"],
      canAll("onboarding.manage") && ["/app/onboarding/progress", "Onboarding", "onboard", ["/app/onboarding", "/app/documents"]],
      canAll("offboarding.manage") && ["/app/offboarding/leavers", "Offboarding", "offboard", ["/app/offboarding"]],
      can("exit.manage") && ["/app/notice-periods", "Notice periods", "hourglass"],
      canAll("hiring.manage") && ["/app/hiring", "Hiring", "hire"],
      can("probation.manage") && ["/app/probation", "Probation", "flag"],
      can("reviews.manage") && ["/app/hr-reviews", "Reviews", "star"],
      canAll("helpdesk.answer") && ["/app/hr-helpdesk", "Helpdesk", "lifebuoy"],
      can("people.edit") && ["/app/letters", "Letters", "pen"],
      can("exit.manage") && ["/app/exit-interviews", "Exit interviews", "door"],
      canAll("people.view") && ["/app/hr-reports", "Reports", "pie"],
      (canAny("people.view", "attendance.view", "reviews.manage", "expenses.approve") || canAll("leave.manage") || canAll("assets.manage")) && ["/app/report-builder", "Report builder", "chart"],
      canAll("leave.approve") && !isManager && ["/app/stand-ins", "Approval cover", "handoff"],
      canAll("assets.manage") && ["/app/assets", "Assets", "laptop"],
      (canAll("tools.manage") || canAll("finance.view")) && ["/app/tools", "Tools & cost", "grid"],
      canAll("tools.manage") && ["/app/claude-requests", "Claude access", "key"],
      canAll("rewards.give") && ["/app/rewards", "Rewards", "medal"],
      canAll("engage.manage") && ["/app/chat-channels", "Slack and Teams", "chat"],
      canAll("users.manage") && ["/app/users", "Users", "settings"],
      superAdmin && ["/app/access", "Access", "shield"],
      canAll("audit.view") && ["/app/audit", "Audit log", "history"],
    ] },
  ];
  return groups.filter(Boolean).map((g) => ({ ...g, items: g.items.filter((it) => it && !OFF_MENU.has(it[0])) })).filter((g) => g.items.length);
}

export const under = (pathname, p) => pathname === p || pathname.startsWith(p + "/");
/* The menu item a page belongs to: the one whose path is the longest match, so /app/leave/apply finds My leave. */
export function findItem(groups, pathname) {
  let best = null;
  for (const g of groups) for (const it of g.items) for (const p of [it[0], ...(it[3] || [])]) {
    if (under(pathname, p) && (!best || p.length > best.len)) best = { group: g.label, item: it, len: p.length };
  }
  return best;
}

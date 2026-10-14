// Department mapping and default tool bundles. Mirrors the HR Access Hub page.
export const BUNDLES = {
  eng:   ["gws", "gemini", "claude", "github", "gcp"],
  sales: ["gws", "gemini"],
  hr:    ["gws", "gemini", "claude"],
  lead:  ["gws", "gemini", "claude"],
};

export const ON_TASKS = ["Laptop issued", "ID card issued", "Policy documents signed", "Welcome call with manager"];
export const OFF_TASKS = ["Laptop returned", "ID card returned", "Exit interview done", "Final settlement cleared"];

// Joiners on or after this date are still onboarding (same rule as the page).
export const NEW_FROM = "2026-09-15";

export function deptOf(title) {
  const t = title.toLowerCase();
  if (/director|vice president/.test(t)) return "Leadership";
  if (/^hr\b/.test(t)) return "HR";
  if (/account|admin/.test(t) && !/network/.test(t)) return "Finance & Admin";
  if (/sales/.test(t)) return "Sales";
  if (/gen ai/.test(t)) return "Gen AI";
  if (/data/.test(t)) return "Data";
  if (/devops|network/.test(t)) return "DevOps & Cloud";
  return "Engineering";
}

export function bundleKey(dept) {
  if (dept === "Sales") return "sales";
  if (dept === "HR" || dept === "Finance & Admin") return "hr";
  if (dept === "Leadership") return "lead";
  return "eng";
}

// Access for a person is in one of these states; checklists follow the same phase.
export function statusFor(startDate) {
  return startDate >= NEW_FROM ? "onboarding" : "active";
}

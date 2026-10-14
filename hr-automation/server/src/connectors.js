// Stand-in connectors for the local build. They record what would happen but change no real account.
// Set STUB_FAIL=github (or any tool codes, comma-separated) to simulate a failing tool.
// Read at call time so tests and runs can change it without reloading the module.
import { createUser, suspendUser, hasActiveAccount } from "./fake-google.js";

// Google Workspace uses the local test directory. Everything else stays a stand-in for now.
const usesDirectory = (appCode) => appCode === "gws";

function failing(appCode) {
  return (process.env.STUB_FAIL ?? "").split(",").includes(appCode);
}

export async function grant(appCode, employee) {
  if (failing(appCode)) throw new Error(`${appCode}: simulated failure (STUB_FAIL)`);
  if (usesDirectory(appCode)) return createUser(employee.work_email);
  return `stub-${appCode}-${employee.id}`;
}

export async function revoke(appCode, employee) {
  if (failing(appCode)) throw new Error(`${appCode}: simulated failure (STUB_FAIL)`);
  if (usesDirectory(appCode)) { suspendUser(employee.work_email); return `suspended:${employee.work_email}`; }
  return `stub-revoked-${appCode}-${employee.id}`;
}

// Asks the tool whether the person still has access. True means access is still open.
// Stand-in: set STUB_LEAK=claude (or several codes) to simulate access that did not close.
export async function check(appCode, employee) {
  if ((process.env.STUB_LEAK ?? "").split(",").includes(appCode)) return true;
  if (usesDirectory(appCode)) return hasActiveAccount(employee.work_email);
  return false;
}

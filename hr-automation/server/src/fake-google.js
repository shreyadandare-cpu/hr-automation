// A local stand-in for the Google Workspace directory. It keeps accounts in a file so tests can
// create, suspend and check them. It is NOT Google: nothing here reaches a real account.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "fake-google-directory.json");

function load() {
  return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
}
function save(dir) {
  writeFileSync(FILE, JSON.stringify(dir, null, 2));
}

export function createUser(email) {
  const dir = load();
  dir[email] = { suspended: false, created: new Date().toISOString() };
  save(dir);
  return email;
}

export function suspendUser(email) {
  const dir = load();
  if (dir[email]) dir[email].suspended = true; // missing user counts as already gone
  save(dir);
}

export function hasActiveAccount(email) {
  const u = load()[email];
  return Boolean(u && !u.suspended);
}

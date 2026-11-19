/* Light and dark theme, shared with the older pages through the same storage key. */
export const THEME_KEY = "hr_theme";
const systemDark = () => !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
export function currentTheme() {
  let t = null;
  try { t = localStorage.getItem(THEME_KEY); } catch (e) { /* storage blocked */ }
  return t === "dark" || t === "light" ? t : systemDark() ? "dark" : "light";
}
export function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); }
export function toggleTheme() {
  const t = currentTheme() === "dark" ? "light" : "dark";
  try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* storage blocked */ }
  applyTheme(t);
  return t;
}
/** The saved choice: "light", "dark", or "system" (follow the device). */
export function themeChoice() {
  let t = null;
  try { t = localStorage.getItem(THEME_KEY); } catch (e) { /* storage blocked */ }
  return t === "dark" || t === "light" ? t : "system";
}
/** Save a choice and show it now. "system" forgets the choice and follows the device. */
export function setThemeChoice(choice) {
  try { if (choice === "system") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, choice); } catch (e) { /* storage blocked */ }
  applyTheme(currentTheme());
}

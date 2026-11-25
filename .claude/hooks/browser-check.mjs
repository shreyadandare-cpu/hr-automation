#!/usr/bin/env node
/*
 * Stop hook: a change to the interface is not done until it has been looked at in a browser.
 *
 * Reads the session transcript Claude Code passes on stdin. If a file under frontend/ (not frontend/dist) was changed
 * and no browser tool looked at a page after the last such change, it sends Claude back once to check it, in this order:
 *   1. Claude's own browser (the built-in browser pane, mcp__Claude_Browser__*)
 *   2. Claude in Chrome (the Chrome extension, mcp__claude-in-chrome__*)
 *   3. Playwright, only when neither of those can reach the page (mcp__plugin_playwright_*, playwright-cli)
 * Chrome DevTools tools count as a check too. Opening a server or listing tabs does not: a page has to be looked at.
 *
 * It sends Claude back once per stop (stop_hook_active), so a turn can still end with an explanation. Any error here
 * lets the turn end: a broken check must never trap a session.
 */
import fs from "node:fs";

const FRONTEND = /[\\/]frontend[\\/](?!dist[\\/]|node_modules[\\/])/;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SHELL_WRITE = /(sed\s+-i|perl\s+-p?i|\btee\b|>\s*\S*frontend[\\/]|\bmv\b|\bcp\b|\brm\b)/;
const BROWSER = /^(mcp__Claude_Browser__|mcp__claude-in-chrome__|mcp__plugin_playwright_playwright__|mcp__plugin_chrome-devtools-mcp_chrome-devtools__)/;
const NOT_A_LOOK = /(preview_(start|stop|list|logs)|tabs_|list_connected_browsers|select_browser|switch_browser|list_pages|browser_close)$/;

function frontendEdit(c) {
  if (EDIT_TOOLS.has(c.name)) return FRONTEND.test(String(c.input?.file_path || c.input?.notebook_path || ""));
  if (c.name === "Bash") {
    const cmd = String(c.input?.command || "");
    return /frontend[\\/](src|public|[\w-]+\.(html|json|js|mjs))/.test(cmd) && !/frontend[\\/]dist/.test(cmd.replace(/npm run build[^;&|]*/g, "")) && SHELL_WRITE.test(cmd);
  }
  return false;
}
function browserLook(c) {
  if (BROWSER.test(c.name)) return !NOT_A_LOOK.test(c.name);
  if (c.name === "Bash") return /\bplaywright(-cli)?\b/.test(String(c.input?.command || ""));
  return false;
}

try {
  const input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  if (input.stop_hook_active || !input.transcript_path || !fs.existsSync(input.transcript_path)) process.exit(0);
  let lastEdit = -1, lastLook = -1, i = 0, editedFile = "";
  for (const line of fs.readFileSync(input.transcript_path, "utf8").split("\n")) {
    if (!line.includes('"tool_use"')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== "assistant" || !Array.isArray(o.message?.content)) continue;
    for (const c of o.message.content) {
      if (c.type !== "tool_use") continue;
      i += 1;
      if (frontendEdit(c)) { lastEdit = i; editedFile = String(c.input?.file_path || "").replace(/^.*[\\/]frontend[\\/]/, "frontend/") || editedFile; }
      else if (browserLook(c)) lastLook = i;
    }
  }
  if (lastEdit === -1 || lastLook > lastEdit) process.exit(0);
  const reason = [
    `The interface changed${editedFile ? ` (${editedFile})` : ""} and no browser has looked at it since. A frontend change is not done until it is checked in a browser (CLAUDE.md, "Check every interface change in a browser").`,
    "Check it now, in this order:",
    "1. Claude's own browser: preview_start the local server from .claude/launch.json, then navigate, read_page, screenshot and read_console_messages (mcp__Claude_Browser__*).",
    "2. If that cannot reach the page: Claude in Chrome (mcp__claude-in-chrome__*).",
    "3. Only if neither works: Playwright (the playwright-cli skill or mcp__plugin_playwright_playwright__*). Say why the first two could not be used.",
    "Cover the sizes in CLAUDE.md, light and dark, the screen's main actions, and the console. If the change truly cannot be shown in a browser, say why in one line instead.",
  ].join("\n");
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
} catch {
  process.exit(0);
}

// Stand-in connectors for removing tool access. Nothing real is touched yet: each call just reports what the real
// integration will do. Set STUB_FAIL=github (comma-separated) to simulate a tool that refuses, to try the retry flow.
const ACTIONS = {
  gws: (to) => `Google account suspended, signed out everywhere, password reset${to ? `; Drive files and email moved to ${to}` : ""}`,
  gemini: () => "Gemini licence removed",
  claude: () => "Removed from the Claude Team workspace",
  github: () => "Removed from the wohlig GitHub org and teams",
  gcp: () => "IAM roles removed from all wohlig projects",
};
export const TOOLS = Object.keys(ACTIONS);
export const TOOL_NAMES = { gws: "Google Workspace", gemini: "Gemini", claude: "Claude", github: "GitHub", gcp: "Google Cloud" };

export async function removeAccess(tool, { transferTo } = {}) {
  const failing = String(process.env.STUB_FAIL || "").split(",").map((s) => s.trim());
  if (failing.includes(tool)) throw new Error(`${TOOL_NAMES[tool]} refused the request (simulated failure)`);
  return `${ACTIONS[tool](transferTo)} (simulated)`;
}

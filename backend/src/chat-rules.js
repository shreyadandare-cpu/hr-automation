/*
 * Slack and Microsoft Teams channels (incoming webhooks): the rules, without the database. HR adds a channel's webhook link
 * and chooses the company news it gets; chat.js sends. Only the real Slack and Teams webhook hosts are accepted, so the
 * server can never be pointed at another machine. The link is a secret: stored encrypted, shown only as its last characters.
 */
const text = (v) => (typeof v === "string" ? v.trim() : "");

export const EVENTS = {
  announcements: "New announcements",
  leave_today: "Who is on leave today (each working morning)",
  celebrations: "Birthdays, work anniversaries and new joiners",
  openings: "New open roles on the careers page",
  praise: "Praise people give each other",
};
export const KINDS = { slack: "Slack", teams: "Microsoft Teams" };

/** Is this a real incoming-webhook address for that kind? https only, on Slack's or Microsoft's webhook hosts. */
export function webhookOk(kind, url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const h = u.hostname.toLowerCase();
  if (kind === "slack") return h === "hooks.slack.com" && /^\/(services|triggers)\/[\w/-]+$/.test(u.pathname);
  if (kind === "teams") return /(^|\.)webhook\.office\.com$/.test(h) || /\.logic\.azure\.com$/.test(h) || /(^|\.)environment\.api\.powerplatform\.com$/.test(h);
  return false;
}
/** The end of a link, for showing which one is saved without showing the secret. */
export const hintOf = (url) => { try { const u = new URL(url); return `${u.hostname} …${url.slice(-4)}`; } catch { return ""; } };

/** A channel HR adds or edits. On an edit the link may be left empty to keep the saved one. */
export function readChannel(b = {}, editing = false) {
  const errors = {};
  const kind = text(b.kind), name = text(b.name).slice(0, 60), url = text(b.url);
  const events = Array.isArray(b.events) ? [...new Set(b.events.map(String))] : [];
  if (!KINDS[kind]) errors.kind = "Please choose Slack or Microsoft Teams.";
  if (!name) errors.name = "Please name the channel, for example #general.";
  if (!url && !editing) errors.url = "Please paste the channel's incoming webhook link.";
  else if (url && KINDS[kind] && !webhookOk(kind, url)) errors.url = kind === "slack"
    ? "Please paste a Slack incoming webhook link. It starts with https://hooks.slack.com/."
    : "Please paste a Teams workflow webhook link. It starts with https:// and ends in webhook.office.com, logic.azure.com or powerplatform.com.";
  if (!events.length) errors.events = "Please choose at least one kind of news for this channel.";
  else if (events.some((e) => !EVENTS[e])) errors.events = "One of the choices is not available.";
  return { value: { kind, name, url, events, enabled: b.enabled !== false }, errors };
}

/** The message body each service expects: Slack's text with a link, or a Teams adaptive card with an Open button. */
export function payload(kind, { title, text: body = "", link = "" }) {
  const clean = (s) => String(s || "").replace(/[<>]/g, "").slice(0, 3000);
  if (kind === "slack") return { text: `*${clean(title)}*${body ? `\n${clean(body)}` : ""}${link ? `\n<${link}|Open>` : ""}` };
  return { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4",
    body: [{ type: "TextBlock", text: clean(title), weight: "Bolder", size: "Medium", wrap: true }, ...(body ? [{ type: "TextBlock", text: clean(body), wrap: true }] : [])],
    actions: link ? [{ type: "Action.OpenUrl", title: "Open", url: link }] : [] } }] };
}

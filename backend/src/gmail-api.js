import fs from "node:fs";
import { JWT } from "google-auth-library";

/*
 * Read-only Gmail access for the Gmail Intelligence Engine, through Google Workspace domain-wide delegation: the same
 * service account file as work-email creation (GOOGLE_SERVICE_ACCOUNT_FILE) acts as one mailbox at a time. A Workspace
 * super admin must first authorise that service account's client ID for ONLY this scope in the Admin console:
 *   https://www.googleapis.com/auth/gmail.readonly
 * Nothing here can send, delete or change mail. Without the file, gmailReady() is false and nothing is called.
 */
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const API = "https://gmail.googleapis.com/gmail/v1/users";
export const gmailReady = () => Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_FILE) && String(process.env.GMAIL_INTEL_ENABLED || "").toLowerCase() === "true";

let key;
const clients = new Map();
function clientFor(mailbox) {
  if (!key) key = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE, "utf8"));
  if (!clients.has(mailbox)) clients.set(mailbox, new JWT({ email: key.client_email, key: key.private_key, scopes: [SCOPE], subject: mailbox }));
  return clients.get(mailbox);
}
const url = (mailbox, path, params) => `${API}/${encodeURIComponent(mailbox)}/${path}${params ? "?" + new URLSearchParams(params) : ""}`;
async function get(mailbox, path, params) {
  try { return (await clientFor(mailbox).request({ url: url(mailbox, path, params) })).data; }
  catch (err) { const e = new Error(err.response?.data?.error?.message || err.message || "Gmail request failed"); e.status = err.response?.status; throw e; }
}

/** Starting point for a new mailbox: the current history id (we only collect mail from now on). */
export const profile = (mailbox) => get(mailbox, "profile");
/** Ids of messages added since historyId. Throws with status 404 when the id is too old (the caller then resets). */
export async function newMessageIds(mailbox, historyId) {
  const ids = new Set(); let pageToken, last = historyId;
  do {
    const d = await get(mailbox, "history", { startHistoryId: historyId, historyTypes: "messageAdded", maxResults: "500", ...(pageToken ? { pageToken } : {}) });
    for (const h of d.history || []) for (const m of h.messagesAdded || []) ids.add(m.message.id);
    last = d.historyId || last; pageToken = d.nextPageToken;
  } while (pageToken);
  return { ids: [...ids], historyId: last };
}
export const getThread = (mailbox, threadId) => get(mailbox, `threads/${encodeURIComponent(threadId)}`, { format: "full" });
export const getMessage = (mailbox, id) => get(mailbox, `messages/${encodeURIComponent(id)}`, { format: "full" });

/** Asks Gmail to send change notifications to the Pub/Sub topic (GMAIL_PUBSUB_TOPIC). Lasts about 7 days. */
export async function watch(mailbox) {
  const topicName = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topicName) throw new Error("GMAIL_PUBSUB_TOPIC is not set");
  try {
    const r = await clientFor(mailbox).request({ url: url(mailbox, "watch"), method: "POST", data: { topicName, labelIds: ["INBOX", "SENT"], labelFilterBehavior: "INCLUDE" } });
    return { historyId: r.data.historyId, expiresAt: new Date(Number(r.data.expiration)) };
  } catch (err) { throw new Error(err.response?.data?.error?.message || err.message || "Gmail watch failed"); }
}

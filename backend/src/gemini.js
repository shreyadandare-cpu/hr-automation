/*
 * LinkedIn headline ideas from Gemini (Google's AI), for the Digital Kit's LinkedIn kit.
 *
 *   GEMINI_API_KEY   a Gemini API key (Google AI Studio). Without it the option says it isn't set up; nothing is guessed.
 *   GEMINI_MODEL     optional, default gemini-flash-lite-latest.
 *
 * Only the person's designation and department, the company line below and an optional note typed by the person go to Gemini.
 * Their name, email, phone and anything else stay here. What comes back is cleaned (no emojis, quotes, numbering or hashtags,
 * 220 characters at most) and shown as suggestions the person can pick or ignore. Hashtag ideas work the same way and are cleaned to #Word form. Pure functions plus one HTTP call, so the
 * prompt and the clean-up can be tested without calling Google.
 */
export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY);
// "gemini-flash-lite-latest" always points at Google's current fast Flash-Lite model (about 1.5 seconds a request), so a retired model name can't break this.
const MODEL = () => process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
export const GEMINI_URL = () => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL())}:generateContent`;
export const HEADLINE_MAX = 220;

const COMPANY = "Wohlig is a Google Cloud Premier Partner that builds AI agents, agentic workflows, data and cloud solutions for businesses.";

export const HEADLINES = 3;   // how many ideas come back at a time
/** The instruction sent to Gemini. `avoid` = headlines already shown, so shuffling gives new ones. */
export function headlinePrompt({ title, dept, note, avoid = [] }) {
  return [
    `Write ${HEADLINES} different LinkedIn profile headlines for an employee. Each must be at most 200 characters.`,
    `Role: ${title || "not given"}`,
    `Department: ${dept || "not given"}`,
    `Company: Wohlig. ${COMPANY}`,
    note ? `The person would like the headline to highlight: ${note}` : "",
    avoid.length ? `Already shown, so do not repeat or closely reword any of these:\n${avoid.map((t) => `- ${t}`).join("\n")}` : "",
    "Rules:",
    "- Use only the facts above. Do not invent numbers, years of experience, awards, certifications, clients, tools or achievements.",
    "- Plain, professional wording. No emojis, no hashtags, no quotation marks, no numbering.",
    "- Make the options different in style: for example role-first, what-we-do-first, or short and punchy.",
    `Reply with a JSON array of exactly ${HEADLINES} strings and nothing else.`,
  ].filter(Boolean).join("\n");
}

const EMOJI = /[\p{Extended_Pictographic}‍️]/gu;
/** Turns Gemini's reply into clean headlines. Returns [] when nothing usable came back. */
export function parseHeadlines(text) {
  let list = [];
  const raw = String(text || "");
  try { const v = JSON.parse(raw); if (Array.isArray(v)) list = v; } catch {
    const m = raw.match(/\[[\s\S]*\]/);   // the answer inside a code fence or a sentence
    if (m) { try { const v = JSON.parse(m[0]); if (Array.isArray(v)) list = v; } catch { /* not JSON */ } }
  }
  const seen = new Set(), out = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    let t = item.replace(EMOJI, "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/#\w+/g, "").replace(/["“”]/g, "").replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").replace(/\s+/g, " ").trim();
    if (t.length > HEADLINE_MAX) t = t.slice(0, HEADLINE_MAX).replace(/\s+\S*$/, "").trim();
    if (t.length < 8) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(t);
  }
  return out.slice(0, HEADLINES);
}

/** Sends one prompt to Gemini and returns the text of its reply. Throws an Error whose message is safe to show; details stay in the server log. */
async function askGemini(prompt, fetchImpl = fetch) {
  if (!geminiConfigured()) { const e = new Error("Gemini AI is not set up on this server yet."); e.code = "NOT_SET_UP"; throw e; }
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const ask = () => fetchImpl(GEMINI_URL(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1, maxOutputTokens: 2000, responseMimeType: "application/json", responseSchema: { type: "ARRAY", items: { type: "STRING" } } },
      }),
      signal: ctl.signal,
    });
    let res = await ask();
    if ([429, 500, 502, 503, 504].includes(res.status)) { await new Promise((r) => setTimeout(r, 1200)); res = await ask(); }   // Google's AI service is sometimes briefly busy: one more try
    if (!res.ok) { console.error(`Gemini returned HTTP ${res.status}`); const e = new Error("Gemini could not be reached right now. Try again in a little while."); e.code = "UPSTREAM"; throw e; }
    const data = await res.json().catch(() => null);
    return data && data.candidates && data.candidates[0] && data.candidates[0].content && (data.candidates[0].content.parts || []).map((p) => p.text || "").join("");
  } catch (err) {
    if (typeof err.code === "string" && ["NOT_SET_UP", "UPSTREAM", "EMPTY"].includes(err.code)) throw err;   // ours (a browser abort error has a numeric code)
    console.error("Gemini request failed:", err.name === "AbortError" ? "timed out" : err.message);
    const e = new Error("Gemini could not be reached right now. Try again in a little while."); e.code = "UPSTREAM"; throw e;
  } finally { clearTimeout(timer); }
}

export async function suggestHeadlines({ title, dept, note, avoid = [] }, fetchImpl = fetch) {
  const headlines = parseHeadlines(await askGemini(headlinePrompt({ title, dept, note, avoid }), fetchImpl));
  if (!headlines.length) { const e = new Error("Gemini did not return usable headlines. Try again."); e.code = "EMPTY"; throw e; }
  return headlines;
}

/* ----- hashtags for the LinkedIn About section ----- */
export const HASHTAGS = 8;   // how many come back at a time
/** What the hashtags are for. Only these fixed names are accepted from the browser, so nothing typed by a person reaches the prompt. */
export const HASHTAG_TOPICS = {
  about: "The hashtags go at the end of the person's LinkedIn About section.",
  welcome: "The hashtags go on a LinkedIn post announcing that the person has just joined Wohlig.",
  anniversary: "The hashtags go on a LinkedIn post celebrating the person's work anniversary at Wohlig.",
  certified: "The hashtags go on a LinkedIn post announcing that the person earned a new professional certification.",
  role: "The hashtags go on a LinkedIn post announcing that the person has taken on a new role at Wohlig.",
};
/** The instruction for hashtags. Same privacy as headlines: only the role, the department and the company line go out. `avoid` = hashtags already shown. */
export function hashtagPrompt({ title, dept, avoid = [], topic = "about" }) {
  return [
    `Suggest ${HASHTAGS} different LinkedIn hashtags for an employee.`,
    HASHTAG_TOPICS[topic] || HASHTAG_TOPICS.about,
    `Role: ${title || "not given"}`,
    `Department: ${dept || "not given"}`,
    `Company: Wohlig. ${COMPANY}`,
    avoid.length ? `Already shown, so do not repeat any of these: ${avoid.join(" ")}` : "",
    "Rules:",
    "- Use only the facts above. Do not invent clients, awards, certifications or tools that are not mentioned.",
    "- Each hashtag is one word or several words joined together (like AgenticWorkflows). Letters and numbers only, up to 30 characters.",
    "- Mix: the role or craft, the company's work, and broad topics people follow on LinkedIn.",
    `Reply with a JSON array of exactly ${HASHTAGS} strings, each starting with #, and nothing else.`,
  ].filter(Boolean).join("\n");
}
/** Turns Gemini's reply into clean hashtags (#Word, letters and numbers only, no duplicates). Returns [] when nothing usable came back. */
export function parseHashtags(text) {
  let list = [];
  const raw = String(text || "");
  try { const v = JSON.parse(raw); if (Array.isArray(v)) list = v; } catch {
    const m = raw.match(/\[[\s\S]*\]/);
    if (m) { try { const v = JSON.parse(m[0]); if (Array.isArray(v)) list = v; } catch { /* not JSON */ } }
  }
  const seen = new Set(), out = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const words = item.replace(EMOJI, "").replace(/#/g, " ").split(/[^A-Za-z0-9]+/).filter(Boolean);
    const t = words.map((w) => w[0].toUpperCase() + w.slice(1)).join("");
    if (!/^[A-Za-z][A-Za-z0-9]{1,29}$/.test(t)) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(`#${t}`);
  }
  return out.slice(0, HASHTAGS);
}
export async function suggestHashtags({ title, dept, avoid = [], topic = "about" }, fetchImpl = fetch) {
  const tags = parseHashtags(await askGemini(hashtagPrompt({ title, dept, avoid, topic }), fetchImpl));
  if (!tags.length) { const e = new Error("Gemini did not return usable hashtags. Try again."); e.code = "EMPTY"; throw e; }
  return tags;
}

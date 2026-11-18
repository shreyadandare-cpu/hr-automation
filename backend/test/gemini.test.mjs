import test from "node:test";
import assert from "node:assert/strict";
import { GEMINI_URL, geminiConfigured, headlinePrompt, parseHeadlines, suggestHeadlines } from "../src/gemini.js";

const reply = (text) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });
const withKey = async (fn) => { process.env.GEMINI_API_KEY = "test-key"; try { await fn(); } finally { delete process.env.GEMINI_API_KEY; } };

test("without a key it says it is not set up and calls nobody", async () => {
  delete process.env.GEMINI_API_KEY;
  assert.equal(geminiConfigured(), false);
  let called = false;
  await assert.rejects(() => suggestHeadlines({ title: "Engineer" }, async () => { called = true; }), (e) => e.code === "NOT_SET_UP");
  assert.equal(called, false);
});

test("the request: right address, key in a header (not the address), only role, department and note go out", async () => withKey(async () => {
  let seen;
  const out = await suggestHeadlines({ title: "GenAI Engineer", dept: "Engineering", note: "agents and data" }, async (url, o) => {
    seen = { url, o }; return reply(JSON.stringify(["GenAI Engineer at Wohlig | Building AI agents on Google Cloud", "Wohlig | GenAI Engineer making agentic workflows work", "Engineer, Wohlig | Google Cloud Premier Partner", "AI agents and data at Wohlig"]));
  });
  assert.equal(seen.url, GEMINI_URL());
  assert.ok(!seen.url.includes("test-key"), "the key must not be in the address");
  assert.equal(seen.o.headers["x-goog-api-key"], "test-key");
  const body = JSON.parse(seen.o.body), prompt = body.contents[0].parts[0].text;
  assert.match(prompt, /Role: GenAI Engineer/); assert.match(prompt, /Department: Engineering/); assert.match(prompt, /agents and data/);
  assert.match(prompt, /Do not invent numbers/);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(out.length, 3, "three ideas at a time");
}));

test("the prompt never contains a name, email or phone because none is passed in", () => {
  const p = headlinePrompt({ title: "Engineer", dept: "Tech" });
  assert.ok(!/@|\+91|\bname\b/i.test(p.replace("Do not invent", "")));
});

test("replies are cleaned: emojis, hashtags, quotes, numbering, long text, duplicates", () => {
  const long = "Senior Engineer at Wohlig " + "building reliable AI agents ".repeat(20);
  const out = parseHeadlines(JSON.stringify(["1. Engineer at Wohlig 🚀 | AI agents #GoogleCloud", "\"Engineer at Wohlig | AI agents\"", "- Engineer at Wohlig | AI agents", long, "hi", 42, null]));
  assert.deepEqual(out[0], "Engineer at Wohlig | AI agents");
  assert.equal(out.filter((x) => /AI agents$/.test(x) && x.startsWith("Engineer at Wohlig |")).length, 1, "duplicates collapse");
  assert.ok(out.every((x) => x.length <= 220 && x.length >= 8));
  assert.ok(out.every((x) => !/[\p{Extended_Pictographic}#"]/u.test(x)));
});

test("a reply wrapped in a code fence or a sentence still reads", () => {
  assert.deepEqual(parseHeadlines('Here you go:\n```json\n["Engineer at Wohlig | AI agents"]\n```'), ["Engineer at Wohlig | AI agents"]);
  assert.deepEqual(parseHeadlines("no json here"), []);
  assert.deepEqual(parseHeadlines('{"a":1}'), []);
});

test("failures give safe messages and never leak the key", async () => withKey(async () => {
  await assert.rejects(() => suggestHeadlines({ title: "E" }, async () => ({ ok: false, status: 500 })), (e) => e.code === "UPSTREAM" && !/test-key/.test(e.message));
  await assert.rejects(() => suggestHeadlines({ title: "E" }, async () => { throw new Error("socket hang up test-key"); }), (e) => e.code === "UPSTREAM" && !/test-key/.test(e.message));
  await assert.rejects(() => suggestHeadlines({ title: "E" }, async () => reply("[]")), (e) => e.code === "EMPTY");
  await assert.rejects(() => suggestHeadlines({ title: "E" }, async () => ({ ok: true, status: 200, json: async () => ({}) })), (e) => e.code === "EMPTY");
}));

test("a timeout (the browser's AbortError has a numeric code) still gives the safe message", async () => withKey(async () => {
  const abort = Object.assign(new Error("aborted"), { name: "AbortError", code: 20 });
  await assert.rejects(() => suggestHeadlines({ title: "E" }, async () => { throw abort; }), (e) => e.code === "UPSTREAM" && /could not be reached/.test(e.message));
}));

test("a brief 503 is retried once and then works", async () => withKey(async () => {
  let n = 0;
  const out = await suggestHeadlines({ title: "E" }, async () => (++n === 1 ? { ok: false, status: 503 } : reply(JSON.stringify(["Engineer at Wohlig | AI agents on Google Cloud"]))));
  assert.equal(n, 2); assert.equal(out.length, 1);
}));

test("shuffling: what is already on screen is passed along so it is not repeated", async () => withKey(async () => {
  let prompt;
  await suggestHeadlines({ title: "E", avoid: ["Engineer at Wohlig | AI agents", "Wohlig | Engineer"] }, async (_u, o) => { prompt = JSON.parse(o.body).contents[0].parts[0].text; return reply(JSON.stringify(["Something new for the engineer at Wohlig"])); });
  assert.match(prompt, /do not repeat or closely reword/i); assert.match(prompt, /- Engineer at Wohlig \| AI agents/); assert.match(prompt, /exactly 3 strings/);
}));

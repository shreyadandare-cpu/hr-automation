import test from "node:test";
import assert from "node:assert/strict";
import { hintOf, payload, readChannel, webhookOk } from "../src/chat-rules.js";

test("webhook: only real Slack and Teams addresses over https", () => {
  assert.equal(webhookOk("slack", "https://hooks.slack.com/services/T000/B000/XXXX"), true);
  assert.equal(webhookOk("slack", "http://hooks.slack.com/services/T000/B000/XXXX"), false, "not https");
  assert.equal(webhookOk("slack", "https://hooks.slack.com.evil.example/services/x"), false);
  assert.equal(webhookOk("slack", "https://user:pw@hooks.slack.com/services/x"), false);
  assert.equal(webhookOk("slack", "https://hooks.slack.com:8443/services/x"), false);
  assert.equal(webhookOk("slack", "https://169.254.169.254/latest/meta-data"), false, "never an internal machine");
  assert.equal(webhookOk("teams", "https://wohlig.webhook.office.com/webhookb2/abc"), true);
  assert.equal(webhookOk("teams", "https://prod-12.westus.logic.azure.com:443/workflows/abc"), true, ":443 is the normal https port, as Teams links carry it");
  assert.equal(webhookOk("teams", "https://prod-12.westus.logic.azure.com:8443/workflows/abc"), false, "any other port is refused");
  assert.equal(webhookOk("teams", "https://prod-12.westus.logic.azure.com/workflows/abc/triggers/manual"), true);
  assert.equal(webhookOk("teams", "https://localhost/webhook.office.com"), false);
  assert.equal(webhookOk("teams", "https://hooks.slack.com/services/x"), false, "a Slack link is not a Teams link");
  assert.equal(webhookOk("slack", "not a link"), false);
});
test("channel: every missing answer is named; an edit may keep the saved link", () => {
  const e = readChannel({}).errors;
  assert.ok(e.kind && e.name && e.url && e.events);
  assert.ok(readChannel({ kind: "slack", name: "#general", url: "https://example.com/x", events: ["praise"] }).errors.url);
  assert.ok(readChannel({ kind: "slack", name: "#general", url: "https://hooks.slack.com/services/a/b/c", events: ["salaries"] }).errors.events);
  assert.deepEqual(readChannel({ kind: "slack", name: "#general", url: "https://hooks.slack.com/services/a/b/c", events: ["praise"] }).errors, {});
  assert.deepEqual(readChannel({ kind: "teams", name: "HR", events: ["openings"] }, true).errors, {});
});
test("hint: the host and the last four characters only", () => {
  assert.equal(hintOf("https://hooks.slack.com/services/T000/B000/abcd1234"), "hooks.slack.com …1234");
});
test("payload: Slack text with a link; Teams adaptive card with an Open button; no markup let through", () => {
  const s = payload("slack", { title: "Hello <@channel>", text: "Body", link: "https://one.example/app" });
  assert.equal(s.text, "*Hello @channel*\nBody\n<https://one.example/app|Open>");
  const t = payload("teams", { title: "Hello", text: "", link: "" });
  assert.equal(t.attachments[0].content.type, "AdaptiveCard");
  assert.equal(t.attachments[0].content.body.length, 1);
  assert.deepEqual(t.attachments[0].content.actions, []);
});

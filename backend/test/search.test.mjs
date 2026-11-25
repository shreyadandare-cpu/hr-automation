import test from "node:test";
import assert from "node:assert/strict";
import { matches } from "../../frontend/src/lib/search.js";

test("people are found by name, email, role or employee ID, typed with or without the slash", () => {
  const f = ["Sahil Rane", "sahil.rane@wohlig.com", "GenAI Interns", "WT/203"];
  for (const q of ["sahil", "RANE", "genai", "WT/203", "wt/203", "203", "WT203", "wt 203", "wt-203", "wohlig.com", ""]) assert.equal(matches(q, ...f), true, q);
  for (const q of ["WT/204", "204", "xyz", "wt/20"]) assert.equal(matches(q, ...f), q === "wt/20", q);   // "wt/20" is a prefix of WT/203, so it still matches
  assert.equal(matches("   ", ...f), true, "an empty search shows everyone");
  assert.equal(matches("//", ...f), false, "punctuation alone matches nothing it should not");
  assert.equal(matches("203", "A", undefined, null, ""), false, "empty fields are fine");
});

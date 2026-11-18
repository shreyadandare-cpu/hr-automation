// ARCHITECTURE.md is the map of this repo. This test fails when the code gains a file, route, table, env var, page or
// module the map does not name, or when the docs link to a file that no longer exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkArchitecture } from "../scripts/check-architecture.mjs";

test("ARCHITECTURE.md names everything in the code", () => {
  const { missing } = checkArchitecture();
  assert.deepEqual(missing, [], "Add these to ARCHITECTURE.md");
});

test("ARCHITECTURE.md, CLAUDE.md and the brand guide link only to files that exist", () => {
  const { dead } = checkArchitecture();
  assert.deepEqual(dead, []);
});

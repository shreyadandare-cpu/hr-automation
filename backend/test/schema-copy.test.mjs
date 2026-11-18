// migrations/hrhub-schema.sql is the plain-SQL copy of src/schema.sql for a database console. It went stale once
// (missing about 20 tables), so this test fails until `npm run migrate:sql` is run after a schema change.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("migrations/hrhub-schema.sql matches src/schema.sql", () => {
  const schema = fs.readFileSync(new URL("../src/schema.sql", import.meta.url), "utf8");
  const copy = fs.readFileSync(new URL("../migrations/hrhub-schema.sql", import.meta.url), "utf8");
  assert.ok(copy.includes(schema), "Run: cd backend && DB_SCHEMA=hrhub npm run migrate:sql");
});

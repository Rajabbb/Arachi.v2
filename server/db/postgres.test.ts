import assert from "node:assert/strict";
import { test } from "node:test";
import { migrationFiles, toPositional } from "./postgres";

test("? placeholders become $n, quoted text is left alone", () => {
  assert.equal(
    toPositional("SELECT * FROM t WHERE a = ? AND b = '?' AND c IN (?, ?)"),
    "SELECT * FROM t WHERE a = $1 AND b = '?' AND c IN ($2, $3)",
  );
});

test("every table in the Postgres migrations has row level security enabled", () => {
  const sql = migrationFiles().map((m) => m.sql).join("\n");
  const tables = [...sql.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]);
  assert.ok(tables.length > 0);
  for (const t of tables) assert.match(sql, new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`), t);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionUrl, migrationFiles, toPositional } from "./postgres";
import { config } from "../config";

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

test("with a CA certificate, sslmode in the URL cannot switch its check off", () => {
  const url = "postgresql://u:p@db.example.co:5432/postgres?sslmode=require&application_name=arachi";
  const original = config.databaseSslCa;
  try {
    config.databaseSslCa = "";
    assert.equal(connectionUrl(url), url);
    config.databaseSslCa = "/app/certs/supabase-ca.crt";
    assert.equal(connectionUrl(url), "postgresql://u:p@db.example.co:5432/postgres?application_name=arachi");
  } finally {
    config.databaseSslCa = original;
  }
});

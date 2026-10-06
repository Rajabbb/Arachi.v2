import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { openSqlite } from "./sqlite";
import { migrations } from "./sqliteSchema";
import { migrationFiles } from "./postgres";

// Offers from before separate offers existed: carrier 1 revised once (v1, v2), and v2 won.
const before = `
  INSERT INTO users (id, email, password_hash, created_at) VALUES (1, 'a@x.az', 'x', '2026-10-01');
  INSERT INTO rfqs (id, origin, destination, cargo_type, weight_kg, transport_type, currency, offer_deadline, created_at, user_id)
    VALUES (1, 'Bakı', 'Tbilisi', 'Şərab', 5000, 'Quru', 'USD', '2026-10-10', '2026-10-01', 1);
  INSERT INTO carriers (id, name, category, created_at, user_id) VALUES (1, 'A', 'Quru', '2026-10-01', 1);
  INSERT INTO offers (id, rfq_id, carrier_id, version, price, currency, transit_days, source, created_at)
    VALUES (1, 1, 1, 1, 322, 'USD', 3, 'link', '2026-10-02'), (2, 1, 1, 2, 323, 'USD', 3, 'link', '2026-10-03');
  UPDATE rfqs SET awarded_offer_id = 2, status = 'awarded' WHERE id = 1;
`;
const after = "SELECT id, offer_no, version, price FROM offers ORDER BY id";
const expected = [
  { id: 1, offer_no: 1, version: 1, price: 322 },
  { id: 2, offer_no: 1, version: 2, price: 323 },
];

test("SQLite: existing offers become offer 1 with their versions, the winner kept", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arachi-"));
  const path = join(dir, "old.db");
  try {
    const old = new DatabaseSync(path);
    old.exec("PRAGMA foreign_keys = ON");
    for (const m of migrations.slice(0, 9)) old.exec(m);
    old.exec("PRAGMA user_version = 9");
    old.exec(before);
    old.close();

    const driver = openSqlite(path);
    try {
      const rows = (await driver.query(after, [])).rows.map((r) => ({ ...r }));
      assert.deepEqual(rows, expected);
      assert.equal((await driver.query("SELECT awarded_offer_id FROM rfqs", [])).rows[0].awarded_offer_id, 2);
      // Foreign keys are on again, and a second offer v1 now fits.
      await assert.rejects(driver.query("UPDATE rfqs SET awarded_offer_id = 99", []));
      await driver.query(
        "INSERT INTO offers (rfq_id, carrier_id, offer_no, version, price, currency, transit_days, source, created_at) VALUES (1, 1, 2, 1, 300, 'USD', 4, 'link', 'x')",
        [],
      );
      await assert.rejects(driver.query(
        "INSERT INTO offers (rfq_id, carrier_id, offer_no, version, price, currency, transit_days, source, created_at) VALUES (1, 1, 2, 1, 300, 'USD', 4, 'link', 'x')",
        [],
      ));
    } finally {
      await driver.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Postgres: existing offers become offer 1 with their versions, the winner kept", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = await PGlite.create();
  try {
    const files = migrationFiles();
    const at = files.findIndex((f) => f.version === "0004_offer_numbers");
    for (const f of files.slice(0, at)) await pg.exec(f.sql);
    await pg.exec(before);
    for (const f of files.slice(at)) await pg.exec(f.sql);
    const rows = (await pg.query<Record<string, unknown>>(after)).rows.map((r) => ({ ...r, id: Number(r.id) }));
    assert.deepEqual(rows, expected);
    // A second offer v1 now fits; the same offer and version twice does not.
    const insert = (id: number) => pg.exec(
      `INSERT INTO offers (id, rfq_id, carrier_id, offer_no, version, price, currency, transit_days, source, created_at) VALUES (${id}, 1, 1, 2, 1, 300, 'USD', 4, 'link', 'x')`,
    );
    await insert(3);
    await assert.rejects(insert(4), /offers_rfq_carrier_offer_version/);
  } finally {
    await pg.close();
  }
});

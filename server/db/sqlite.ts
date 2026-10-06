import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Driver } from ".";
import { migrations } from "./sqliteSchema";

const returnsRows = /^\s*(select|with|pragma)\b|\breturning\b/i;

/** Local-development fallback: a SQLite file (or ":memory:"). */
export function openSqlite(path: string): Driver {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") database.exec("PRAGMA journal_mode = WAL");
  migrate(database);

  // One connection: transactions are serialized so concurrent requests
  // never nest BEGIN statements.
  let queue: Promise<unknown> = Promise.resolve();

  const driver: Driver = {
    kind: "sqlite",
    async query(sql, params) {
      const statement = database.prepare(sql);
      const args = params as SQLInputValue[];
      if (returnsRows.test(sql)) {
        return { rows: statement.all(...args) as Record<string, unknown>[], changes: 0 };
      }
      return { rows: [], changes: Number(statement.run(...args).changes) };
    },
    transaction<T>(fn: (tx: Driver) => Promise<T>): Promise<T> {
      const result = queue.then(async () => {
        database.exec("BEGIN");
        try {
          const value = await fn(driver);
          database.exec("COMMIT");
          return value;
        } catch (err) {
          database.exec("ROLLBACK");
          throw err;
        }
      });
      queue = result.catch(() => undefined);
      return result;
    },
    async close() {
      database.close();
    },
  };
  return driver;
}

/**
 * Applies pending migrations. Foreign keys are off meanwhile, so a migration
 * can rebuild a table others point to (SQLite's documented way to change a
 * constraint); every reference is checked before each commit.
 */
function migrate(database: DatabaseSync) {
  const { user_version: version } = database.prepare("PRAGMA user_version").get() as { user_version: number };
  if (version >= migrations.length) return;
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    for (let i = version; i < migrations.length; i++) {
      database.exec("BEGIN");
      try {
        database.exec(migrations[i]);
        const broken = database.prepare("PRAGMA foreign_key_check").all();
        if (broken.length) throw new Error(`Migration ${i + 1} broke ${broken.length} foreign key reference(s).`);
        database.exec(`PRAGMA user_version = ${i + 1}`);
        database.exec("COMMIT");
      } catch (err) {
        database.exec("ROLLBACK");
        throw err;
      }
    }
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

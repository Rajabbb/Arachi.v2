import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config";
import { migrations } from "./schema";

let current: DatabaseSync | null = null;

/** The application database, opened (and migrated) on first use. */
export function db(): DatabaseSync {
  return current ?? openDatabase(config.dbPath);
}

/** Opens a database, applies pending migrations and makes it the current one. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") database.exec("PRAGMA journal_mode = WAL");
  migrate(database);
  current?.close();
  current = database;
  return database;
}

function migrate(database: DatabaseSync) {
  const { user_version: version } = database
    .prepare("PRAGMA user_version")
    .get() as { user_version: number };
  for (let i = version; i < migrations.length; i++) {
    database.exec("BEGIN");
    try {
      database.exec(migrations[i]);
      database.exec(`PRAGMA user_version = ${i + 1}`);
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    }
  }
}

/** Runs `fn` in a transaction on the current database. */
export function transaction<T>(fn: () => T): T {
  const database = db();
  database.exec("BEGIN");
  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
}

export function now(): string {
  return new Date().toISOString();
}

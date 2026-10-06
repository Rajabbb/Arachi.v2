import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "../config";

/** A value bound to a `?` placeholder. */
export type Param = string | number | null | Uint8Array;

/** One database connection (or pool) behind the common interface. */
export interface Driver {
  readonly kind: "sqlite" | "postgres";
  query(sql: string, params: Param[]): Promise<{ rows: Record<string, unknown>[]; changes: number }>;
  /** Runs `fn` with a driver bound to a single transaction. */
  transaction<T>(fn: (tx: Driver) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Queries against the current database. SQL is written once for both
 * backends: `?` placeholders, `RETURNING id` instead of last-insert ids, and
 * nothing SQLite- or Postgres-only.
 */
export interface Db {
  readonly kind: Driver["kind"];
  all<T = Record<string, unknown>>(sql: string, ...params: Param[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, ...params: Param[]): Promise<T | undefined>;
  run(sql: string, ...params: Param[]): Promise<{ changes: number }>;
}

let current: Driver | null = null;
let opening: Promise<Driver> | null = null;
const txDriver = new AsyncLocalStorage<Driver>();

async function driver(): Promise<Driver> {
  const tx = txDriver.getStore();
  if (tx) return tx;
  if (current) return current;
  return (opening ??= openDatabase());
}

function facade(kind: Driver["kind"]): Db {
  return {
    kind,
    async all<T>(sql: string, ...params: Param[]) {
      return (await (await driver()).query(sql, params)).rows as T[];
    },
    async get<T>(sql: string, ...params: Param[]) {
      return (await (await driver()).query(sql, params)).rows[0] as T | undefined;
    },
    async run(sql: string, ...params: Param[]) {
      return { changes: (await (await driver()).query(sql, params)).changes };
    },
  };
}

/**
 * The application database. Postgres (Supabase) when DATABASE_URL is set,
 * otherwise a local SQLite file. Opened and migrated on first use.
 */
export function db(): Db {
  return facade(txDriver.getStore()?.kind ?? current?.kind ?? (config.databaseUrl ? "postgres" : "sqlite"));
}

export type DatabaseTarget =
  | { kind: "sqlite"; path: string }
  | { kind: "postgres"; url: string }
  /** In-process Postgres (PGlite), used by tests to check the Postgres SQL. */
  | { kind: "pglite" };

export function defaultTarget(): DatabaseTarget {
  return config.databaseUrl ? { kind: "postgres", url: config.databaseUrl } : { kind: "sqlite", path: config.dbPath };
}

/** Opens a database, applies pending migrations and makes it the current one. */
export async function openDatabase(target: DatabaseTarget = defaultTarget()): Promise<Driver> {
  let next: Driver;
  if (target.kind === "sqlite") {
    const { openSqlite } = await import("./sqlite");
    next = openSqlite(target.path);
  } else if (target.kind === "postgres") {
    const { openPostgres } = await import("./postgres");
    next = await openPostgres(target.url);
  } else {
    const { openPglite } = await import("./postgres");
    next = await openPglite();
  }
  const previous = current;
  current = next;
  opening = null;
  await previous?.close();
  return next;
}

export async function closeDatabase() {
  const previous = current;
  current = null;
  opening = null;
  await previous?.close();
}

/** Runs `fn` in a transaction; every db() call inside it uses that transaction. */
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (txDriver.getStore()) return fn();
  return (await driver()).transaction((tx) => txDriver.run(tx, fn));
}

export function now(): string {
  return new Date().toISOString();
}

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import type { Driver, Param } from ".";
import { config } from "../config";

const migrationsDir = join(import.meta.dirname, "migrations");

// bigint (ids, count(*)) and numeric (sum of integers) arrive as strings by
// default; every value the app stores fits in a JS number.
const INT8 = 20;
const NUMERIC = 1700;
pg.types.setTypeParser(INT8, Number);
pg.types.setTypeParser(NUMERIC, Number);

/** Rewrites `?` placeholders to `$1, $2, ...`, leaving quoted text alone. */
export function toPositional(sql: string): string {
  let n = 0;
  let out = "";
  let quote: string | null = null;
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === "?") {
      out += `$${++n}`;
      continue;
    }
    out += ch;
  }
  return out;
}

function toPg(params: Param[]): unknown[] {
  return params.map((p) => (p instanceof Uint8Array && !Buffer.isBuffer(p) ? Buffer.from(p) : p));
}

/** Postgres (Supabase) through a direct connection string. */
export async function openPostgres(url: string): Promise<Driver> {
  const pool = new pg.Pool({
    connectionString: connectionUrl(url),
    ssl: sslOptions(url),
    max: config.databasePoolSize,
    allowExitOnIdle: true,
  });
  // An idle client losing its connection must not crash the server.
  pool.on("error", (err) => console.error("Postgres pool error:", err.message));

  type Client = pg.Pool | pg.PoolClient;
  const wrap = (client: Client): Driver => ({
    kind: "postgres",
    async query(sql, params) {
      const result = await client.query(toPositional(sql), toPg(params));
      return { rows: result.rows, changes: result.rowCount ?? 0 };
    },
    transaction: (fn) => fn(wrap(client)),
    close: async () => {},
  });

  const driver: Driver = {
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await fn(wrap(client));
        await client.query("COMMIT");
        return value;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  try {
    await migrate(true, {
      exec: async (sql) => void (await pool.query(sql)),
      query: async (sql, params) => (await pool.query(sql, params)).rows,
      session: async (fn) => {
        const client = await pool.connect();
        try {
          return await fn({
            exec: async (sql) => void (await client.query(sql)),
            query: async (sql, params) => (await client.query(sql, params)).rows,
          });
        } finally {
          client.release();
        }
      },
    });
  } catch (err) {
    await pool.end();
    throw err;
  }
  return driver;
}

/**
 * Supabase requires TLS. DATABASE_SSL_CA (path to the certificate from
 * Project Settings → Database → SSL) enables full verification; without it
 * the connection is still encrypted. DATABASE_SSL=off for a local Postgres.
 */
/**
 * The connection string pg should use. With DATABASE_SSL_CA, any sslmode
 * (or other ssl*) parameter is dropped from it: pg lets those override the
 * ssl option, which would discard the certificate.
 */
export function connectionUrl(url: string): string {
  if (!config.databaseSslCa || config.databaseSsl === "off") return url;
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.startsWith("ssl") || key === "uselibpqcompat") parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

export function sslOptions(url: string): pg.ConnectionConfig["ssl"] {
  if (config.databaseSsl === "off") return false;
  if (config.databaseSslCa) return { ca: readFileSync(config.databaseSslCa, "utf8") };
  const host = new URL(url).hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  return local ? false : { rejectUnauthorized: false };
}

/** In-process Postgres for tests: same SQL and migrations as Supabase. */
export async function openPglite(): Promise<Driver> {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const database = await PGlite.create({
    parsers: { [types.INT8]: Number, [types.NUMERIC]: Number },
  });
  type Queryable = Pick<typeof database, "query" | "exec">;
  const wrap = (client: Queryable): Driver => ({
    kind: "postgres",
    async query(sql, params) {
      const result = await client.query<Record<string, unknown>>(toPositional(sql), params);
      return { rows: result.rows, changes: result.affectedRows ?? 0 };
    },
    transaction: (fn) => fn(wrap(client)),
    close: async () => {},
  });
  const runner: MigrationSession = {
    exec: async (sql) => void (await database.exec(sql)),
    query: async (sql, params) => (await database.query<Record<string, unknown>>(sql, params)).rows,
  };
  await migrate(false, { ...runner, session: (fn) => fn(runner) });
  return {
    ...wrap(database),
    transaction: (fn) => database.transaction((tx) => fn(wrap(tx))),
    close: () => database.close(),
  };
}

interface MigrationSession {
  exec(sql: string): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}

export function migrationFiles(): { version: string; sql: string }[] {
  return readdirSync(migrationsDir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ version: f.replace(/\.sql$/, ""), sql: readFileSync(join(migrationsDir, f), "utf8") }));
}

/**
 * Applies migrations/*.sql in name order, each in its own transaction, and
 * records them in schema_migrations. An advisory lock keeps two servers
 * starting at once from applying the same file twice.
 */
async function migrate(
  log: boolean,
  db: MigrationSession & { session<T>(fn: (s: MigrationSession) => Promise<T>): Promise<T> }) {
  await db.session(async (s) => {
    await s.exec("SELECT pg_advisory_lock(727274)");
    try {
      await s.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
        ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
      `);
      const done = new Set((await s.query("SELECT version FROM schema_migrations")).map((r) => r.version as string));
      for (const m of migrationFiles()) {
        if (done.has(m.version)) continue;
        await s.exec("BEGIN");
        try {
          await s.exec(m.sql);
          await s.query("INSERT INTO schema_migrations (version) VALUES ($1)", [m.version]);
          await s.exec("COMMIT");
          if (log) console.log(`Applied migration ${m.version}`);
        } catch (err) {
          await s.exec("ROLLBACK");
          throw new Error(`Migration ${m.version} failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    } finally {
      await s.exec("SELECT pg_advisory_unlock(727274)");
    }
  });
}

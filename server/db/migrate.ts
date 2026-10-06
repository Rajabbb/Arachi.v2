import { closeDatabase, defaultTarget, openDatabase } from ".";

/** npm run migrate — applies pending migrations to the configured database. */
const target = defaultTarget();
console.log(target.kind === "sqlite" ? `Migrating SQLite (${target.path})…` : "Migrating Postgres (DATABASE_URL)…");
try {
  await openDatabase(target);
  console.log("Database is up to date.");
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}

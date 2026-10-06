import type { UploadedFile } from "../../shared/protocol";
import { db, openDatabase, type DatabaseTarget } from "../db";
import { resetLinkSecret } from "../links";
import { emptyContext, type ToolContext } from "../agent/tools/registry";
import { tools } from "../agent/tools";

/**
 * Which database the tests run on: in-memory SQLite by default;
 * ARACHI_TEST_DB=pglite for an in-process Postgres with the Supabase
 * migrations (npm run test:pg); or a real, disposable Postgres given in
 * ARACHI_TEST_DATABASE_URL (run with --test-concurrency=1: tests empty it).
 */
const testTarget: DatabaseTarget = process.env.ARACHI_TEST_DATABASE_URL
  ? { kind: "postgres", url: process.env.ARACHI_TEST_DATABASE_URL }
  : process.env.ARACHI_TEST_DB === "pglite"
    ? { kind: "pglite" }
    : { kind: "sqlite", path: ":memory:" };

let postgresOpen = false;

/** Fresh empty database for one test. */
export async function freshDb() {
  resetLinkSecret();
  if (testTarget.kind === "sqlite") {
    await openDatabase(testTarget);
    return;
  }
  // Postgres is opened (and migrated) once per test file, then emptied between tests.
  if (!postgresOpen) {
    await openDatabase(testTarget);
    postgresOpen = true;
  }
  await db().run("TRUNCATE settings, outbox, rfqs, carriers, dispatches, offers, files RESTART IDENTITY CASCADE");
}

/** Runs a registered tool the way the agent loop does and parses its JSON result. */
export async function call(
  name: string,
  input: Record<string, unknown> = {},
  ctx: ToolContext = emptyContext(),
) {
  const run = await tools.execute(name, input, ctx);
  if (!run.ok) throw new Error(run.content);
  return { ...run, result: JSON.parse(run.content) };
}

export function textFile(name: string, text: string, type = "text/plain"): UploadedFile {
  return { name, type, data: Buffer.from(text).toString("base64") };
}

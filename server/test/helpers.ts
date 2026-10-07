import type { UploadedFile } from "../../shared/protocol";
import { db, openDatabase, type DatabaseTarget } from "../db";
import { resetLinkSecret } from "../links";
import { emptyContext, type ToolContext } from "../agent/tools/registry";
import { tools } from "../agent/tools";
import { asUser } from "../auth/current";
import { resetLoginLimits } from "../auth/accounts";
import { resetRateLimits } from "../rateLimit";

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

/** The user tools run as in tests (see call()); created by freshDb(). */
export let testUserId = 0;

/** Fresh empty database for one test, with one user (testUserId). */
export async function freshDb() {
  resetLinkSecret();
  resetLoginLimits();
  resetRateLimits();
  if (testTarget.kind === "sqlite") {
    await openDatabase(testTarget);
  } else {
    // Postgres is opened (and migrated) once per test file, then emptied between tests.
    if (!postgresOpen) {
      await openDatabase(testTarget);
      postgresOpen = true;
    }
    await db().run(
      `TRUNCATE settings, outbox, rfqs, carriers, dispatches, offers, files, users, sessions, password_resets,
       conversations, conversation_messages, confirmations
       RESTART IDENTITY CASCADE`,
    );
  }
  testUserId = await addUser("test@arachi.az");
}

/** Inserts a user directly (no password check needed in tool tests). */
export async function addUser(email: string): Promise<number> {
  const row = await db().get<{ id: number }>(
    "INSERT INTO users (email, name, password_hash, created_at) VALUES (?, '', 'x', ?) RETURNING id",
    email, new Date().toISOString(),
  );
  return row!.id;
}

/** Runs a registered tool the way the agent loop does and parses its JSON result. */
export async function call(
  name: string,
  input: Record<string, unknown> = {},
  ctx: ToolContext = emptyContext(),
  userId = testUserId,
) {
  const run = await asUser(userId, () => tools.execute(name, input, ctx));
  if (!run.ok) throw new Error(run.content);
  return { ...run, result: JSON.parse(run.content) };
}

export function textFile(name: string, text: string, type = "text/plain"): UploadedFile {
  return { name, type, data: Buffer.from(text).toString("base64") };
}

/** Runs fn as the test user, the way the server runs a signed-in request. */
export function asTestUser<T>(fn: () => Promise<T>): Promise<T> {
  return asUser(testUserId, fn);
}

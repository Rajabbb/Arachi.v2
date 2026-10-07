import { randomBytes } from "node:crypto";
import type { Confirmation } from "../../shared/protocol";
import { currentUserId } from "../auth/current";
import { db, now } from "../db";

/**
 * Actions the agent prepared that send messages to carriers. The agent
 * cannot run them itself: they wait here until the user presses "Bəli"
 * under the reply, so a document or offer that tells the agent to send
 * email cannot make it happen. Every query is limited to the signed-in user.
 */

/** How long a prepared action can still be confirmed. */
export const CONFIRM_HOURS = 24;

export interface StoredConfirmation {
  id: string;
  conversation_id: number;
  message_id: number | null;
  tool: string;
  params: string;
  summary: string;
  status: Confirmation["status"];
  result: string;
  created_at: string;
}

function expired(row: StoredConfirmation): boolean {
  return row.status === "pending" && Date.parse(row.created_at) < Date.now() - CONFIRM_HOURS * 3600_000;
}

export function toConfirmation(row: StoredConfirmation): Confirmation {
  return { id: row.id, text: row.summary, status: expired(row) ? "expired" : row.status, result: row.result };
}

export async function createConfirmation(
  conversationId: number,
  tool: string,
  params: Record<string, unknown>,
  summary: string,
): Promise<Confirmation> {
  const id = randomBytes(16).toString("base64url");
  await db().run(
    `INSERT INTO confirmations (id, user_id, conversation_id, tool, params, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, currentUserId(), conversationId, tool, JSON.stringify(params), summary, now(),
  );
  return { id, text: summary, status: "pending", result: "" };
}

/** Ties the actions prepared in a turn to the reply that shows their buttons. */
export async function attachConfirmations(ids: string[], messageId: number) {
  for (const id of ids) {
    await db().run("UPDATE confirmations SET message_id = ? WHERE id = ? AND user_id = ?", messageId, id, currentUserId());
  }
}

export function findConfirmation(id: string): Promise<StoredConfirmation | undefined> {
  return db().get<StoredConfirmation>("SELECT * FROM confirmations WHERE id = ? AND user_id = ?", id, currentUserId());
}

/** The conversation's confirmations by the message that shows them. */
export async function confirmationsOf(conversationId: number): Promise<Map<number, Confirmation[]>> {
  const rows = await db().all<StoredConfirmation>(
    "SELECT * FROM confirmations WHERE conversation_id = ? AND user_id = ? AND message_id IS NOT NULL ORDER BY created_at, id",
    conversationId, currentUserId(),
  );
  const byMessage = new Map<number, Confirmation[]>();
  for (const row of rows) {
    const list = byMessage.get(Number(row.message_id)) ?? [];
    list.push(toConfirmation(row));
    byMessage.set(Number(row.message_id), list);
  }
  return byMessage;
}

/**
 * Claims a pending, unexpired action for the user's answer; false when it was
 * already answered or has expired (so a double click cannot send twice).
 */
export async function claimConfirmation(id: string, status: "running" | "declined"): Promise<boolean> {
  const { changes } = await db().run(
    "UPDATE confirmations SET status = ?, resolved_at = ? WHERE id = ? AND user_id = ? AND status = 'pending' AND created_at > ?",
    status, now(), id, currentUserId(), new Date(Date.now() - CONFIRM_HOURS * 3600_000).toISOString(),
  );
  return changes > 0;
}

export async function finishConfirmation(id: string, status: "done" | "failed", result: string) {
  await db().run(
    "UPDATE confirmations SET status = ?, result = ? WHERE id = ? AND user_id = ?",
    status, result, id, currentUserId(),
  );
}

/**
 * What the user decided since the agent last heard, as notes for its next
 * turn (it only saw "waiting for the user" when it prepared the action).
 */
export async function takeOutcomes(conversationId: number): Promise<string[]> {
  const rows = await db().all<StoredConfirmation>(
    `SELECT * FROM confirmations WHERE conversation_id = ? AND user_id = ? AND noted = 0
       AND status IN ('done', 'failed', 'declined') ORDER BY resolved_at, id`,
    conversationId, currentUserId(),
  );
  for (const row of rows) await db().run("UPDATE confirmations SET noted = 1 WHERE id = ?", row.id);
  return rows.map((row) =>
    row.status === "declined"
      ? `The user pressed "Xeyr" (no) for: ${row.summary} Nothing was sent.`
      : `The user pressed "Bəli" (yes) for: ${row.summary} Outcome: ${row.result}`,
  );
}

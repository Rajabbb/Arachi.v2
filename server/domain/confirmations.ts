import { randomBytes } from "node:crypto";
import type { CarrierChoices, Confirmation, UploadedFile } from "../../shared/protocol";
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
  choices: string | null;
  files: string | null;
  status: Confirmation["status"];
  result: string;
  created_at: string;
}

function expired(row: StoredConfirmation): boolean {
  return row.status === "pending" && Date.parse(row.created_at) < Date.now() - CONFIRM_HOURS * 3600_000;
}

export function parseChoices(row: StoredConfirmation): CarrierChoices | undefined {
  if (!row.choices) return undefined;
  try {
    return JSON.parse(row.choices) as CarrierChoices;
  } catch {
    return undefined;
  }
}

/** The files kept with a pending RFQ card (contents included); empty when none. */
export function storedFiles(row: StoredConfirmation): UploadedFile[] {
  if (!row.files) return [];
  try {
    return JSON.parse(row.files) as UploadedFile[];
  } catch {
    return [];
  }
}

function fileSize(file: UploadedFile): number {
  return Math.floor((file.data.length * 3) / 4);
}

export function toConfirmation(row: StoredConfirmation): Confirmation {
  const choices = parseChoices(row);
  const files = storedFiles(row);
  return {
    id: row.id,
    tool: row.tool,
    text: row.summary,
    status: expired(row) ? "expired" : row.status,
    result: row.result,
    ...(choices ? { choices } : {}),
    ...(files.length ? { files: files.map((f) => ({ name: f.name, size: fileSize(f) })) } : {}),
  };
}

export async function createConfirmation(
  conversationId: number,
  tool: string,
  params: Record<string, unknown>,
  summary: string,
  choices?: CarrierChoices,
  files?: UploadedFile[],
): Promise<Confirmation> {
  const id = randomBytes(16).toString("base64url");
  // Files of cards that were never answered are not kept beyond the confirmation window.
  await db().run("UPDATE confirmations SET files = NULL WHERE files IS NOT NULL AND status = 'pending' AND created_at < ?", new Date(Date.now() - CONFIRM_HOURS * 3600_000).toISOString());
  await db().run(
    `INSERT INTO confirmations (id, user_id, conversation_id, tool, params, summary, choices, files, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, currentUserId(), conversationId, tool, JSON.stringify(params), summary,
    choices ? JSON.stringify(choices) : null, files?.length ? JSON.stringify(files) : null, now(),
  );
  return {
    id, tool, text: summary, status: "pending", result: "",
    ...(choices ? { choices } : {}),
    ...(files?.length ? { files: files.map((f) => ({ name: f.name, size: fileSize(f) })) } : {}),
  };
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
    "UPDATE confirmations SET status = ?, result = ?, files = NULL WHERE id = ? AND user_id = ?",
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
      ? `The user pressed "Xeyr" (no) for: ${row.summary} It was CANCELLED: nothing was created or sent. Do not offer or prepare it again from this earlier message unless the user asks for it again.`
      : `The user pressed "Bəli" (yes) for: ${row.summary} Outcome: ${row.result}`,
  );
}

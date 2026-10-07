import type {
  AttachmentInfo,
  ConversationMessage,
  ConversationSummary,
  Download,
  UploadedFile,
} from "../../shared/protocol";
import { currentUserId } from "../auth/current";
import { db, now, transaction } from "../db";
import { refreshFileUrl } from "./files";
import { confirmationsOf } from "./confirmations";

/**
 * Saved conversations with the agent. Every query is limited to the
 * signed-in user (currentUserId), so nobody can open, continue or delete
 * someone else's conversation.
 */

const TITLE_LENGTH = 60;

/** A short title from the first message: its text, else the first file's name. */
export function titleFor(text: string, files: { name: string }[]): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return files[0]?.name.slice(0, TITLE_LENGTH) || "Yeni söhbət";
  return clean.length > TITLE_LENGTH ? `${clean.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : clean;
}

export function attachmentInfo(files: UploadedFile[]): AttachmentInfo[] {
  return files.map((f) => ({
    name: f.name,
    // Decoded size of the base64 data, without decoding it.
    size: Math.floor((f.data.length * 3) / 4) - (f.data.endsWith("==") ? 2 : f.data.endsWith("=") ? 1 : 0),
    type: f.type,
  }));
}

export async function listConversations(): Promise<ConversationSummary[]> {
  return db().all<ConversationSummary>(
    "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC, id DESC",
    currentUserId(),
  );
}

/** The user's conversation, or undefined when it doesn't exist or is someone else's. */
export async function findConversation(id: number): Promise<(ConversationSummary & { context: string }) | undefined> {
  const row = await db().get<ConversationSummary & { context: string }>(
    "SELECT id, title, context, created_at, updated_at FROM conversations WHERE id = ? AND user_id = ?",
    id, currentUserId(),
  );
  return row && { ...row, id: Number(row.id) };
}

export async function createConversation(title: string): Promise<number> {
  const at = now();
  const row = await db().get<{ id: number }>(
    "INSERT INTO conversations (user_id, title, context, created_at, updated_at) VALUES (?, ?, '[]', ?, ?) RETURNING id",
    currentUserId(), title, at, at,
  );
  return Number(row!.id);
}

/** Appends a message to one of the user's conversations and marks it as the latest. */
export async function addMessage(
  conversationId: number,
  message: { role: "user" | "assistant"; text: string; attachments?: AttachmentInfo[]; downloads?: Download[] },
): Promise<number> {
  const at = now();
  const { changes } = await db().run(
    "UPDATE conversations SET updated_at = ? WHERE id = ? AND user_id = ?",
    at, conversationId, currentUserId(),
  );
  if (changes === 0) throw new Error(`Conversation ${conversationId} not found.`);
  const row = await db().get<{ id: number }>(
    `INSERT INTO conversation_messages (conversation_id, role, text, attachments, downloads, created_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    conversationId, message.role, message.text,
    JSON.stringify(message.attachments ?? []), JSON.stringify(message.downloads ?? []), at,
  );
  return Number(row!.id);
}

export async function conversationMessages(conversationId: number): Promise<ConversationMessage[]> {
  const rows = await db().all<{
    id: number; role: "user" | "assistant"; text: string; attachments: string; downloads: string; created_at: string;
  }>(
    `SELECT m.id, m.role, m.text, m.attachments, m.downloads, m.created_at
     FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE m.conversation_id = ? AND c.user_id = ?
     ORDER BY m.id`,
    conversationId, currentUserId(),
  );
  const confirmations = await confirmationsOf(conversationId);
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      id: Number(r.id),
      attachments: JSON.parse(r.attachments) as AttachmentInfo[],
      // Saved download links expire; the chat gets fresh ones each time it is opened.
      downloads: await Promise.all(
        (JSON.parse(r.downloads) as Download[]).map(async (d) => ({ ...d, url: await refreshFileUrl(d.url) })),
      ),
      ...(confirmations.has(Number(r.id)) ? { confirmations: confirmations.get(Number(r.id)) } : {}),
    })),
  );
}

/** The model's transcript of the latest turns, one array of messages per turn. */
export function parseContext(context: string): unknown[][] {
  try {
    const turns: unknown = JSON.parse(context);
    return Array.isArray(turns) && turns.every(Array.isArray) ? (turns as unknown[][]) : [];
  } catch {
    return [];
  }
}

export async function saveContext(conversationId: number, turns: unknown[][]): Promise<void> {
  await db().run(
    "UPDATE conversations SET context = ? WHERE id = ? AND user_id = ?",
    JSON.stringify(turns), conversationId, currentUserId(),
  );
}

/** Deletes one of the user's conversations with its messages; false when there was none. */
export async function deleteConversation(id: number): Promise<boolean> {
  const conversation = await findConversation(id);
  if (!conversation) return false;
  await transaction(async () => {
    await db().run("DELETE FROM confirmations WHERE conversation_id = ?", id);
    await db().run("DELETE FROM conversation_messages WHERE conversation_id = ?", id);
    await db().run("DELETE FROM conversations WHERE id = ? AND user_id = ?", id, currentUserId());
  });
  return true;
}

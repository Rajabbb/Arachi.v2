import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChatRequest, ChatResponse, ConversationData, ConversationListData } from "../../shared/protocol";
import { runTurn } from "../agent/loop";
import { remember, usableTurns } from "../agent/history";
import { provider } from "../agent/providers";
import {
  addMessage,
  attachmentInfo,
  conversationMessages,
  createConversation,
  deleteConversation,
  findConversation,
  listConversations,
  parseContext,
  saveContext,
  titleFor,
} from "../domain/conversations";
import { HttpError, readJson, send } from "../http";
import { attachConfirmations, createConfirmation, takeOutcomes } from "../domain/confirmations";

function parseChatRequest(body: unknown): ChatRequest {
  const b = body as Partial<ChatRequest> | null;
  const ok =
    b !== null &&
    typeof b === "object" &&
    (b.conversationId === undefined || b.conversationId === null || Number.isInteger(b.conversationId)) &&
    typeof b.message?.text === "string" &&
    Array.isArray(b.message.files) &&
    b.message.files.every(
      (f) =>
        typeof f?.name === "string" &&
        typeof f.type === "string" &&
        typeof f.data === "string",
    );
  if (!ok) throw new HttpError(400, "Sorğunun formatı yanlışdır.");
  return b as ChatRequest;
}

/** An error after the user's message was saved; the UI stays in that conversation. */
export class ChatTurnError extends Error {
  constructor(
    readonly inner: unknown,
    readonly conversationId: number,
  ) {
    super("Chat turn failed.");
  }
}

/**
 * POST /api/chat — one user message. Saved in the given conversation (or a
 * new one), answered by the agent with that conversation's latest turns as
 * context, and the answer saved too.
 */
export async function handleChat(req: IncomingMessage, res: ServerResponse) {
  const { conversationId, message } = parseChatRequest(await readJson(req));
  if (!message.text.trim() && message.files.length === 0) throw new HttpError(400, "Mesaj boşdur.");

  const existing = conversationId ? await findConversation(conversationId) : undefined;
  if (conversationId && !existing) throw new HttpError(404, "Söhbət tapılmadı.");
  const id = existing?.id ?? (await createConversation(titleFor(message.text, message.files)));
  await addMessage(id, { role: "user", text: message.text, attachments: attachmentInfo(message.files) });

  try {
    const model = provider();
    const turns = usableTurns(parseContext(existing?.context ?? "[]"), model);
    const previous = turns.flat();
    // The agent only saw "waiting for the user" for actions it prepared; tell it what the user decided.
    const outcomes = await takeOutcomes(id);
    const text = outcomes.length
      ? `[System note, not written by the user: ${outcomes.join(" ")}]\n\n${message.text}`
      : message.text;
    const result = await runTurn(previous, text, message.files, model, (tool, params, summary) =>
      createConfirmation(id, tool, params, summary),
    );
    await saveContext(id, remember(turns, result.transcript.slice(previous.length), model));
    const replyId = await addMessage(id, { role: "assistant", text: result.reply, downloads: result.downloads });
    await attachConfirmations(result.confirmations.map((c) => c.id), replyId);
    const body: ChatResponse = {
      conversationId: id,
      reply: result.reply,
      toolCalls: result.toolCalls,
      downloads: result.downloads,
      confirmations: result.confirmations,
    };
    send(res, 200, body);
  } catch (err) {
    throw new ChatTurnError(err, id);
  }
}

/** GET /api/conversations — the chat history list. */
export async function handleConversationList(res: ServerResponse) {
  const body: ConversationListData = { conversations: await listConversations() };
  send(res, 200, body);
}

function conversationId(id: string): number {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, "Söhbət tapılmadı.");
  return n;
}

/** GET /api/conversations/:id — one conversation to show and continue. */
export async function handleConversation(res: ServerResponse, id: string) {
  const conversation = await findConversation(conversationId(id));
  if (!conversation) throw new HttpError(404, "Söhbət tapılmadı.");
  const { context: _context, ...summary } = conversation;
  const body: ConversationData = { conversation: summary, messages: await conversationMessages(conversation.id) };
  send(res, 200, body);
}

/** DELETE /api/conversations/:id */
export async function handleConversationDelete(res: ServerResponse, id: string) {
  if (!(await deleteConversation(conversationId(id)))) throw new HttpError(404, "Söhbət tapılmadı.");
  send(res, 200, { ok: true });
}

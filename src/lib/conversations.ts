import type {
  ChatError,
  ConversationData,
  ConversationListData,
  ConversationMessage,
} from "../../shared/protocol";
import type { Message } from "../types";
import { getJson } from "./api";

export async function listConversations() {
  return (await getJson<ConversationListData>("/api/conversations")).conversations;
}

/** A saved conversation's messages, ready for the message list. */
export async function loadConversation(id: number): Promise<Message[]> {
  const data = await getJson<ConversationData>(`/api/conversations/${id}`);
  return data.messages.map(toMessage);
}

export async function deleteConversation(id: number): Promise<void> {
  const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
  if (res.status === 401) window.location.reload();
  if (!res.ok && res.status !== 404) {
    const body = (await res.json().catch(() => null)) as ChatError | null;
    throw new Error(body?.error ?? "Serverlə əlaqə qurulmadı.");
  }
}

function toMessage(m: ConversationMessage): Message {
  return {
    id: `saved-${m.id}`,
    role: m.role,
    text: m.text,
    attachments: m.attachments.map((a, i) => ({ id: `saved-${m.id}-${i}`, ...a })),
    downloads: m.downloads,
    createdAt: Date.parse(m.created_at),
  };
}

/** "Bu gün 14:05", "Dünən", or a date, for the conversation list. */
export function when(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const days = Math.round(
    (new Date(today.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86_400_000,
  );
  const time = date.toLocaleTimeString("az-AZ", { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `Bu gün ${time}`;
  if (days === 1) return `Dünən ${time}`;
  return date.toLocaleDateString("az-AZ", { day: "numeric", month: "short", year: days > 300 ? "numeric" : undefined });
}

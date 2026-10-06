import type { Attachment } from "../types";
import type {
  ChatError,
  ChatRequest,
  ChatResponse,
  UploadedFile,
} from "../../shared/protocol";

export interface AgentRequest {
  text: string;
  files: File[];
  /** The saved conversation to continue; null starts a new one. */
  conversationId: number | null;
}

/** A failed message; conversationId is set when the message was saved anyway. */
export class AgentRequestError extends Error {
  constructor(
    message: string,
    readonly conversationId?: number,
  ) {
    super(message);
  }
}

export type AgentResponse = ChatResponse;

/**
 * Sends one message to the agent server. The API key lives on the server;
 * the browser only ever talks to /api/chat.
 */
export async function sendToAgent(req: AgentRequest): Promise<AgentResponse> {
  const body: ChatRequest = {
    conversationId: req.conversationId,
    message: {
      text: req.text,
      files: await Promise.all(req.files.map(toUploadedFile)),
    },
  };

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    // The session expired or was ended elsewhere: show the login screen.
    window.location.reload();
  }
  const data = (await res.json().catch(() => null)) as
    | ChatResponse
    | ChatError
    | null;
  if (!res.ok || !data || "error" in data) {
    throw new AgentRequestError(
      data && "error" in data ? data.error : "Serverlə əlaqə qurulmadı.",
      data && "error" in data ? data.conversationId : undefined,
    );
  }
  return data;
}

export async function toUploadedFile(file: File): Promise<UploadedFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return { name: file.name, type: file.type, data: btoa(binary) };
}

export function toAttachment(file: File): Attachment {
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    type: file.type,
  };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

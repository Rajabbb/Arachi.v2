import type { Attachment } from "../types";

export interface AgentRequest {
  text: string;
  files: File[];
}

export interface AgentResponse {
  text: string;
}

/**
 * Placeholder for the real AI agent backend.
 * Replace the body with a call to the V2 API once it exists; the UI only
 * depends on this function's signature.
 */
export async function sendToAgent(req: AgentRequest): Promise<AgentResponse> {
  await new Promise((resolve) => setTimeout(resolve, 900));

  const parts: string[] = [];
  if (req.text.trim()) {
    parts.push(`Əmrinizi aldım: “${req.text.trim()}”.`);
  }
  if (req.files.length > 0) {
    const names = req.files.map((f) => f.name).join(", ");
    parts.push(`${req.files.length} fayl qəbul edildi: ${names}.`);
  }
  parts.push(
    "Xüsusi parametr qeyd etmədiyiniz üçün default parametrlərlə işləyəcəyəm. (Bu hələlik demo cavabdır, AI backend qoşulmayıb.)",
  );
  return { text: parts.join(" ") };
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

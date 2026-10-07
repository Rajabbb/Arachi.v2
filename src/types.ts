import type { Confirmation, Download } from "../shared/protocol";

export type Role = "user" | "assistant";

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  attachments: Attachment[];
  /** Files the agent generated (PDF quotes, Excel exports). */
  downloads?: Download[];
  /** Actions waiting for the user's "Bəli" / "Xeyr". */
  confirmations?: Confirmation[];
  createdAt: number;
}

import type { Confirmation, Download, ResultCard } from "../shared/protocol";

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
  /** What the agent did (created RFQ, added carriers, ...), laid out for checking. */
  cards?: ResultCard[];
  /** Actions waiting for the user's "Bəli" / "Xeyr". */
  confirmations?: Confirmation[];
  createdAt: number;
}

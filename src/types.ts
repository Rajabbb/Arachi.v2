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
  createdAt: number;
}

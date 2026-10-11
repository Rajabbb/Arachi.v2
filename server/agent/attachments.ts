import type { UploadedFile } from "../../shared/protocol";

/** What arachi.co accepts as an RFQ attachment (same list as the panel's upload). */
const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".csv": "text/csv",
  ".txt": "text/plain",
};
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function attachmentMime(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? undefined : MIME_BY_EXTENSION[name.slice(dot).toLowerCase()];
}

/** The attached files carriers can be shown: an accepted type and at most 10 MB. */
export function attachableFiles(files: UploadedFile[]): UploadedFile[] {
  return files.filter((f) => attachmentMime(f.name) && Math.floor((f.data.length * 3) / 4) <= MAX_ATTACHMENT_BYTES);
}

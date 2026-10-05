import { db, now } from "../db";
import { publicUrl, signToken, verifyToken } from "../links";

export interface StoredFile {
  id: number;
  owner_kind: string;
  owner_id: number;
  name: string;
  type: string;
  data: Uint8Array;
  created_at: string;
}

const TOKEN_KIND = "file";

export function storeFile(ownerKind: string, ownerId: number, name: string, type: string, data: Uint8Array): number {
  const { lastInsertRowid } = db()
    .prepare("INSERT INTO files (owner_kind, owner_id, name, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(ownerKind, ownerId, name, type || "application/octet-stream", data, now());
  return Number(lastInsertRowid);
}

export function filesOf(ownerKind: string, ownerId: number): { id: number; name: string; type: string; url: string }[] {
  const rows = db()
    .prepare("SELECT id, name, type FROM files WHERE owner_kind = ? AND owner_id = ? ORDER BY id")
    .all(ownerKind, ownerId) as { id: number; name: string; type: string }[];
  return rows.map((r) => ({ ...r, url: fileUrl(r.id) }));
}

/** Signed download path, so file ids cannot be enumerated. */
export function fileUrl(id: number): string {
  return `/api/files/${signToken(TOKEN_KIND, id)}`;
}

export function absoluteFileUrl(id: number): string {
  return publicUrl(fileUrl(id));
}

export function fileFromToken(token: string): StoredFile | undefined {
  const id = verifyToken(TOKEN_KIND, token);
  if (id === null) return undefined;
  return db().prepare("SELECT * FROM files WHERE id = ?").get(id) as StoredFile | undefined;
}

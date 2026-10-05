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

export async function storeFile(
  ownerKind: string,
  ownerId: number,
  name: string,
  type: string,
  data: Uint8Array,
): Promise<number> {
  const row = await db().get<{ id: number }>(
    "INSERT INTO files (owner_kind, owner_id, name, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    ownerKind, ownerId, name, type || "application/octet-stream", data, now(),
  );
  return row!.id;
}

export async function filesOf(
  ownerKind: string,
  ownerId: number,
): Promise<{ id: number; name: string; type: string; url: string }[]> {
  const rows = await db().all<{ id: number; name: string; type: string }>(
    "SELECT id, name, type FROM files WHERE owner_kind = ? AND owner_id = ? ORDER BY id",
    ownerKind, ownerId,
  );
  return Promise.all(rows.map(async (r) => ({ ...r, url: await fileUrl(r.id) })));
}

/** Signed download path, so file ids cannot be enumerated. */
export async function fileUrl(id: number): Promise<string> {
  return `/api/files/${await signToken(TOKEN_KIND, id)}`;
}

export async function absoluteFileUrl(id: number): Promise<string> {
  return publicUrl(await fileUrl(id));
}

export async function fileFromToken(token: string): Promise<StoredFile | undefined> {
  const id = await verifyToken(TOKEN_KIND, token);
  if (id === null) return undefined;
  return db().get<StoredFile>("SELECT * FROM files WHERE id = ?", id);
}

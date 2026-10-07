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
/**
 * How long a download link works. Pages (panel, chat, the carrier's quote
 * page) sign a fresh link every time they are opened, so only a link copied
 * out of the app stops working.
 */
export const FILE_LINK_HOURS = 24;

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

/** Signed, expiring download path, so file ids cannot be enumerated and a leaked link soon stops working. */
export async function fileUrl(id: number): Promise<string> {
  return `/api/files/${await signToken(TOKEN_KIND, id, FILE_LINK_HOURS * 3600)}`;
}

/**
 * A fresh link for a download saved earlier (e.g. a file button in an old
 * chat message), whose own link may have expired. Other URLs stay as they are.
 */
export async function refreshFileUrl(url: string): Promise<string> {
  const token = url.match(/^\/api\/files\/([\w.-]+)$/)?.[1];
  const id = token ? await verifyToken(TOKEN_KIND, token, { ignoreExpiry: true }) : null;
  return id === null ? url : fileUrl(id);
}

export async function absoluteFileUrl(id: number): Promise<string> {
  return publicUrl(await fileUrl(id));
}

export async function fileFromToken(token: string): Promise<StoredFile | undefined> {
  // Links from before expiry existed are refused too: the app re-signs every link it shows.
  const id = await verifyToken(TOKEN_KIND, token, { requireExpiry: true });
  if (id === null) return undefined;
  return db().get<StoredFile>("SELECT * FROM files WHERE id = ?", id);
}

import type { ServerResponse } from "node:http";
import { fileFromToken } from "../domain/files";
import { send } from "../http";

/** GET /api/files/:token — downloads a stored file (offer documents, exports). */
export async function handleFile(res: ServerResponse, token: string) {
  const file = await fileFromToken(token);
  if (!file) return send(res, 404, { error: "Fayl tapılmadı." });
  res.writeHead(200, {
    "content-type": file.type,
    "content-length": file.data.byteLength,
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    // The type comes from whoever uploaded it (a carrier, too): never let the browser run it as a page.
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
  });
  res.end(Buffer.from(file.data));
}

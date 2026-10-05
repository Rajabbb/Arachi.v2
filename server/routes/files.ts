import type { ServerResponse } from "node:http";
import { fileFromToken } from "../domain/files";
import { send } from "../http";

/** GET /api/files/:token — downloads a stored file (offer documents, exports). */
export function handleFile(res: ServerResponse, token: string) {
  const file = fileFromToken(token);
  if (!file) return send(res, 404, { error: "Fayl tapılmadı." });
  res.writeHead(200, {
    "content-type": file.type,
    "content-length": file.data.byteLength,
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
  });
  res.end(Buffer.from(file.data));
}

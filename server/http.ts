import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function readJson(req: IncomingMessage, maxBytes = config.maxBodyBytes): Promise<unknown> {
  const body = await readBody(req, maxBytes);
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "Sorğu düzgün JSON deyil.");
  }
}

/** The raw request body as text (webhook signatures are computed over it). */
export async function readBody(req: IncomingMessage, maxBytes = config.maxBodyBytes): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) {
      throw new HttpError(
        413,
        maxBytes === config.maxBodyBytes ? "Fayllar çox böyükdür (maksimum 30 MB)." : "Sorğu çox böyükdür.",
      );
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Body cap for requests that carry no files (login forms, webhooks). */
export const SMALL_BODY_BYTES = 256 * 1024;

export function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

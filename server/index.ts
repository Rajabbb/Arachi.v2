import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import type { ChatError, ChatRequest } from "../shared/protocol";
import { config } from "./config";
import { AgentError, runTurn } from "./agent/loop";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > config.maxBodyBytes) {
      throw new HttpError(413, "Fayllar çox böyükdür (maksimum 30 MB).");
    }
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Sorğu düzgün JSON deyil.");
  }
}

function parseChatRequest(body: unknown): ChatRequest {
  const b = body as Partial<ChatRequest> | null;
  const ok =
    b !== null &&
    typeof b === "object" &&
    Array.isArray(b.transcript) &&
    typeof b.message?.text === "string" &&
    Array.isArray(b.message.files) &&
    b.message.files.every(
      (f) =>
        typeof f?.name === "string" &&
        typeof f.type === "string" &&
        typeof f.data === "string",
    );
  if (!ok) throw new HttpError(400, "Sorğunun formatı yanlışdır.");
  return b as ChatRequest;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function handleChat(req: IncomingMessage, res: ServerResponse) {
  const { transcript, message } = parseChatRequest(await readJson(req));
  const result = await runTurn(
    transcript as Anthropic.Beta.BetaMessageParam[],
    message.text,
    message.files,
  );
  send(res, 200, result);
}

function toError(err: unknown): { status: number; body: ChatError } {
  if (err instanceof HttpError) {
    return { status: err.status, body: { error: err.message } };
  }
  if (err instanceof AgentError) {
    return { status: 400, body: { error: err.message } };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return {
      status: 500,
      body: { error: "Serverdə ANTHROPIC_API_KEY qurulmayıb və ya etibarsızdır." },
    };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, body: { error: "Hazırda sorğu limiti dolub, bir az sonra yenidən cəhd edin." } };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { status: 400, body: { error: `AI sorğunu qəbul etmədi: ${err.message}` } };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: 502, body: { error: "AI xidməti ilə əlaqədə xəta baş verdi." } };
  }
  return { status: 500, body: { error: "Serverdə gözlənilməz xəta baş verdi." } };
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/chat") {
      await handleChat(req, res);
    } else if (req.method === "GET" && req.url === "/api/health") {
      send(res, 200, { ok: true });
    } else {
      send(res, 404, { error: "Tapılmadı." });
    }
  } catch (err) {
    const { status, body } = toError(err);
    if (status >= 500) console.error(err);
    send(res, status, body);
  }
});

server.listen(config.port, () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("ANTHROPIC_API_KEY is not set; copy .env.example to .env and fill it in.");
  }
  console.log(`Agent server listening on http://localhost:${config.port}`);
});

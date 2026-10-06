import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import type { ChatError, ChatRequest } from "../shared/protocol";
import { config } from "./config";
import { openDatabase } from "./db";
import { sendsForReal } from "./notify";
import { AgentError, runTurn } from "./agent/loop";
import { HttpError, readJson, send } from "./http";
import { handleQuote } from "./routes/quote";
import { handleFile } from "./routes/files";
import { handleDashboard } from "./routes/dashboard";

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
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const quote = path.match(/^\/api\/quote\/([\w.-]+)$/);
    const file = path.match(/^\/api\/files\/([\w.-]+)$/);
    if (req.method === "POST" && path === "/api/chat") {
      await handleChat(req, res);
    } else if (req.method === "GET" && path === "/api/health") {
      send(res, 200, { ok: true });
    } else if (quote) {
      await handleQuote(req, res, quote[1]);
    } else if (req.method === "GET" && path === "/api/dashboard") {
      await handleDashboard(req, res);
    } else if (file && req.method === "GET") {
      await handleFile(res, file[1]);
    } else {
      send(res, 404, { error: "Tapılmadı." });
    }
  } catch (err) {
    const { status, body } = toError(err);
    if (status >= 500) console.error(err);
    send(res, status, body);
  }
});

// Connect and apply pending migrations before taking requests.
try {
  const database = await openDatabase();
  console.log(database.kind === "postgres" ? "Database: Postgres (DATABASE_URL)" : `Database: SQLite (${config.dbPath})`);
} catch (err) {
  console.error("Could not open the database:", err instanceof Error ? err.message : err);
  process.exit(1);
}
console.log(sendsForReal("email") ? "Email: Resend" : "Email: log only (set RESEND_API_KEY and EMAIL_FROM to send)");

server.listen(config.port, () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("ANTHROPIC_API_KEY is not set; copy .env.example to .env and fill it in.");
  }
  console.log(`Agent server listening on http://localhost:${config.port}`);
});

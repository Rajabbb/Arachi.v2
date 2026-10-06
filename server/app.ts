import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChatError, ChatRequest } from "../shared/protocol";
import { AgentError, runTurn } from "./agent/loop";
import { provider } from "./agent/providers";
import { HttpError, readJson, send } from "./http";
import { handleQuote } from "./routes/quote";
import { handleFile } from "./routes/files";
import { handleDashboard } from "./routes/dashboard";
import { handleResendWebhook } from "./routes/resendWebhook";
import { handleAuth, requireUser } from "./routes/auth";
import { asUser } from "./auth/current";
import { handleRfqDetail, handleRfqList } from "./routes/rfqs";

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
  const result = await runTurn(transcript, message.text, message.files);
  send(res, 200, result);
}

function toError(err: unknown): { status: number; body: ChatError } {
  if (err instanceof HttpError) {
    return { status: err.status, body: { error: err.message } };
  }
  if (err instanceof AgentError) {
    return { status: 400, body: { error: err.message } };
  }
  const described = provider().describeError(err);
  if (described) {
    return { status: described.status, body: { error: described.message } };
  }
  return { status: 500, body: { error: "Serverdə gözlənilməz xəta baş verdi." } };
}

/** Routes one HTTP request; index.ts serves it, tests call it directly. */
export async function app(req: IncomingMessage, res: ServerResponse) {
  try {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const quote = path.match(/^\/api\/quote\/([\w.-]+)$/);
    const file = path.match(/^\/api\/files\/([\w.-]+)$/);
    const auth = path.match(/^\/api\/auth\/(\w+)$/);
    const rfq = path.match(/^\/api\/rfqs\/(\w+)$/);
    if (auth) {
      await handleAuth(req, res, auth[1]);
    } else if (req.method === "POST" && path === "/api/chat") {
      const user = await requireUser(req);
      await asUser(user.id, () => handleChat(req, res));
    } else if (req.method === "POST" && path === "/api/webhooks/resend") {
      await handleResendWebhook(req, res);
    } else if (req.method === "GET" && path === "/api/health") {
      send(res, 200, { ok: true });
    } else if (quote) {
      await handleQuote(req, res, quote[1]);
    } else if (req.method === "GET" && path === "/api/dashboard") {
      const user = await requireUser(req);
      await asUser(user.id, () => handleDashboard(req, res));
    } else if (req.method === "GET" && path === "/api/rfqs") {
      const user = await requireUser(req);
      await asUser(user.id, () => handleRfqList(res));
    } else if (req.method === "GET" && rfq) {
      const user = await requireUser(req);
      await asUser(user.id, () => handleRfqDetail(res, rfq[1]));
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
}

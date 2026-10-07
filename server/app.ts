import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChatError } from "../shared/protocol";
import { AgentError } from "./agent/loop";
import { provider } from "./agent/providers";
import { HttpError, send } from "./http";
import { db } from "./db";
import { handleQuote } from "./routes/quote";
import { handleFile } from "./routes/files";
import { handleDashboard } from "./routes/dashboard";
import { handleResendWebhook } from "./routes/resendWebhook";
import { serveStatic } from "./static";
import { handleAuth, requireUser } from "./routes/auth";
import { asUser } from "./auth/current";
import { handleRfqDetail, handleRfqList } from "./routes/rfqs";
import { handleCarrierDetail, handleCarrierList } from "./routes/carriers";
import {
  ChatTurnError,
  handleChat,
  handleConversation,
  handleConversationDelete,
  handleConversationList,
} from "./routes/chat";

function toError(err: unknown): { status: number; body: ChatError } {
  if (err instanceof ChatTurnError) {
    const { status, body } = toError(err.inner);
    return { status, body: { ...body, conversationId: err.conversationId } };
  }
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

/**
 * Up only when the database answers too, so the Docker health check and an
 * uptime monitor notice a lost Supabase connection, not just a running process.
 */
async function handleHealth(res: ServerResponse) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out after 3 s")), 3000);
  });
  try {
    await Promise.race([db().get("SELECT 1 AS ok"), timeout]);
    send(res, 200, { ok: true });
  } catch (err) {
    console.error("Health check: database unreachable:", err instanceof Error ? err.message : err);
    send(res, 503, { ok: false, error: "Baza cavab vermir." });
  } finally {
    clearTimeout(timer);
  }
}

/** Routes one HTTP request; index.ts serves it, tests call it directly. */
export async function app(req: IncomingMessage, res: ServerResponse) {
  try {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const quote = path.match(/^\/api\/quote\/([\w.-]+)$/);
    const file = path.match(/^\/api\/files\/([\w.-]+)$/);
    const auth = path.match(/^\/api\/auth\/(\w+)$/);
    const rfq = path.match(/^\/api\/rfqs\/(\w+)$/);
    const carrier = path.match(/^\/api\/carriers\/(\w+)$/);
    const conversation = path.match(/^\/api\/conversations\/(\w+)$/);
    if (auth) {
      await handleAuth(req, res, auth[1]);
    } else if (req.method === "POST" && path === "/api/chat") {
      const user = await requireUser(req);
      await asUser(user.id, () => handleChat(req, res));
    } else if (req.method === "GET" && path === "/api/conversations") {
      const user = await requireUser(req);
      await asUser(user.id, () => handleConversationList(res));
    } else if (conversation && (req.method === "GET" || req.method === "DELETE")) {
      const user = await requireUser(req);
      await asUser(user.id, () =>
        req.method === "DELETE" ? handleConversationDelete(res, conversation[1]) : handleConversation(res, conversation[1]),
      );
    } else if (req.method === "POST" && path === "/api/webhooks/resend") {
      await handleResendWebhook(req, res);
    } else if (req.method === "GET" && (path === "/api/health" || path === "/healthz")) {
      await handleHealth(res);
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
    } else if (req.method === "GET" && path === "/api/carriers") {
      const user = await requireUser(req);
      await asUser(user.id, () => handleCarrierList(res));
    } else if (req.method === "GET" && carrier) {
      const user = await requireUser(req);
      await asUser(user.id, () => handleCarrierDetail(res, carrier[1]));
    } else if (file && req.method === "GET") {
      await handleFile(res, file[1]);
    } else if (path.startsWith("/api/") || !(await serveStatic(req, res, path))) {
      send(res, 404, { error: "Tapılmadı." });
    }
  } catch (err) {
    const { status, body } = toError(err);
    if (status >= 500) console.error(err instanceof ChatTurnError ? err.inner : err);
    send(res, status, body);
  }
}

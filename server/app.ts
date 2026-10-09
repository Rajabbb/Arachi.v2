import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChatError } from "../shared/protocol";
import { AgentError } from "./agent/loop";
import { provider } from "./agent/providers";
import { HttpError, send } from "./http";
import { db } from "./db";
import { config } from "./config";
import { handleConfirmation } from "./routes/confirmations";
import { handleFile } from "./routes/files";
import { serveStatic } from "./static";
import { handleAuth, requireUser } from "./routes/auth";
import { handleSso } from "./routes/sso";
import { ArachiError } from "./arachi/client";
import { asUser } from "./auth/current";
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
  if (err instanceof ArachiError) {
    // 401 = the arachi.co session ended: the page then asks the user to come back through arachi.co.
    return { status: err.status === 401 ? 401 : err.status >= 500 ? 502 : 400, body: { error: err.message } };
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

const appOrigin = new URL(config.publicBaseUrl).origin;

/**
 * Changes (POST, DELETE, ...) only from the app's own pages. The session
 * cookie is SameSite=Lax, which still lets sibling subdomains of the same
 * site post with it; browsers always send Origin on such requests, so a
 * foreign one is refused. Server-to-server calls (webhooks) send none.
 */
function checkOrigin(req: IncomingMessage) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.origin;
  if (!origin || origin === appOrigin) return;
  // The page's own address also counts (e.g. 127.0.0.1 instead of localhost in development).
  let host: string | undefined;
  try {
    host = new URL(origin).host;
  } catch {
    host = undefined;
  }
  if (host !== req.headers.host) throw new HttpError(403, "Bu sorğu başqa saytdan gəlib və qəbul edilmir.");
}

/** Runs a request as its signed-in user, with that user's arachi.co token available to the tools. */
async function asSession<T>(req: IncomingMessage, fn: () => Promise<T>): Promise<T> {
  const user = await requireUser(req);
  return asUser(user.id, fn, user.arachiToken);
}

/** Routes one HTTP request; index.ts serves it, tests call it directly. */
export async function app(req: IncomingMessage, res: ServerResponse) {
  try {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path.startsWith("/api/")) checkOrigin(req);
    const auth = path.match(/^\/api\/auth\/(\w+)$/);
    const conversation = path.match(/^\/api\/conversations\/(\w+)$/);
    const file = path.match(/^\/api\/files\/([\w.-]+)$/);
    const confirmation = path.match(/^\/api\/confirmations\/([\w-]+)$/);
    if (req.method === "GET" && path === "/sso") {
      await handleSso(req, res);
    } else if (auth) {
      await handleAuth(req, res, auth[1]);
    } else if (req.method === "POST" && path === "/api/chat") {
      await asSession(req, () => handleChat(req, res));
    } else if (req.method === "GET" && path === "/api/conversations") {
      await asSession(req, () => handleConversationList(res));
    } else if (conversation && (req.method === "GET" || req.method === "DELETE")) {
      await asSession(req, () =>
        req.method === "DELETE" ? handleConversationDelete(res, conversation[1]) : handleConversation(res, conversation[1]),
      );
    } else if (confirmation && req.method === "POST") {
      await asSession(req, () => handleConfirmation(req, res, confirmation[1]));
    } else if (file && req.method === "GET") {
      await handleFile(res, file[1]);
    } else if (req.method === "GET" && (path === "/api/health" || path === "/healthz")) {
      await handleHealth(res);
    } else if (path.startsWith("/api/") || !(await serveStatic(req, res, path))) {
      send(res, 404, { error: "Tapılmadı." });
    }
  } catch (err) {
    const { status, body } = toError(err);
    if (status >= 500) console.error(err instanceof ChatTurnError ? err.inner : err);
    send(res, status, body);
  }
}

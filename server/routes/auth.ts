import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthResponse } from "../../shared/protocol";
import {
  createSession,
  deleteSession,
  login,
  register,
  requestPasswordReset,
  resetPassword,
  SESSION_DAYS,
  userForSession,
  type User,
} from "../auth/accounts";
import { config } from "../config";
import { HttpError, readJson, send, SMALL_BODY_BYTES } from "../http";
import { clientIp, limit } from "../rateLimit";

/** Requests per client address for each form: [max, window in minutes]. */
const limits: Record<string, [number, number]> = {
  login: [30, 15],
  register: [5, 60],
  forgot: [5, 60],
  reset: [10, 15],
};

const COOKIE = "arachi_session";

function sessionToken(req: IncomingMessage): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE) return value.join("=") || undefined;
  }
  return undefined;
}

/** httpOnly: page scripts cannot read it; SameSite=Lax: other sites cannot post with it. */
function sessionCookie(token: string, maxAgeSeconds: number): string {
  const secure = config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

/** The signed-in user, or a 401 asking to log in. */
export async function requireUser(req: IncomingMessage): Promise<User> {
  const token = sessionToken(req);
  const user = token ? await userForSession(token) : undefined;
  if (!user) throw new HttpError(401, "Davam etmək üçün hesabınıza daxil olun.");
  return user;
}

async function signIn(res: ServerResponse, user: User) {
  const { token } = await createSession(user.id);
  res.setHeader("set-cookie", sessionCookie(token, SESSION_DAYS * 86400));
  send(res, 200, { user: publicUser(user) } satisfies AuthResponse);
}

function publicUser(user: User): AuthResponse["user"] {
  return { id: user.id, email: user.email, name: user.name };
}

function field(body: unknown, key: string): string {
  const value = body && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" ? value : "";
}

/** /api/auth/* — register, login, logout, current user, password reset. */
export async function handleAuth(req: IncomingMessage, res: ServerResponse, action: string) {
  if (req.method === "GET" && action === "me") {
    return send(res, 200, { user: publicUser(await requireUser(req)) } satisfies AuthResponse);
  }
  if (req.method !== "POST") throw new HttpError(405, "Bu əməliyyat dəstəklənmir.");

  if (action === "logout") {
    const token = sessionToken(req);
    if (token) await deleteSession(token);
    res.setHeader("set-cookie", sessionCookie("", 0));
    return send(res, 200, { ok: true });
  }

  const rule = limits[action];
  if (rule) limit(`${action}:${clientIp(req)}`, ...rule);
  const body = await readJson(req, SMALL_BODY_BYTES);
  switch (action) {
    case "register":
      return signIn(res, await register({ email: field(body, "email"), password: field(body, "password"), name: field(body, "name") }));
    case "login":
      return signIn(res, await login(field(body, "email"), field(body, "password")));
    case "forgot":
      await requestPasswordReset(field(body, "email"));
      return send(res, 200, { ok: true });
    case "reset":
      return signIn(res, await resetPassword(field(body, "token"), field(body, "password")));
  }
  throw new HttpError(404, "Tapılmadı.");
}

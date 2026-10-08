import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The signed-in user a request acts for. Every query on RFQs, carriers,
 * offers and messages is limited to this user, so one account never sees
 * another's data. Set by the HTTP layer after checking the session cookie.
 *
 * When the server works on top of arachi.co, the context also carries that
 * user's arachi.co access token: every data call goes to arachi.co with it,
 * so arachi.co itself enforces who may see what.
 */
interface Context {
  userId: number;
  arachiToken?: string;
}

const current = new AsyncLocalStorage<Context>();

export function asUser<T>(userId: number, fn: () => Promise<T>, arachiToken?: string): Promise<T> {
  return current.run({ userId, arachiToken }, fn);
}

/** The current user's id; throws when no user is signed in, so nothing runs unscoped. */
export function currentUserId(): number {
  const ctx = current.getStore();
  if (ctx === undefined) throw new Error("No signed-in user for this operation.");
  return ctx.userId;
}

/** The current user's id, or null outside a user's request. */
export function maybeUserId(): number | null {
  return current.getStore()?.userId ?? null;
}

/** The current user's arachi.co token; throws when the request has none (not signed in through arachi.co). */
export function currentArachiToken(): string {
  const token = current.getStore()?.arachiToken;
  if (!token) throw new Error("arachi.co sessiyası yoxdur. arachi.co-dan yenidən 'Aİ istifadə et' basın.");
  return token;
}

/** The current user's arachi.co customer id: the `sub` of their arachi.co token (arachi.co re-checks it on every call). */
export function currentCustomerId(): number {
  const part = currentArachiToken().split(".")[1] ?? "";
  try {
    const sub = Number((JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { sub?: unknown }).sub);
    if (Number.isInteger(sub) && sub > 0) return sub;
  } catch {
    /* falls through */
  }
  throw new Error("arachi.co sessiyası etibarsızdır. arachi.co-dan yenidən 'Aİ istifadə et' basın.");
}

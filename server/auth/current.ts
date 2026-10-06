import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The signed-in user a request acts for. Every query on RFQs, carriers,
 * offers and messages is limited to this user, so one account never sees
 * another's data. Set by the HTTP layer after checking the session cookie,
 * and by the carrier quote page for the owner of the RFQ its link names.
 */
const current = new AsyncLocalStorage<number>();

export function asUser<T>(userId: number, fn: () => Promise<T>): Promise<T> {
  return current.run(userId, fn);
}

/** The current user's id; throws when no user is signed in, so nothing runs unscoped. */
export function currentUserId(): number {
  const id = current.getStore();
  if (id === undefined) throw new Error("No signed-in user for this operation.");
  return id;
}

/** The current user's id, or null outside a user's request. */
export function maybeUserId(): number | null {
  return current.getStore() ?? null;
}

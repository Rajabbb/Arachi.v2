import type { IncomingMessage } from "node:http";
import { config } from "./config";
import { HttpError } from "./http";

/**
 * In-memory request limits per client address, for the public auth forms
 * (login, registration, password reset). One app instance runs, so memory is
 * enough; a restart only forgets the counts.
 */

const windows = new Map<string, { count: number; resetAt: number }>();

/** Forgets all counts (tests). */
export function resetRateLimits() {
  windows.clear();
}

/**
 * The client's address. Behind Caddy (TRUST_PROXY=1) it is the last
 * X-Forwarded-For entry, the one Caddy itself added; earlier entries come
 * from the client and can be made up.
 */
export function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (config.trustProxy && typeof forwarded === "string") {
    const last = forwarded.split(",").pop()?.trim();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** Counts one request for `key`; over `max` per `windowMinutes`, answers 429. */
export function limit(key: string, max: number, windowMinutes: number) {
  const now = Date.now();
  if (windows.size > 10_000) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  }
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + windowMinutes * 60_000 };
    windows.set(key, w);
  }
  if (++w.count > max) {
    const minutes = Math.max(1, Math.ceil((w.resetAt - now) / 60_000));
    throw new HttpError(429, `Bu ünvandan çox sayda cəhd oldu. ${minutes} dəqiqə sonra yenidən cəhd edin.`);
  }
}

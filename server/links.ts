import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { db } from "./db";

/**
 * Signed tokens for links sent to carriers. The token names the record it
 * opens and carries an HMAC, so it cannot be guessed or altered, and the
 * carrier needs no login.
 */

function secret(): string {
  if (config.linkSecret) return config.linkSecret;
  const row = db().prepare("SELECT value FROM settings WHERE key = 'link_secret'").get() as
    | { value: string }
    | undefined;
  if (row) return row.value;
  const value = randomBytes(32).toString("hex");
  db().prepare("INSERT INTO settings (key, value) VALUES ('link_secret', ?)").run(value);
  return value;
}

function mac(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function signToken(kind: string, id: number): string {
  const payload = Buffer.from(`${kind}:${id}`).toString("base64url");
  return `${payload}.${mac(payload)}`;
}

/** Returns the id the token was signed for, or null if it is invalid. */
export function verifyToken(kind: string, token: string): number | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(mac(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null;
  }
  const [k, id] = Buffer.from(payload, "base64url").toString().split(":");
  const n = Number(id);
  return k === kind && Number.isInteger(n) && n > 0 ? n : null;
}

export function publicUrl(path: string): string {
  return `${config.publicBaseUrl}${path}`;
}

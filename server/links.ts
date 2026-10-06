import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { db } from "./db";

/**
 * Signed tokens for links sent to carriers. The token names the record it
 * opens and carries an HMAC, so it cannot be guessed or altered, and the
 * carrier needs no login.
 */

let stored: Promise<string> | null = null;

/** The secret from config, or one generated once and kept in the settings table. */
function secret(): Promise<string> {
  if (config.linkSecret) return Promise.resolve(config.linkSecret);
  stored ??= (async () => {
    // Several servers may start at once: the first insert wins, all read it back.
    await db().run(
      "INSERT INTO settings (key, value) VALUES ('link_secret', ?) ON CONFLICT (key) DO NOTHING",
      randomBytes(32).toString("hex"),
    );
    const row = await db().get<{ value: string }>("SELECT value FROM settings WHERE key = 'link_secret'");
    return row!.value;
  })().catch((err) => {
    stored = null;
    throw err;
  });
  return stored;
}

/** Forgets the cached secret, for when the database is replaced (tests). */
export function resetLinkSecret() {
  stored = null;
}

async function mac(payload: string): Promise<string> {
  return createHmac("sha256", await secret()).update(payload).digest("base64url");
}

export async function signToken(kind: string, id: number): Promise<string> {
  const payload = Buffer.from(`${kind}:${id}`).toString("base64url");
  return `${payload}.${await mac(payload)}`;
}

/** Returns the id the token was signed for, or null if it is invalid. */
export async function verifyToken(kind: string, token: string): Promise<number | null> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(await mac(payload));
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

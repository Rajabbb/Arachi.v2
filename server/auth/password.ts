import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing with scrypt (built into Node, no extra dependency).
 * Stored as "scrypt$N$r$p$salt$hash" so the cost can be raised later
 * without breaking existing passwords.
 */

const N = 16384;
const r = 8;
const p = 1;
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFC"), salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r, p });
  return ["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, rr, pp, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await derive(password, Buffer.from(salt, "base64url"), {
    N: Number(n),
    r: Number(rr),
    p: Number(pp),
    maxmem: 256 * Number(n) * Number(rr),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

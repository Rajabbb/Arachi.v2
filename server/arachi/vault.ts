import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config";

/**
 * arachi.co-nun verdiyi giriş tokeni bazada açıq mətnlə saxlanılmır: AES-256-GCM ilə
 * şifrələnir. Açar V2_SSO_SECRET-dən götürülür (hər iki serverdə eyni gizli açar).
 * Baza sızsa belə, token açarsız oxunmur.
 */
function key(): Buffer {
  if (!config.ssoSecret) throw new Error("V2_SSO_SECRET təyin olunmayıb.");
  return createHash("sha256").update(`arachi-v2-token-vault:${config.ssoSecret}`).digest();
}

export function sealToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** Returns undefined when the value was tampered with or sealed under another secret. */
export function openToken(sealed: string): string | undefined {
  try {
    const [version, iv, tag, body] = sealed.split(".");
    if (version !== "v1" || !iv || !tag || !body) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}

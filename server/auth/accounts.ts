import { createHash, randomBytes } from "node:crypto";
import { config } from "../config";
import { db, now, transaction } from "../db";
import { HttpError } from "../http";
import { publicUrl } from "../links";
import { deliver, sendsForReal } from "../notify";
import { asUser } from "./current";
import { hashPassword, verifyPassword } from "./password";

/** Email + password accounts, server-side sessions and password reset links. */

export interface User {
  id: number;
  email: string;
  name: string;
  created_at: string;
}

export const SESSION_DAYS = 30;
const RESET_MINUTES = 60;
/** Reset emails one account may request per hour. */
const RESETS_PER_HOUR = 3;
/** Failed logins for one email from one address before that pair is locked for LOCK_MINUTES. */
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
/**
 * Failed logins for one email from all addresses together before the email
 * is locked for ACCOUNT_LOCK_MINUTES (guessing spread over many addresses).
 */
const MAX_ACCOUNT_FAILURES = 30;
const ACCOUNT_LOCK_MINUTES = 60;
export const MIN_PASSWORD_LENGTH = 8;

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_COLUMNS = "u.id, u.email, u.name, u.created_at";

/** Tokens go to the browser or into an email; only their hash is stored. */
function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function later(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function normalizeEmail(email: string): string {
  const e = email.trim().toLowerCase();
  if (!emailRe.test(e) || e.length > 254) throw new HttpError(400, "Email ünvanı düzgün deyil.");
  return e;
}

function checkPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Şifrə ən azı ${MIN_PASSWORD_LENGTH} simvol olmalıdır.`);
  }
  if (password.length > 200) throw new HttpError(400, "Şifrə çox uzundur.");
}

export async function findUserByEmail(email: string): Promise<(User & { password_hash: string }) | undefined> {
  return db().get(`SELECT ${USER_COLUMNS}, u.password_hash FROM users u WHERE lower(u.email) = ?`, email.trim().toLowerCase());
}

/**
 * Creates an account. The first account to register takes over everything
 * created before accounts existed (RFQs, carriers, messages with no owner).
 * With signup closed (config.allowSignup), only that first account can register.
 */
export async function register(input: { email: string; password: string; name?: string }): Promise<User> {
  const email = normalizeEmail(input.email);
  checkPassword(input.password);
  const name = (input.name ?? "").trim().slice(0, 100);
  const hash = await hashPassword(input.password);
  return transaction(async () => {
    if (!config.allowSignup && (await db().get("SELECT id FROM users LIMIT 1"))) {
      throw new HttpError(403, "Yeni hesab yaratmaq bağlıdır. Hesab lazımdırsa, administratora müraciət edin.");
    }
    if (await findUserByEmail(email)) throw new HttpError(409, "Bu email ilə hesab artıq var. Daxil olun və ya şifrəni bərpa edin.");
    const user = (await db().get<User>(
      "INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?) RETURNING id, email, name, created_at",
      email, name, hash, now(),
    ))!;
    const { n } = (await db().get<{ n: number }>("SELECT count(*) AS n FROM users"))!;
    if (Number(n) === 1) await claimUnowned(user.id);
    return user;
  });
}

/** Gives rows created before accounts existed to a user. */
export async function claimUnowned(userId: number) {
  for (const table of ["rfqs", "carriers", "outbox"]) {
    await db().run(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`, userId);
  }
}

let dummyHash: string | undefined;
const failedLogins = new Map<string, { count: number; since: number }>();

/** Forgets failed login counts (tests). */
export function resetLoginLimits() {
  failedLogins.clear();
}

/** The live failure count under `key`, forgetting it once `minutes` have passed. */
function failures(key: string, minutes: number): number {
  const entry = failedLogins.get(key);
  if (entry && Date.now() - entry.since > minutes * 60_000) failedLogins.delete(key);
  return failedLogins.get(key)?.count ?? 0;
}

function countFailure(key: string) {
  if (failedLogins.size > 10_000) {
    const stale = Date.now() - ACCOUNT_LOCK_MINUTES * 60_000;
    for (const [k, e] of failedLogins) if (e.since < stale) failedLogins.delete(k);
  }
  const entry = failedLogins.get(key) ?? { count: 0, since: Date.now() };
  entry.count++;
  failedLogins.set(key, entry);
}

/**
 * Checks an email and password. Wrong passwords lock the email for the
 * address they came from (so a stranger cannot lock the owner out from
 * elsewhere), and many wrong passwords from anywhere lock the email itself.
 */
export async function login(emailInput: string, password: string, clientAddress = "unknown"): Promise<User> {
  const email = emailInput.trim().toLowerCase();
  const pairKey = `${clientAddress}|${email}`;
  const accountKey = `*|${email}`;
  if (failures(pairKey, LOCK_MINUTES) >= MAX_FAILED_LOGINS) {
    throw new HttpError(429, `Çox sayda uğursuz cəhd oldu. ${LOCK_MINUTES} dəqiqə sonra yenidən cəhd edin və ya şifrəni bərpa edin.`);
  }
  if (failures(accountKey, ACCOUNT_LOCK_MINUTES) >= MAX_ACCOUNT_FAILURES) {
    throw new HttpError(429, `Bu hesaba çox sayda uğursuz cəhd oldu. ${ACCOUNT_LOCK_MINUTES} dəqiqə sonra yenidən cəhd edin və ya şifrəni bərpa edin.`);
  }
  const user = await findUserByEmail(email);
  // Check a password even for an unknown email, so timing does not reveal which emails have accounts.
  const ok = await verifyPassword(password, user?.password_hash ?? dummyHash ?? (dummyHash = await hashPassword("x")));
  if (!user || !ok) {
    countFailure(pairKey);
    countFailure(accountKey);
    throw new HttpError(401, "Email və ya şifrə yanlışdır.");
  }
  failedLogins.delete(pairKey);
  const { password_hash: _, ...rest } = user;
  return rest;
}

export async function createSession(userId: number): Promise<{ token: string; expiresAt: string }> {
  const token = newToken();
  const expiresAt = later(SESSION_DAYS * 24 * 60);
  await db().run("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?", userId, now());
  await db().run(
    "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    tokenHash(token), userId, now(), expiresAt,
  );
  return { token, expiresAt };
}

export function userForSession(token: string): Promise<User | undefined> {
  return db().get<User>(
    `SELECT ${USER_COLUMNS} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`,
    tokenHash(token), now(),
  );
}

export async function deleteSession(token: string) {
  await db().run("DELETE FROM sessions WHERE id = ?", tokenHash(token));
}

/**
 * Emails a one-time password reset link. Says nothing about whether the
 * email has an account: the caller always shows the same message.
 */
export async function requestPasswordReset(emailInput: string): Promise<void> {
  const user = await findUserByEmail(emailInput);
  if (!user) return;
  const { n } = (await db().get<{ n: number }>(
    "SELECT count(*) AS n FROM password_resets WHERE user_id = ? AND created_at > ?",
    user.id, later(-60),
  ))!;
  if (Number(n) >= RESETS_PER_HOUR) return;

  const token = newToken();
  await db().run(
    "INSERT INTO password_resets (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    tokenHash(token), user.id, now(), later(RESET_MINUTES),
  );
  const link = publicUrl(`/reset/${token}`);
  await asUser(user.id, () =>
    deliver({
      channel: "email",
      to: user.email,
      subject: "Arachi: şifrənin bərpası",
      body: [
        `Salam${user.name ? `, ${user.name}` : ""}!`,
        "Arachi hesabınız üçün şifrənin bərpası istənildi. Yeni şifrə təyin etmək üçün linkə keçin:",
        link,
        `Link ${RESET_MINUTES} dəqiqə etibarlıdır və bir dəfə işləyir.`,
        "Bunu siz istəməmisinizsə, bu məktubu nəzərə almayın: şifrəniz dəyişməyəcək.",
      ].join("\n\n"),
    }),
  );
  // Without Resend the email only goes to the log, so show the link there for local use.
  if (!sendsForReal("email")) console.log(`Password reset link for ${user.email}: ${link}`);
}

/** Sets a new password from a reset link and signs the user out everywhere else. */
export async function resetPassword(token: string, password: string): Promise<User> {
  checkPassword(password);
  const hash = await hashPassword(password);
  return transaction(async () => {
    const reset = await db().get<{ user_id: number }>(
      "SELECT user_id FROM password_resets WHERE id = ? AND used_at IS NULL AND expires_at > ?",
      tokenHash(token), now(),
    );
    const used = reset && (await db().run(
      "UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
      now(), reset.user_id,
    )).changes > 0;
    if (!reset || !used) throw new HttpError(400, "Link etibarsızdır və ya vaxtı keçib. Yeni link istəyin.");
    await db().run("UPDATE users SET password_hash = ? WHERE id = ?", hash, reset.user_id);
    await db().run("DELETE FROM sessions WHERE user_id = ?", reset.user_id);
    return (await db().get<User>(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = ?`, reset.user_id))!;
  });
}

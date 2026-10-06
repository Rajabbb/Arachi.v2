import { createHash, randomBytes } from "node:crypto";
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
/** Failed logins per email before it is locked for LOCK_MINUTES. */
const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;
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
 */
export async function register(input: { email: string; password: string; name?: string }): Promise<User> {
  const email = normalizeEmail(input.email);
  checkPassword(input.password);
  const name = (input.name ?? "").trim().slice(0, 100);
  const hash = await hashPassword(input.password);
  return transaction(async () => {
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

export async function login(emailInput: string, password: string): Promise<User> {
  const email = emailInput.trim().toLowerCase();
  const failed = failedLogins.get(email);
  if (failed && Date.now() - failed.since > LOCK_MINUTES * 60_000) failedLogins.delete(email);
  else if (failed && failed.count >= MAX_FAILED_LOGINS) {
    throw new HttpError(429, `Çox sayda uğursuz cəhd oldu. ${LOCK_MINUTES} dəqiqə sonra yenidən cəhd edin və ya şifrəni bərpa edin.`);
  }
  const user = await findUserByEmail(email);
  // Check a password even for an unknown email, so timing does not reveal which emails have accounts.
  const ok = await verifyPassword(password, user?.password_hash ?? dummyHash ?? (dummyHash = await hashPassword("x")));
  if (!user || !ok) {
    const entry = failedLogins.get(email) ?? { count: 0, since: Date.now() };
    entry.count++;
    failedLogins.set(email, entry);
    throw new HttpError(401, "Email və ya şifrə yanlışdır.");
  }
  failedLogins.delete(email);
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

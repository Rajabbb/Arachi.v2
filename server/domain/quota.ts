import type { Quota } from "../../shared/protocol";
import { db } from "../db";
import { HttpError } from "../http";

/**
 * The AI request allowance of the plan arachi.co reported at sign-in (demo: 100 for the whole
 * demo; paid plans: per calendar month). Counted in its own table so deleting a conversation
 * never gives requests back. A user without a plan (not signed in through arachi.co) is not limited.
 */

interface SubRow {
  sub_plan: string | null;
  sub_label: string | null;
  sub_ai_limit: number | null;
  sub_ai_period: string | null;
  sub_trial_ends_at: string | null;
}

export const DEMO_EXPIRED_MESSAGE = "Demo müddətiniz bitib. Davam etmək üçün arachi.co-da plan seçib ödəniş edin.";

/** "m:2026-10" for the monthly allowance, "total" for the demo's. */
export function periodKey(period: "month" | "total", at: Date = new Date()): string {
  return period === "month" ? `m:${at.toISOString().slice(0, 7)}` : "total";
}

export async function quotaFor(userId: number, at: Date = new Date()): Promise<Quota | null> {
  const row = await db().get<SubRow>(
    "SELECT sub_plan, sub_label, sub_ai_limit, sub_ai_period, sub_trial_ends_at FROM users WHERE id = ?",
    userId,
  );
  if (!row || !row.sub_plan) return null;
  const period: "month" | "total" = row.sub_ai_period === "total" ? "total" : "month";
  const limit = row.sub_ai_limit === null || row.sub_ai_limit === undefined ? null : Number(row.sub_ai_limit);
  const usage = await db().get<{ used: number }>("SELECT used FROM ai_usage WHERE user_id = ? AND period = ?", userId, periodKey(period, at));
  const used = Number(usage?.used ?? 0);
  const isDemo = row.sub_plan === "demo";
  const trialEnd = row.sub_trial_ends_at ? Date.parse(row.sub_trial_ends_at.endsWith("Z") || /[+-]\d\d:\d\d$/.test(row.sub_trial_ends_at) ? row.sub_trial_ends_at : `${row.sub_trial_ends_at}Z`) : NaN;
  const expired = isDemo && Number.isFinite(trialEnd) && trialEnd <= at.getTime();
  return {
    plan: row.sub_plan,
    label: row.sub_label || row.sub_plan,
    limit,
    used,
    remaining: limit === null ? null : Math.max(0, limit - used),
    period,
    isDemo,
    trialEndsAt: row.sub_trial_ends_at,
    expired,
  };
}

/** Counts one request for the user, or refuses it (demo over, allowance used up). Returns the allowance after it. */
export async function consumeRequest(userId: number, at: Date = new Date()): Promise<Quota | null> {
  const quota = await quotaFor(userId, at);
  if (!quota) return null;
  if (quota.expired) throw new HttpError(402, DEMO_EXPIRED_MESSAGE);
  if (quota.limit !== null && quota.used >= quota.limit) {
    const where = quota.period === "month" ? `Bu ay üçün ${quota.limit} sorğu limiti dolub. Limit növbəti ayın əvvəlində yenilənir.` : `Demo üçün ${quota.limit} sorğu limiti dolub.`;
    throw new HttpError(402, `${where} Əlavə sorğu üçün arachi.co-da planı seçin və ya yeniləyin.`);
  }
  await db().run(
    "INSERT INTO ai_usage (user_id, period, used) VALUES (?, ?, 1) ON CONFLICT (user_id, period) DO UPDATE SET used = ai_usage.used + 1",
    userId, periodKey(quota.period, at),
  );
  const used = quota.used + 1;
  return { ...quota, used, remaining: quota.limit === null ? null : Math.max(0, quota.limit - used) };
}

import { config } from "../config";
import { db, now } from "../db";
import { fetchResendStatus } from "./resend";

/**
 * Real delivery status of sent emails. Resend accepting an email only means
 * it was sent; whether it reached the inbox, bounced or was opened comes
 * later. It arrives two ways: polling Resend's API for emails whose outcome
 * is not known yet (works on localhost), and Resend's webhook once the app
 * has a public address (routes/resendWebhook.ts). Both end in
 * applyEmailStatus(), which updates the outbox row and the RFQ dispatch the
 * panel counts.
 */

/** Resend's last_event values that mean the email did not reach the recipient. */
const failures: Record<string, string> = {
  bounced: "Məktub geri qayıtdı (bounce)",
  complained: "Alıcı məktubu spam kimi işarələdi",
  suppressed: "Resend bu ünvana göndərmir (əvvəllər geri qayıdıb və ya spam şikayəti olub)",
  failed: "Resend məktubu göndərə bilmədi",
  canceled: "Göndərmə ləğv edildi",
};

/** Positive events in the order they happen; a later one never moves back to an earlier one. */
const progress = ["queued", "scheduled", "sent", "delivery_delayed", "delivered", "opened", "clicked"];

/** Statuses after which nothing the panel shows can change, so polling stops. */
const settled = new Set([...Object.keys(failures), "opened", "clicked"]);

export function isFailure(status: string | null | undefined): boolean {
  return !!status && status in failures;
}

/** Text for the panel and the agent: why an email was not delivered. */
export function failureText(status: string, detail?: string | null): string {
  return detail ? `${failures[status]}: ${detail}` : failures[status];
}

/** Which status to keep when a new one arrives: a failure wins, otherwise the furthest along. */
function merge(current: string | null, next: string): string {
  if (!current || isFailure(next)) return next;
  if (isFailure(current)) return current;
  return progress.indexOf(next) > progress.indexOf(current) ? next : current;
}

interface OutboxRow {
  id: number;
  recipient: string;
  subject: string;
  user_id: number | null;
  dispatch_id: number | null;
  provider_status: string | null;
  provider_detail: string | null;
}

/**
 * The dispatch an email is for. Emails sent before outbox.dispatch_id existed
 * are matched by recipient and the "RFQ #N" in their subject.
 */
async function dispatchOf(row: OutboxRow): Promise<number | null> {
  if (row.dispatch_id) return row.dispatch_id;
  // "RFQ #N " (with a space) matches the RFQ email and its reminders, not the award notice "RFQ #N:".
  const rfq = row.subject.match(/RFQ #(\d+) /)?.[1];
  if (!rfq || row.user_id === null) return null;
  const found = await db().get<{ id: number }>(
    `SELECT d.id FROM dispatches d JOIN carriers c ON c.id = d.carrier_id JOIN rfqs r ON r.id = d.rfq_id
     WHERE d.rfq_id = ? AND d.channel = 'email' AND lower(c.email) = lower(?) AND r.user_id = ?`,
    Number(rfq), row.recipient.trim(), row.user_id,
  );
  // Remember the match, so the panel knows this dispatch's email was accepted.
  if (found) await db().run("UPDATE outbox SET dispatch_id = ? WHERE id = ?", found.id, row.id);
  return found?.id ?? null;
}

/**
 * Records a status Resend reported for one of our emails (by its Resend id)
 * and moves its dispatch accordingly: a failure makes it "Çatdırılmadı",
 * delivered makes it "Çatdırıldı", an open makes it "Baxıldı". A dispatch
 * whose link was viewed or that has an offer keeps its status. Unknown ids
 * and statuses are ignored. Returns whether an email matched.
 */
export async function applyEmailStatus(providerId: string, status: string, detail?: string): Promise<boolean> {
  if (!(status in failures) && !progress.includes(status)) return false;
  const rows = await db().all<OutboxRow>(
    `SELECT id, recipient, subject, user_id, dispatch_id, provider_status, provider_detail
     FROM outbox WHERE provider_id = ? AND channel = 'email'`,
    providerId,
  );
  const at = now();
  for (const row of rows) {
    const merged = merge(row.provider_status, status);
    const mergedDetail = merged === status ? (detail ?? row.provider_detail) : row.provider_detail;
    const failed = isFailure(merged);
    await db().run(
      `UPDATE outbox SET provider_status = ?, provider_detail = ?, status_checked_at = ?,
         delivered = CASE WHEN ? = 1 THEN 0 ELSE delivered END,
         error = CASE WHEN ? = 1 THEN ? ELSE error END
       WHERE id = ?`,
      merged, mergedDetail ?? null, at, failed ? 1 : 0, failed ? 1 : 0,
      failed ? failureText(merged, mergedDetail) : null, row.id,
    );

    const dispatchId = await dispatchOf(row);
    if (dispatchId === null) continue;
    if (failed) {
      await db().run(
        "UPDATE dispatches SET status = 'failed', error = ? WHERE id = ? AND status IN ('sent', 'delivered')",
        failureText(merged, mergedDetail), dispatchId,
      );
    } else if (merged === "opened" || merged === "clicked") {
      await db().run(
        `UPDATE dispatches SET status = 'viewed', viewed_at = coalesce(viewed_at, ?)
         WHERE id = ? AND status IN ('sent', 'delivered')`,
        at, dispatchId,
      );
    } else if (merged === "delivered") {
      await db().run("UPDATE dispatches SET status = 'delivered' WHERE id = ? AND status = 'sent'", dispatchId);
    }
  }
  return rows.length > 0;
}

/** Asks the email provider for an email's last event; undefined when it does not know the id. */
export type StatusChecker = (providerId: string) => Promise<string | undefined>;

let checker: StatusChecker | null = config.resendApiKey
  ? (id) => fetchResendStatus(config.resendApiKey, id)
  : null;
/** Pause between API calls, under Resend's default limit of 2 requests per second. */
let pauseMs = 600;

/** Replaces the status source (tests); null turns polling off. */
export function setStatusChecker(next: StatusChecker | null, pause = 600) {
  checker = next;
  pauseMs = pause;
}

export function statusCheckingEnabled(): boolean {
  return checker !== null;
}

/** Emails older than this are no longer checked. */
const maxAgeMs = 7 * 86400_000;

/** Time to wait before checking an email again: often while fresh (bounces come within minutes), rarely later. */
export function recheckAfterMs(ageMs: number): number {
  return Math.min(2 * 3600_000, Math.max(60_000, ageMs / 4));
}

/** Asks Resend about one email right away and applies the answer. */
export async function checkEmailNow(providerId: string): Promise<void> {
  if (!checker) return;
  // Only ids we sent: a webhook request without a signature cannot make us query arbitrary ids.
  if (!(await db().get("SELECT id FROM outbox WHERE provider_id = ?", providerId))) return;
  const status = await checker(providerId);
  await db().run("UPDATE outbox SET status_checked_at = ? WHERE provider_id = ?", now(), providerId);
  if (status) await applyEmailStatus(providerId, status);
}

let running: Promise<number> | null = null;
/** The last polling error logged, so a lasting problem is logged once, not every minute. */
let lastWarning = "";

/**
 * Checks emails whose final status is not known yet and that are due for a
 * check (see recheckAfterMs), at most `limit` per run. userId limits it to
 * one user's emails (the panel); without it every user's (the background
 * job). Runs one at a time: a call while another runs waits for that one.
 * Returns how many emails were checked.
 */
export function refreshEmailStatuses(options: { userId?: number; limit?: number } = {}): Promise<number> {
  if (!checker) return Promise.resolve(0);
  running ??= poll(options).finally(() => (running = null));
  return running;
}

async function poll({ userId, limit = 20 }: { userId?: number; limit?: number }): Promise<number> {
  const nowMs = Date.now();
  const candidates = await db().all<{ provider_id: string; created_at: string; status_checked_at: string | null }>(
    `SELECT provider_id, created_at, status_checked_at FROM outbox
     WHERE channel = 'email' AND provider_id IS NOT NULL AND created_at >= ?
       AND (provider_status IS NULL OR provider_status NOT IN (${[...settled].map(() => "?").join(", ")}))
       ${userId === undefined ? "" : "AND user_id = ?"}
     ORDER BY coalesce(status_checked_at, created_at) LIMIT 200`,
    new Date(nowMs - maxAgeMs).toISOString(), ...settled, ...(userId === undefined ? [] : [userId]),
  );
  const due = candidates.filter((c) => {
    if (!c.status_checked_at) return true;
    const age = nowMs - Date.parse(c.created_at);
    return nowMs - Date.parse(c.status_checked_at) >= recheckAfterMs(age);
  });
  const ids = [...new Set(due.map((c) => c.provider_id))].slice(0, limit);
  let checked = 0;
  for (const id of ids) {
    if (checked > 0 && pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
    try {
      await checkEmailNow(id);
      checked++;
      lastWarning = "";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== lastWarning) console.warn(`Email status check failed: ${message}`);
      lastWarning = message;
      break; // Resend unreachable, rate limited or the key cannot read: try again on the next run.
    }
  }
  return checked;
}

/** Checks in the background every minute while the server runs. */
export function startEmailStatusPolling(intervalMs = 60_000) {
  if (!checker) return;
  const tick = () => refreshEmailStatuses().catch((err) => console.warn("Email status polling:", err));
  setTimeout(tick, 5_000).unref();
  setInterval(tick, intervalMs).unref();
}

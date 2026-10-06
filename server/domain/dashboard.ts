import type { DashboardData } from "../../shared/protocol";
import { db, now } from "../db";
import { currentUserId } from "../auth/current";
import { statusLabels, type DispatchStatus } from "./dispatches";

/** Numbers for the analytics panel and the get_dashboard tool. */
export async function dashboard(periodDays: number): Promise<DashboardData> {
  if (!(periodDays > 0)) throw new Error("Dövr (gün) müsbət olmalıdır.");
  const since = new Date(Date.now() - periodDays * 86400_000).toISOString();
  const user = currentUserId();
  const one = async <T>(sql: string, ...args: (string | number)[]) => (await db().get<T>(sql, ...args))!;

  const rfqs = await one<{ open: number; awarded: number; created: number }>(
    `SELECT count(*) FILTER (WHERE status = 'open') AS open, count(*) FILTER (WHERE status = 'awarded') AS awarded,
            count(*) FILTER (WHERE created_at >= ?) AS created FROM rfqs WHERE user_id = ?`,
    since, user,
  );
  const carriers = (await one<{ n: number }>("SELECT count(*) AS n FROM carriers WHERE active = 1 AND user_id = ?", user)).n;
  const offers = (await one<{ n: number }>(
    "SELECT count(*) AS n FROM offers o JOIN rfqs r ON r.id = o.rfq_id WHERE o.created_at >= ? AND r.user_id = ?",
    since, user,
  )).n;

  // Response rate: carriers that sent an offer out of those an RFQ reached, in the period.
  const reach = await one<{ sent: number; offered: number }>(
    `SELECT count(*) AS sent, count(*) FILTER (WHERE d.status = 'offered') AS offered
     FROM dispatches d JOIN rfqs r ON r.id = d.rfq_id WHERE d.sent_at >= ? AND r.user_id = ?`,
    since, user,
  );
  const statusRows = await db().all<{ status: DispatchStatus; n: number }>(
    `SELECT d.status, count(*) AS n FROM dispatches d JOIN rfqs r ON r.id = d.rfq_id
     WHERE d.sent_at >= ? AND r.user_id = ? GROUP BY d.status`,
    since, user,
  );
  const counts = new Map(statusRows.map((r) => [r.status, r.n]));

  const awardedValue = await db().all<{ currency: string; total: number }>(
    `SELECT o.currency, sum(o.price) AS total FROM rfqs r JOIN offers o ON o.id = r.awarded_offer_id
     WHERE r.awarded_at >= ? AND r.user_id = ? GROUP BY o.currency ORDER BY o.currency`,
    since, user,
  );

  const recent = await db().all<DashboardData["recentOffers"][number]>(
    `SELECT o.id, o.rfq_id, r.origin, r.destination, c.name AS carrier, o.version, o.price, o.currency,
            o.transit_days, o.created_at, r.awarded_offer_id IS NOT NULL AND r.awarded_offer_id = o.id AS winner
     FROM offers o JOIN rfqs r ON r.id = o.rfq_id JOIN carriers c ON c.id = o.carrier_id
     WHERE r.user_id = ? ORDER BY o.id DESC LIMIT 10`,
    user,
  );

  return {
    generatedAt: now(),
    periodDays,
    activeRfqs: rfqs.open ?? 0,
    awardedRfqs: rfqs.awarded ?? 0,
    rfqsCreated: rfqs.created ?? 0,
    carriers,
    offersReceived: offers,
    responseRate: reach.sent ? Math.round(((reach.offered ?? 0) / reach.sent) * 1000) / 10 : null,
    statuses: (Object.keys(statusLabels) as DispatchStatus[]).map((s) => ({
      status: s,
      label: statusLabels[s],
      count: counts.get(s) ?? 0,
    })),
    awardedValue,
    recentOffers: recent.map((r) => ({ ...r, winner: Boolean(r.winner) })),
  };
}

import type { DashboardData } from "../../shared/protocol";
import { db, now } from "../db";
import { statusLabels, type DispatchStatus } from "./dispatches";

/** Numbers for the analytics panel and the get_dashboard tool. */
export function dashboard(periodDays: number): DashboardData {
  if (!(periodDays > 0)) throw new Error("Dövr (gün) müsbət olmalıdır.");
  const since = new Date(Date.now() - periodDays * 86400_000).toISOString();
  const one = <T>(sql: string, ...args: (string | number)[]) => db().prepare(sql).get(...args) as T;

  const rfqs = one<{ open: number; awarded: number; created: number }>(
    `SELECT sum(status = 'open') AS open, sum(status = 'awarded') AS awarded,
            sum(created_at >= ?) AS created FROM rfqs`,
    since,
  );
  const carriers = one<{ n: number }>("SELECT count(*) AS n FROM carriers WHERE active = 1").n;
  const offers = one<{ n: number }>("SELECT count(*) AS n FROM offers WHERE created_at >= ?", since).n;

  // Response rate: carriers that sent an offer out of those an RFQ reached, in the period.
  const reach = one<{ sent: number; offered: number }>(
    `SELECT count(*) AS sent, sum(status = 'offered') AS offered FROM dispatches WHERE sent_at >= ?`,
    since,
  );
  const statusRows = db()
    .prepare("SELECT status, count(*) AS n FROM dispatches WHERE sent_at >= ? GROUP BY status")
    .all(since) as { status: DispatchStatus; n: number }[];
  const counts = new Map(statusRows.map((r) => [r.status, r.n]));

  const awardedValue = db()
    .prepare(
      `SELECT o.currency, sum(o.price) AS total FROM rfqs r JOIN offers o ON o.id = r.awarded_offer_id
       WHERE r.awarded_at >= ? GROUP BY o.currency ORDER BY o.currency`,
    )
    .all(since) as { currency: string; total: number }[];

  const recent = db()
    .prepare(
      `SELECT o.id, o.rfq_id, r.origin, r.destination, c.name AS carrier, o.version, o.price, o.currency,
              o.transit_days, o.created_at, r.awarded_offer_id = o.id AS winner
       FROM offers o JOIN rfqs r ON r.id = o.rfq_id JOIN carriers c ON c.id = o.carrier_id
       ORDER BY o.id DESC LIMIT 10`,
    )
    .all() as unknown as DashboardData["recentOffers"];

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

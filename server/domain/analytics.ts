import type { MonthlyPoint, MonthlyReportData } from "../../shared/protocol";
import { db } from "../db";
import { currentUserId } from "../auth/current";
import { listRfqs } from "./rfqOverview";

/**
 * Month-by-month numbers for the panel's charts and its monthly report.
 * Months are calendar months in Baku time (UTC+4 all year, no DST), so an RFQ
 * made at 01:00 on the 1st in Baku counts in that month, not the one before.
 */

const BAKU_OFFSET_MS = 4 * 3600_000;

/** "2026-10" for a stored ISO timestamp, in Baku time. */
export function monthOf(iso: string): string {
  return new Date(Date.parse(iso) + BAKU_OFFSET_MS).toISOString().slice(0, 7);
}

function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** When a Baku month starts, as a stored (UTC ISO) timestamp, for SQL range filters. */
function monthStart(month: string): string {
  return new Date(Date.parse(`${month}-01T00:00:00Z`) - BAKU_OFFSET_MS).toISOString();
}

/** The last `n` months, oldest first, ending with the current one. */
export function lastMonths(n: number, nowMs = Date.now()): string[] {
  const current = monthOf(new Date(nowMs).toISOString());
  return Array.from({ length: n }, (_, i) => addMonths(current, i - n + 1));
}

export const isMonth = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

const rate = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

function countBy(dates: string[], months: string[]): Map<string, number> {
  const counts = new Map(months.map((m) => [m, 0]));
  for (const d of dates) {
    const m = monthOf(d);
    if (counts.has(m)) counts.set(m, counts.get(m)! + 1);
  }
  return counts;
}

/** Rows of the user's RFQs, offers and sends in [from, to), read once for grouping in code. */
async function activityBetween(from: string, to: string) {
  const user = currentUserId();
  const rfqs = await db().all<{ created_at: string }>(
    "SELECT created_at FROM rfqs WHERE user_id = ? AND created_at >= ? AND created_at < ?",
    user, from, to,
  );
  // Separate offers, not their updates (a new version is the same offer), as on the dashboard.
  const offers = await db().all<{ created_at: string }>(
    `SELECT o.created_at FROM offers o JOIN rfqs r ON r.id = o.rfq_id
     WHERE o.version = 1 AND r.user_id = ? AND o.created_at >= ? AND o.created_at < ?`,
    user, from, to,
  );
  const dispatches = await db().all<{ carrier_id: number; carrier: string; status: string; sent_at: string }>(
    `SELECT d.carrier_id, c.name AS carrier, d.status, d.sent_at
     FROM dispatches d JOIN rfqs r ON r.id = d.rfq_id JOIN carriers c ON c.id = d.carrier_id
     WHERE r.user_id = ? AND d.sent_at >= ? AND d.sent_at < ?`,
    user, from, to,
  );
  const awarded = await db().all<{ awarded_at: string; carrier_id: number; currency: string; price: number }>(
    `SELECT r.awarded_at, o.carrier_id, o.currency, o.price FROM rfqs r JOIN offers o ON o.id = r.awarded_offer_id
     WHERE r.user_id = ? AND r.awarded_at >= ? AND r.awarded_at < ?`,
    user, from, to,
  );
  return { rfqs, offers, dispatches, awarded };
}

/** RFQs, offers, sends and wins per month for the last `n` months, oldest first. */
export async function monthlyTrend(n = 12): Promise<MonthlyPoint[]> {
  const months = lastMonths(n);
  const a = await activityBetween(monthStart(months[0]), monthStart(addMonths(months[n - 1], 1)));
  const rfqs = countBy(a.rfqs.map((r) => r.created_at), months);
  const offers = countBy(a.offers.map((o) => o.created_at), months);
  const sent = countBy(a.dispatches.map((d) => d.sent_at), months);
  const offered = countBy(a.dispatches.filter((d) => d.status === "offered").map((d) => d.sent_at), months);
  const awarded = countBy(a.awarded.map((w) => w.awarded_at), months);
  return months.map((month) => ({
    month,
    rfqs: rfqs.get(month)!,
    offers: offers.get(month)!,
    sent: sent.get(month)!,
    offered: offered.get(month)!,
    awarded: awarded.get(month)!,
    responseRate: rate(offered.get(month)!, sent.get(month)!),
  }));
}

/** One month's report for the panel: totals, its RFQs and how each carrier did. */
export async function monthlyReport(month: string): Promise<MonthlyReportData> {
  if (!isMonth(month)) throw new Error("Ay YYYY-MM şəklində olmalıdır.");
  const a = await activityBetween(monthStart(month), monthStart(addMonths(month, 1)));

  const awardedValue = new Map<string, number>();
  for (const w of a.awarded) awardedValue.set(w.currency, (awardedValue.get(w.currency) ?? 0) + Number(w.price));
  const offered = a.dispatches.filter((d) => d.status === "offered").length;

  const carriers = new Map<number, MonthlyReportData["carriers"][number]>();
  const carrier = (id: number, name: string) => {
    let c = carriers.get(id);
    if (!c) carriers.set(id, (c = { carrier_id: id, name, sent: 0, offered: 0, responseRate: null, won: 0 }));
    return c;
  };
  for (const d of a.dispatches) {
    const c = carrier(Number(d.carrier_id), d.carrier);
    c.sent++;
    if (d.status === "offered") c.offered++;
  }
  for (const w of a.awarded) {
    const c = carriers.get(Number(w.carrier_id));
    if (c) c.won++;
  }
  for (const c of carriers.values()) c.responseRate = rate(c.offered, c.sent);

  const rfqs = (await listRfqs())
    .filter((r) => monthOf(r.created_at) === month)
    .map(({ offers, ...r }) => {
      const winner = offers.find((o) => o.winner);
      return {
        id: r.id,
        origin: r.origin,
        destination: r.destination,
        cargo_type: r.cargo_type,
        weight_kg: r.weight_kg,
        created_at: r.created_at,
        status: r.status,
        statusLabel: r.statusLabel,
        carriersSent: r.carriersSent,
        carriersResponded: r.carriersResponded,
        offers: offers.length,
        bestPrice: r.bestPrice,
        winner: winner ? { carrier: winner.carrier, price: winner.price, currency: winner.currency } : null,
      };
    })
    .reverse();

  return {
    month,
    rfqsCreated: a.rfqs.length,
    offersReceived: a.offers.length,
    sent: a.dispatches.length,
    offered,
    responseRate: rate(offered, a.dispatches.length),
    awarded: a.awarded.length,
    awardedValue: [...awardedValue].sort(([x], [y]) => x.localeCompare(y)).map(([currency, total]) => ({ currency, total })),
    rfqs,
    carriers: [...carriers.values()].sort((x, y) => y.won - x.won || y.offered - x.offered || y.sent - x.sent || x.name.localeCompare(y.name)),
  };
}

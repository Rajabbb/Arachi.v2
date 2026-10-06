import type { RfqDetailData, RfqListItem, RfqOfferSummary } from "../../shared/protocol";
import { db, now } from "../db";
import { currentUserId } from "../auth/current";
import { statusLabels, type DispatchStatus } from "./dispatches";
import { filesOf } from "./files";
import { publicUrl } from "../links";
import { isLatestVersion, type Offer } from "./offers";
import { getRfq, type Rfq, type RfqStatus } from "./rfqs";

/** Per-RFQ views for the panel: the RFQ list and one RFQ's detail page. */

export const rfqStatusLabels: Record<RfqStatus, string> = {
  open: "Təklif toplanır",
  awarded: "Qalib seçilib",
  closed: "Bağlanıb",
};

/** The RFQ's own page in the panel. */
export function rfqPageUrl(id: number): string {
  return publicUrl(`/panel/rfq/${id}`);
}

type LatestOffer = Offer & { carrier_name: string };

/**
 * The offers "cheapest" is decided among: those in the RFQ currency, or all
 * of them when they share one other currency. Different currencies are never
 * compared without an exchange rate.
 */
function priceComparable(rfq: Pick<Rfq, "currency">, offers: Pick<Offer, "currency">[]) {
  const inRfqCurrency = offers.filter((o) => o.currency === rfq.currency);
  if (inRfqCurrency.length) return inRfqCurrency;
  return new Set(offers.map((o) => o.currency)).size === 1 ? offers : [];
}

function bestPrice(rfq: Pick<Rfq, "currency">, offers: Pick<Offer, "currency" | "price">[]): RfqListItem["bestPrice"] {
  const candidates = priceComparable(rfq, offers) as Pick<Offer, "currency" | "price">[];
  if (!candidates.length) return null;
  const best = candidates.reduce((a, b) => (b.price < a.price ? b : a));
  return { price: best.price, currency: best.currency };
}

/** Carriers with at least one offer. */
function respondedCarriers(offers: Pick<Offer, "carrier_id">[]): number {
  return new Set(offers.map((o) => Number(o.carrier_id))).size;
}

/** Each latest offer with how it compares: cheapest, fastest, expired, the winner. */
function summarize(rfq: Rfq, latest: LatestOffer[]): RfqOfferSummary[] {
  const today = now().slice(0, 10);
  const perCarrier = new Map<number, number>();
  for (const o of latest) perCarrier.set(Number(o.carrier_id), (perCarrier.get(Number(o.carrier_id)) ?? 0) + 1);
  const comparable = new Set(priceComparable(rfq, latest) as LatestOffer[]);
  const minPrice = Math.min(...[...comparable].map((o) => o.price));
  const minTransit = Math.min(...latest.map((o) => o.transit_days));
  return latest.map((o) => ({
    id: o.id,
    carrier_id: o.carrier_id,
    carrier: o.carrier_name,
    offer_no: o.offer_no,
    carrier_offers: perCarrier.get(Number(o.carrier_id)) ?? 1,
    version: o.version,
    price: o.price,
    currency: o.currency,
    transit_days: o.transit_days,
    valid_until: o.valid_until,
    created_at: o.created_at,
    expired: Boolean(o.valid_until && o.valid_until < today),
    cheapest: comparable.has(o) && o.price === minPrice,
    fastest: o.transit_days === minTransit,
    winner: rfq.awarded_offer_id !== null && Number(rfq.awarded_offer_id) === Number(o.id),
  }));
}

/** The latest version of every offer, for all of the user's RFQs (or one). */
function latestOffersOf(rfqId?: number): Promise<LatestOffer[]> {
  return db().all<LatestOffer>(
    `SELECT o.*, c.name AS carrier_name FROM offers o JOIN carriers c ON c.id = o.carrier_id
       JOIN rfqs r ON r.id = o.rfq_id
     WHERE r.user_id = ? ${rfqId === undefined ? "" : "AND o.rfq_id = ?"} AND ${isLatestVersion}
     ORDER BY o.price, o.id`,
    currentUserId(), ...(rfqId === undefined ? [] : [rfqId]),
  );
}

function listItem(rfq: Rfq, sent: number, offers: LatestOffer[]): RfqListItem {
  return {
    id: rfq.id,
    origin: rfq.origin,
    destination: rfq.destination,
    cargo_type: rfq.cargo_type,
    weight_kg: rfq.weight_kg,
    transport_type: rfq.transport_type,
    currency: rfq.currency,
    offer_deadline: rfq.offer_deadline,
    created_at: rfq.created_at,
    status: rfq.status,
    statusLabel: rfqStatusLabels[rfq.status] ?? rfq.status,
    carriersSent: Number(sent),
    carriersResponded: respondedCarriers(offers),
    bestPrice: bestPrice(rfq, offers),
    offers: summarize(rfq, offers),
  };
}

/** Every RFQ of the signed-in user, newest first, with its counts and best price. */
export async function listRfqs(): Promise<RfqListItem[]> {
  const user = currentUserId();
  const rfqs = await db().all<Rfq>("SELECT * FROM rfqs WHERE user_id = ? ORDER BY id DESC", user);
  const sent = await db().all<{ rfq_id: number; n: number }>(
    `SELECT d.rfq_id, count(*) AS n FROM dispatches d JOIN rfqs r ON r.id = d.rfq_id
     WHERE r.user_id = ? GROUP BY d.rfq_id`,
    user,
  );
  const sentBy = new Map(sent.map((s) => [Number(s.rfq_id), s.n]));
  const offersBy = new Map<number, LatestOffer[]>();
  for (const o of await latestOffersOf()) {
    const list = offersBy.get(Number(o.rfq_id)) ?? [];
    list.push(o);
    offersBy.set(Number(o.rfq_id), list);
  }
  return rfqs.map((r) => {
    const offers = offersBy.get(Number(r.id)) ?? [];
    return listItem(r, sentBy.get(Number(r.id)) ?? 0, offers);
  });
}

function withoutOffers({ offers: _, ...item }: RfqListItem) {
  return item;
}

/** Everything about one RFQ of the signed-in user; another user's RFQ is "not found". */
export async function rfqDetail(id: number): Promise<RfqDetailData> {
  const rfq = await getRfq(id);
  const user = currentUserId();

  const carriers = await db().all<RfqDetailData["carriers"][number] & { status: DispatchStatus }>(
    `SELECT d.carrier_id, c.name, c.email, d.channel, d.status, d.error, d.sent_at, d.viewed_at,
            d.reminder_count, d.last_reminder_at
     FROM dispatches d JOIN carriers c ON c.id = d.carrier_id JOIN rfqs r ON r.id = d.rfq_id
     WHERE d.rfq_id = ? AND r.user_id = ? ORDER BY d.id`,
    id, user,
  );

  const latest = await latestOffersOf(id);
  const all = await db().all<Offer>(
    `SELECT o.* FROM offers o JOIN rfqs r ON r.id = o.rfq_id
     WHERE o.rfq_id = ? AND r.user_id = ? ORDER BY o.version DESC`,
    id, user,
  );
  const byId = new Map(latest.map((o) => [o.id, o]));
  const offers = await Promise.all(
    summarize(rfq, latest).map(async (o) => ({
      ...o,
      notes: byId.get(o.id)!.notes,
      source: byId.get(o.id)!.source,
      documents: (await filesOf("offer", o.id)).map((f) => ({ name: f.name, url: f.url })),
      previous: all
        .filter((p) => p.carrier_id === o.carrier_id && p.offer_no === o.offer_no && p.version < o.version)
        .map((p) => ({
          id: p.id,
          version: p.version,
          price: p.price,
          currency: p.currency,
          transit_days: p.transit_days,
          notes: p.notes,
          created_at: p.created_at,
        })),
    })),
  );

  return {
    rfq: {
      ...withoutOffers(listItem(rfq, carriers.length, latest)),
      volume_m3: rfq.volume_m3,
      pallets: rfq.pallets,
      loading_date: rfq.loading_date,
      delivery_date: rfq.delivery_date,
      notes: rfq.notes,
      source: rfq.source,
      awarded_at: rfq.awarded_at,
    },
    carriers: carriers.map((c) => ({ ...c, statusLabel: statusLabels[c.status] ?? c.status })),
    offers,
    mixedCurrencies: new Set(latest.map((o) => o.currency)).size > 1,
  };
}

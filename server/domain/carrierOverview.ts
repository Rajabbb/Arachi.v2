import type { CarrierDetailData, CarrierListItem } from "../../shared/protocol";
import { db } from "../db";
import { currentUserId } from "../auth/current";
import type { Carrier } from "./carriers";
import { latestOffersOf, rfqDetail } from "./rfqOverview";

/** Per-carrier views for the panel: the carrier base and one carrier's page. */

interface DispatchRow {
  carrier_id: number;
  rfq_id: number;
  status: string;
  sent_at: string;
  viewed_at: string | null;
}

type Activity = Awaited<ReturnType<typeof activityOf>>;

/** Sends, offers and wins of the user's carriers (or one), read once and grouped in code. */
async function activityOf(carrierId?: number) {
  const user = currentUserId();
  const one = carrierId === undefined ? "" : "AND d.carrier_id = ?";
  const dispatches = await db().all<DispatchRow>(
    `SELECT d.carrier_id, d.rfq_id, d.status, d.sent_at, d.viewed_at
     FROM dispatches d JOIN rfqs r ON r.id = d.rfq_id WHERE r.user_id = ? ${one}`,
    user, ...(carrierId === undefined ? [] : [carrierId]),
  );
  const offers = (await latestOffersOf()).filter((o) => carrierId === undefined || Number(o.carrier_id) === carrierId);
  const wins = await db().all<{ carrier_id: number; rfq_id: number }>(
    `SELECT o.carrier_id, r.id AS rfq_id FROM rfqs r JOIN offers o ON o.id = r.awarded_offer_id
     WHERE r.user_id = ? ${carrierId === undefined ? "" : "AND o.carrier_id = ?"}`,
    user, ...(carrierId === undefined ? [] : [carrierId]),
  );
  return { dispatches, offers, wins };
}

const latest = (dates: (string | null | undefined)[]) =>
  dates.reduce<string | null>((a, b) => (b && (!a || b > a) ? b : a), null);

function stats(carrier: Carrier, activity: Activity): CarrierListItem {
  const id = Number(carrier.id);
  const dispatches = activity.dispatches.filter((d) => Number(d.carrier_id) === id);
  const offers = activity.offers.filter((o) => Number(o.carrier_id) === id);
  const sentTo = new Set(dispatches.map((d) => Number(d.rfq_id)));
  const answered = new Set(offers.map((o) => Number(o.rfq_id)));
  // Same reading as the dashboard's response rate: of the RFQs that reached it, those it answered.
  const answeredSent = [...sentTo].filter((r) => answered.has(r)).length;
  const newest = offers.reduce<(typeof offers)[number] | null>(
    (a, b) => (!a || b.created_at > a.created_at || (b.created_at === a.created_at && b.id > a.id) ? b : a),
    null,
  );
  return {
    id,
    name: carrier.name,
    email: carrier.email,
    category: carrier.category,
    subcategory: carrier.subcategory,
    active: Boolean(Number(carrier.active)),
    rfqsSent: sentTo.size,
    rfqsAnswered: answered.size,
    responseRate: sentTo.size ? Math.round((answeredSent / sentTo.size) * 1000) / 10 : null,
    rfqsWon: new Set(activity.wins.filter((w) => Number(w.carrier_id) === id).map((w) => Number(w.rfq_id))).size,
    failedDeliveries: dispatches.filter((d) => d.status === "failed").length,
    lastOffer: newest && {
      rfq_id: Number(newest.rfq_id),
      price: newest.price,
      currency: newest.currency,
      transit_days: newest.transit_days,
      created_at: newest.created_at,
    },
    lastActivity: latest([...dispatches.flatMap((d) => [d.sent_at, d.viewed_at]), ...offers.map((o) => o.created_at)]),
  };
}

/** Every carrier of the signed-in user (active first, then by name), with its numbers. */
export async function listCarriers(): Promise<CarrierListItem[]> {
  const carriers = await db().all<Carrier>(
    "SELECT * FROM carriers WHERE user_id = ? ORDER BY active DESC, name, id",
    currentUserId(),
  );
  const activity = await activityOf();
  return carriers.map((c) => stats(c, activity));
}

/** The user's carrier without throwing; another user's carrier is undefined. */
export function findCarrier(id: number): Promise<Carrier | undefined> {
  return db().get<Carrier>("SELECT * FROM carriers WHERE id = ? AND user_id = ?", id, currentUserId());
}

/**
 * One carrier's page: its numbers and each RFQ it was sent or answered,
 * taken from that RFQ's own page so statuses and offer marks match it.
 */
export async function carrierDetail(id: number): Promise<CarrierDetailData> {
  const carrier = await findCarrier(id);
  if (!carrier) throw new Error(`Daşıyıcı #${id} tapılmadı.`);
  const activity = await activityOf(id);
  const rfqIds = [...new Set([...activity.dispatches, ...activity.offers].map((x) => Number(x.rfq_id)))].sort((a, b) => b - a);

  const rfqs = await Promise.all(
    rfqIds.map(async (rfqId) => {
      const detail = await rfqDetail(rfqId);
      return {
        rfq: detail.rfq,
        dispatch: detail.carriers.find((c) => Number(c.carrier_id) === id) ?? null,
        offers: detail.offers.filter((o) => Number(o.carrier_id) === id),
      };
    }),
  );

  return {
    carrier: {
      ...stats(carrier, activity),
      phone: carrier.phone,
      whatsapp: carrier.whatsapp,
      telegram: carrier.telegram,
      language: carrier.language,
      created_at: carrier.created_at,
    },
    rfqs,
  };
}

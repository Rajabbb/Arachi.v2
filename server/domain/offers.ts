import { db, now, transaction } from "../db";
import { currentUserId } from "../auth/current";
import type { UploadedFile } from "../../shared/protocol";
import { markOffered } from "./dispatches";
import { filesOf, storeFile } from "./files";
import { checkDate, currencies, getRfq } from "./rfqs";

export interface Offer {
  id: number;
  rfq_id: number;
  carrier_id: number;
  dispatch_id: number | null;
  /** The carrier's Nth separate offer for this RFQ (1, 2, ...). */
  offer_no: number;
  /** The version of that offer (v1, v2, ...); the latest one counts. */
  version: number;
  price: number;
  currency: string;
  transit_days: number;
  valid_until: string;
  notes: string;
  source: "link" | "manual";
  created_at: string;
}

export interface OfferInput {
  rfqId: number;
  carrierId: number;
  dispatchId: number | null;
  price: number;
  currency: string;
  transitDays: number;
  validUntil: string;
  notes: string;
  source: Offer["source"];
  files: UploadedFile[];
  /** Adds a new version to this offer of the carrier; omitted or 0 = a new, separate offer. */
  offerNo?: number;
}

/**
 * Records a carrier's offer. A carrier may send several separate offers for
 * an RFQ (offer 1, 2, ...) and update any of them: an update is kept as a new
 * version (v1, v2, ...) of that offer, and its latest version counts.
 */
export async function submitOffer(
  input: OfferInput,
): Promise<Offer & { documents: Awaited<ReturnType<typeof filesOf>> }> {
  const rfq = await getRfq(input.rfqId);
  if (rfq.status !== "open") throw new Error(`RFQ #${rfq.id} üzrə təkliflər artıq qəbul edilmir.`);
  if (!(input.price > 0)) throw new Error("Qiymət müsbət olmalıdır.");
  if (!Number.isInteger(input.transitDays) || input.transitDays <= 0) {
    throw new Error("Tranzit müddəti (gün) müsbət tam ədəd olmalıdır.");
  }
  if (!(currencies as readonly string[]).includes(input.currency)) {
    throw new Error(`Valyuta ${currencies.join(" və ya ")} olmalıdır.`);
  }
  checkDate("Təklifin etibarlılıq tarixi", input.validUntil);

  const id = await transaction(async () => {
    let offerNo: number;
    let v: number;
    if (input.offerNo) {
      const { n } = (await db().get<{ n: number }>(
        "SELECT max(version) AS n FROM offers WHERE rfq_id = ? AND carrier_id = ? AND offer_no = ?",
        input.rfqId, input.carrierId, input.offerNo,
      ))!;
      if (!n) throw new Error(`Yenilənəcək təklif №${input.offerNo} tapılmadı.`);
      offerNo = input.offerNo;
      v = Number(n) + 1;
    } else {
      const { n } = (await db().get<{ n: number }>(
        "SELECT coalesce(max(offer_no), 0) + 1 AS n FROM offers WHERE rfq_id = ? AND carrier_id = ?",
        input.rfqId, input.carrierId,
      ))!;
      offerNo = Number(n);
      v = 1;
    }
    const inserted = await db().get<{ id: number }>(
      `INSERT INTO offers (rfq_id, carrier_id, dispatch_id, offer_no, version, price, currency, transit_days,
         valid_until, notes, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      input.rfqId, input.carrierId, input.dispatchId, offerNo, v, input.price, input.currency,
      input.transitDays, input.validUntil, input.notes.trim(), input.source, now(),
    );
    const offerId = inserted!.id;
    for (const f of input.files) {
      await storeFile("offer", offerId, f.name, f.type, Buffer.from(f.data, "base64"));
    }
    if (input.dispatchId) await markOffered(input.dispatchId);
    return offerId;
  });
  return { ...(await getOffer(id)), documents: await filesOf("offer", id) };
}

export async function getOffer(id: number): Promise<Offer> {
  const offer = await db().get<Offer>(
    "SELECT o.* FROM offers o JOIN rfqs r ON r.id = o.rfq_id WHERE o.id = ? AND r.user_id = ?",
    id, currentUserId(),
  );
  if (!offer) throw new Error(`Təklif #${id} tapılmadı.`);
  return offer;
}

/** SQL condition: offer row `o` is the latest version of its offer. */
export const isLatestVersion = `o.version = (SELECT max(version) FROM offers x
  WHERE x.rfq_id = o.rfq_id AND x.carrier_id = o.carrier_id AND x.offer_no = o.offer_no)`;

/** The latest version of every offer for an RFQ (a carrier may have several offers), cheapest first. */
export function latestOffers(rfqId: number): Promise<(Offer & { carrier_name: string })[]> {
  return db().all<Offer & { carrier_name: string }>(
    `SELECT o.*, c.name AS carrier_name FROM offers o JOIN carriers c ON c.id = o.carrier_id
       JOIN rfqs r ON r.id = o.rfq_id
     WHERE o.rfq_id = ? AND r.user_id = ? AND ${isLatestVersion}
     ORDER BY o.price, o.id`,
    rfqId, currentUserId(),
  );
}

/** Every version of a carrier's offers for an RFQ, by offer then version (oldest first). */
export function offerVersions(rfqId: number, carrierId: number): Promise<Offer[]> {
  return db().all<Offer>(
    `SELECT o.* FROM offers o JOIN rfqs r ON r.id = o.rfq_id
     WHERE o.rfq_id = ? AND o.carrier_id = ? AND r.user_id = ? ORDER BY o.offer_no, o.version`,
    rfqId, carrierId, currentUserId(),
  );
}

/** Groups offer rows (sorted by offer_no, version) into offers, each with its versions oldest first. */
export function groupByOffer<T extends Pick<Offer, "offer_no">>(rows: T[]): { offer_no: number; versions: T[] }[] {
  const groups = new Map<number, T[]>();
  for (const r of rows) {
    const list = groups.get(Number(r.offer_no)) ?? [];
    list.push(r);
    groups.set(Number(r.offer_no), list);
  }
  return [...groups].map(([offer_no, versions]) => ({ offer_no, versions }));
}

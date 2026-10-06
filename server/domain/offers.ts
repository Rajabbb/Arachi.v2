import { db, now, transaction } from "../db";
import type { UploadedFile } from "../../shared/protocol";
import { markOffered } from "./dispatches";
import { filesOf, storeFile } from "./files";
import { checkDate, currencies, getRfq } from "./rfqs";

export interface Offer {
  id: number;
  rfq_id: number;
  carrier_id: number;
  dispatch_id: number | null;
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
}

/**
 * Records a carrier's offer. A carrier may revise its offer: every submission
 * is kept as a new version (v1, v2, ...) and the latest one counts.
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
    const { v } = (await db().get<{ v: number }>(
      "SELECT coalesce(max(version), 0) + 1 AS v FROM offers WHERE rfq_id = ? AND carrier_id = ?",
      input.rfqId, input.carrierId,
    ))!;
    const inserted = await db().get<{ id: number }>(
      `INSERT INTO offers (rfq_id, carrier_id, dispatch_id, version, price, currency, transit_days,
         valid_until, notes, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      input.rfqId, input.carrierId, input.dispatchId, v, input.price, input.currency,
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
  const offer = await db().get<Offer>("SELECT * FROM offers WHERE id = ?", id);
  if (!offer) throw new Error(`Təklif #${id} tapılmadı.`);
  return offer;
}

/** The latest version of every carrier's offer for an RFQ. */
export function latestOffers(rfqId: number): Promise<(Offer & { carrier_name: string })[]> {
  return db().all<Offer & { carrier_name: string }>(
    `SELECT o.*, c.name AS carrier_name FROM offers o JOIN carriers c ON c.id = o.carrier_id
     WHERE o.rfq_id = ? AND o.version = (
       SELECT max(version) FROM offers WHERE rfq_id = o.rfq_id AND carrier_id = o.carrier_id)
     ORDER BY o.price, o.id`,
    rfqId,
  );
}

export function offerVersions(rfqId: number, carrierId: number): Promise<Offer[]> {
  return db().all<Offer>("SELECT * FROM offers WHERE rfq_id = ? AND carrier_id = ? ORDER BY version", rfqId, carrierId);
}

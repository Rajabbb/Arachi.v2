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
export function submitOffer(input: OfferInput): Offer & { documents: ReturnType<typeof filesOf> } {
  const rfq = getRfq(input.rfqId);
  if (rfq.status !== "open") throw new Error(`RFQ #${rfq.id} üzrə təkliflər artıq qəbul edilmir.`);
  if (!(input.price > 0)) throw new Error("Qiymət müsbət olmalıdır.");
  if (!Number.isInteger(input.transitDays) || input.transitDays <= 0) {
    throw new Error("Tranzit müddəti (gün) müsbət tam ədəd olmalıdır.");
  }
  if (!(currencies as readonly string[]).includes(input.currency)) {
    throw new Error(`Valyuta ${currencies.join(" və ya ")} olmalıdır.`);
  }
  checkDate("Təklifin etibarlılıq tarixi", input.validUntil);

  const id = transaction(() => {
    const { v } = db()
      .prepare("SELECT coalesce(max(version), 0) + 1 AS v FROM offers WHERE rfq_id = ? AND carrier_id = ?")
      .get(input.rfqId, input.carrierId) as { v: number };
    const { lastInsertRowid } = db()
      .prepare(
        `INSERT INTO offers (rfq_id, carrier_id, dispatch_id, version, price, currency, transit_days,
           valid_until, notes, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.rfqId, input.carrierId, input.dispatchId, v, input.price, input.currency,
        input.transitDays, input.validUntil, input.notes.trim(), input.source, now(),
      );
    const offerId = Number(lastInsertRowid);
    for (const f of input.files) {
      storeFile("offer", offerId, f.name, f.type, Buffer.from(f.data, "base64"));
    }
    if (input.dispatchId) markOffered(input.dispatchId);
    return offerId;
  });
  return { ...getOffer(id), documents: filesOf("offer", id) };
}

export function getOffer(id: number): Offer {
  const offer = db().prepare("SELECT * FROM offers WHERE id = ?").get(id) as Offer | undefined;
  if (!offer) throw new Error(`Təklif #${id} tapılmadı.`);
  return offer;
}

/** The latest version of every carrier's offer for an RFQ. */
export function latestOffers(rfqId: number): (Offer & { carrier_name: string })[] {
  return db()
    .prepare(
      `SELECT o.*, c.name AS carrier_name FROM offers o JOIN carriers c ON c.id = o.carrier_id
       WHERE o.rfq_id = ? AND o.version = (
         SELECT max(version) FROM offers WHERE rfq_id = o.rfq_id AND carrier_id = o.carrier_id)
       ORDER BY o.price`,
    )
    .all(rfqId) as unknown as (Offer & { carrier_name: string })[];
}

export function offerVersions(rfqId: number, carrierId: number): Offer[] {
  return db()
    .prepare("SELECT * FROM offers WHERE rfq_id = ? AND carrier_id = ? ORDER BY version")
    .all(rfqId, carrierId) as unknown as Offer[];
}

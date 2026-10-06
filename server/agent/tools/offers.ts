import type { AgentTool } from "./registry";
import { db } from "../../db";
import { currentUserId } from "../../auth/current";
import { getCarrier } from "../../domain/carriers";
import { findDispatchFor, statusLabels, type DispatchStatus } from "../../domain/dispatches";
import { filesOf } from "../../domain/files";
import { latestOffers, submitOffer } from "../../domain/offers";
import { getRfq, rfqTitle } from "../../domain/rfqs";

/** Process 6: incoming offers and delivery statuses per carrier. */
export const listOffers: AgentTool = {
  name: "list_offers",
  description:
    "Shows an RFQ's incoming offers and, for every carrier it was sent to, the delivery status: Göndərildi (sent), Çatdırıldı (delivered), Baxıldı (viewed), Təklif alındı (offer received), Çatdırılmadı (not delivered).",
  params: {
    rfq_id: { type: "integer", description: "RFQ number." },
    status: {
      type: "string",
      description: "Only carriers with this status; all = everyone.",
      enum: ["all", "sent", "delivered", "viewed", "offered", "failed"],
      default: "all",
    },
  },
  async run(p) {
    const rfq = await getRfq(p.rfq_id as number);
    const latest = await latestOffers(rfq.id);
    const offersOf = (carrierId: number) => latest.filter((o) => o.carrier_id === carrierId);
    const offerView = async (offer: (typeof latest)[number]) => ({
      offer_id: offer.id,
      offer_no: offer.offer_no,
      version: offer.version,
      price: offer.price,
      currency: offer.currency,
      transit_days: offer.transit_days,
      valid_until: offer.valid_until,
      notes: offer.notes,
      documents: await filesOf("offer", offer.id),
    });
    const rows = await db().all<{
      carrier_id: number;
      carrier_name: string;
      channel: string;
      status: DispatchStatus;
      error: string | null;
      sent_at: string;
      viewed_at: string | null;
      reminder_count: number;
    }>(
      `SELECT d.*, c.name AS carrier_name FROM dispatches d JOIN carriers c ON c.id = d.carrier_id
       WHERE d.rfq_id = ? AND c.user_id = ? ORDER BY c.name, c.id`,
      rfq.id, currentUserId(),
    );

    const carriers = await Promise.all(rows
      .filter((r) => p.status === "all" || r.status === p.status)
      .map(async (r) => {
        return {
          carrier_id: r.carrier_id,
          carrier: r.carrier_name,
          channel: r.channel,
          status: statusLabels[r.status],
          error: r.error ?? undefined,
          sent_at: r.sent_at,
          viewed_at: r.viewed_at ?? undefined,
          reminders: r.reminder_count,
          // Latest version of each separate offer the carrier sent.
          offers: await Promise.all(offersOf(r.carrier_id).map(offerView)),
        };
      }));

    // Offers entered by hand for carriers the RFQ was never sent to.
    const sentTo = new Set(rows.map((r) => r.carrier_id));
    const manual =
      p.status === "all" || p.status === "offered"
        ? latest.filter((o) => !sentTo.has(o.carrier_id))
        : [];

    const counts = Object.fromEntries(
      (Object.keys(statusLabels) as DispatchStatus[]).map((s) => [statusLabels[s], rows.filter((r) => r.status === s).length]),
    );
    return { rfq: rfqTitle(rfq), rfq_status: rfq.status, counts, offers_received: latest.length,
      carriers_responded: new Set(latest.map((o) => o.carrier_id)).size, carriers, manual_offers: manual };
  },
};

export const recordOffer: AgentTool = {
  name: "record_offer",
  description:
    "Records an offer a carrier sent outside the quote page (e.g. by email or phone) that the user pastes or attaches. A carrier may have several separate offers for one RFQ; to record a changed price or terms of one of them, pass its offer_no (from list_offers) and it becomes a new version of that offer.",
  params: {
    rfq_id: { type: "integer", description: "RFQ number." },
    carrier_id: { type: "integer", description: "Carrier id." },
    price: { type: "number", description: "Total price." },
    transit_days: { type: "integer", description: "Transit time in days." },
    currency: { type: "string", description: "Offer currency; empty means the RFQ's currency.", enum: ["", "USD", "EUR"], default: "" },
    valid_until: { type: "string", description: "Offer valid until, YYYY-MM-DD; empty = not stated.", default: "" },
    notes: { type: "string", description: "Terms and notes from the carrier.", default: "" },
    offer_no: {
      type: "integer",
      description: "Update this earlier offer of the carrier (adds a new version); 0 = record a new, separate offer.",
      default: 0,
    },
    attach_files: { type: "boolean", description: "Store the files attached to this message as the offer's documents.", default: false },
  },
  async run(p, ctx) {
    const rfq = await getRfq(p.rfq_id as number);
    const carrier = await getCarrier(p.carrier_id as number);
    const offer = await submitOffer({
      rfqId: rfq.id,
      carrierId: carrier.id,
      dispatchId: (await findDispatchFor(rfq.id, carrier.id))?.id ?? null,
      price: p.price as number,
      currency: (p.currency as string) || rfq.currency,
      transitDays: p.transit_days as number,
      validUntil: p.valid_until as string,
      notes: p.notes as string,
      source: "manual",
      files: p.attach_files ? ctx.files : [],
      offerNo: p.offer_no as number,
    });
    return { carrier: carrier.name, ...offer };
  },
};

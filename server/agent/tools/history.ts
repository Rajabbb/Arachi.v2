import type { AgentTool } from "./registry";
import { db } from "../../db";
import { getCarrier } from "../../domain/carriers";
import { filesOf } from "../../domain/files";
import { offerVersions } from "../../domain/offers";
import { getRfq, rfqTitle } from "../../domain/rfqs";

/** Process 9: offer version history (v1, v2, ...) per carrier. */
export const offerHistory: AgentTool = {
  name: "offer_history",
  description:
    "Shows every version of the carriers' offers for an RFQ (v1, v2, ...) with what changed between versions (price and transit time).",
  params: {
    rfq_id: { type: "integer", description: "RFQ number." },
    carrier_id: { type: "integer", description: "Only this carrier; 0 = all carriers that offered.", default: 0 },
  },
  async run(p) {
    const rfq = getRfq(p.rfq_id as number);
    const carrierIds = p.carrier_id
      ? [getCarrier(p.carrier_id as number).id]
      : (db().prepare("SELECT DISTINCT carrier_id FROM offers WHERE rfq_id = ? ORDER BY carrier_id").all(rfq.id) as { carrier_id: number }[]).map(
          (r) => r.carrier_id,
        );

    const carriers = carrierIds.map((id) => {
      const versions = offerVersions(rfq.id, id);
      return {
        carrier_id: id,
        carrier: getCarrier(id).name,
        versions: versions.map((o, i) => {
          const prev = versions[i - 1];
          const sameCurrency = prev && prev.currency === o.currency;
          return {
            version: `v${o.version}`,
            offer_id: o.id,
            price: o.price,
            currency: o.currency,
            transit_days: o.transit_days,
            valid_until: o.valid_until,
            notes: o.notes,
            source: o.source,
            created_at: o.created_at,
            documents: filesOf("offer", o.id),
            change: prev && {
              price: sameCurrency ? Math.round((o.price - prev.price) * 100) / 100 : undefined,
              price_percent: sameCurrency ? Math.round(((o.price - prev.price) / prev.price) * 1000) / 10 : undefined,
              currency_changed: !sameCurrency || undefined,
              transit_days: o.transit_days - prev.transit_days,
            },
          };
        }),
      };
    });
    return { rfq: rfqTitle(rfq), carriers };
  },
};

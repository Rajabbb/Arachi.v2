/**
 * How an offer is named in the panel: "v2" when the carrier sent one offer,
 * "№2 · v1" when it sent several separate offers for the RFQ.
 */
export function offerTag(o: { offer_no: number; carrier_offers: number; version: number }): string {
  return o.carrier_offers > 1 ? `№${o.offer_no} · v${o.version}` : `v${o.version}`;
}

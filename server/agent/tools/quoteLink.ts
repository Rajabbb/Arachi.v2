import type { AgentTool } from "./registry";
import { getCarrier } from "../../domain/carriers";
import { findDispatchFor, quoteLink, saveDispatch, statusLabels } from "../../domain/dispatches";
import { getRfq } from "../../domain/rfqs";

/**
 * Process 5: the carrier's quote page. Carriers open their personal link
 * (no login, AZ/EN, mobile) and enter price, transit time, notes and
 * documents; the page itself lives in the UI at /quote/:token. This tool
 * gives the user that link, e.g. to forward it to a carrier by hand.
 */
export const getQuoteLink: AgentTool = {
  name: "get_quote_link",
  description:
    "Returns a carrier's personal quote page link for an RFQ (no login needed; the carrier enters price, transit time, notes and documents there). If the RFQ was not sent to that carrier yet, the link is created without sending anything, so the user can forward it themselves.",
  params: {
    rfq_id: { type: "integer", description: "RFQ number." },
    carrier_id: { type: "integer", description: "Carrier id." },
  },
  async run(p) {
    const rfq = await getRfq(p.rfq_id as number);
    const carrier = await getCarrier(p.carrier_id as number);
    const dispatch =
      (await findDispatchFor(rfq.id, carrier.id)) ?? (await saveDispatch(rfq.id, carrier.id, "link", "sent", null));
    return {
      rfq_id: rfq.id,
      carrier: carrier.name,
      link: await quoteLink(dispatch.id),
      status: statusLabels[dispatch.status],
    };
  },
};

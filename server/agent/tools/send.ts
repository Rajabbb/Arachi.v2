import type { AgentTool } from "./registry";
import { carrierCategories, findCarriers } from "../../domain/carriers";
import {
  addressFor,
  findDispatchFor,
  quoteLink,
  rfqMessage,
  saveDispatch,
  shareLink,
  statusLabels,
} from "../../domain/dispatches";
import { getRfq } from "../../domain/rfqs";
import { channels, deliver, type Channel } from "../../notify";
import { db } from "../../db";

/** Process 3: send an RFQ to carriers, each with a personal signed link. */
export const sendRfqToCarriers: AgentTool = {
  name: "send_rfq_to_carriers",
  description:
    "Sends an RFQ to carriers from the carrier base. Each carrier gets a personal link to the quote page where they enter their offer without logging in. Carriers that already received this RFQ are skipped unless resend is true.",
  params: {
    rfq_id: { type: "integer", description: "RFQ number." },
    audience: {
      type: "string",
      description:
        "Who receives it: matching = carriers whose category matches the RFQ's transport type; all = every carrier; category = the category/subcategory given; specific = the carrier_ids given.",
      enum: ["matching", "all", "category", "specific"],
      default: "matching",
    },
    category: { type: "string", description: "Category for audience=category.", enum: ["", ...carrierCategories], default: "" },
    subcategory: { type: "string", description: "Optional subcategory filter, e.g. Türkiyə xətti.", default: "" },
    carrier_ids: { type: "array", description: "Carrier ids for audience=specific.", items: { type: "integer" }, default: [] },
    channels: {
      type: "array",
      description: "Channels in order of preference; each carrier gets the first one it has a contact for.",
      items: { type: "string", enum: channels },
      default: ["email"],
    },
    resend: { type: "boolean", description: "Send again to carriers that already got this RFQ.", default: false },
  },
  async run(p) {
    const rfq = getRfq(p.rfq_id as number);
    if (rfq.status !== "open") throw new Error(`RFQ #${rfq.id} artıq açıq deyil (${rfq.status}).`);

    const audience = p.audience as string;
    const subcategory = (p.subcategory as string) || undefined;
    const carriers =
      audience === "specific"
        ? findCarriers({ ids: p.carrier_ids as number[] })
        : audience === "category"
          ? findCarriers({ category: (p.category as string) || undefined, subcategory })
          : audience === "matching"
            ? findCarriers({ category: rfq.transport_type, subcategory })
            : findCarriers({ subcategory });
    if (carriers.length === 0) {
      throw new Error("Seçimə uyğun aktiv daşıyıcı tapılmadı. Əvvəlcə daşıyıcı bazasına daşıyıcı əlavə edin.");
    }

    const preferred = p.channels as Channel[];
    if (preferred.length === 0) throw new Error("Ən azı bir kanal seçilməlidir.");
    const results = [];
    for (const carrier of carriers) {
      if (!p.resend && findDispatchFor(rfq.id, carrier.id)) {
        results.push({ carrier_id: carrier.id, name: carrier.name, skipped: "artıq göndərilib" });
        continue;
      }
      const channel = preferred.find((c) => addressFor(carrier, c)) ?? preferred[0];
      const to = addressFor(carrier, channel);
      // Create the dispatch first: the link is signed with its id.
      const pending = saveDispatch(rfq.id, carrier.id, channel, "sent", null);
      const link = quoteLink(pending.id);
      const message = rfqMessage(rfq, carrier, link);
      const delivery = await deliver({ channel, to, ...message });
      const dispatch = saveDispatch(
        rfq.id,
        carrier.id,
        channel,
        delivery.delivered ? "delivered" : "failed",
        delivery.error ?? null,
      );
      results.push({
        carrier_id: carrier.id,
        name: carrier.name,
        channel,
        to,
        status: statusLabels[dispatch.status],
        error: dispatch.error ?? undefined,
        link,
        share_link: shareLink(channel, to, message.body, link),
      });
    }
    const sent = results.filter((r) => !("skipped" in r));
    return {
      rfq_id: rfq.id,
      sent: sent.length,
      failed: sent.filter((r) => "error" in r && r.error).length,
      skipped: results.length - sent.length,
      note: "Mesajlar hələ real göndərilmir: hər biri serverin jurnalına və outbox cədvəlinə yazılır.",
      results,
    };
  },
};

export const listOutbox: AgentTool = {
  name: "list_outbox",
  description: "Shows the latest outgoing messages (emails, WhatsApp, Telegram) recorded by the system.",
  params: { limit: { type: "integer", description: "How many messages.", default: 20 } },
  async run({ limit }) {
    return db().prepare("SELECT * FROM outbox ORDER BY id DESC LIMIT ?").all(limit as number);
  },
};

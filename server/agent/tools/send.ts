import type { AgentTool } from "./registry";
import { findCarriers } from "../../domain/carriers";
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
import { channels, deliver, logOnlyNote, type Channel } from "../../notify";
import { db } from "../../db";
import { refreshEmailStatuses } from "../../notify/emailStatus";
import { currentUserId } from "../../auth/current";

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
        "Who receives it: matching = carriers whose category matches the RFQ's transport type, plus carriers in the user's own categories (A, VIP, ...); all = every carrier; category = the category/subcategory given (e.g. \"A kateqoriyasına göndər\"); specific = the carrier_ids given.",
      enum: ["matching", "all", "category", "specific"],
      default: "matching",
    },
    category: { type: "string", description: "Category for audience=category: a transport category or the user's own (A, B, VIP, ...).", default: "" },
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
    const rfq = await getRfq(p.rfq_id as number);
    if (rfq.status !== "open") throw new Error(`RFQ #${rfq.id} artıq açıq deyil (${rfq.status}).`);

    const audience = p.audience as string;
    const subcategory = (p.subcategory as string) || undefined;
    const carriers = await (
      audience === "specific"
        ? findCarriers({ ids: p.carrier_ids as number[] })
        : audience === "category"
          ? findCarriers({ category: (p.category as string) || undefined, subcategory })
          : audience === "matching"
            ? findCarriers({ category: rfq.transport_type, subcategory, withOwnCategories: true })
            : findCarriers({ subcategory }));
    if (carriers.length === 0) {
      throw new Error("Seçimə uyğun aktiv daşıyıcı tapılmadı. Əvvəlcə daşıyıcı bazasına daşıyıcı əlavə edin.");
    }

    const preferred = p.channels as Channel[];
    if (preferred.length === 0) throw new Error("Ən azı bir kanal seçilməlidir.");
    const results = [];
    for (const carrier of carriers) {
      if (!p.resend && (await findDispatchFor(rfq.id, carrier.id))) {
        results.push({ carrier_id: carrier.id, name: carrier.name, skipped: "artıq göndərilib" });
        continue;
      }
      const channel = preferred.find((c) => addressFor(carrier, c)) ?? preferred[0];
      const to = addressFor(carrier, channel);
      // Create the dispatch first: the link is signed with its id.
      const pending = await saveDispatch(rfq.id, carrier.id, channel, "sent", null);
      const link = await quoteLink(pending.id);
      const message = rfqMessage(rfq, carrier, link);
      const delivery = await deliver({ channel, to, ...message, dispatchId: pending.id });
      // With a provider id (Resend) the email is only accepted so far: it becomes
      // "delivered" or "failed" when Resend reports the outcome (notify/emailStatus.ts).
      const dispatch = await saveDispatch(
        rfq.id,
        carrier.id,
        channel,
        !delivery.delivered ? "failed" : delivery.providerId ? "sent" : "delivered",
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
      note: logOnlyNote(sent.map((r) => r.channel as Channel)),
      results,
    };
  },
};

export const listOutbox: AgentTool = {
  name: "list_outbox",
  description:
    "Shows the latest outgoing messages (emails, WhatsApp, Telegram) recorded by the system. For emails, provider_status is the real delivery status from Resend (sent, delivered, opened, bounced, complained, suppressed, ...) and error says why one was not delivered.",
  params: { limit: { type: "integer", description: "How many messages.", default: 20 } },
  async run({ limit }) {
    await refreshEmailStatuses({ userId: currentUserId(), limit: 5 }).catch(() => 0);
    return db().all("SELECT * FROM outbox WHERE user_id = ? ORDER BY id DESC LIMIT ?", currentUserId(), limit as number);
  },
};

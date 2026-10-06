import type { AgentTool } from "./registry";
import { db, now } from "../../db";
import { currentUserId } from "../../auth/current";
import { getCarrier } from "../../domain/carriers";
import { addressFor, quoteLink, rfqMessage, statusLabels, type Dispatch } from "../../domain/dispatches";
import { getRfq } from "../../domain/rfqs";
import { deliver, logOnlyNote } from "../../notify";

/** Process 8: remind carriers that have not sent an offer yet. */
export const sendReminders: AgentTool = {
  name: "send_reminders",
  description:
    "Sends a reminder with the same personal link to carriers that received an RFQ but have not sent an offer yet. Respects a minimum gap since the last message and a maximum number of reminders.",
  params: {
    rfq_id: { type: "integer", description: "RFQ number; 0 = every open RFQ.", default: 0 },
    min_hours: { type: "number", description: "Only remind if at least this many hours passed since the RFQ or the last reminder.", default: 24 },
    max_reminders: { type: "integer", description: "Never send a carrier more reminders than this per RFQ.", default: 3 },
    include_viewed: { type: "boolean", description: "Also remind carriers that opened the link but did not offer.", default: true },
    dry_run: { type: "boolean", description: "Only list who would be reminded, send nothing.", default: false },
  },
  async run(p) {
    const statuses = p.include_viewed ? ["sent", "delivered", "viewed"] : ["sent", "delivered"];
    const cutoff = new Date(Date.now() - (p.min_hours as number) * 3600_000).toISOString();
    const rfqFilter = p.rfq_id ? "AND d.rfq_id = ?" : "";
    if (p.rfq_id) await getRfq(p.rfq_id as number);

    const due = await db().all<Dispatch>(
      `SELECT d.* FROM dispatches d JOIN rfqs r ON r.id = d.rfq_id
       WHERE r.user_id = ? AND r.status = 'open' AND d.channel != 'link'
         AND d.status IN (${statuses.map(() => "?").join(",")})
         AND d.reminder_count < ?
         AND coalesce(d.last_reminder_at, d.sent_at) <= ? ${rfqFilter}
       ORDER BY d.rfq_id, d.id`,
      currentUserId(), ...statuses, p.max_reminders as number, cutoff, ...(p.rfq_id ? [p.rfq_id as number] : []),
    );

    const results = [];
    for (const d of due) {
      const rfq = await getRfq(d.rfq_id);
      const carrier = await getCarrier(d.carrier_id);
      const channel = d.channel as Exclude<Dispatch["channel"], "link">;
      const row = { rfq_id: rfq.id, carrier: carrier.name, channel, status: statusLabels[d.status], reminder: d.reminder_count + 1 };
      if (p.dry_run) {
        results.push(row);
        continue;
      }
      const message = rfqMessage(rfq, carrier, await quoteLink(d.id), true);
      const delivery = await deliver({ channel, to: addressFor(carrier, channel), ...message, dispatchId: d.id });
      await db().run(
        "UPDATE dispatches SET reminder_count = reminder_count + 1, last_reminder_at = ? WHERE id = ?",
        now(), d.id,
      );
      results.push({ ...row, delivered: delivery.delivered, error: delivery.error });
    }
    return {
      dry_run: p.dry_run,
      reminded: p.dry_run ? 0 : results.length,
      would_remind: p.dry_run ? results.length : undefined,
      note: p.dry_run ? undefined : logOnlyNote(results.map((r) => r.channel)),
      results,
    };
  },
};

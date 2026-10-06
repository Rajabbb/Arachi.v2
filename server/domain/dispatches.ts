import { db, now } from "../db";
import { currentUserId } from "../auth/current";
import { publicUrl, signToken, verifyToken } from "../links";
import type { Carrier } from "./carriers";
import type { Channel } from "../notify";
import type { Rfq } from "./rfqs";

/** Delivery status of an RFQ sent to one carrier. */
export type DispatchStatus = "sent" | "delivered" | "viewed" | "offered" | "failed";

export const statusLabels: Record<DispatchStatus, string> = {
  sent: "Göndərildi",
  delivered: "Çatdırıldı",
  viewed: "Baxıldı",
  offered: "Təklif alındı",
  failed: "Çatdırılmadı",
};

export interface Dispatch {
  id: number;
  rfq_id: number;
  carrier_id: number;
  /** "link" when the user shares the link by hand. */
  channel: Channel | "link";
  status: DispatchStatus;
  error: string | null;
  sent_at: string;
  viewed_at: string | null;
  reminder_count: number;
  last_reminder_at: string | null;
}

const TOKEN_KIND = "dispatch";

export async function quoteLink(dispatchId: number): Promise<string> {
  return publicUrl(`/quote/${await signToken(TOKEN_KIND, dispatchId)}`);
}

/**
 * The dispatch a carrier's link names, with the user who owns its RFQ. The
 * link is the carrier's only credential, so this lookup is not limited to
 * a signed-in user; the quote page then acts as the owner.
 */
export async function dispatchFromToken(token: string): Promise<(Dispatch & { user_id: number | null }) | undefined> {
  const id = await verifyToken(TOKEN_KIND, token);
  if (id === null) return undefined;
  return db().get<Dispatch & { user_id: number | null }>(
    "SELECT d.*, r.user_id FROM dispatches d JOIN rfqs r ON r.id = d.rfq_id WHERE d.id = ?",
    id,
  );
}

export function findDispatch(id: number): Promise<Dispatch | undefined> {
  return db().get<Dispatch>(
    "SELECT d.* FROM dispatches d JOIN rfqs r ON r.id = d.rfq_id WHERE d.id = ? AND r.user_id = ?",
    id, currentUserId(),
  );
}

export function findDispatchFor(rfqId: number, carrierId: number): Promise<Dispatch | undefined> {
  return db().get<Dispatch>(
    `SELECT d.* FROM dispatches d JOIN rfqs r ON r.id = d.rfq_id
     WHERE d.rfq_id = ? AND d.carrier_id = ? AND r.user_id = ?`,
    rfqId, carrierId, currentUserId(),
  );
}

/** Creates the dispatch, or resets an existing one when the RFQ is sent again. */
export async function saveDispatch(
  rfqId: number,
  carrierId: number,
  channel: Dispatch["channel"],
  status: DispatchStatus,
  error: string | null,
): Promise<Dispatch> {
  return (await db().get<Dispatch>(
    `INSERT INTO dispatches (rfq_id, carrier_id, channel, status, error, sent_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (rfq_id, carrier_id) DO UPDATE SET
       channel = excluded.channel, error = excluded.error, sent_at = excluded.sent_at,
       status = CASE WHEN dispatches.status IN ('viewed', 'offered') THEN dispatches.status ELSE excluded.status END
     RETURNING *`,
    rfqId, carrierId, channel, status, error, now(),
  ))!;
}

/** Status only moves forward: a viewed link stays viewed, an offer stays offered. */
export async function markViewed(dispatch: Dispatch) {
  await db().run(
    `UPDATE dispatches SET viewed_at = coalesce(viewed_at, ?),
       status = CASE WHEN status = 'offered' THEN status ELSE 'viewed' END
     WHERE id = ?`,
    now(), dispatch.id,
  );
}

export async function markOffered(dispatchId: number) {
  await db().run("UPDATE dispatches SET status = 'offered' WHERE id = ?", dispatchId);
}

/** Address of the carrier on a channel, or "" if it has none. */
export function addressFor(carrier: Carrier, channel: Channel): string {
  if (channel === "email") return carrier.email ?? "";
  if (channel === "whatsapp") return carrier.whatsapp || carrier.phone;
  return carrier.telegram;
}

/** The RFQ message in the carrier's language. */
export function rfqMessage(rfq: Rfq, carrier: Carrier, link: string, reminder = false) {
  const en = carrier.language === "en";
  const dates = [rfq.loading_date, rfq.delivery_date].filter(Boolean).join(" → ");
  const lines = en
    ? [
        `Hello ${carrier.name},`,
        reminder
          ? `Reminder: we are still waiting for your offer for RFQ #${rfq.id}.`
          : `We would like your price offer for RFQ #${rfq.id}.`,
        `Route: ${rfq.origin} → ${rfq.destination}`,
        `Cargo: ${rfq.cargo_type}, ${rfq.weight_kg} kg${rfq.volume_m3 ? `, ${rfq.volume_m3} m³` : ""}${rfq.pallets ? `, ${rfq.pallets} pallets` : ""}`,
        `Transport: ${rfq.transport_type}${dates ? `, dates: ${dates}` : ""}`,
        `Please quote in ${rfq.currency} by ${rfq.offer_deadline}.`,
        `Send your offer here (no login needed): ${link}`,
      ]
    : [
        `Salam, ${carrier.name}!`,
        reminder
          ? `Xatırlatma: RFQ #${rfq.id} üzrə təklifinizi hələ gözləyirik.`
          : `RFQ #${rfq.id} üzrə qiymət təklifinizi gözləyirik.`,
        `Marşrut: ${rfq.origin} → ${rfq.destination}`,
        `Yük: ${rfq.cargo_type}, ${rfq.weight_kg} kq${rfq.volume_m3 ? `, ${rfq.volume_m3} m³` : ""}${rfq.pallets ? `, ${rfq.pallets} palet` : ""}`,
        `Nəqliyyat: ${rfq.transport_type}${dates ? `, tarixlər: ${dates}` : ""}`,
        `Təklifi ${rfq.offer_deadline} tarixinədək ${rfq.currency} ilə göndərin.`,
        `Təklif göndərmək üçün link (giriş tələb olunmur): ${link}`,
      ];
  const subject = en
    ? `${reminder ? "Reminder: " : ""}RFQ #${rfq.id} ${rfq.origin} → ${rfq.destination}`
    : `${reminder ? "Xatırlatma: " : ""}RFQ #${rfq.id} ${rfq.origin} → ${rfq.destination}`;
  return { subject, body: lines.join("\n") };
}

/** Click-to-send links the user can open on their phone for messenger channels. */
export function shareLink(channel: Channel, address: string, body: string, link: string): string | undefined {
  if (channel === "whatsapp") {
    const digits = address.replace(/\D/g, "");
    return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(body)}` : undefined;
  }
  if (channel === "telegram") {
    return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(body)}`;
  }
  return undefined;
}

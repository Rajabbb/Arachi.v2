import type { AgentTool } from "./registry";
import { db, now } from "../../db";
import { currentUserId } from "../../auth/current";
import { getCarrier } from "../../domain/carriers";
import { addressFor, findDispatchFor } from "../../domain/dispatches";
import { getOffer, latestOffers, type Offer } from "../../domain/offers";
import { getRfq, rfqTitle, type Rfq } from "../../domain/rfqs";
import { deliver, logOnlyNote, type Channel } from "../../notify";

/** Process 7: compare offers and pick the winner. */

type Criterion = "price" | "transit" | "balanced";

const criterionParam = {
  type: "string",
  description:
    "How to rank: price = cheapest first; transit = fastest first; balanced = weighted score of price and transit time.",
  enum: ["price", "transit", "balanced"],
  default: "price",
} as const;

const rankingParams = {
  criterion: criterionParam,
  price_weight: {
    type: "number",
    description: "For balanced: weight of price between 0 and 1 (the rest is transit time).",
    default: 0.7,
  },
  eur_usd_rate: {
    type: "number",
    description: "USD per 1 EUR, used to compare offers in different currencies; 0 = do not convert.",
    default: 0,
  },
} as const;

export interface RankedOffer extends Offer {
  carrier_name: string;
  price_in_rfq_currency: number | null;
  expired: boolean;
  score: number;
  rank: number;
}

function convert(offer: Offer, rfq: Rfq, rate: number): number | null {
  if (offer.currency === rfq.currency) return offer.price;
  if (!(rate > 0)) return null;
  return offer.currency === "EUR" ? offer.price * rate : offer.price / rate;
}

/**
 * Ranks the latest offer of every carrier. Lower score is better. Offers
 * that cannot be priced in the RFQ currency (no rate given) and expired
 * offers go last.
 */
export async function rankOffers(rfq: Rfq, criterion: Criterion, priceWeight: number, rate: number): Promise<RankedOffer[]> {
  if (priceWeight < 0 || priceWeight > 1) throw new Error("price_weight 0 ilə 1 arasında olmalıdır.");
  const today = now().slice(0, 10);
  const latest = await latestOffers(rfq.id);
  // Offers all in one currency compare directly, even if it is not the RFQ's.
  const singleCurrency = new Set(latest.map((o) => o.currency)).size === 1;
  const offers = latest.map((o) => {
    const converted = convert(o, rfq, rate);
    return {
      ...o,
      price_in_rfq_currency: converted,
      comparable: singleCurrency ? o.price : converted,
      expired: Boolean(o.valid_until && o.valid_until < today),
    };
  });
  const priced = offers.filter((o) => o.comparable !== null);
  const minPrice = Math.min(...priced.map((o) => o.comparable!));
  const minTransit = Math.min(...offers.map((o) => o.transit_days));

  const scored = offers.map(({ comparable, ...o }) => {
    const priceRatio = comparable === null ? Infinity : comparable / minPrice;
    const transitRatio = o.transit_days / minTransit;
    const score =
      criterion === "price"
        ? priceRatio
        : criterion === "transit"
          ? transitRatio + (priceRatio === Infinity ? 1e6 : priceRatio / 1e6)
          : priceWeight * priceRatio + (1 - priceWeight) * transitRatio;
    return { ...o, score: Number.isFinite(score) ? Math.round(score * 1000) / 1000 : 1e9, rank: 0 };
  });
  scored.sort((a, b) => Number(a.expired) - Number(b.expired) || a.score - b.score || a.transit_days - b.transit_days);
  scored.forEach((o, i) => (o.rank = i + 1));
  return scored;
}

export const compareOffers: AgentTool = {
  name: "compare_offers",
  description:
    "Compares the latest version of every offer for an RFQ side by side (price, transit time, validity, terms) and ranks them; a carrier may have several separate offers. Use it before picking a winner.",
  params: { rfq_id: { type: "integer", description: "RFQ number." }, ...rankingParams },
  async run(p) {
    const rfq = await getRfq(p.rfq_id as number);
    const ranked = await rankOffers(rfq, p.criterion as Criterion, p.price_weight as number, p.eur_usd_rate as number);
    const currencies = new Set(ranked.map((o) => o.currency));
    return {
      rfq: rfqTitle(rfq),
      rfq_currency: rfq.currency,
      criterion: p.criterion,
      mixed_currencies_without_rate: currencies.size > 1 && !((p.eur_usd_rate as number) > 0),
      offers: ranked.map((o) => ({
        rank: o.rank,
        offer_id: o.id,
        carrier_id: o.carrier_id,
        carrier: o.carrier_name,
        offer_no: o.offer_no,
        version: o.version,
        price: o.price,
        currency: o.currency,
        price_in_rfq_currency: o.price_in_rfq_currency === null ? undefined : Math.round(o.price_in_rfq_currency * 100) / 100,
        transit_days: o.transit_days,
        valid_until: o.valid_until,
        expired: o.expired,
        notes: o.notes,
        score: o.score,
      })),
      winner_offer_id: rfq.awarded_offer_id ?? undefined,
    };
  },
};

/** The offer select_winner picks: the one given, else the best-ranked valid one. */
async function pickWinner(rfq: Rfq, p: Record<string, unknown>): Promise<Offer> {
  if (p.offer_id) {
    const winner = await getOffer(p.offer_id as number);
    if (winner.rfq_id !== rfq.id) throw new Error(`Təklif #${winner.id} RFQ #${rfq.id}-ə aid deyil.`);
    return winner;
  }
  const ranked = await rankOffers(rfq, p.criterion as Criterion, p.price_weight as number, p.eur_usd_rate as number);
  const best = ranked.find((o) => !o.expired && o.score < 1e9);
  if (!best) throw new Error(`RFQ #${rfq.id} üzrə seçilə bilən etibarlı təklif yoxdur.`);
  return best;
}

export const selectWinner: AgentTool = {
  name: "select_winner",
  description:
    "Picks the winning offer for an RFQ, closes it for new offers and (by default) informs the winning carrier. Without offer_id the best-ranked valid offer wins.",
  params: {
    rfq_id: { type: "integer", description: "RFQ number." },
    offer_id: { type: "integer", description: "Winning offer id; 0 = best-ranked by the criterion.", default: 0 },
    ...rankingParams,
    notify_winner: { type: "boolean", description: "Send the winning carrier a confirmation.", default: true },
    notify_others: { type: "boolean", description: "Tell the other carriers that offered that they did not win.", default: false },
  },
  async confirm(p) {
    if (!p.notify_winner && !p.notify_others) return null;
    const rfq = await getRfq(p.rfq_id as number);
    if (rfq.status !== "open") return null;
    const winner = await pickWinner(rfq, p);
    const carrier = await getCarrier(winner.carrier_id);
    const others = new Set((await latestOffers(rfq.id)).map((o) => o.carrier_id).filter((id) => id !== winner.carrier_id));
    const lines = [
      `RFQ #${rfq.id} (${rfq.origin} → ${rfq.destination}) üçün qalib: ${carrier.name}, ${winner.price} ${winner.currency}, ${winner.transit_days} gün. RFQ yeni təkliflər üçün bağlanacaq.`,
      ...(p.notify_winner ? [`• ${carrier.name}: ${carrier.email || "ünvan yoxdur"} (təklifiniz qəbul edildi)`] : []),
      ...(p.notify_others && others.size > 0 ? [`• digər ${others.size} daşıyıcıya "bu dəfə başqa təklif seçildi" məktubu`] : []),
    ];
    return { summary: lines.join("\n"), params: { ...p, offer_id: winner.id } };
  },
  done(result) {
    const r = result as { winner: { carrier: string; price: number; currency: string }; notified: unknown[]; note?: string };
    return [
      `Qalib seçildi: ${r.winner.carrier} (${r.winner.price} ${r.winner.currency}). ${r.notified.length} daşıyıcıya məktub göndərildi.`,
      r.note,
    ].filter(Boolean).join(" ");
  },
  async run(p) {
    const rfq = await getRfq(p.rfq_id as number);
    if (rfq.status !== "open") throw new Error(`RFQ #${rfq.id} üçün qalib artıq seçilib və ya sorğu bağlıdır.`);
    const winner = await pickWinner(rfq, p);

    // Only an open RFQ can be awarded, so two concurrent picks cannot both win.
    const { changes } = await db().run(
      "UPDATE rfqs SET status = 'awarded', awarded_offer_id = ?, awarded_at = ? WHERE id = ? AND user_id = ? AND status = 'open'",
      winner.id, now(), rfq.id, currentUserId(),
    );
    if (changes === 0) throw new Error(`RFQ #${rfq.id} üçün qalib artıq seçilib və ya sorğu bağlıdır.`);

    const notified: { carrier: string; channel: Channel; delivered: boolean }[] = [];
    const notify = async (offer: Offer, won: boolean) => {
      const carrier = await getCarrier(offer.carrier_id);
      const dispatch = await findDispatchFor(rfq.id, carrier.id);
      const channel: Channel = dispatch && dispatch.channel !== "link" ? dispatch.channel : "email";
      const en = carrier.language === "en";
      const subject = en ? `RFQ #${rfq.id}: ${won ? "your offer was accepted" : "result"}` : `RFQ #${rfq.id}: ${won ? "təklifiniz qəbul edildi" : "nəticə"}`;
      const body = won
        ? en
          ? `Hello ${carrier.name}, your offer (${offer.price} ${offer.currency}, ${offer.transit_days} days) for ${rfq.origin} → ${rfq.destination} was accepted. We will contact you with the details.`
          : `Salam, ${carrier.name}! ${rfq.origin} → ${rfq.destination} üzrə təklifiniz (${offer.price} ${offer.currency}, ${offer.transit_days} gün) qəbul edildi. Təfərrüatlar üçün sizinlə əlaqə saxlayacağıq.`
        : en
          ? `Hello ${carrier.name}, thank you for your offer for RFQ #${rfq.id}. This time another offer was chosen.`
          : `Salam, ${carrier.name}! RFQ #${rfq.id} üzrə təklifiniz üçün təşəkkür edirik. Bu dəfə başqa təklif seçildi.`;
      const r = await deliver({ channel, to: addressFor(carrier, channel), subject, body });
      notified.push({ carrier: carrier.name, channel, delivered: r.delivered });
    };

    if (p.notify_winner) await notify(winner, true);
    if (p.notify_others) {
      // One message per carrier, however many offers it sent.
      const told = new Set([winner.carrier_id]);
      for (const o of await latestOffers(rfq.id)) {
        if (told.has(o.carrier_id)) continue;
        told.add(o.carrier_id);
        await notify(o, false);
      }
    }
    return {
      rfq: rfqTitle(rfq),
      status: "awarded",
      winner: { offer_id: winner.id, carrier: (await getCarrier(winner.carrier_id)).name, price: winner.price, currency: winner.currency, transit_days: winner.transit_days, offer_no: winner.offer_no, version: winner.version },
      notified,
      note: logOnlyNote(notified.map((n) => n.channel)),
    };
  },
};

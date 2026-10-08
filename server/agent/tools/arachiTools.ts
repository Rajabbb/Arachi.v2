import type { AgentTool } from "./registry";
import * as api from "../../arachi/api";
import { config } from "../../config";

/**
 * The agent's tools. All data lives on arachi.co: every tool calls its API as the
 * signed-in customer, so the AI sees and changes exactly what the panel on arachi.co shows.
 */

const siteUrl = () => config.arachiSiteUrl.replace(/\/+$/, "");

/** A recipient list for a confirmation, the first 25 in full. */
export function recipientLines(lines: string[]): string {
  const shown = lines.slice(0, 25).map((l) => `• ${l}`);
  if (lines.length > shown.length) shown.push(`• və daha ${lines.length - shown.length}`);
  return shown.join("\n");
}

const isMine = (c: api.ArachiCarrier) => !(c.email ?? "").startsWith("public_link_");

async function rfqOrThrow(id: number): Promise<api.ArachiRfq> {
  const rfq = (await api.listRfqs()).find((r) => r.id === id);
  if (!rfq) throw new Error(`RFQ #${id} tapılmadı.`);
  return rfq;
}

export const createRfq: AgentTool = {
  name: "create_rfq",
  description:
    "Creates a new freight RFQ (request for quotation) on arachi.co and returns it with its number. It does not send it to carriers: use send_rfq_to_carriers for that. Use it when the user wants prices for moving cargo.",
  params: {
    origin: { type: "string", description: "Loading place (city, country or full address)." },
    destination: { type: "string", description: "Unloading place (city, country or full address)." },
    cargo_type: { type: "string", description: "What the cargo is, e.g. textile, furniture, food.", default: "" },
    weight_kg: { type: "number", description: "Gross weight in kilograms (convert tonnes to kg); 0 means not specified.", default: 0 },
    volume_m3: { type: "number", description: "Volume in cubic metres; 0 means not specified.", default: 0 },
    deadline: { type: "string", description: "Delivery deadline, YYYY-MM-DD; empty means flexible.", default: "" },
    truck_type: { type: "string", description: "Vehicle type, e.g. Tent, Reefer.", default: "" },
    hs_code: { type: "string", description: "HS code if known.", default: "" },
    shipment_type: { type: "string", description: "Shipment type, e.g. FTL, LTL.", default: "" },
    notes: { type: "string", description: "Extra requirements for carriers (pallets, ADR, temperature, loading date ...).", default: "" },
  },
  async run(p) {
    const rfq = await api.createRfq({
      origin: p.origin as string,
      destination: p.destination as string,
      cargo_type: p.cargo_type as string,
      weight_kg: p.weight_kg as number,
      volume_m3: p.volume_m3 as number,
      deadline: p.deadline as string,
      truck_type: p.truck_type as string,
      hs_code: p.hs_code as string,
      shipment_type: p.shipment_type as string,
      additional_notes: p.notes as string,
    });
    return { ...rfq, page_url: `${siteUrl()}/customer` };
  },
};

export const listRfqs: AgentTool = {
  name: "list_rfqs",
  description: "Lists the user's RFQs on arachi.co, newest first, with how many offers each has. Use it to find an RFQ number.",
  params: {
    status: { type: "string", description: "Filter: open, closed (winner chosen) or all.", enum: ["all", "open", "closed"], default: "all" },
    limit: { type: "integer", description: "Maximum number of RFQs to return.", default: 20 },
  },
  async run({ status, limit }) {
    const all = await api.listRfqs();
    return all.filter((r) => status === "all" || r.status === status).slice(0, limit as number);
  },
};

export const listCarriers: AgentTool = {
  name: "list_carriers",
  description: "Lists the carriers in the user's carrier base on arachi.co.",
  params: {
    search: { type: "string", description: "Only carriers whose name or email contains this text.", default: "" },
    limit: { type: "integer", description: "Maximum number of carriers to return.", default: 50 },
  },
  async run({ search, limit }) {
    const q = (search as string).toLowerCase();
    const all = (await api.listCarriers()).filter(isMine);
    const rows = all.filter((c) => !q || `${c.company_name} ${c.email}`.toLowerCase().includes(q));
    return { total: rows.length, carriers: rows.slice(0, limit as number).map((c) => ({ id: c.id, name: c.company_name, email: c.email })) };
  },
};

export const addCarriers: AgentTool = {
  name: "add_carriers",
  description: "Adds carriers (name and email) to the user's carrier base on arachi.co. Duplicate emails are skipped.",
  params: {
    carriers: {
      type: "array",
      description: "Carriers to add.",
      items: {
        type: "object",
        properties: { name: { type: "string" }, email: { type: "string" } },
        required: ["name", "email"],
      },
    },
  },
  async run(p) {
    const list = ((p.carriers as { name?: string; email?: string }[]) ?? []).filter((c) => c?.email);
    if (list.length === 0) throw new Error("Əlavə ediləcək daşıyıcının email ünvanı yoxdur.");
    return api.addCarriers(list.map((c) => ({ name: String(c.name ?? "").trim() || "Daşıyıcı", email: String(c.email).trim() })));
  },
};

/** The carriers a send would reach: those chosen (or all) that have not been sent this RFQ yet. */
async function dueCarriers(p: Record<string, unknown>) {
  const rfqId = p.rfq_id as number;
  const wanted = (p.carrier_ids as number[]) ?? [];
  const carriers = (await api.listCarriers()).filter(isMine);
  const chosen = p.audience === "specific" ? carriers.filter((c) => wanted.includes(c.id)) : carriers;
  const already = new Set((await api.recipients(rfqId)).map((r) => r.carrier_id));
  return chosen.filter((c) => !already.has(c.id) && c.email);
}

export const sendRfqToCarriers: AgentTool = {
  name: "send_rfq_to_carriers",
  description:
    "Emails an RFQ to carriers from the user's carrier base. Each carrier gets a personal link to the quote page where they enter their offer without logging in. Carriers that already received this RFQ are skipped.",
  params: {
    rfq_id: { type: "integer", description: "RFQ number." },
    audience: { type: "string", description: "all = every carrier in the base; specific = the carrier_ids given.", enum: ["all", "specific"], default: "all" },
    carrier_ids: { type: "array", description: "Carrier ids for audience=specific.", items: { type: "integer" }, default: [] },
  },
  async confirm(p) {
    const rfq = await rfqOrThrow(p.rfq_id as number);
    if (rfq.status !== "open") return null;
    const due = await dueCarriers(p);
    if (due.length === 0) return null;
    return {
      summary:
        `RFQ #${rfq.id} (${rfq.origin} → ${rfq.destination}) ${due.length} daşıyıcıya email ilə göndəriləcək:\n` +
        recipientLines(due.map((c) => `${c.company_name}: ${c.email}`)),
      // Exactly the carriers shown, even if the base changes before "Bəli".
      params: { rfq_id: rfq.id, audience: "specific", carrier_ids: due.map((c) => c.id) },
    };
  },
  done(result) {
    const r = result as { rfq_id: number; sent: number };
    return `RFQ #${r.rfq_id} ${r.sent} daşıyıcıya göndərildi.`;
  },
  async run(p) {
    const rfq = await rfqOrThrow(p.rfq_id as number);
    if (rfq.status !== "open") throw new Error(`RFQ #${rfq.id} artıq açıq deyil (${rfq.status}).`);
    const due = await dueCarriers(p);
    if (due.length === 0) throw new Error("Göndəriləcək yeni daşıyıcı yoxdur: ya baza boşdur, ya da hamısına artıq göndərilib.");
    const res = await api.sendRfq(rfq.id, { carrier_ids: due.map((c) => c.id) });
    return { rfq_id: rfq.id, sent: res.sent.length, carriers: res.sent.map((s) => s.company_name) };
  },
};

export const getQuoteLink: AgentTool = {
  name: "get_quote_link",
  description:
    "Creates a shareable public link for an RFQ: anyone who gets it (e.g. via WhatsApp) can enter an offer on the quote page without logging in. Nothing is sent by this tool.",
  params: { rfq_id: { type: "integer", description: "RFQ number." } },
  async run(p) {
    const rfq = await rfqOrThrow(p.rfq_id as number);
    return { rfq_id: rfq.id, link: await api.publicLink(rfq.id) };
  },
};

function offerView(o: api.ArachiOffer) {
  return {
    offer_id: o.id,
    carrier: o.carrier_company,
    price: o.price,
    currency: o.currency,
    transit_days: o.transit_time_days,
    is_winner: o.is_winner,
    details: o.extra_details,
    versions: Array.isArray(o.quote_history) ? o.quote_history.length : 0,
  };
}

export const listOffers: AgentTool = {
  name: "list_offers",
  description:
    "Shows an RFQ's received offers and, for every carrier it was sent to, the status: sent/delivered/not delivered (email), viewed, offer received.",
  params: { rfq_id: { type: "integer", description: "RFQ number." } },
  async run(p) {
    const id = p.rfq_id as number;
    const rfq = await rfqOrThrow(id);
    const [got, who] = await Promise.all([api.offers(id), api.recipients(id)]);
    return {
      rfq: { id: rfq.id, route: `${rfq.origin} → ${rfq.destination}`, status: rfq.status },
      offers: got.map(offerView),
      carriers: who.map((r) => ({
        quote_id: r.quote_id,
        carrier: r.company_name,
        email: r.is_public ? "(ictimai link)" : r.email,
        status: r.has_submitted
          ? "Təklif alındı"
          : r.is_viewed
            ? "Baxıldı"
            : r.mail_status === "failed"
              ? "Çatdırılmadı"
              : r.mail_status === "delivered"
                ? "Çatdırıldı"
                : "Göndərilir",
      })),
    };
  },
};

export const compareOffers: AgentTool = {
  name: "compare_offers",
  description: "Ranks an RFQ's offers. Offers in different currencies are ranked separately (no conversion).",
  params: {
    rfq_id: { type: "integer", description: "RFQ number." },
    criterion: { type: "string", description: "price = cheapest first; transit = fastest first.", enum: ["price", "transit"], default: "price" },
  },
  async run(p) {
    const priced = (await api.offers(p.rfq_id as number)).filter((o) => o.price !== null);
    if (priced.length === 0) return { message: "Hələ qiymətli təklif yoxdur." };
    const key = (o: api.ArachiOffer) => (p.criterion === "transit" ? (o.transit_time_days ?? Infinity) : (o.price as number));
    const byCurrency = new Map<string, api.ArachiOffer[]>();
    for (const o of priced) byCurrency.set(o.currency, [...(byCurrency.get(o.currency) ?? []), o]);
    return {
      criterion: p.criterion,
      rankings: [...byCurrency].map(([currency, list]) => ({
        currency,
        offers: list.sort((a, b) => key(a) - key(b)).map((o, i) => ({ rank: i + 1, ...offerView(o) })),
      })),
    };
  },
};

export const selectWinner: AgentTool = {
  name: "select_winner",
  description: "Marks one offer as the winner and closes the RFQ on arachi.co. Does not message the carrier. The user can undo it on arachi.co.",
  params: {
    rfq_id: { type: "integer", description: "RFQ number." },
    offer_id: { type: "integer", description: "offer_id from list_offers / compare_offers." },
  },
  async run(p) {
    const rfqId = p.rfq_id as number;
    const offer = (await api.offers(rfqId)).find((o) => o.id === p.offer_id);
    if (!offer) throw new Error(`Bu RFQ-da #${p.offer_id} təklifi tapılmadı.`);
    await api.selectWinner(rfqId, offer.id);
    return { rfq_id: rfqId, winner: offerView(offer) };
  },
};

async function waitingFor(rfqId: number) {
  await rfqOrThrow(rfqId); // the RFQ must be the user's own
  return (await api.recipients(rfqId)).filter((r) => !r.has_submitted && !r.is_public && r.email && r.mail_status !== "failed");
}

export const sendReminders: AgentTool = {
  name: "send_reminders",
  description: "Emails a reminder to the carriers of an RFQ who have not sent an offer yet.",
  params: {
    rfq_id: { type: "integer", description: "RFQ number." },
    quote_ids: { type: "array", description: "Set by the system when the user confirms; leave it out.", items: { type: "integer" }, default: [] },
  },
  async confirm(p) {
    const waiting = await waitingFor(p.rfq_id as number);
    if (waiting.length === 0) return null;
    return {
      summary:
        `RFQ #${p.rfq_id} üzrə cavab verməyən ${waiting.length} daşıyıcıya xatırlatma göndəriləcək:\n` +
        recipientLines(waiting.map((r) => `${r.company_name}: ${r.email}`)),
      params: { rfq_id: p.rfq_id, quote_ids: waiting.map((r) => r.quote_id) },
    };
  },
  done(result) {
    return `${(result as { reminded: number }).reminded} daşıyıcıya xatırlatma göndərildi.`;
  },
  async run(p) {
    // Only carriers of this RFQ that are still waiting, whatever ids were asked for.
    const chosen = (p.quote_ids as number[]) ?? [];
    const ids = (await waitingFor(p.rfq_id as number)).map((r) => r.quote_id).filter((id) => chosen.length === 0 || chosen.includes(id));
    if (ids.length === 0) throw new Error("Cavab verməyən daşıyıcı yoxdur.");
    await api.remind(ids);
    return { rfq_id: p.rfq_id, reminded: ids.length };
  },
};

export const getDashboard: AgentTool = {
  name: "get_dashboard",
  description: "Overall numbers from arachi.co: active RFQs, incoming offers, completed shipments, carriers.",
  params: {},
  async run() {
    return api.stats();
  },
};

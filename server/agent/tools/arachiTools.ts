import type { AgentTool } from "./registry";
import * as api from "../../arachi/api";
import { config } from "../../config";
import { categoryOrThrow, isMine, recipientLines, rfqOrThrow, subCategoryOrThrow } from "./lookup";

export { recipientLines };

/**
 * The agent's tools. All data lives on arachi.co: every tool calls its API as the
 * signed-in customer, so the AI sees and changes exactly what the panel on arachi.co shows.
 */

const siteUrl = () => config.arachiSiteUrl.replace(/\/+$/, "");

/** An RFQ as the agent sees it: by its panel number, without the database id. */
function rfqView(r: api.ArachiRfq | Omit<api.ArachiRfq, "display_id">) {
  return {
    origin: r.origin,
    destination: r.destination,
    cargo_type: r.cargo_type || undefined,
    weight_kg: r.weight_kg || undefined,
    volume_m3: r.volume_m3 || undefined,
    deadline: r.deadline || undefined,
    truck_type: r.truck_type || undefined,
    shipment_type: r.shipment_type || undefined,
    stackable: r.stackable === null || r.stackable === undefined ? undefined : r.stackable ? "Stackable" : "Non-stackable",
    details: Array.isArray(r.required_fields) && r.required_fields.length > 0 ? r.required_fields : undefined,
    notes: r.additional_notes || undefined,
    status: r.status,
    created_at: r.created_at,
  };
}

const TRANSPORT_MODES: Record<string, string> = {
  Quru: "Quru (Road)",
  Hava: "Hava (Air)",
  "Dəniz": "Su/Dəniz (Sea)",
  "Dəmiryolu": "Dəmiryolu (Rail)",
};

const INCOTERMS = ["", "EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"] as const;

/** A date the way the panel writes it into the RFQ: "2026-10-12" or "2026-10-12 10:30 AM". */
export function panelDate(label: string, value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(value.trim());
  if (!m || Number.isNaN(Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`))) {
    throw new Error(`${label} YYYY-MM-DD və ya YYYY-MM-DDTHH:MM formatında olmalıdır (məsələn 2026-10-12).`);
  }
  if (!m[4]) return `${m[1]}-${m[2]}-${m[3]}`;
  let h = Number(m[4]);
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${m[1]}-${m[2]}-${m[3]} ${String(h).padStart(2, "0")}:${m[5]} ${suffix}`;
}

/**
 * The panel's "ixtiyari parametrlər" and volume lines for an RFQ, exactly as the panel writes them.
 * Throws for a number or date that can't be used, so the user is never asked to confirm a broken RFQ.
 */
function rfqFieldLines(p: Record<string, unknown>): string[] {
  const unit = p.volume_unit as string;
  const amount = p.volume_amount as number;
  if (!(amount > 0)) throw new Error("Həcm / palet miqdarı 0-dan böyük olmalıdır.");
  if (!((p.weight_kg as number) > 0)) throw new Error("Çəki 0-dan böyük olmalıdır.");
  const fields: string[] = [];
  const loading = (p.loading_date as string).trim();
  const delivery = (p.delivery_deadline as string).trim();
  if (loading) fields.push(`Loading Date: ${panelDate("loading_date", loading)}`);
  if ((p.truck_type as string).trim()) fields.push(`Truck Type: ${(p.truck_type as string).trim()}`);
  if ((p.hs_code as string).trim()) fields.push(`HS Code: ${(p.hs_code as string).trim()}`);
  if (p.stackable) fields.push(`Stackable / Non-stackable: ${p.stackable}`);
  if (p.shipment_type) fields.push(`Shipment Type: ${p.shipment_type}`);
  if (p.incoterm) fields.push(`Incoterm: ${p.incoterm}`);
  if ((p.adr as string).trim()) fields.push(`Dangerous Goods (ADR): ${(p.adr as string).trim()}`);
  if ((p.temperature as string).trim()) fields.push(`Temperature Requirement: ${(p.temperature as string).trim()}`);
  if (delivery) fields.push(`Delivery Deadline: ${panelDate("delivery_deadline", delivery)}`);
  const notes = (p.notes as string).trim();
  if (notes) fields.push(`Additional Information: ${notes}`);
  fields.push(`Həcm / Palet: ${amount} ${unit}`);
  return fields;
}

/** "Don't create it" / "yaratma": the user asked to see the fields, not to create the RFQ. */
const NOT_NOW =
  /\b(yaratma|yaratmayın|yaratmayin|yaratmağa\s+ehtiyac\s+yoxdur|hələ\s+yaratma|yaratmaq\s+lazım\s+deyil|do\s+not\s+create|don'?t\s+create|not\s+yet\s+create|без\s+создания|не\s+создавай|не\s+надо\s+создавать)\b/i;

function refuseWhenNotWanted(userText: string) {
  if (NOT_NOW.test(userText)) {
    throw new Error(
      "İstifadəçi sorğunun hələ yaradılmamasını istəyib. Sorğunu yaratmayın: sahələri mətnlə yazın, çatışanları bildirin və yaratmağı soruşun.",
    );
  }
}

export const createRfq: AgentTool = {
  name: "create_rfq",
  description:
    "Prepares a new freight RFQ with exactly the fields of the panel's RFQ form. The user sees every field and presses \"Bəli\" before it is created on arachi.co; it never sends it to carriers (use send_rfq_to_carriers for that). Do not call it when the user only asked to see or extract the fields, or said not to create it. The mandatory fields are origin, destination, cargo_type, weight_kg, volume (amount + unit) and transport_mode; if the user did not give one of them, ask for it before calling. The optional fields are only set when the user mentioned them.",
  params: {
    origin: { type: "string", description: "Loading place (city, country or full address), e.g. \"Bakı, Azərbaycan\"." },
    destination: { type: "string", description: "Unloading place (city, country or full address), e.g. \"İstanbul, Türkiyə\"." },
    cargo_type: { type: "string", description: "What the cargo is, e.g. textile, furniture, food." },
    weight_kg: { type: "number", description: "Gross weight in kilograms (convert tonnes to kg)." },
    volume_amount: { type: "number", description: "The quantity: number of pallets, or volume in cubic metres, depending on volume_unit." },
    volume_unit: {
      type: "string",
      description: "What volume_amount counts: Palet (pallets) or CBM (cubic metres).",
      enum: ["Palet", "CBM"],
    },
    transport_mode: {
      type: "string",
      description: "Transport mode: Quru (road), Dəniz (sea), Hava (air), Dəmiryolu (rail).",
      enum: Object.keys(TRANSPORT_MODES),
    },
    loading_date: { type: "string", description: "Loading date, YYYY-MM-DD or YYYY-MM-DDTHH:MM; empty = not specified.", default: "" },
    delivery_deadline: { type: "string", description: "Delivery deadline, YYYY-MM-DD or YYYY-MM-DDTHH:MM; empty = not specified.", default: "" },
    truck_type: { type: "string", description: "Vehicle type, e.g. Tentli, Refrijerator.", default: "" },
    hs_code: { type: "string", description: "HS code, e.g. 1234.56.", default: "" },
    stackable: { type: "string", description: "Whether the cargo can be stacked; empty = not specified.", enum: ["", "Stackable", "Non-stackable"], default: "" },
    shipment_type: { type: "string", description: "Shipment type; empty = not specified.", enum: ["", "FTL", "LTL", "FCL", "LCL"], default: "" },
    incoterm: { type: "string", description: "Incoterm; empty = not specified.", enum: [...INCOTERMS], default: "" },
    adr: { type: "string", description: "Dangerous goods (ADR) details, e.g. \"Klass 3\"; empty = not dangerous / not specified.", default: "" },
    temperature: { type: "string", description: "Temperature requirement (reefer), e.g. \"+2 to +8 °C\"; empty = none.", default: "" },
    notes: { type: "string", description: "Additional information and special instructions for carriers.", default: "" },
  },
  async confirm(p, ctx) {
    refuseWhenNotWanted(ctx.text);
    rfqFieldLines(p); // validates numbers and dates before the user is asked
    const rows: [string, unknown][] = [
      ["Yükləmə yeri", p.origin],
      ["Boşaltma yeri", p.destination],
      ["Yükün növü", p.cargo_type],
      ["Çəki", `${p.weight_kg} kq`],
      ["Həcm / Palet", `${p.volume_amount} ${p.volume_unit}`],
      ["Daşınma növü", p.transport_mode],
      ["Yükləmə tarixi", p.loading_date ? panelDate("loading_date", String(p.loading_date)) : ""],
      ["Çatdırılma müddəti", p.delivery_deadline ? panelDate("delivery_deadline", String(p.delivery_deadline)) : ""],
      ["Maşın növü", p.truck_type],
      ["HS Code", p.hs_code],
      ["Stackable", p.stackable],
      ["Daşınma tipi", p.shipment_type],
      ["Incoterm", p.incoterm],
      ["Təhlükəli yük (ADR)", p.adr],
      ["Temperatur", p.temperature],
      ["Əlavə məlumat", p.notes],
    ];
    const lines = rows.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "").map(([k, v]) => `• ${k}: ${v}`);
    return {
      summary: `Yeni RFQ yaradılacaq (daşıyıcılara göndərilmir):\n${lines.join("\n")}`,
      params: p,
    };
  },
  done(result) {
    const r = result as { number?: number };
    return `RFQ #${r.number} yaradıldı. Hələ daşıyıcılara göndərilməyib.`;
  },
  async run(p) {
    const amount = p.volume_amount as number;
    const fields = rfqFieldLines(p);
    const loading = (p.loading_date as string).trim();
    const notes = (p.notes as string).trim();
    const rfq = await api.createRfq({
      origin: (p.origin as string).trim(),
      destination: (p.destination as string).trim(),
      cargo_type: (p.cargo_type as string).trim(),
      weight_kg: p.weight_kg as number,
      volume_m3: amount,
      deadline: loading,
      truck_type: (p.truck_type as string).trim(),
      hs_code: (p.hs_code as string).trim(),
      shipment_type: p.shipment_type as string,
      stackable: p.stackable as string,
      transportation_mode: TRANSPORT_MODES[p.transport_mode as string],
      required_fields: fields,
      additional_notes: notes,
    });
    const number = (await api.listRfqs()).find((r) => r.id === rfq.id)?.display_id;
    return { number, ...rfqView(rfq), page_url: `${siteUrl()}/customer` };
  },
};

export const listRfqs: AgentTool = {
  name: "list_rfqs",
  description:
    "Lists the user's RFQs on arachi.co, newest first, with the number the panel shows (number) and how many offers each has. Returns total = how many RFQs match. Use it to find an RFQ number, or to look RFQs up by place or cargo.",
  params: {
    status: { type: "string", description: "Filter: open, closed (winner chosen) or all.", enum: ["all", "open", "closed"], default: "all" },
    search: { type: "string", description: "Only RFQs whose origin, destination, cargo or notes contain this text.", default: "" },
    limit: { type: "integer", description: "Maximum number of RFQs to return (newest first).", default: 20 },
  },
  async run({ status, search, limit }) {
    const q = (search as string).trim().toLowerCase();
    const rows = (await api.listRfqs()).filter(
      (r) =>
        (status === "all" || r.status === status) &&
        (!q || [r.origin, r.destination, r.cargo_type, r.additional_notes].join(" ").toLowerCase().includes(q)),
    );
    return {
      total: rows.length,
      shown: Math.min(rows.length, limit as number),
      rfqs: rows.slice(0, limit as number).map((r) => ({ number: r.display_id, ...rfqView(r), offers_received: r.quotes_count ?? 0 })),
    };
  },
};

export const listCarriers: AgentTool = {
  name: "list_carriers",
  description: "Lists the carriers in the user's carrier base on arachi.co, with their category and subcategory. Use the ids it returns for the other carrier tools.",
  params: {
    search: { type: "string", description: "Only carriers whose name or email contains this text.", default: "" },
    category: { type: "string", description: "Only carriers of this category (by name); empty = any.", default: "" },
    limit: { type: "integer", description: "Maximum number of carriers to return.", default: 50 },
  },
  async run({ search, category, limit }) {
    const q = (search as string).toLowerCase();
    const [carriers, categories] = await Promise.all([api.listCarriers(), api.listCategories()]);
    const subNames = new Map<number, string>();
    for (const cat of categories) for (const sub of await api.listSubCategories(cat.id)) subNames.set(sub.id, sub.name);
    const catName = (id?: number | null) => categories.find((c) => c.id === id)?.name;
    const wanted = (category as string).trim().toLowerCase();
    const rows = carriers
      .filter(isMine)
      .filter((c) => !q || `${c.company_name} ${c.email}`.toLowerCase().includes(q))
      .filter((c) => !wanted || (catName(c.category_id) ?? "").toLowerCase() === wanted);
    return {
      total: rows.length,
      carriers: rows.slice(0, limit as number).map((c) => ({
        id: c.id,
        name: c.company_name,
        email: c.email,
        category: catName(c.category_id),
        subcategory: c.sub_category_id ? subNames.get(c.sub_category_id) : undefined,
      })),
    };
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
    const wanted = list.map((c) => ({ name: String(c.name ?? "").trim() || "Daşıyıcı", email: String(c.email).trim() }));
    const before = new Set((await api.listCarriers()).map((c) => c.id));
    const res = await api.addCarriers(wanted);
    const after = (await api.listCarriers()).filter(isMine);
    const added = after.filter((c) => !before.has(c.id));
    const addedEmails = new Set(added.map((c) => c.email.toLowerCase()));
    const skipped = wanted.filter((w) => !addedEmails.has(w.email.toLowerCase()));
    return {
      message: res.message,
      added: added.map((c) => ({ name: c.company_name, email: c.email })),
      skipped,
    };
  },
};

/** The carriers a send would reach: those chosen (or all) that have not been sent this RFQ yet. */
async function dueCarriers(rfq: api.ArachiRfq, p: Record<string, unknown>) {
  const wanted = (p.carrier_ids as number[]) ?? [];
  let carriers = (await api.listCarriers()).filter(isMine);
  if (p.audience === "category") {
    const category = await categoryOrThrow(p.category as string);
    carriers = carriers.filter((c) => c.category_id === category.id);
    if ((p.subcategory as string).trim()) {
      const sub = await subCategoryOrThrow(category, p.subcategory as string);
      carriers = carriers.filter((c) => c.sub_category_id === sub.id);
    }
  }
  const chosen = p.audience === "specific" ? carriers.filter((c) => wanted.includes(c.id)) : carriers;
  const already = new Set((await api.recipients(rfq.id)).map((r) => r.carrier_id));
  return chosen.filter((c) => !already.has(c.id) && c.email);
}

export const sendRfqToCarriers: AgentTool = {
  name: "send_rfq_to_carriers",
  description:
    "Emails an RFQ to carriers from the user's carrier base. Each carrier gets a personal link to the quote page where they enter their offer without logging in. Carriers that already received this RFQ are skipped.",
  params: {
    rfq_id: { type: "integer", description: "RFQ number as shown in the panel on arachi.co (RFQ #n)." },
    audience: {
      type: "string",
      description: "all = every carrier in the base; category = the carriers of the category (and subcategory) given; specific = the carrier_ids given.",
      enum: ["all", "category", "specific"],
      default: "all",
    },
    category: { type: "string", description: "Category name for audience=category.", default: "" },
    subcategory: { type: "string", description: "Optional subcategory name for audience=category.", default: "" },
    carrier_ids: { type: "array", description: "Carrier ids for audience=specific.", items: { type: "integer" }, default: [] },
  },
  async confirm(p) {
    const rfq = await rfqOrThrow(p.rfq_id as number);
    if (rfq.status !== "open") return null;
    const due = await dueCarriers(rfq, p);
    if (due.length === 0) return null;
    return {
      summary:
        `RFQ #${rfq.display_id} (${rfq.origin} → ${rfq.destination}) ${due.length} daşıyıcıya email ilə göndəriləcək:\n` +
        recipientLines(due.map((c) => `${c.company_name}: ${c.email}`)),
      // Exactly the carriers shown, even if the base changes before "Bəli".
      params: { rfq_id: rfq.display_id, audience: "specific", carrier_ids: due.map((c) => c.id), category: "", subcategory: "" },
    };
  },
  done(result) {
    const r = result as { rfq_id: number; sent: number };
    return `RFQ #${r.rfq_id} ${r.sent} daşıyıcıya göndərildi.`;
  },
  async run(p) {
    const rfq = await rfqOrThrow(p.rfq_id as number);
    if (rfq.status !== "open") throw new Error(`RFQ #${rfq.display_id} artıq açıq deyil (${rfq.status}).`);
    const due = await dueCarriers(rfq, p);
    if (due.length === 0) throw new Error("Göndəriləcək yeni daşıyıcı yoxdur: ya baza boşdur, ya da hamısına artıq göndərilib.");
    const res = await api.sendRfq(rfq.id, { carrier_ids: due.map((c) => c.id) });
    return {
      rfq_id: rfq.display_id,
      sent: res.sent.length,
      carriers: res.sent.map((s) => s.company_name),
      recipients: res.sent.map((s) => ({ name: s.company_name, email: s.email })),
    };
  },
};

export const getQuoteLink: AgentTool = {
  name: "get_quote_link",
  description:
    "Creates a shareable public link for an RFQ: anyone who gets it (e.g. via WhatsApp) can enter an offer on the quote page without logging in. Nothing is sent by this tool.",
  params: { rfq_id: { type: "integer", description: "RFQ number as shown in the panel on arachi.co (RFQ #n)." } },
  async run(p) {
    const rfq = await rfqOrThrow(p.rfq_id as number);
    return { rfq_id: rfq.display_id, link: await api.publicLink(rfq.id) };
  },
};

function offerView(o: api.ArachiOffer) {
  return {
    offer_id: o.id,
    carrier: o.carrier_company,
    price: o.price,
    currency: o.currency,
    price_azn: o.price_azn ?? null,
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
  params: { rfq_id: { type: "integer", description: "RFQ number as shown in the panel on arachi.co (RFQ #n)." } },
  async run(p) {
    const rfq = await rfqOrThrow(p.rfq_id as number);
    const [got, who] = await Promise.all([api.offers(rfq.id), api.recipients(rfq.id)]);
    return {
      rfq: { number: rfq.display_id, route: `${rfq.origin} → ${rfq.destination}`, status: rfq.status },
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
  description:
    "Ranks an RFQ's offers. Offers in different currencies are converted to AZN at the Central Bank of Azerbaijan rate so they can be compared; each offer keeps its original price and shows its AZN equivalent. If the rate is unavailable they are ranked separately per currency.",
  params: {
    rfq_id: { type: "integer", description: "RFQ number as shown in the panel on arachi.co (RFQ #n)." },
    criterion: { type: "string", description: "price = cheapest first (in AZN); transit = fastest first.", enum: ["price", "transit"], default: "price" },
  },
  async run(p) {
    const rfq = await rfqOrThrow(p.rfq_id as number);
    const { offers, fx } = await api.offersWithFx(rfq.id);
    const priced = offers.filter((o) => o.price !== null);
    if (priced.length === 0) return { message: "Hələ qiymətli təklif yoxdur." };
    const converted = priced.every((o) => typeof o.price_azn === "number");
    const key = (o: api.ArachiOffer) =>
      p.criterion === "transit" ? (o.transit_time_days ?? Infinity) : converted ? (o.price_azn as number) : (o.price as number);
    if (converted) {
      const foreign = [...new Set(priced.map((o) => o.currency).filter((c) => c !== "AZN"))];
      return {
        criterion: p.criterion,
        converted_to: "AZN",
        rate_note: foreign.length
          ? `Məzənnə (${fx?.source ?? "?"}, ${fx?.date ?? "?"}): ${foreign.map((c) => `1 ${c} = ${fx?.rates[c]} AZN`).join(", ")}`
          : undefined,
        rankings: [
          {
            currency: "AZN",
            offers: [...priced].sort((a, b) => key(a) - key(b)).map((o, i) => ({ rank: i + 1, ...offerView(o) })),
          },
        ],
      };
    }
    const byCurrency = new Map<string, api.ArachiOffer[]>();
    for (const o of priced) byCurrency.set(o.currency, [...(byCurrency.get(o.currency) ?? []), o]);
    return {
      criterion: p.criterion,
      warning: byCurrency.size > 1 ? "Məzənnə hazırda əlçatan deyil: təkliflər valyutaya görə ayrıca sıralanıb, bir-biri ilə müqayisə olunmur." : undefined,
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
    rfq_id: { type: "integer", description: "RFQ number as shown in the panel on arachi.co (RFQ #n)." },
    offer_id: { type: "integer", description: "offer_id from list_offers / compare_offers." },
  },
  async run(p) {
    const rfq = await rfqOrThrow(p.rfq_id as number);
    const offer = (await api.offers(rfq.id)).find((o) => o.id === p.offer_id);
    if (!offer) throw new Error(`Bu RFQ-da #${p.offer_id} təklifi tapılmadı.`);
    await api.selectWinner(rfq.id, offer.id);
    return { rfq_id: rfq.display_id, winner: offerView(offer) };
  },
};

async function waitingFor(number: number) {
  const rfq = await rfqOrThrow(number); // the RFQ must be the user's own
  return (await api.recipients(rfq.id)).filter((r) => !r.has_submitted && !r.is_public && r.email && r.mail_status !== "failed");
}

export const sendReminders: AgentTool = {
  name: "send_reminders",
  description: "Emails a reminder to the carriers of an RFQ who have not sent an offer yet.",
  params: {
    rfq_id: { type: "integer", description: "RFQ number as shown in the panel on arachi.co (RFQ #n)." },
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
    const due = (await waitingFor(p.rfq_id as number)).filter((r) => chosen.length === 0 || chosen.includes(r.quote_id));
    if (due.length === 0) throw new Error("Cavab verməyən daşıyıcı yoxdur.");
    await api.remind(due.map((r) => r.quote_id));
    return { rfq_id: p.rfq_id, reminded: due.length, recipients: due.map((r) => ({ name: r.company_name, email: r.email })) };
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

export const cancelWinner: AgentTool = {
  name: "cancel_winner",
  description: "Takes the winner mark back: the RFQ becomes open again and another offer can be chosen. Does not message anyone.",
  params: { rfq_id: { type: "integer", description: "RFQ number as shown in the panel on arachi.co (RFQ #n)." } },
  async run(p) {
    const rfq = await rfqOrThrow(p.rfq_id as number);
    const winner = (await api.offers(rfq.id)).find((o) => o.is_winner);
    if (!winner) throw new Error(`RFQ #${rfq.display_id} üzrə seçilmiş qalib yoxdur.`);
    await api.cancelWinner(winner.id);
    return { rfq_id: rfq.display_id, was_winner: winner.carrier_company, status: "open" };
  },
};

interface Version {
  version?: number;
  price?: number | null;
  currency?: string;
  transit_time_days?: number | null;
  date?: string;
}

export const offerHistory: AgentTool = {
  name: "offer_history",
  description:
    "Shows how each carrier's offer on an RFQ changed: every earlier version (price, currency, transit time, date) and the current one. Use it for 'did X lower the price?' questions.",
  params: {
    rfq_id: { type: "integer", description: "RFQ number as shown in the panel on arachi.co (RFQ #n)." },
    carrier: { type: "string", description: "Only this carrier (part of the name); empty = all.", default: "" },
  },
  async run(p) {
    const rfq = await rfqOrThrow(p.rfq_id as number);
    const wanted = (p.carrier as string).trim().toLowerCase();
    const rows = (await api.offers(rfq.id)).filter((o) => !wanted || o.carrier_company.toLowerCase().includes(wanted));
    return {
      rfq_id: rfq.display_id,
      carriers: rows.map((o) => ({
        carrier: o.carrier_company,
        current: { price: o.price, currency: o.currency, transit_days: o.transit_time_days },
        earlier_versions: ((Array.isArray(o.quote_history) ? o.quote_history : []) as Version[]).map((v) => ({
          version: v.version,
          price: v.price,
          currency: v.currency,
          transit_days: v.transit_time_days,
          date: v.date,
        })),
      })),
    };
  },
};

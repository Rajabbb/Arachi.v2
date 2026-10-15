import { resolveParams, type AgentTool } from "./registry";
import * as api from "../../arachi/api";
import { config } from "../../config";
import { categoryOrThrow, isMine, recipientLines, rfqOrThrow, subCategoryOrThrow } from "./lookup";
import type { CarrierChoices } from "../../../shared/protocol";
import { toAttachment } from "../files";
import { checkRfq } from "./sourceCheck";

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
    subject: r.subject || undefined,
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
  if (p.container_type) fields.push(`Container Type: ${p.container_type}`);
  if ((p.container_count as number) > 0) fields.push(`Container Count: ${p.container_count}`);
  if ((p.hs_code as string).trim()) fields.push(`HS Code: ${(p.hs_code as string).trim()}`);
  if (p.stackable) fields.push(`Stackable / Non-stackable: ${p.stackable}`);
  if (p.shipment_type) fields.push(`Shipment Type: ${p.shipment_type}`);
  if (p.incoterm) fields.push(`Incoterm: ${p.incoterm}`);
  if ((p.adr as string).trim()) fields.push(`Dangerous Goods (ADR): ${(p.adr as string).trim()}`);
  if ((p.temperature as string).trim()) fields.push(`Temperature Requirement: ${(p.temperature as string).trim()}`);
  if (delivery) fields.push(`Delivery Deadline: ${panelDate("delivery_deadline", delivery)}`);
  const due = String(p.quote_deadline ?? "").trim();
  if (due) {
    fields.push(`Offer Due: ${offerDueText(due)}`);
    if (p.auto_reminder === false) fields.push("Auto Reminder: off");
  }
  const notes = (p.notes as string).trim();
  if (notes) fields.push(`Additional Information: ${notes}`);
  fields.push(`Həcm / Palet: ${amount} ${unit}`);
  return fields;
}

/** Distant sea routes: below this many days between loading and delivery the transit is not realistic. */
const FAR_PLACES =
  /(?<![\p{L}])(?:ABŞ|USA|United States|Amerika|Kanada|Canada|Meksika|Mexico|Braziliya|Brazil|Argentina|Çin|China|Yaponiya|Japan|Koreya|Korea|Hindistan|India|Avstraliya|Australia|Vyetnam|Vietnam|Tailand|Thailand|İndoneziya|Indonesia|Malayziya|Malaysia|Sinqapur|Singapore)(?![\p{L}])/iu;
/** Euro-pallets that usually fit one container, by its length in feet. */
const PALLETS_PER_CONTAINER: Record<string, number> = { "20": 10, "40": 20, "45": 23 };

/** Things worth the user's attention before creating; they never block the RFQ. */
function rfqWarnings(p: Record<string, unknown>): string[] {
  const out: string[] = [];
  const load = Date.parse(String(p.loading_date ?? "").slice(0, 10));
  const deliver = Date.parse(String(p.delivery_deadline ?? "").slice(0, 10));
  if (p.transport_mode === "Dəniz" && Number.isFinite(load) && Number.isFinite(deliver) && deliver >= load) {
    const days = Math.round((deliver - load) / 86_400_000);
    const far = FAR_PLACES.test(String(p.origin)) || FAR_PLACES.test(String(p.destination));
    if (far ? days < 25 : days < 7) {
      out.push(
        `Yükləmə ilə çatdırılma arasında ${days} gün var: bu dəniz marşrutu üçün adətən real deyil. Müddəti yoxlayın (sorğu bloklanmır).`,
      );
    }
  }
  const size = String(p.container_type ?? "").match(/^(20|40|45)/)?.[1];
  const count = Number(p.container_count ?? 0);
  if (p.volume_unit === "Palet" && size && count > 0) {
    const capacity = PALLETS_PER_CONTAINER[size] * count;
    if (Number(p.volume_amount) > capacity) {
      out.push(
        `${p.volume_amount} palet ${count} × ${p.container_type} konteynerə (≈ ${capacity} palet) adətən yalnız paletlər üst-üstə yığılanda sığır. Dəqiqləşdirin.`,
      );
    }
  }
  return out;
}

/** One line on what this route cost before, from the user's own RFQs; empty when there is none or it can't be read. */
async function routeHistoryLine(origin: string, destination: string): Promise<string> {
  try {
    const h = await api.routePrices(origin, destination);
    if (!h.count || !h.stats) return "";
    return `Bu marşrut üzrə keçmiş: ${h.count} təklif (${h.rfq_count} sorğu), orta ${h.stats.avg_azn} AZN, ən aşağı ${h.stats.min_azn} AZN.`;
  } catch {
    return "";
  }
}

/** null = the base could not be read; undefined = it is empty. */
async function readCarrierChoices(): Promise<CarrierChoices | undefined | null> {
  try {
    const [all, categories] = await Promise.all([api.listCarriers(), api.listCategories()]);
    const carriers = all.filter(isMine).filter((c) => (c.email ?? "").trim());
    if (carriers.length === 0) return undefined;
    return {
      categories: categories
        .map((cat) => ({ name: cat.name, carrierIds: carriers.filter((c) => c.category_id === cat.id).map((c) => c.id) }))
        .filter((cat) => cat.carrierIds.length > 0),
      carriers: carriers.map((c) => ({ id: c.id, name: c.company_name, email: c.email })),
    };
  } catch {
    return null;
  }
}

/**
 * The carrier base as the picker under a prepared RFQ shows it; undefined when it is empty or can't be read.
 * A transient arachi.co error must not silently turn the picker into a plain card, so one retry.
 */
async function carrierChoices(): Promise<CarrierChoices | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const found = await readCarrierChoices();
    if (found !== null) return found;
  }
  return undefined;
}

/** Places that are only a country: for sea and air the user must name the port or airport. */
const COUNTRY_ONLY = new Set(
  "abş,amerika,usa,united states,türkiyə,turkiye,turkey,çin,china,rusiya,russia,almaniya,germany,gürcüstan,georgia,iran,i̇ran,italiya,italy,fransa,france,ispaniya,spain,hollandiya,netherlands,belçika,belgium,polşa,poland,ukrayna,ukraine,yunanıstan,greece,bolqarıstan,bulgaria,rumıniya,romania,hindistan,india,yaponiya,japan,koreya,korea,kanada,canada,braziliya,brazil,meksika,mexico,birləşmiş ərəb əmirlikləri,bəə,uae,səudiyyə ərəbistanı,qazaxıstan,kazakhstan,özbəkistan,uzbekistan,türkmənistan,turkmenistan,misir,egypt,böyük britaniya,uk,england,ingiltərə,vyetnam,vietnam,tailand,thailand".split(","),
);
/** Cities that share a name with another (or are not seaports): ask which port is meant. */
const AMBIGUOUS_PLACE = /^(vaşinqton|washington|kembric|cambridge|portland|richmond|springfield|columbus|victoria|georgetown|alexandria|kingston|birmingham|san[- ]?jose)\b/i;
const PORT_WORDS = /liman|\bport\b|terminal|airport|hava limanı|aeroport|\([A-Z]{3}\)/i;

function portProblem(place: string): string | null {
  const text = place.trim();
  if (!text || PORT_WORDS.test(text)) return null;
  if (!text.includes(",") && COUNTRY_ONLY.has(text.toLowerCase())) {
    return `"${text}" yalnız ölkədir`;
  }
  if (AMBIGUOUS_PLACE.test(text)) {
    return `"${text}" aydın deyil (eyni adlı yerlər var və dəniz limanı deyil)`;
  }
  return null;
}

/**
 * Rules the model kept missing in live tests, applied to what the user will see and what runs:
 * sea and air need a port/airport, and at sea the vehicle is a container, not a truck.
 */
/** The user's text plus the text of the files they attached; null when a file cannot be read as text (PDF, image). */
async function sourceText(ctx: { text: string; files: Parameters<typeof toAttachment>[0][] }) {
  const parts = [ctx.text];
  let fromFile = false;
  for (const file of ctx.files) {
    const a = await toAttachment(file);
    if (a.kind !== "text") return null;
    parts.push(a.text);
    fromFile = true;
  }
  return { text: parts.join("\n"), fromFile };
}

function normalizeRfq(p: Record<string, unknown>, source: { text: string; fromFile: boolean } | null = null) {
  const out = { ...p };
  const mode = out.transport_mode;
  if (mode === "Dəniz" || mode === "Hava") {
    for (const [label, place] of [["yükləmə", out.origin], ["boşaltma", out.destination]] as const) {
      const problem = portProblem(String(place ?? ""));
      if (problem) {
        throw new Error(
          `${mode} daşımasında ${label} yeri liman/hava limanı olmalıdır: ${problem}. Sorğunu hələ hazırlamayın: istifadəçidən hansı ${mode === "Dəniz" ? "limanı" : "hava limanını"} nəzərdə tutduğunu soruşun (məs. Vaşinqton üçün Baltimor, Norfolk, New York).`,
        );
      }
    }
  }
  if (mode === "Dəniz") {
    const truck = String(out.truck_type ?? "").trim();
    const cold = /refrij|reefer|soyuduc|frigo|рефриж/i.test(truck) || String(out.temperature ?? "").trim() !== "";
    out.truck_type = ""; // a truck type means nothing at sea
    const container = String(out.container_type ?? "");
    if (cold && !/reefer$/.test(container)) {
      const size = container.match(/^(20|40)/)?.[1];
      if (!size) {
        throw new Error("Dəniz daşımasında temperaturlu yük reefer konteynerlə daşınır: 20 ft yoxsa 40 ft reefer? İstifadəçidən soruşun, sorğunu hələ hazırlamayın.");
      }
      out.container_type = `${size} reefer`;
    }
  }
  return checkRfq(out, source);
}

/** The offer deadline as the panel stores it ("Offer Due: 2026-10-16 17:00"); a date alone means the end of that day. */
function offerDueText(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(value.trim());
  if (!m || Number.isNaN(Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`))) {
    throw new Error("Təklif üçün son tarix YYYY-MM-DD və ya YYYY-MM-DDTHH:MM formatında olmalıdır (məsələn 2026-10-16T17:00).");
  }
  return `${m[1]}-${m[2]}-${m[3]} ${m[4] ?? "23"}:${m[5] ?? "59"}`;
}

/** The deadline must still be ahead (Baku time), or no reminder could ever be sent. */
function refusePastOfferDue(value: string) {
  const text = offerDueText(value);
  const bakuNow = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
  if (text < bakuNow) {
    throw new Error(`Təklif üçün son tarix (${text}) keçmişdədir. İstifadəçidən gələcək bir tarix soruşun, sorğunu hələ hazırlamayın.`);
  }
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
    quote_deadline: {
      type: "string",
      description: "The date and time by which carriers must send their offer (\"təklif üçün son tarix\", quote deadline), YYYY-MM-DDTHH:MM. This is NOT the loading date. Empty = not specified.",
      default: "",
    },
    auto_reminder: {
      type: "boolean",
      description: "With a quote deadline: remind carriers that have not answered 24 hours before it. Set false only if the user asked for no automatic reminder.",
      default: true,
    },
    truck_type: { type: "string", description: "Vehicle type for road freight, e.g. Tentli, Refrijerator. Not for sea freight: use container_type there.", default: "" },
    container_type: {
      type: "string",
      description: "Container type for sea freight (a reefer container is a reefer type, not a truck); empty = not specified or not a container shipment.",
      enum: ["", "20DC", "40DC", "40HC", "45HC", "20 reefer", "40 reefer"],
      default: "",
    },
    container_count: { type: "integer", description: "How many containers; 0 = not specified.", default: 0 },
    hs_code: { type: "string", description: "HS code, e.g. 1234.56.", default: "" },
    stackable: { type: "string", description: "Whether the cargo can be stacked; empty = not specified.", enum: ["", "Stackable", "Non-stackable"], default: "" },
    shipment_type: { type: "string", description: "Shipment type; empty = not specified.", enum: ["", "FTL", "LTL", "FCL", "LCL"], default: "" },
    incoterm: { type: "string", description: "Incoterm; empty = not specified.", enum: [...INCOTERMS], default: "" },
    adr: { type: "string", description: "Dangerous goods (ADR) details, e.g. \"Klass 3\"; empty = not dangerous / not specified.", default: "" },
    temperature: { type: "string", description: "Temperature requirement (reefer), e.g. \"+2 to +8 °C\"; empty = none.", default: "" },
    notes: { type: "string", description: "Additional information and special instructions for carriers.", default: "" },
    subject: {
      type: "string",
      description:
        "The RFQ's subject/group (\"başlıq\", \"qrup\", \"mövzu\"): the customer's own label for grouping RFQs, e.g. the client, the country or the project (\"Sifarişçi: Azersun\", \"Gürcüstan yükləri\"). Only set it when the user mentioned one; it is not shown to carriers and is not the cargo type or the notes. Empty = none.",
      default: "",
    },
  },
  async confirm(raw, ctx) {
    refuseWhenNotWanted(ctx.text);
    const checked = normalizeRfq(raw, await sourceText(ctx));
    const p = checked.params;
    if (String(p.quote_deadline ?? "").trim()) refusePastOfferDue(String(p.quote_deadline));
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
      ["Təklif üçün son tarix", String(p.quote_deadline ?? "").trim() ? offerDueText(String(p.quote_deadline)) : ""],
      ["Avtomatik xatırlatma", String(p.quote_deadline ?? "").trim() ? (p.auto_reminder === false ? "söndürülüb" : "cavab verməyənlərə son tarixdən 24 saat əvvəl") : ""],
      ["Maşın növü", p.truck_type],
      ["Konteyner", p.container_type ? `${Number(p.container_count) > 0 ? `${p.container_count} × ` : ""}${p.container_type}` : ""],
      ["HS Code", p.hs_code],
      ["Stackable", p.stackable],
      ["Daşınma tipi", p.shipment_type],
      ["Incoterm", p.incoterm],
      ["Təhlükəli yük (ADR)", p.adr],
      ["Temperatur", p.temperature],
      ["Əlavə məlumat", p.notes],
      ["Başlıq (qrup)", p.subject],
    ];
    const lines = rows.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "").map(([k, v]) => `• ${k}: ${v}`);
    const warnings = [...checked.warnings, ...rfqWarnings(p)].map((w) => `⚠ ${w}`);
    const choices = await carrierChoices();
    const history = await routeHistoryLine(String(p.origin), String(p.destination));
    return {
      summary:
        `Yeni RFQ yaradılacaq${choices ? "" : " (daşıyıcılara göndərilmir)"}:\n${lines.join("\n")}` +
        (warnings.length ? `\n\n${warnings.join("\n")}` : "") +
        (history ? `\n\nℹ ${history}` : ""),
      params: p,
      choices,
    };
  },
  done(result) {
    const r = result as { number?: number };
    return `RFQ #${r.number} yaradıldı. Hələ daşıyıcılara göndərilməyib.`;
  },
  async run(raw, ctx) {
    const p = normalizeRfq(raw).params;
    if (String(p.quote_deadline ?? "").trim()) refusePastOfferDue(String(p.quote_deadline));
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
      subject: String(p.subject ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
      ...(ctx.attachmentUrl ? { attachment_url: ctx.attachmentUrl } : {}),
    });
    const number = (await api.listRfqs()).find((r) => r.id === rfq.id)?.display_id;
    return { number, ...rfqView(rfq), page_url: `${siteUrl()}/customer` };
  },
};

const MODE_FROM_PANEL: [RegExp, string][] = [
  [/quru|road/i, "Quru"],
  [/dəniz|sea/i, "Dəniz"],
  [/hava|air/i, "Hava"],
  [/dəmir|rail/i, "Dəmiryolu"],
];

/** The create_rfq parameters of an existing RFQ (its stored fields and "ixtiyari parametr" lines), for a copy. */
function paramsFromRfq(rfq: api.ArachiRfq, overrides: Record<string, unknown>): Record<string, unknown> {
  const lines = (rfq.required_fields ?? []).filter((l): l is string => typeof l === "string");
  const line = (re: RegExp) => lines.map((l) => re.exec(l)?.[1]?.trim()).find(Boolean) ?? "";
  const vol = lines.map((l) => /Həcm \/ Palet:\s*([\d.,]+)\s*(CBM|Palet)?/i.exec(l)).find(Boolean);
  const mode = MODE_FROM_PANEL.find(([re]) => re.test(String(rfq.transportation_mode ?? "")))?.[1];
  const keep = (key: string, fallback: unknown) => {
    const v = overrides[key];
    return v === undefined || v === "" || v === 0 ? fallback : v;
  };
  const notes = String(rfq.additional_notes ?? "").replace(/\s*\|?\s*Təklif üçün son tarix:[^|]*/g, "").trim();
  return {
    origin: keep("origin", rfq.origin),
    destination: keep("destination", rfq.destination),
    cargo_type: keep("cargo_type", rfq.cargo_type ?? ""),
    weight_kg: keep("weight_kg", rfq.weight_kg ?? 0),
    volume_amount: keep("volume_amount", vol ? Number(vol[1].replace(",", ".")) : (rfq.volume_m3 ?? 0)),
    volume_unit: vol?.[2] && /pal/i.test(vol[2]) ? "Palet" : "CBM",
    transport_mode: keep("transport_mode", mode ?? ""),
    // Dates are not copied: they belong to the old shipment.
    loading_date: String(overrides.loading_date ?? ""),
    delivery_deadline: String(overrides.delivery_deadline ?? ""),
    quote_deadline: String(overrides.quote_deadline ?? ""),
    auto_reminder: !lines.some((l) => /^\s*Auto Reminder\s*:\s*(off|no|0)/i.test(l)),
    truck_type: rfq.truck_type ?? line(/^Truck Type:\s*(.+)$/i),
    hs_code: rfq.hs_code ?? line(/^HS Code:\s*(.+)$/i),
    stackable: rfq.stackable === true ? "Stackable" : rfq.stackable === false ? "Non-stackable" : "",
    shipment_type: rfq.shipment_type ?? line(/^Shipment Type:\s*(.+)$/i),
    incoterm: line(/^Incoterm:\s*(.+)$/i),
    adr: line(/^Dangerous Goods \(ADR\):\s*(.+)$/i),
    temperature: line(/^Temperature Requirement:\s*(.+)$/i),
    container_type: line(/^Container Type:\s*(.+)$/i),
    container_count: Number(line(/^Container Count:\s*(\d+)/i) || 0),
    notes: String(overrides.notes ?? "").trim() || notes,
    subject: keep("subject", rfq.subject ?? ""),
  };
}

/** The copy's parameters; an old RFQ may lack a mandatory field, then the user is asked instead of a bare error. */
function copyParams(rfq: api.ArachiRfq, overrides: Record<string, unknown>): Record<string, unknown> {
  const raw = paramsFromRfq(rfq, overrides);
  const missing: string[] = [];
  if (!String(raw.cargo_type ?? "").trim()) missing.push("yükün növü (cargo_type)");
  if (!(Number(raw.weight_kg) > 0)) missing.push("çəki (weight_kg)");
  if (!(Number(raw.volume_amount) > 0)) missing.push("həcm / palet (volume_amount)");
  if (!raw.transport_mode) missing.push("daşınma növü (transport_mode)");
  if (missing.length) {
    throw new Error(
      `RFQ #${rfq.display_id}-də bu məlumat yoxdur: ${missing.join(", ")}. İstifadəçidən soruşun və duplicate_rfq-ya həmin dəyərləri ötürün.`,
    );
  }
  const resolved = resolveParams(createRfq, raw);
  if ("error" in resolved) throw new Error(resolved.error);
  return resolved.params;
}

export const duplicateRfq: AgentTool = {
  name: "duplicate_rfq",
  description:
    "Prepares a NEW RFQ as a copy of an existing one (same route, cargo, weight, volume and conditions) so the user does not have to type it again. Dates are not copied: pass the new loading_date, delivery_deadline and quote_deadline when the user gave them, otherwise they stay empty. The user then sees the usual card (fields, carrier picker) and confirms; the old RFQ is not touched.",
  params: {
    rfq_id: { type: "integer", description: "RFQ number as shown in the panel on arachi.co (RFQ #n) to copy." },
    loading_date: { type: "string", description: "New loading date, YYYY-MM-DD or YYYY-MM-DDTHH:MM; empty = not given.", default: "" },
    delivery_deadline: { type: "string", description: "New delivery deadline; empty = not given.", default: "" },
    quote_deadline: { type: "string", description: "New offer deadline (təklif üçün son tarix), YYYY-MM-DDTHH:MM; empty = not given.", default: "" },
    origin: { type: "string", description: "Different loading place; empty = same as the copied RFQ.", default: "" },
    destination: { type: "string", description: "Different unloading place; empty = same.", default: "" },
    weight_kg: { type: "number", description: "Different weight in kg; 0 = same.", default: 0 },
    volume_amount: { type: "number", description: "Different volume or pallet count; 0 = same.", default: 0 },
    cargo_type: { type: "string", description: "Different cargo; empty = same. Needed when the copied RFQ has none.", default: "" },
    transport_mode: {
      type: "string",
      description: "Transport mode when the copied RFQ does not have one (old RFQs): Quru, Dəniz, Hava or Dəmiryolu; empty = same.",
      enum: ["", ...Object.keys(TRANSPORT_MODES)],
      default: "",
    },
    notes: { type: "string", description: "New additional information replacing the old; empty = keep the old.", default: "" },
  },
  async confirm(p, ctx) {
    const rfq = await rfqOrThrow(p.rfq_id as number);
    const resolved = copyParams(rfq, p);
    const plan = await createRfq.confirm!(resolved, ctx);
    if (!plan) return null;
    return { ...plan, tool: "create_rfq", summary: `RFQ #${rfq.display_id} kopyası. ${plan.summary}` };
  },
  async run(p, ctx) {
    const rfq = await rfqOrThrow(p.rfq_id as number);
    return createRfq.run(copyParams(rfq, p), ctx);
  },
};

export const routePriceHistory: AgentTool = {
  name: "route_price_history",
  description:
    "What carriers quoted before for the same route (same loading and unloading city) in the user's own RFQs: how many offers, the average, lowest and highest in AZN at the Central Bank rate, the cheapest offer and the latest ones. Use it for \"how much did Baku–Berlin cost before\" or to judge whether a new offer is normal. Only the user's own data; nothing is sent.",
  params: {
    origin: { type: "string", description: "Loading place, e.g. \"Bakı\" or \"Bakı, Azərbaycan\" (the city is compared)." },
    destination: { type: "string", description: "Unloading place, e.g. \"Berlin\"." },
    exclude_rfq_id: { type: "integer", description: "RFQ number (as in the panel) to leave out, usually the one being judged; 0 = none.", default: 0 },
  },
  async run(p) {
    const exclude = (p.exclude_rfq_id as number) > 0 ? (await rfqOrThrow(p.exclude_rfq_id as number)).id : undefined;
    const h = await api.routePrices(String(p.origin), String(p.destination), exclude);
    if (!h.count) return { origin: p.origin, destination: p.destination, message: "Bu marşrut üzrə əvvəlki təklif tapılmadı." };
    return { origin: p.origin, destination: p.destination, offers: h.count, rfqs: h.rfq_count, stats: h.stats, cheapest: h.cheapest, latest: h.items.slice(0, 5) };
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
        (!q || [r.origin, r.destination, r.cargo_type, r.additional_notes, r.subject].join(" ").toLowerCase().includes(q)),
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
    includes: typeof o.extra_details?.["Daxildir"] === "string" ? o.extra_details["Daxildir"] : undefined,
    excludes: typeof o.extra_details?.["Daxil deyil"] === "string" ? o.extra_details["Daxil deyil"] : undefined,
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
        status:
          (r.has_submitted
            ? "Təklif alındı"
            : r.is_viewed
              ? "Baxıldı"
              : r.mail_status === "failed"
                ? "Çatdırılmadı"
                : r.mail_status === "delivered"
                  ? "Çatdırıldı"
                  : "Göndərilir") + (!r.has_submitted && r.auto_reminded_at ? " · avtomatik xatırlatma göndərilib" : ""),
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

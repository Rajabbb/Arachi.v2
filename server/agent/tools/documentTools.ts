import ExcelJS from "exceljs";
import type { AgentTool, ToolContext } from "./registry";
import * as api from "../../arachi/api";
import { now } from "../../db";
import { fileUrl, storeFile } from "../../domain/files";
import { renderPdf, table } from "../../docs/pdf";
import { rfqOrThrow } from "./lookup";

/** Files for the user: the report of RFQs/offers (Excel or PDF) and the official quote for the end customer (PDF). */

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const CURRENCIES = ["AZN", "USD", "EUR", "TRY", "RUB", "GBP"] as const;

async function saveDownload(ctx: ToolContext, name: string, type: string, data: Uint8Array) {
  const id = await storeFile("export", 0, name, type, data);
  const download = { name, url: await fileUrl(id) };
  ctx.downloads.push(download);
  return download;
}

type Row = Record<string, string | number | null>;

/** Dates must be real calendar days, so a typo is reported instead of silently exporting nothing. */
function checkDay(label: string, value: string) {
  if (!value) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${label} YYYY-MM-DD formatında olmalıdır (məsələn 2026-10-09).`);
  }
}

async function workbook(rows: Row[], sheet: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  const keys = Object.keys(rows[0]);
  ws.columns = keys.map((key) => ({
    header: key,
    key,
    width: Math.min(40, Math.max(key.length + 2, ...rows.map((r) => String(r[key] ?? "").length + 2))),
  }));
  rows.forEach((r) => ws.addRow(keys.map((k) => r[k])));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const pdfColumns: Record<"rfq" | "quotes", string[]> = {
  rfq: ["Sorğu ID", "Marşrut", "Yük Növü", "Çəki (kq)", "Maşın Növü", "Status", "Yaradılma Tarixi"],
  quotes: ["Sorğu ID", "Marşrut", "Daşıyıcı Şirkət", "Qiymət", "Valyuta", "Tranzit Müddəti (gün)", "Qalibdir?", "Təklif Tarixi"],
};

function reportPdf(rows: Row[], kind: "rfq" | "quotes", title: string): Promise<Buffer> {
  const keys = pdfColumns[kind].filter((k) => k in rows[0]);
  return renderPdf(
    (doc) => {
      doc.font("bold").fontSize(16).text(title).moveDown(0.5);
      doc.font("regular").fontSize(9);
      table(doc, keys, rows.map((r) => keys.map((k) => String(r[k] ?? ""))), keys.map((k) => (k === "Marşrut" ? 2 : 1)));
    },
    { landscape: true },
  );
}

export const exportRfqs: AgentTool = {
  name: "export_rfqs",
  description:
    "The report of the user's RFQs or of the offers they received, as an Excel or PDF file, taken from arachi.co. Returns a download link. Use it for 'hesabat', 'export', 'Excel/PDF hazırla'.",
  params: {
    what: { type: "string", description: "rfqs = the RFQs with their details; offers = the carrier offers received.", enum: ["rfqs", "offers"], default: "rfqs" },
    period: {
      type: "string",
      description: "all = everything; today = created today; date_range = between start_date and end_date; selected = only the rfq_ids given.",
      enum: ["all", "today", "date_range", "selected"],
      default: "all",
    },
    start_date: { type: "string", description: "For period=date_range: first day, YYYY-MM-DD.", default: "" },
    end_date: { type: "string", description: "For period=date_range: last day, YYYY-MM-DD.", default: "" },
    rfq_ids: { type: "array", description: "For period=selected: RFQ numbers as shown in the panel.", items: { type: "integer" }, default: [] },
    format: { type: "string", description: "File format.", enum: ["xlsx", "pdf"], default: "xlsx" },
  },
  async run(p, ctx) {
    const period = p.period as "all" | "today" | "date_range" | "selected";
    checkDay("start_date", p.start_date as string);
    checkDay("end_date", p.end_date as string);
    if (period === "date_range" && !p.start_date && !p.end_date) throw new Error("Tarix aralığı üçün start_date və ya end_date lazımdır.");
    let dbIds: number[] = [];
    if (period === "selected") {
      const numbers = p.rfq_ids as number[];
      if (numbers.length === 0) throw new Error("Seçilmiş RFQ nömrələri verilməyib.");
      dbIds = await Promise.all(numbers.map(async (n) => (await rfqOrThrow(n)).id));
    }
    const kind = p.what === "offers" ? "quotes" : "rfq";
    const rows = await api.report({
      report_type: period,
      report_category: kind,
      start_date: (p.start_date as string) || undefined,
      end_date: (p.end_date as string) || undefined,
      rfq_ids: dbIds,
    });
    if (rows.length === 0) throw new Error(kind === "rfq" ? "Bu seçimə uyğun RFQ tapılmadı." : "Bu seçimdə təklif tapılmadı.");
    const stamp = now().slice(0, 10);
    const base = `${kind === "rfq" ? "RFQ" : "Teklifler"}-hesabati-${stamp}`;
    const download =
      p.format === "pdf"
        ? await saveDownload(ctx, `${base}.pdf`, "application/pdf", await reportPdf(rows, kind, `${kind === "rfq" ? "RFQ hesabatı" : "Təkliflər hesabatı"} · ${stamp}`))
        : await saveDownload(ctx, `${base}.xlsx`, XLSX, await workbook(rows, kind === "rfq" ? "RFQ" : "Təkliflər"));
    return { rows: rows.length, format: p.format, download };
  },
};

function money(n: number, currency: string): string {
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

const text = {
  az: {
    title: "Kommersiya təklifi",
    no: "Təklif №",
    date: "Tarix",
    valid: "Etibarlıdır",
    to: "Müştəri",
    route: "Marşrut",
    cargo: "Yük",
    weight: "Çəki",
    volume: "Həcm",
    truck: "Maşın növü",
    shipment: "Yük tipi",
    deadline: "Çatdırılma tarixi",
    transit: "Tranzit müddəti",
    days: "gün",
    carrier: "Daşıyıcı",
    service: "Xidmət",
    total: "Yekun məbləğ",
    freight: "Yükdaşıma xidməti",
    defaultValidity: (d: number) => `Etibarlılıq müddəti standart olaraq ${d} gündür.`,
    footer: "Qiymətə göstərilən marşrut üzrə yükdaşıma daxildir. Təklif yuxarıdakı tarixədək qüvvədədir.",
    kg: "kq",
  },
  en: {
    title: "Commercial offer",
    no: "Offer no.",
    date: "Date",
    valid: "Valid until",
    to: "Customer",
    route: "Route",
    cargo: "Cargo",
    weight: "Weight",
    volume: "Volume",
    truck: "Vehicle type",
    shipment: "Shipment type",
    deadline: "Delivery date",
    transit: "Transit time",
    days: "days",
    carrier: "Carrier",
    service: "Service",
    total: "Total",
    freight: "Freight service",
    defaultValidity: (d: number) => `Standard validity period: ${d} days.`,
    footer: "The price covers transportation along the route above. This offer is valid until the date above.",
    kg: "kg",
  },
};

/** How long a customer quote stays valid when the user gave no date (arachi.co offers carry no validity date). */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 7;

function plusDays(days: number, from: Date): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export function customerPrice(price: number, from: string, to: string, feePercent: number, rate: number) {
  if (!(feePercent >= 0)) throw new Error("Xidmət haqqı faizi mənfi ola bilməz.");
  let cost = price;
  if (from !== to) {
    if (!(rate > 0)) throw new Error(`${from} → ${to} çevirmək üçün eur_usd_rate (1 EUR neçə USD) lazımdır.`);
    if (!["EUR", "USD"].includes(from) || !["EUR", "USD"].includes(to)) throw new Error("Yalnız EUR ↔ USD çevirmək mümkündür.");
    cost = from === "EUR" ? price * rate : price / rate;
  }
  const fee = Math.round(cost * feePercent) / 100;
  cost = Math.round(cost * 100) / 100;
  return { cost, fee, total: Math.round((cost + fee) * 100) / 100 };
}

/** The offer the quote is based on: the one given, else the winner, else the cheapest. */
async function baseOffer(rfqId: number, offerId: number): Promise<api.ArachiOffer> {
  const priced = (await api.offers(rfqId)).filter((o) => o.price !== null);
  if (offerId) {
    const offer = priced.find((o) => o.id === offerId);
    if (!offer) throw new Error(`Bu RFQ-da #${offerId} təklifi tapılmadı.`);
    return offer;
  }
  const winner = priced.find((o) => o.is_winner);
  if (winner) return winner;
  if (priced.length === 0) throw new Error("Bu RFQ üzrə hələ qiymətli təklif yoxdur.");
  const currency = priced[0].currency;
  return priced.filter((o) => o.currency === currency).sort((a, b) => (a.price as number) - (b.price as number))[0];
}

export const createCustomerQuote: AgentTool = {
  name: "create_customer_quote",
  description:
    "Creates the official quote PDF for the end customer from a carrier offer, adding the service fee on top of the carrier price, and saves it on arachi.co. By default uses the winning offer (or the cheapest) and hides the carrier's name. Returns a download link. Always tell the user the valid_until date.",
  params: {
    rfq_id: { type: "integer", description: "RFQ number as shown in the panel on arachi.co (RFQ #n)." },
    offer_id: { type: "integer", description: "offer_id to base the quote on; 0 = the winner, else the cheapest.", default: 0 },
    service_fee_percent: { type: "number", description: "Markup added to the carrier price, in percent.", default: 10 },
    currency: { type: "string", description: "Quote currency; empty = the offer's currency.", enum: ["", ...CURRENCIES], default: "" },
    eur_usd_rate: { type: "number", description: "USD per 1 EUR, needed only when converting EUR ↔ USD.", default: 0 },
    customer_name: { type: "string", description: "Customer shown on the quote; empty = not shown.", default: "" },
    language: { type: "string", description: "Language of the PDF.", enum: ["az", "en"], default: "az" },
    validity_days: { type: "integer", description: "Days the quote stays valid, only when the user asks; 0 = the standard 7 days.", default: 0 },
    valid_until: { type: "string", description: "Exact valid-until date YYYY-MM-DD, only when the user gives one; overrides validity_days.", default: "" },
    show_carrier: { type: "boolean", description: "Show the carrier's name to the customer.", default: false },
  },
  async run(p, ctx) {
    const rfq = await rfqOrThrow(p.rfq_id as number);
    const offer = await baseOffer(rfq.id, p.offer_id as number);
    const currency = (p.currency as string) || offer.currency;
    const price = customerPrice(offer.price as number, offer.currency, currency, p.service_fee_percent as number, p.eur_usd_rate as number);
    const s = text[p.language as "az" | "en"];
    const issued = now().slice(0, 10);
    checkDay("valid_until", p.valid_until as string);
    if ((p.validity_days as number) < 0) throw new Error("Etibarlılıq müddəti (gün) mənfi ola bilməz.");
    const from = new Date(`${issued}T00:00:00Z`);
    const validUntil = (p.valid_until as string) || plusDays((p.validity_days as number) || DEFAULT_QUOTE_VALIDITY_DAYS, from);
    if (validUntil < issued) throw new Error(`Etibarlılıq tarixi (${validUntil}) bugündən (${issued}) əvvəl ola bilməz.`);
    const standard = !p.valid_until && !p.validity_days;
    const number = `Q-${rfq.display_id}-${offer.id}`;

    const pdf = await renderPdf((doc) => {
      doc.font("bold").fontSize(20).fillColor("#4f46e5").text(s.title).fillColor("black").moveDown();
      doc.fontSize(10);
      const meta: [string, string][] = [[s.no, number], [s.date, issued], [s.valid, validUntil]];
      if (p.customer_name) meta.push([s.to, p.customer_name as string]);
      meta.forEach(([k, v]) => doc.text(`${k}: ${v}`));
      doc.moveDown();
      const rows: [string, string][] = [[s.route, `${rfq.origin} → ${rfq.destination}`]];
      if (rfq.cargo_type) rows.push([s.cargo, rfq.cargo_type]);
      if (rfq.weight_kg) rows.push([s.weight, `${rfq.weight_kg} ${s.kg}`]);
      if (rfq.volume_m3) rows.push([s.volume, `${rfq.volume_m3} m³`]);
      if (rfq.truck_type) rows.push([s.truck, rfq.truck_type]);
      if (rfq.shipment_type) rows.push([s.shipment, rfq.shipment_type]);
      if (rfq.deadline) rows.push([s.deadline, rfq.deadline]);
      if (offer.transit_time_days) rows.push([s.transit, `${offer.transit_time_days} ${s.days}`]);
      if (p.show_carrier) rows.push([s.carrier, offer.carrier_company]);
      table(doc, ["", ""], rows, [1, 2]);
      doc.moveDown();
      // The fee is built into the customer's price; it is not shown as a separate line.
      table(doc, [s.service, s.total], [[`${s.freight}: ${rfq.origin} → ${rfq.destination}`, money(price.total, currency)]], [3, 1]);
      doc.moveDown().fontSize(9).fillColor("#555555").text(s.footer);
      if (standard) doc.text(s.defaultValidity(DEFAULT_QUOTE_VALIDITY_DAYS));
      doc.fillColor("black");
    });

    await api.saveCustomerQuote({
      request_id: rfq.id,
      quote_id: offer.id,
      base_price: price.cost,
      margin_type: "percent",
      margin_value: p.service_fee_percent as number,
      final_price: price.total,
      currency,
      valid_until: validUntil,
    });
    const download = await saveDownload(ctx, `${number}.pdf`, "application/pdf", pdf);
    return {
      quote_number: number,
      rfq_id: rfq.display_id,
      offer_id: offer.id,
      carrier_price: money(offer.price as number, offer.currency),
      service_fee_percent: p.service_fee_percent,
      service_fee: money(price.fee, currency),
      customer_total: money(price.total, currency),
      valid_until: validUntil,
      ...(standard ? { validity_note: `Müddət yazılmadığı üçün standart ${DEFAULT_QUOTE_VALIDITY_DAYS} gün götürüldü.` } : {}),
      download,
    };
  },
};

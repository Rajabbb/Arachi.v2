import ExcelJS from "exceljs";
import type { AgentTool, ToolContext } from "./registry";
import { db, now } from "../../db";
import { currentUserId } from "../../auth/current";
import { getCarrier } from "../../domain/carriers";
import { statusLabels, type DispatchStatus } from "../../domain/dispatches";
import { fileUrl, storeFile } from "../../domain/files";
import { getOffer, latestOffers, type Offer } from "../../domain/offers";
import { addDays, checkDate, currencies, getRfq, type Rfq } from "../../domain/rfqs";
import { renderPdf, table } from "../../docs/pdf";

/** Process 10: the official quote for the customer (PDF) and Excel/PDF exports. */

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function saveDownload(
  ctx: ToolContext,
  ownerKind: string,
  ownerId: number,
  name: string,
  type: string,
  data: Uint8Array,
) {
  const id = await storeFile(ownerKind, ownerId, name, type, data);
  const download = { name, url: await fileUrl(id) };
  ctx.downloads.push(download);
  return download;
}

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
    pallets: "Palet",
    transport: "Nəqliyyat",
    loading: "Yükləmə tarixi",
    transit: "Tranzit müddəti",
    days: "gün",
    carrier: "Daşıyıcı",
    service: "Xidmət",
    total: "Yekun məbləğ",
    freight: "Yükdaşıma xidməti",
    flexible: "çevik",
    defaultValidity: (d: number) => `Etibarlılıq müddəti standart olaraq ${d} gündür.`,
    footer: "Qiymətə göstərilən marşrut üzrə yükdaşıma daxildir. Təklif yuxarıdakı tarixədək qüvvədədir.",
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
    pallets: "Pallets",
    transport: "Transport",
    loading: "Loading date",
    transit: "Transit time",
    days: "days",
    carrier: "Carrier",
    service: "Service",
    total: "Total",
    freight: "Freight service",
    flexible: "flexible",
    defaultValidity: (d: number) => `Standard validity period: ${d} days.`,
    footer: "The price covers transportation along the route above. This offer is valid until the date above.",
  },
};

const transportEn: Record<string, string> = { Quru: "Road", "Dəniz": "Sea", Hava: "Air", "Dəmiryolu": "Rail" };

/** Picks the offer the quote is based on: the given one, else the winner, else the cheapest same-currency one. */
async function baseOffer(rfq: Rfq, offerId: number): Promise<Offer> {
  if (offerId) {
    const offer = await getOffer(offerId);
    if (offer.rfq_id !== rfq.id) throw new Error(`Təklif #${offer.id} RFQ #${rfq.id}-ə aid deyil.`);
    return offer;
  }
  if (rfq.awarded_offer_id) return getOffer(rfq.awarded_offer_id);
  const offers = await latestOffers(rfq.id);
  const best = offers.find((o) => o.currency === rfq.currency) ?? offers[0];
  if (!best) throw new Error(`RFQ #${rfq.id} üzrə hələ təklif yoxdur.`);
  return best;
}

/** How long a customer quote stays valid when neither the carrier nor the user gave a date. */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 7;

export interface QuoteValidity {
  valid_until: string;
  /** user = asked for in chat, carrier = the carrier offer's date, default = DEFAULT_QUOTE_VALIDITY_DAYS. */
  source: "user" | "carrier" | "default";
  note: string;
  warning: string;
}

/**
 * The quote's valid-until date. A date or day count the user asked for wins (with a warning when it outlives
 * the carrier's offer); otherwise the carrier's own validity date; otherwise the standard period.
 */
export function quoteValidity(issued: string, carrierValidUntil: string, validityDays: number, validUntil: string): QuoteValidity {
  checkDate("Təklifin etibarlılıq tarixi", validUntil);
  if (validityDays < 0) throw new Error("Etibarlılıq müddəti (gün) mənfi ola bilməz.");
  const from = new Date(`${issued}T00:00:00Z`);
  const user = validUntil || (validityDays > 0 ? addDays(validityDays, from) : "");
  if (user) {
    if (user < issued) throw new Error(`Etibarlılıq tarixi (${user}) təklif tarixindən (${issued}) əvvəl ola bilməz.`);
    const warning = carrierValidUntil && user > carrierValidUntil
      ? `Diqqət: daşıyıcının təklifi yalnız ${carrierValidUntil} tarixinədək etibarlıdır, müştəri təklifi isə ${user} tarixinədək yazıldı.`
      : "";
    return { valid_until: user, source: "user", note: "İstifadəçinin istədiyi müddət.", warning };
  }
  if (carrierValidUntil && carrierValidUntil >= issued) {
    return { valid_until: carrierValidUntil, source: "carrier", note: "Daşıyıcı təklifinin etibarlılıq tarixi götürüldü.", warning: "" };
  }
  const days = DEFAULT_QUOTE_VALIDITY_DAYS;
  return {
    valid_until: addDays(days, from),
    source: "default",
    note: `Daşıyıcı etibarlılıq tarixi yazmayıb, standart ${days} gün götürüldü; dəyişmək üçün müddəti və ya tarixi yazın.`,
    warning: carrierValidUntil
      ? `Diqqət: daşıyıcının təklifinin müddəti ${carrierValidUntil} tarixində bitib; qiyməti daşıyıcı ilə təsdiqləyin.`
      : "",
  };
}

export function customerPrice(price: number, from: string, to: string, feePercent: number, rate: number) {
  if (feePercent < 0) throw new Error("Xidmət haqqı faizi mənfi ola bilməz.");
  let cost = price;
  if (from !== to) {
    if (!(rate > 0)) throw new Error(`${from} → ${to} çevirmək üçün eur_usd_rate lazımdır.`);
    cost = from === "EUR" ? price * rate : price / rate;
  }
  const fee = Math.round(cost * feePercent) / 100;
  cost = Math.round(cost * 100) / 100;
  return { cost, fee, total: Math.round((cost + fee) * 100) / 100 };
}

export const createCustomerQuote: AgentTool = {
  name: "create_customer_quote",
  description:
    "Creates the official quote PDF for the end customer from a carrier offer, adding the service fee on top of the carrier price. By default uses the winning offer (or the cheapest one) and hides the carrier's name. Returns a download link. Always tell the user the valid_until date with its validity_note, and any warning.",
  params: {
    rfq_id: { type: "integer", description: "RFQ number." },
    offer_id: { type: "integer", description: "Offer to base the quote on; 0 = winner, else cheapest.", default: 0 },
    service_fee_percent: { type: "number", description: "Markup added to the carrier price, in percent.", default: 10 },
    currency: { type: "string", description: "Quote currency; empty = the offer's currency.", enum: ["", ...currencies], default: "" },
    eur_usd_rate: { type: "number", description: "USD per 1 EUR, needed only when converting.", default: 0 },
    customer_name: { type: "string", description: "Customer shown on the quote; empty = not shown.", default: "" },
    language: { type: "string", description: "Language of the PDF.", enum: ["az", "en"], default: "az" },
    validity_days: {
      type: "integer",
      description: "Days the quote stays valid, only when the user asks; 0 = the carrier offer's validity date, else 7 days.",
      default: 0,
    },
    valid_until: {
      type: "string",
      description: "Exact valid-until date YYYY-MM-DD, only when the user gives one; overrides validity_days.",
      default: "",
    },
    show_carrier: { type: "boolean", description: "Show the carrier's name to the customer.", default: false },
  },
  async run(p, ctx) {
    const rfq = await getRfq(p.rfq_id as number);
    const offer = await baseOffer(rfq, p.offer_id as number);
    const carrierName = p.show_carrier ? (await getCarrier(offer.carrier_id)).name : "";
    const currency = (p.currency as string) || offer.currency;
    const price = customerPrice(offer.price, offer.currency, currency, p.service_fee_percent as number, p.eur_usd_rate as number);
    const s = text[p.language as "az" | "en"];
    const en = p.language === "en";
    const issued = now().slice(0, 10);
    const validity = quoteValidity(issued, offer.valid_until, p.validity_days as number, p.valid_until as string);
    const validUntil = validity.valid_until;
    const number = `Q-${rfq.id}-${offer.id}`;

    const pdf = await renderPdf((doc) => {
      // No platform brand on customer-facing documents: the offer heading is the top line.
      doc.font("bold").fontSize(20).fillColor("#4f46e5").text(s.title).fillColor("black").moveDown();
      doc.fontSize(10);
      const meta: [string, string][] = [
        [s.no, number],
        [s.date, issued],
        [s.valid, validUntil],
        ...(p.customer_name ? [[s.to, p.customer_name as string] as [string, string]] : []),
      ];
      meta.forEach(([k, v]) => doc.text(`${k}: ${v}`));
      doc.moveDown();
      const rows: [string, string][] = [
        [s.route, `${rfq.origin} → ${rfq.destination}`],
        [s.cargo, rfq.cargo_type],
        [s.weight, `${rfq.weight_kg} ${en ? "kg" : "kq"}`],
        ...(rfq.volume_m3 ? [[s.volume, `${rfq.volume_m3} m³`] as [string, string]] : []),
        ...(rfq.pallets ? [[s.pallets, String(rfq.pallets)] as [string, string]] : []),
        [s.transport, en ? (transportEn[rfq.transport_type] ?? rfq.transport_type) : rfq.transport_type],
        [s.loading, rfq.loading_date || s.flexible],
        [s.transit, `${offer.transit_days} ${s.days}`],
        ...(p.show_carrier ? [[s.carrier, carrierName] as [string, string]] : []),
      ];
      table(doc, ["", ""], rows, [1, 2]);
      doc.moveDown();
      // The fee is built into the customer's price; it is not shown as a separate line.
      table(doc, [s.service, s.total], [[`${s.freight}: ${rfq.origin} → ${rfq.destination}`, money(price.total, currency)]], [3, 1]);
      doc.moveDown().fontSize(9).fillColor("#555555").text(s.footer);
      if (validity.source === "default") doc.text(s.defaultValidity(DEFAULT_QUOTE_VALIDITY_DAYS));
      doc.fillColor("black");
    });

    const download = await saveDownload(ctx, "rfq", rfq.id, `${number}.pdf`, "application/pdf", pdf);
    return {
      quote_number: number,
      rfq_id: rfq.id,
      offer_id: offer.id,
      carrier_price: money(offer.price, offer.currency),
      service_fee_percent: p.service_fee_percent,
      service_fee: money(price.fee, currency),
      customer_total: money(price.total, currency),
      valid_until: validUntil,
      validity_source: validity.source,
      validity_note: validity.note,
      ...(validity.warning ? { warning: validity.warning } : {}),
      download,
    };
  },
};

interface ExportRow {
  rfq: Rfq;
  dispatches: { carrier: string; status: string }[];
  offers: (Offer & { carrier_name: string })[];
}

async function collect(rfqId: number, status: string): Promise<ExportRow[]> {
  const rfqs = rfqId
    ? [await getRfq(rfqId)]
    : await db().all<Rfq>(
        `SELECT * FROM rfqs WHERE user_id = ? ${status === "all" ? "" : "AND status = ?"} ORDER BY id`,
        currentUserId(), ...(status === "all" ? [] : [status]),
      );
  const rows: ExportRow[] = [];
  for (const rfq of rfqs) {
    const dispatches = await db().all<{ name: string; status: DispatchStatus }>(
      "SELECT c.name, d.status FROM dispatches d JOIN carriers c ON c.id = d.carrier_id WHERE d.rfq_id = ? AND c.user_id = ? ORDER BY c.name, c.id",
      rfq.id, currentUserId(),
    );
    rows.push({
      rfq,
      dispatches: dispatches.map((d) => ({ carrier: d.name, status: statusLabels[d.status] })),
      offers: await latestOffers(rfq.id),
    });
  }
  return rows;
}

const rfqStatusLabels: Record<string, string> = { open: "Açıq", awarded: "Qalib seçilib", closed: "Bağlı" };

export const exportRfqs: AgentTool = {
  name: "export_rfqs",
  description: "Exports RFQs with their carriers' statuses and latest offers to Excel (default) or PDF and returns a download link.",
  params: {
    rfq_id: { type: "integer", description: "One RFQ; 0 = all RFQs.", default: 0 },
    status: { type: "string", description: "With rfq_id 0: which RFQs.", enum: ["all", "open", "awarded", "closed"], default: "all" },
    format: { type: "string", description: "File format.", enum: ["xlsx", "pdf"], default: "xlsx" },
  },
  async run(p, ctx) {
    const rows = await collect(p.rfq_id as number, p.status as string);
    if (rows.length === 0) throw new Error("İxrac üçün RFQ tapılmadı.");
    const stamp = now().slice(0, 10);
    const base = p.rfq_id ? `RFQ-${p.rfq_id}` : `RFQ-ler-${stamp}`;

    const rfqHeader = ["RFQ", "Haradan", "Haraya", "Yük", "Çəki (kq)", "Nəqliyyat", "Yükləmə", "Valyuta", "Status", "Göndərilib", "Təklif", "Ən ucuz"];
    const rfqRow = (r: ExportRow) => {
      const cheapest = r.offers[0];
      return [
        `#${r.rfq.id}`, r.rfq.origin, r.rfq.destination, r.rfq.cargo_type, r.rfq.weight_kg, r.rfq.transport_type,
        r.rfq.loading_date || "çevik", r.rfq.currency, rfqStatusLabels[r.rfq.status] ?? r.rfq.status,
        r.dispatches.length, r.offers.length, cheapest ? `${cheapest.price} ${cheapest.currency}` : "",
      ];
    };
    const offerHeader = ["RFQ", "Daşıyıcı", "Təklif / versiya", "Qiymət", "Valyuta", "Tranzit (gün)", "Etibarlıdır", "Qeydlər", "Qalib"];
    const offerRows = rows.flatMap((r) =>
      r.offers.map((o) => [
        `#${r.rfq.id}`, o.carrier_name, `№${o.offer_no} v${o.version}`, o.price, o.currency, o.transit_days, o.valid_until, o.notes,
        r.rfq.awarded_offer_id === o.id ? "✓" : "",
      ]),
    );
    const statusRows = rows.flatMap((r) => r.dispatches.map((d) => [`#${r.rfq.id}`, d.carrier, d.status]));

    let download;
    if (p.format === "xlsx") {
      const wb = new ExcelJS.Workbook();
      const add = (name: string, header: string[], data: (string | number)[][]) => {
        const ws = wb.addWorksheet(name);
        ws.addRow(header).font = { bold: true };
        ws.addRows(data);
        ws.columns.forEach((c) => (c.width = 16));
        ws.views = [{ state: "frozen", ySplit: 1 }];
      };
      add("RFQ-lər", rfqHeader, rows.map(rfqRow));
      add("Təkliflər", offerHeader, offerRows);
      add("Statuslar", ["RFQ", "Daşıyıcı", "Status"], statusRows);
      const data = new Uint8Array(await wb.xlsx.writeBuffer());
      download = await saveDownload(ctx, "export", 0, `${base}.xlsx`, XLSX, data);
    } else {
      const pdf = await renderPdf(
        (doc) => {
          doc.font("bold").fontSize(16).text(`${p.rfq_id ? `RFQ #${p.rfq_id}` : "RFQ-lər"} · ${stamp}`).moveDown(0.5);
          table(doc, rfqHeader, rows.map((r) => rfqRow(r).map(String)), [5, 10, 10, 10, 7, 8, 8, 6, 9, 9, 6, 9]);
          if (offerRows.length) {
            doc.moveDown().font("bold").fontSize(12).text("Təkliflər").moveDown(0.3);
            table(doc, offerHeader, offerRows.map((r) => r.map(String)), [5, 14, 6, 8, 6, 7, 9, 20, 5]);
          }
        },
        { landscape: true },
      );
      download = await saveDownload(ctx, "export", 0, `${base}.pdf`, "application/pdf", pdf);
    }
    return { rfqs: rows.length, offers: offerRows.length, format: p.format, download };
  },
};

import ExcelJS from "exceljs";
import { db, now } from "../db";
import { currentUserId } from "../auth/current";
import { statusLabels, type DispatchStatus } from "../domain/dispatches";
import { latestOffers, type Offer } from "../domain/offers";
import { bestPrice, rfqStatusLabels } from "../domain/rfqOverview";
import { getRfq, type Rfq } from "../domain/rfqs";
import { renderPdf, table } from "./pdf";

/** The report of the user's RFQs: an Excel workbook (chat tool and panel button) or a PDF. */

export const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Delivery funnel of one RFQ: each stage also counts the carriers that went further (as on the dashboard). */
export interface Funnel {
  sent: number;
  delivered: number;
  viewed: number;
  offered: number;
  failed: number;
}

export interface ReportRow {
  rfq: Rfq;
  dispatches: { carrier: string; status: string }[];
  funnel: Funnel;
  offers: (Offer & { carrier_name: string })[];
  best: { price: number; currency: string } | null;
  winner: { carrier: string; price: number; currency: string } | null;
}

function funnelOf(rows: { status: DispatchStatus; viewed_at: string | null; accepted: unknown }[]): Funnel {
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  return {
    // A bounced email that the provider accepted was still sent (it is also counted as failed).
    sent: count((r) => r.status !== "failed" || Boolean(Number(r.accepted))),
    delivered: count((r) => ["delivered", "viewed", "offered"].includes(r.status)),
    viewed: count((r) => ["viewed", "offered"].includes(r.status) || (r.viewed_at !== null && r.status !== "failed")),
    offered: count((r) => r.status === "offered"),
    failed: count((r) => r.status === "failed"),
  };
}

/** One RFQ (rfqId), or every RFQ of the signed-in user with the given status ("all" = every one), oldest first. */
export async function collectReport(rfqId: number, status = "all"): Promise<ReportRow[]> {
  const user = currentUserId();
  const rfqs = rfqId
    ? [await getRfq(rfqId)]
    : await db().all<Rfq>(
        `SELECT * FROM rfqs WHERE user_id = ? ${status === "all" ? "" : "AND status = ?"} ORDER BY id`,
        user, ...(status === "all" ? [] : [status]),
      );
  const rows: ReportRow[] = [];
  for (const rfq of rfqs) {
    const dispatches = await db().all<{ name: string; status: DispatchStatus; viewed_at: string | null; accepted: unknown }>(
      `SELECT c.name, d.status, d.viewed_at,
              EXISTS (SELECT 1 FROM outbox o WHERE o.dispatch_id = d.id AND o.provider_id IS NOT NULL) AS accepted
       FROM dispatches d JOIN carriers c ON c.id = d.carrier_id WHERE d.rfq_id = ? AND c.user_id = ? ORDER BY c.name, c.id`,
      rfq.id, user,
    );
    const offers = await latestOffers(rfq.id);
    const winner = rfq.awarded_offer_id
      ? await db().get<{ carrier: string; price: number; currency: string }>(
          `SELECT c.name AS carrier, o.price, o.currency FROM offers o JOIN carriers c ON c.id = o.carrier_id
           WHERE o.id = ? AND c.user_id = ?`,
          rfq.awarded_offer_id, user,
        )
      : undefined;
    rows.push({
      rfq,
      dispatches: dispatches.map((d) => ({ carrier: d.name, status: statusLabels[d.status] ?? d.status })),
      funnel: funnelOf(dispatches),
      offers,
      best: bestPrice(rfq, offers),
      winner: winner ?? null,
    });
  }
  return rows;
}

const price = (p: { price: number; currency: string } | null) => (p ? `${p.price} ${p.currency}` : "");

const rfqHeader = [
  "RFQ", "Yaradılıb", "Haradan", "Haraya", "Yük", "Çəki (kq)", "Nəqliyyat", "Yükləmə", "Son tarix", "Valyuta", "Status",
  "Göndərilib", "Çatdırılıb", "Baxılıb", "Təklif verib", "Çatdırılmadı", "Təklif sayı", "Ən ucuz", "Qalib",
];
const rfqRow = (r: ReportRow): (string | number)[] => [
  `#${r.rfq.id}`, r.rfq.created_at.slice(0, 10), r.rfq.origin, r.rfq.destination, r.rfq.cargo_type, r.rfq.weight_kg,
  r.rfq.transport_type, r.rfq.loading_date || "çevik", r.rfq.offer_deadline, r.rfq.currency,
  rfqStatusLabels[r.rfq.status] ?? r.rfq.status,
  r.funnel.sent, r.funnel.delivered, r.funnel.viewed, r.funnel.offered, r.funnel.failed, r.offers.length,
  price(r.best), r.winner ? `${r.winner.carrier}, ${price(r.winner)}` : "",
];

const offerHeader = ["RFQ", "Daşıyıcı", "Təklif / versiya", "Qiymət", "Valyuta", "Tranzit (gün)", "Etibarlıdır", "Alınıb", "Qeydlər", "Qalib"];
const offerRows = (rows: ReportRow[]) =>
  rows.flatMap((r) =>
    r.offers.map((o) => [
      `#${r.rfq.id}`, o.carrier_name, `№${o.offer_no} v${o.version}`, o.price, o.currency, o.transit_days, o.valid_until,
      o.created_at.slice(0, 10), o.notes, Number(r.rfq.awarded_offer_id) === Number(o.id) ? "✓" : "",
    ]),
  );

/** Totals over the whole report, for its first sheet. */
function totals(rows: ReportRow[]): [string, string | number][] {
  const by = (s: string) => rows.filter((r) => r.rfq.status === s).length;
  const sum = (k: keyof Funnel) => rows.reduce((a, r) => a + r.funnel[k], 0);
  const dates = rows.map((r) => r.rfq.created_at.slice(0, 10)).sort();
  return [
    ["Hesabat tarixi", now().slice(0, 10)],
    ["Dövr", dates.length ? `${dates[0]} — ${dates[dates.length - 1]}` : ""],
    ["RFQ sayı", rows.length],
    [rfqStatusLabels.open, by("open")],
    [rfqStatusLabels.awarded, by("awarded")],
    [rfqStatusLabels.closed, by("closed")],
    ["Daşıyıcılara göndərilib", sum("sent")],
    ["Çatdırılıb", sum("delivered")],
    ["Baxılıb", sum("viewed")],
    ["Təklif verib", sum("offered")],
    ["Çatdırılmadı", sum("failed")],
    ["Alınan təkliflər", rows.reduce((a, r) => a + r.offers.length, 0)],
  ];
}

export async function reportWorkbook(rows: ReportRow[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const add = (name: string, header: string[], data: (string | number)[][], width = 16) => {
    const ws = wb.addWorksheet(name);
    ws.addRow(header).font = { bold: true };
    ws.addRows(data);
    ws.columns.forEach((c) => (c.width = width));
    ws.views = [{ state: "frozen", ySplit: 1 }];
    return ws;
  };
  add("Xülasə", ["Göstərici", "Dəyər"], totals(rows), 26);
  add("RFQ-lər", rfqHeader, rows.map(rfqRow));
  add("Təkliflər", offerHeader, offerRows(rows));
  add("Statuslar", ["RFQ", "Daşıyıcı", "Status"], rows.flatMap((r) => r.dispatches.map((d) => [`#${r.rfq.id}`, d.carrier, d.status])));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const pdfHeader = ["RFQ", "Yaradılıb", "Marşrut", "Yük", "Status", "Göndərilib", "Təklif verib", "Təklif sayı", "Ən ucuz", "Qalib"];
const pdfRow = (r: ReportRow): string[] => [
  `#${r.rfq.id}`, r.rfq.created_at.slice(0, 10), `${r.rfq.origin} → ${r.rfq.destination}`,
  `${r.rfq.cargo_type}, ${r.rfq.weight_kg} kq`, rfqStatusLabels[r.rfq.status] ?? r.rfq.status,
  String(r.funnel.sent), String(r.funnel.offered), String(r.offers.length), price(r.best),
  r.winner ? `${r.winner.carrier}, ${price(r.winner)}` : "",
];

export function reportPdf(rows: ReportRow[], title: string): Promise<Buffer> {
  const offers = offerRows(rows);
  return renderPdf(
    (doc) => {
      doc.font("bold").fontSize(16).text(title).moveDown(0.5);
      table(doc, pdfHeader, rows.map(pdfRow), [4, 7, 14, 10, 8, 6, 6, 6, 8, 12]);
      if (offers.length) {
        doc.moveDown().font("bold").fontSize(12).text("Təkliflər").moveDown(0.3);
        table(doc, offerHeader, offers.map((r) => r.map(String)), [5, 14, 6, 8, 6, 7, 9, 8, 18, 5]);
      }
    },
    { landscape: true },
  );
}

export function offerCount(rows: ReportRow[]): number {
  return rows.reduce((a, r) => a + r.offers.length, 0);
}

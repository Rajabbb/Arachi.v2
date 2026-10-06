import { db, now } from "../db";

export const transportTypes = ["Quru", "Dəniz", "Hava", "Dəmiryolu"] as const;
export const currencies = ["USD", "EUR"] as const;
export type Currency = (typeof currencies)[number];

/** open → awarded (winner picked) or closed. */
export type RfqStatus = "open" | "awarded" | "closed";

export interface Rfq {
  id: number;
  origin: string;
  destination: string;
  cargo_type: string;
  weight_kg: number;
  volume_m3: number;
  pallets: number;
  transport_type: string;
  loading_date: string;
  delivery_date: string;
  currency: Currency;
  offer_deadline: string;
  notes: string;
  source: string;
  status: RfqStatus;
  created_at: string;
  awarded_offer_id: number | null;
  awarded_at: string | null;
}

export type NewRfq = Omit<Rfq, "id" | "status" | "created_at" | "awarded_offer_id" | "awarded_at">;

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export function checkDate(label: string, value: string) {
  if (value && (!isoDate.test(value) || Number.isNaN(Date.parse(value)))) {
    throw new Error(`${label} YYYY-MM-DD formatında olmalıdır: "${value}"`);
  }
}

export function addDays(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function insertRfq(input: NewRfq): Promise<Rfq> {
  if (!input.origin.trim() || !input.destination.trim()) {
    throw new Error("Yükləmə və boşaltma yeri boş ola bilməz.");
  }
  if (!input.cargo_type.trim()) throw new Error("Yükün növü boş ola bilməz.");
  if (!(input.weight_kg > 0)) throw new Error("Çəki (kq) müsbət olmalıdır.");
  if (input.volume_m3 < 0 || input.pallets < 0) {
    throw new Error("Həcm və palet sayı mənfi ola bilməz.");
  }
  checkDate("Yükləmə tarixi", input.loading_date);
  checkDate("Çatdırılma tarixi", input.delivery_date);
  checkDate("Təklif son tarixi", input.offer_deadline);

  const inserted = await db().get<{ id: number }>(
    `INSERT INTO rfqs (origin, destination, cargo_type, weight_kg, volume_m3, pallets,
       transport_type, loading_date, delivery_date, currency, offer_deadline, notes, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    input.origin.trim(),
    input.destination.trim(),
    input.cargo_type.trim(),
    input.weight_kg,
    input.volume_m3,
    input.pallets,
    input.transport_type,
    input.loading_date,
    input.delivery_date,
    input.currency,
    input.offer_deadline,
    input.notes,
    input.source,
    now(),
  );
  return getRfq(inserted!.id);
}

export function findRfq(id: number): Promise<Rfq | undefined> {
  return db().get<Rfq>("SELECT * FROM rfqs WHERE id = ?", id);
}

export async function getRfq(id: number): Promise<Rfq> {
  const rfq = await findRfq(id);
  if (!rfq) throw new Error(`RFQ #${id} tapılmadı.`);
  return rfq;
}

/** One-line description used in messages, e.g. "RFQ #3: Bakı → İstanbul, Tekstil, 12000 kq". */
export function rfqTitle(rfq: Rfq): string {
  return `RFQ #${rfq.id}: ${rfq.origin} → ${rfq.destination}, ${rfq.cargo_type}, ${rfq.weight_kg} kq`;
}

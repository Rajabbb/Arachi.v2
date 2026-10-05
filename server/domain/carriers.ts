import { db, now } from "../db";

export const carrierCategories = ["Quru", "Dəniz", "Hava", "Dəmiryolu"] as const;

export interface Carrier {
  id: number;
  name: string;
  email: string | null;
  phone: string;
  whatsapp: string;
  telegram: string;
  category: string;
  subcategory: string;
  language: "az" | "en";
  active: number;
  created_at: string;
}

export interface CarrierInput {
  name: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  telegram?: string;
  category?: string;
  subcategory?: string;
  language?: string;
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeCategory(value: string | undefined, fallback: string): string {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return fallback;
  const exact = carrierCategories.find((c) => c.toLowerCase() === v);
  if (exact) return exact;
  if (/d[əe]niz|sea/.test(v)) return "Dəniz";
  if (/hava|air|avia/.test(v)) return "Hava";
  if (/d[əe]mir|rail/.test(v)) return "Dəmiryolu";
  if (/quru|road|truck|avto/.test(v)) return "Quru";
  return fallback;
}

export type UpsertOutcome = "added" | "updated" | "skipped";

/**
 * Adds a carrier, or updates the existing one with the same email. Returns
 * "skipped" with a reason when the row is unusable.
 */
export function upsertCarrier(
  input: CarrierInput,
  defaults: { category: string; language: string },
): { outcome: UpsertOutcome; carrier?: Carrier; reason?: string } {
  const name = input.name?.trim();
  const email = input.email?.trim().toLowerCase() || null;
  if (!name) return { outcome: "skipped", reason: "ad yoxdur" };
  if (email && !emailRe.test(email)) return { outcome: "skipped", reason: `yanlış email: ${email}` };
  const contact = [email, input.phone, input.whatsapp, input.telegram].some((v) => v && v.trim());
  if (!contact) return { outcome: "skipped", reason: "əlaqə məlumatı yoxdur" };

  const row = {
    name,
    email,
    phone: input.phone?.trim() ?? "",
    whatsapp: input.whatsapp?.trim() ?? "",
    telegram: input.telegram?.trim() ?? "",
    category: normalizeCategory(input.category, defaults.category),
    subcategory: input.subcategory?.trim() ?? "",
    language: input.language?.trim().toLowerCase() === "en" ? "en" : defaults.language,
  };

  const existing = email
    ? (db().prepare("SELECT id FROM carriers WHERE lower(email) = ?").get(email) as { id: number } | undefined)
    : undefined;

  if (existing) {
    db()
      .prepare(
        `UPDATE carriers SET name = ?, phone = coalesce(nullif(?, ''), phone),
           whatsapp = coalesce(nullif(?, ''), whatsapp), telegram = coalesce(nullif(?, ''), telegram),
           category = ?, subcategory = coalesce(nullif(?, ''), subcategory), language = ?, active = 1
         WHERE id = ?`,
      )
      .run(row.name, row.phone, row.whatsapp, row.telegram, row.category, row.subcategory, row.language, existing.id);
    return { outcome: "updated", carrier: getCarrier(existing.id) };
  }

  const { lastInsertRowid } = db()
    .prepare(
      `INSERT INTO carriers (name, email, phone, whatsapp, telegram, category, subcategory, language, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.name, row.email, row.phone, row.whatsapp, row.telegram, row.category, row.subcategory, row.language, now());
  return { outcome: "added", carrier: getCarrier(Number(lastInsertRowid)) };
}

export function getCarrier(id: number): Carrier {
  const carrier = db().prepare("SELECT * FROM carriers WHERE id = ?").get(id) as Carrier | undefined;
  if (!carrier) throw new Error(`Daşıyıcı #${id} tapılmadı.`);
  return carrier;
}

export function findCarriers(filter: { category?: string; subcategory?: string; ids?: number[] }): Carrier[] {
  const where = ["active = 1"];
  const args: (string | number)[] = [];
  if (filter.category) {
    where.push("category = ?");
    args.push(filter.category);
  }
  if (filter.subcategory) {
    where.push("lower(subcategory) = lower(?)");
    args.push(filter.subcategory);
  }
  if (filter.ids) {
    if (filter.ids.length === 0) return [];
    where.push(`id IN (${filter.ids.map(() => "?").join(",")})`);
    args.push(...filter.ids);
  }
  return db()
    .prepare(`SELECT * FROM carriers WHERE ${where.join(" AND ")} ORDER BY name`)
    .all(...args) as unknown as Carrier[];
}

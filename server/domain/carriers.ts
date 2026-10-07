import { db, now } from "../db";
import { currentUserId } from "../auth/current";

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

/** Lower case without accents, so "DƏNİZ", "Dəniz" and "deniz" compare equal. */
export function fold(value: string): string {
  return value
    .toLocaleLowerCase("az")
    .replace(/ə/g, "e")
    .replace(/ı/g, "i")
    .replace(/ё/g, "е")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Words that name a category, in Azerbaijani, English, Russian and Turkish
 * (folded, see fold()). Short words must match a whole word, longer ones
 * the start of a word ("havayolu", "морской").
 */
const categoryWords: [string, string[]][] = [
  ["Dəniz", ["deniz", "sea", "ocean", "marin", "maritim", "ship", "gemi", "konteyner", "container", "fcl", "lcl", "vessel", "морск", "море", "контейнер", "судн"]],
  ["Hava", ["hava", "air", "avia", "aero", "teyyare", "plane", "flight", "авиа", "воздуш", "самолет"]],
  ["Dəmiryolu", ["demir", "rail", "train", "qatar", "vaqon", "wagon", "жд", "железн", "вагон", "поезд"]],
  ["Quru", ["quru", "road", "truck", "avto", "auto", "tir", "fura", "ftl", "ltl", "karayol", "land", "авто", "фура", "грузов", "дорог"]],
];

/** The category a free-text value names ("sea", "Dəniz yolu", "Авиа"), or null when it names none. */
export function matchCategory(value: string | undefined): string | null {
  const words = fold((value ?? "").replace(/ж\s*\/?\s*д/gi, "жд")).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const word of words) {
    for (const [category, keys] of categoryWords) {
      if (keys.some((k) => (k.length <= 3 ? word === k : word.startsWith(k)))) return category;
    }
  }
  return null;
}

export function normalizeCategory(value: string | undefined, fallback: string): string {
  return matchCategory(value) ?? fallback;
}

/** How one row of carriers to add is checked before saving (see saveCarriers). */
interface Known {
  id: number;
  name: string;
  email: string | null;
  active: number;
  /** Row number in this batch, for carriers added by an earlier row of it. */
  row?: number;
}

export interface SaveSummary {
  /** Rows given. */
  rows: number;
  added: number;
  /** Removed carriers that came back (same name and email). */
  restored: number;
  /** New carriers per category, so the user sees how they were grouped. */
  by_category: { category: string; subcategory: string; count: number }[];
  /** Rows not saved and why: already in the base, a name/email conflict, a repeat in the same list, bad data. */
  skipped: { row: number; name: string; email: string; reason: string }[];
  /** Set when some carriers had no category anywhere and got the fallback one. */
  category_defaulted?: { count: number; category: string; names: string[] };
  /** Category values that name no known category; the value was kept as the subcategory. */
  category_not_recognized?: { row: number; name: string; value: string; saved_as: string }[];
  note?: string;
}

/**
 * Adds carriers without ever creating a second copy of one: a row is skipped
 * when its email or its name (case-insensitive) already belongs to one of the
 * user's carriers or to an earlier row. A name that matches with another email
 * (or an email that matches with another name) is a conflict and is skipped
 * too; nothing existing is overwritten. A removed carrier with the same name
 * and email is restored. Each row keeps its own category; only rows with none
 * get defaults.category.
 */
export async function saveCarriers(
  rows: CarrierInput[],
  defaults: { category: string; language: string },
): Promise<SaveSummary> {
  const summary: SaveSummary = { rows: rows.length, added: 0, restored: 0, by_category: [], skipped: [] };
  const known = await db().all<Known>(
    "SELECT id, name, email, active FROM carriers WHERE user_id = ? ORDER BY active DESC, id",
    currentUserId(),
  );
  const defaulted: string[] = [];
  const notRecognized: NonNullable<SaveSummary["category_not_recognized"]> = [];
  const fallback = matchCategory(defaults.category) ?? "Quru";

  for (const [i, input] of rows.entries()) {
    const rowNo = i + 1;
    const name = (input.name ?? "").trim().replace(/\s+/g, " ");
    const email = input.email?.trim().toLowerCase() || null;
    const skip = (reason: string) => summary.skipped.push({ row: rowNo, name, email: email ?? "", reason });

    if (!name) { skip("ad yoxdur"); continue; }
    if (email && !emailRe.test(email)) { skip(`yanlış email: ${email}`); continue; }
    const contact = [email, input.phone, input.whatsapp, input.telegram].some((v) => v && v.trim());
    if (!contact) { skip("əlaqə məlumatı yoxdur"); continue; }

    const byEmail = email ? known.find((k) => k.email?.toLowerCase() === email) : undefined;
    const byName = known.find((k) => fold(k.name) === fold(name));
    const where = (k: Known) => (k.row ? `bu siyahının ${k.row}-ci sətrində` : k.active ? "bazada" : "silinmiş daşıyıcılarda");

    if (byEmail && fold(byEmail.name) !== fold(name)) {
      skip(`bu email ${where(byEmail)} «${byEmail.name}» adı ilə var`);
      continue;
    }
    if (!byEmail && byName && (byName.email || email)) {
      skip(
        byName.email
          ? `bu ad ${where(byName)} başqa email ilə var (${byName.email})`
          : `bu ad ${where(byName)} email-siz var`,
      );
      continue;
    }
    const same = byEmail ?? byName;
    if (same && (same.active || same.row)) {
      skip(same.row ? `bu siyahıda təkrarlanır (${same.row}-ci sətir)` : "artıq bazada var");
      continue;
    }

    let category = matchCategory(input.category);
    let subcategory = (input.subcategory ?? "").trim();
    const rawCategory = (input.category ?? "").trim();
    if (!category) {
      category = fallback;
      if (rawCategory) {
        if (!subcategory) subcategory = rawCategory;
        notRecognized.push({ row: rowNo, name, value: rawCategory, saved_as: `${category}${subcategory ? ` / ${subcategory}` : ""}` });
      } else defaulted.push(name);
    }
    const row = {
      name,
      email,
      phone: input.phone?.trim() ?? "",
      whatsapp: input.whatsapp?.trim() ?? "",
      telegram: input.telegram?.trim() ?? "",
      category,
      subcategory,
      language: input.language?.trim().toLowerCase() === "en" ? "en" : defaults.language,
    };

    if (same) {
      // A removed carrier with the same name and email: bring it back with the new details.
      await db().run(
        `UPDATE carriers SET name = ?, phone = coalesce(nullif(?, ''), phone),
           whatsapp = coalesce(nullif(?, ''), whatsapp), telegram = coalesce(nullif(?, ''), telegram),
           category = ?, subcategory = ?, language = ?, active = 1
         WHERE id = ? AND user_id = ?`,
        row.name, row.phone, row.whatsapp, row.telegram, row.category, row.subcategory, row.language, same.id, currentUserId(),
      );
      same.row = rowNo;
      summary.restored++;
    } else {
      const inserted = await db().get<{ id: number }>(
        `INSERT INTO carriers (name, email, phone, whatsapp, telegram, category, subcategory, language, created_at, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        row.name, row.email, row.phone, row.whatsapp, row.telegram, row.category, row.subcategory, row.language, now(),
        currentUserId(),
      );
      known.push({ id: inserted!.id, name, email, active: 1, row: rowNo });
      summary.added++;
    }
    const group = summary.by_category.find((g) => g.category === category && g.subcategory === subcategory);
    if (group) group.count++;
    else summary.by_category.push({ category, subcategory, count: 1 });
  }

  if (defaulted.length > 0) {
    summary.category_defaulted = { count: defaulted.length, category: fallback, names: defaulted };
  }
  if (notRecognized.length > 0) summary.category_not_recognized = notRecognized;
  if (defaulted.length > 0 || notRecognized.length > 0) {
    summary.note =
      `Kateqoriyası göstərilməyən və ya tanınmayan daşıyıcılar «${fallback}» kateqoriyasına yazıldı; ` +
      "update_carriers ilə dəyişmək olar.";
  }
  return summary;
}

export interface CarrierChanges {
  name?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  telegram?: string;
  category?: string;
  subcategory?: string;
  language?: string;
}

/**
 * Changes the given fields of one carrier; empty fields stay as they are.
 * Refuses a name or email that another of the user's carriers already has.
 */
export async function updateCarrier(id: number, changes: CarrierChanges): Promise<Carrier> {
  const carrier = await getCarrier(id);
  const set: Record<string, string> = {};
  const name = changes.name?.trim().replace(/\s+/g, " ");
  const email = changes.email?.trim().toLowerCase();
  if (name) set.name = name;
  if (email) {
    if (!emailRe.test(email)) throw new Error(`Yanlış email: ${email}`);
    set.email = email;
  }
  if (name || email) {
    const others = await db().all<{ name: string; email: string | null }>(
      "SELECT name, email FROM carriers WHERE user_id = ? AND id <> ?",
      currentUserId(), id,
    );
    const clash = others.find((o) => (name && fold(o.name) === fold(name)) || (email && o.email?.toLowerCase() === email));
    if (clash) throw new Error(`«${clash.name}» (${clash.email ?? "email-siz"}) artıq bu ad və ya email ilə bazadadır.`);
  }
  if (changes.category?.trim()) {
    const category = matchCategory(changes.category);
    if (!category) throw new Error(`Kateqoriya tanınmadı: ${changes.category}. Mümkün olanlar: ${carrierCategories.join(", ")}.`);
    set.category = category;
  }
  if (changes.subcategory !== undefined && changes.subcategory !== "") {
    // "-" clears the subcategory.
    set.subcategory = changes.subcategory.trim() === "-" ? "" : changes.subcategory.trim();
  }
  for (const key of ["phone", "whatsapp", "telegram"] as const) {
    if (changes[key]?.trim()) set[key] = changes[key]!.trim();
  }
  if (changes.language?.trim()) set.language = changes.language.trim().toLowerCase() === "en" ? "en" : "az";
  const keys = Object.keys(set);
  if (keys.length > 0) {
    await db().run(
      `UPDATE carriers SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND user_id = ?`,
      ...keys.map((k) => set[k]), carrier.id, currentUserId(),
    );
  }
  return getCarrier(id);
}

/** The current user's carrier; another user's carrier is "not found". */
export async function getCarrier(id: number): Promise<Carrier> {
  const carrier = await db().get<Carrier>("SELECT * FROM carriers WHERE id = ? AND user_id = ?", id, currentUserId());
  if (!carrier) throw new Error(`Daşıyıcı #${id} tapılmadı.`);
  return carrier;
}

export async function findCarriers(filter: { category?: string; subcategory?: string; ids?: number[] }): Promise<Carrier[]> {
  const where = ["active = 1", "user_id = ?"];
  const args: (string | number)[] = [currentUserId()];
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
  return db().all<Carrier>(`SELECT * FROM carriers WHERE ${where.join(" AND ")} ORDER BY name, id`, ...args);
}

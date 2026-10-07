import { categoryName, fold, isCategoryLabel, matchCategory, type CarrierInput } from "../../domain/carriers";

/**
 * Reading carriers out of what the user gave: a table (Excel/CSV) with or
 * without a recognisable header, or a list typed in chat. Used by
 * import_carriers, and by add_carriers to repair what the model passed.
 */

type Field = keyof CarrierInput;
export type ColumnMap = Partial<Record<Field, number>>;

/** Header words, folded (see fold()), so "ŞİRKƏT", "Şirkət" and "sirket" all match. */
const headerAliases: Record<Field, RegExp> = {
  name: /(^ad\b|^adi\b|name|sirket|firma|kompaniya|company|dasiyici|carrier|teskilat|organi[sz]ation|название|наименование|компания|фирма|перевозчик)/,
  email: /(e-?mail|e-?poct|почта)/,
  phone: /^(phone|tel|mobil|телефон|моб)/,
  whatsapp: /(whats ?app|ватсап|вотсап)/,
  telegram: /(telegram|телеграм)/,
  subcategory: /(alt ?kateqoriya|subcategory|sub-category|подкатегор|xett|line|route|marsrut|istiqamet|маршрут|направлен)/,
  category: /(kateqoriya|category|\bnov|type|категор|вид|тип)/,
  language: /^(dil|language|lang|язык)/,
};

/** Maps a header row to carrier fields; returns null when no name/email column is found. */
export function mapHeader(header: string[]): ColumnMap | null {
  const map: ColumnMap = {};
  header.forEach((cell, i) => {
    const c = fold(cell ?? "");
    if (!c || c.includes("@")) return;
    // Check subcategory before category: "alt kateqoriya" also contains "kateqoriya".
    for (const key of ["subcategory", "whatsapp", "telegram", "email", "phone", "category", "language", "name"] as const) {
      if (map[key] === undefined && headerAliases[key].test(c)) {
        map[key] = i;
        return;
      }
    }
  });
  return map.name !== undefined || map.email !== undefined ? map : null;
}

const emailRe = /[^\s@<>()[\],;:"'|]+@[^\s@<>()[\],;:"'|]+\.[a-z]{2,}/gi;
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const isPhone = (v: string) => /^\+?[\d\s().-]+$/.test(v.trim()) && v.replace(/\D/g, "").length >= 7;

/** Words that may stand next to a category word: "Dəniz yolu", "Sea freight", "Hava daşıyıcıları". */
const categoryFiller = ["yol", "dasi", "freight", "cargo", "kargo", "transport", "neqliyyat", "logistic", "перевоз", "достав", "груз"];

/** A cell that only names a category ("Dəniz", "Sea freight"), unlike a name that contains one ("Blue Sea Shipping"). */
export function isCategoryCell(value: string): boolean {
  const words = fold(value).replace(/[:.]+$/, "").split(/[^\p{L}\p{N}/]+/u).filter(Boolean);
  if (words.length === 0 || words.length > 3 || !matchCategory(value)) return false;
  return words.every((w) => matchCategory(w) || categoryFiller.some((f) => w.startsWith(f)));
}

/** Category words a typed line may end with after the name: "Asim Logistics Dəniz". */
const trailingCategory = new Set(["quru", "deniz", "hava", "demiryolu", "sea", "air", "road", "rail", "avia", "авиа", "море", "жд"]);

/** Labels typed before a value ("Ad: Asim", "email: a@x.az"); never a carrier's name. */
const labels = /^(ad|adi|name|email|e-?mail|emaili|e-?poct|poct|tel|telefon|phone|kateqoriya|kateqoriyasi|category|sirket|company|название|почта|телефон|категория)$/;

/**
 * Columns of a table found by their content, for tables whose header is
 * missing or not recognised: emails, phone numbers, category words, and the
 * first text column as the name. `taken` columns are left out.
 */
export function contentColumns(rows: string[][], taken: ColumnMap = {}): ColumnMap {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const used = new Set(Object.values(taken));
  const map: ColumnMap = {};
  const share = (i: number, test: (v: string) => boolean) => {
    const values = rows.map((r) => (r[i] ?? "").trim()).filter(Boolean);
    return values.length === 0 ? 0 : values.filter(test).length / values.length;
  };
  const pick = (field: Field, test: (v: string) => boolean) => {
    if (taken[field] !== undefined) return;
    let best = -1;
    let bestShare = 0.5;
    for (let i = 0; i < width; i++) {
      if (used.has(i)) continue;
      const s = share(i, test);
      if (s >= bestShare && (best < 0 || s > bestShare)) {
        best = i;
        bestShare = s;
      }
    }
    if (best >= 0) {
      map[field] = best;
      used.add(best);
    }
  };
  pick("email", isEmail);
  pick("phone", isPhone);
  pick("category", isCategoryCell);
  if (taken.name === undefined) {
    for (let i = 0; i < width; i++) {
      if (used.has(i)) continue;
      if (share(i, (v) => /\p{L}/u.test(v) && !v.includes("@") && !isPhone(v)) >= 0.5) {
        map.name = i;
        break;
      }
    }
  }
  return map;
}

/**
 * Carrier rows of one table. The header may sit under a title row, or be
 * missing: columns the header doesn't name are found by their content. Without
 * a category column, the category comes from a section row that only names
 * one ("Dəniz daşıyıcıları") or from the sheet name ("Hava").
 */
export function tableCarriers(sheet: string, rows: string[][]): CarrierInput[] | null {
  // A title row above the header ("Daşıyıcılar") can look like a one-column header; prefer a fuller row.
  const first = rows.slice(0, 5);
  const columns = (r: string[]) => Object.keys(mapHeader(r) ?? {}).length;
  const fuller = first.findIndex((r) => columns(r) >= 2);
  const headerAt = fuller >= 0 ? fuller : first.findIndex((r) => columns(r) > 0);
  const data = rows.slice(headerAt + 1);
  const header = headerAt >= 0 ? mapHeader(rows[headerAt])! : {};
  const map: ColumnMap = { ...header, ...contentColumns(data, header) };
  if (map.name === undefined && map.email === undefined) return null;

  let section = map.category === undefined ? matchCategory(sheet) ?? undefined : undefined;
  const inputs: CarrierInput[] = [];
  for (const r of data) {
    const filled = r.map((c) => (c ?? "").trim()).filter(Boolean);
    if (filled.length === 1 && Object.keys(map).length >= 2 && (isCategoryCell(filled[0]) || isCategoryLabel(filled[0]))) {
      if (map.category === undefined) section = categoryName(filled[0])!;
      continue;
    }
    // A title or note row ("Daşıyıcılar"), not a carrier.
    if (filled.length === 1 && !isEmail(filled[0]) && !isPhone(filled[0])) continue;
    const get = (k: Field) => (map[k] === undefined ? undefined : (r[map[k]!] ?? "").trim());
    const name = get("name");
    inputs.push({
      name: name && !isEmail(name) ? name : name || get("email") || "",
      email: get("email") || (name && isEmail(name) ? name : undefined),
      phone: get("phone"),
      whatsapp: get("whatsapp"),
      telegram: get("telegram"),
      category: get("category") || section,
      subcategory: get("subcategory"),
      language: get("language"),
    });
  }
  return inputs;
}

/**
 * Carriers typed in chat, one per line, in whatever form people type them:
 * "Asim Logistics - asim@x.az - Dəniz", "Asim Logistics, asim@x.az, +994 50 111 22 33",
 * "1. Asim Logistics asim@x.az Hava", "Ad: Asim, email: asim@x.az". A line
 * naming only a category ("Dəniz daşıyıcıları:", "A kateqoriyası:") sets the
 * category of the lines after it. A short value after the name is the
 * category ("Ogullar - o@x.az - A"). Lines with neither an email nor a phone are not carriers.
 */
export function parseCarrierLines(text: string): CarrierInput[] {
  const out: CarrierInput[] = [];
  let section: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (!line) continue;
    const emails = line.match(emailRe) ?? [];
    const cells = line
      .replace(emailRe, "\t")
      .split(/\s*[\t;|,]\s*|\s+[-–—]\s+|\s*:\s+/)
      .map((c) => c.trim().replace(/^[-–—:<>()\s]+|[-–—:<>()\s]+$/g, "").trim())
      .filter(Boolean);

    const phones = cells.filter(isPhone);
    if (emails.length === 0 && phones.length === 0) {
      const only = cells.length === 1 ? cells[0] : "";
      if (only && (isCategoryCell(only) || isCategoryLabel(only))) section = categoryName(only)!;
      continue;
    }

    let name: string | undefined;
    let category: string | undefined;
    let categoryNext = false;
    for (const cell of cells) {
      if (isPhone(cell)) continue;
      if (labels.test(fold(cell))) {
        // "kateqoriya: A": the next value is the category.
        categoryNext = /^(kateqoriya|category|категория)/.test(fold(cell));
        continue;
      }
      if (!category && (categoryNext || isCategoryCell(cell) || isCategoryLabel(cell))) {
        category = cell;
        categoryNext = false;
        continue;
      }
      if (name) {
        // "Ogullar - o@x.az - A": a short value after the name is its category.
        if (!category && cell.split(/\s+/).length <= 3) category = cell;
        continue;
      }
      // "Asim Logistics Dəniz": a category word typed after the name.
      const words = cell.split(/\s+/);
      const last = fold(words[words.length - 1]);
      if (!category && words.length > 1 && trailingCategory.has(last)) {
        category = words.pop();
        name = words.join(" ");
      } else name = cell;
    }
    out.push({ name: name ?? emails[0] ?? "", email: emails[0], phone: phones[0], category: category ?? section });
  }
  return out;
}

/**
 * A carrier as the model passed it, corrected from what the user actually
 * typed or attached: a missing name, or the email used as the name, is
 * replaced by the name next to that email; a category the user wrote for that
 * carrier wins over the model's.
 */
export function repairCarrier(carrier: CarrierInput, sources: CarrierInput[]): CarrierInput {
  const email = carrier.email?.trim().toLowerCase() || (carrier.name && isEmail(carrier.name) ? carrier.name.trim().toLowerCase() : "");
  const source =
    (email && sources.find((s) => s.email?.trim().toLowerCase() === email)) ||
    (carrier.name?.trim() && sources.find((s) => fold(s.name) === fold(carrier.name)));
  if (!source) return carrier;
  const badName = !carrier.name?.trim() || carrier.name.includes("@");
  const sourceName = source.name && !source.name.includes("@") ? source.name : "";
  return {
    ...carrier,
    name: badName && sourceName ? sourceName : carrier.name,
    email: carrier.email || source.email || email || undefined,
    phone: carrier.phone || source.phone,
    category: source.category?.trim() ? source.category : carrier.category,
    subcategory: carrier.subcategory || source.subcategory,
  };
}

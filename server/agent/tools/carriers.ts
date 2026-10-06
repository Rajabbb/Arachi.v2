import type { AgentTool } from "./registry";
import type { UploadedFile } from "../../../shared/protocol";
import {
  carrierCategories, findCarriers, matchCategory, saveCarriers, updateCarrier, type CarrierInput,
} from "../../domain/carriers";
import { isSpreadsheet, readSpreadsheet } from "../files";
import { db } from "../../db";
import { currentUserId } from "../../auth/current";

/** Process 4: the carrier base (manual add, XLS/CSV import, categories). */

const carrierSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    email: { type: "string" },
    phone: { type: "string" },
    whatsapp: { type: "string" },
    telegram: { type: "string" },
    category: {
      type: "string",
      description:
        "This carrier's own category (Quru, Dəniz, Hava or Dəmiryolu) when the user gave one for it; carriers in one list may have different categories.",
    },
    subcategory: { type: "string", description: "e.g. Türkiyə xətti, Avropa." },
    language: { type: "string", enum: ["az", "en"] },
  },
  required: ["name"],
};

const defaultParams = {
  category: {
    type: "string",
    description:
      "Category only for carriers that have no category of their own, e.g. when the user says the whole list is sea carriers. " +
      "Never use it to give one category to carriers whose categories differ; put those on each carrier.",
    enum: carrierCategories,
    default: "Quru",
  },
  language: {
    type: "string",
    description: "Language of messages to carriers that have none set.",
    enum: ["az", "en"],
    default: "az",
  },
} as const;

export const addCarriers: AgentTool = {
  name: "add_carriers",
  description:
    "Adds carriers typed in chat to the carrier base. Each needs a name and at least one contact (email, phone, WhatsApp or Telegram). " +
    "Give each carrier its own category/subcategory when the user stated it. A carrier whose name or email is already in the base " +
    "(or repeated in the list) is not added; the result lists skipped rows with the reason, how new carriers were grouped by category, " +
    "and which got the default category: tell the user all of it. To change an existing carrier use update_carriers.",
  params: {
    carriers: { type: "array", description: "Carriers to add.", items: carrierSchema },
    ...defaultParams,
  },
  async run(p) {
    return saveCarriers(p.carriers as CarrierInput[], {
      category: p.category as string,
      language: p.language as string,
    });
  },
};

const headerAliases: Record<keyof CarrierInput, RegExp> = {
  name: /^(name|ad|adı|şirkət|sirket|company|daşıyıcı|carrier|название|компания)/i,
  email: /(e-?mail|e-?poçt|почта)/i,
  phone: /^(phone|tel|telefon|mobil|телефон)/i,
  whatsapp: /whats ?app/i,
  telegram: /telegram/i,
  subcategory: /(alt ?kateqoriya|subcategory|sub-category|xətt|line|route)/i,
  category: /(kateqoriya|category|növ|type|категория|вид|тип)/i,
  language: /^(dil|language|lang)/i,
};

/** Maps a header row to carrier fields; returns null when no name/email column is found. */
export function mapHeader(header: string[]): Partial<Record<keyof CarrierInput, number>> | null {
  const map: Partial<Record<keyof CarrierInput, number>> = {};
  header.forEach((cell, i) => {
    const c = cell.trim();
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

export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const sep = [";", "\t", ","].reduce((best, s) =>
    firstLine.split(s).length > firstLine.split(best).length ? s : best,
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

async function readTables(file: UploadedFile): Promise<{ sheet: string; rows: string[][] }[]> {
  if (isSpreadsheet(file)) return (await readSpreadsheet(file)).filter((s) => s.rows.length > 0);
  return [{ sheet: "", rows: parseCsv(Buffer.from(file.data, "base64").toString("utf8").replace(/^\uFEFF/, "")) }];
}

/**
 * Carrier rows of one table. The header may sit under a title row. Without a
 * category column, the category comes from a section row that only names one
 * ("Dəniz daşıyıcıları") or from the sheet name ("Hava").
 */
export function tableCarriers(sheet: string, rows: string[][]): CarrierInput[] | null {
  // A title row above the header ("Daşıyıcılar") can look like a one-column header; prefer a fuller row.
  const first = rows.slice(0, 5);
  const columns = (r: string[]) => Object.keys(mapHeader(r) ?? {}).length;
  const fuller = first.findIndex((r) => columns(r) >= 2);
  const headerAt = fuller >= 0 ? fuller : first.findIndex((r) => columns(r) > 0);
  if (headerAt < 0) return null;
  const map = mapHeader(rows[headerAt])!;
  let section = map.category === undefined ? matchCategory(sheet) ?? undefined : undefined;
  const inputs: CarrierInput[] = [];
  for (const r of rows.slice(headerAt + 1)) {
    const filled = r.map((c) => (c ?? "").trim()).filter(Boolean);
    const sectionRow = filled.length === 1 && Object.keys(map).length >= 2 && !filled[0].includes("@");
    if (sectionRow && map.category === undefined && matchCategory(filled[0])) {
      section = matchCategory(filled[0])!;
      continue;
    }
    const get = (k: keyof CarrierInput) => (map[k] === undefined ? undefined : (r[map[k]!] ?? "").trim());
    inputs.push({
      name: get("name") || get("email") || "",
      email: get("email"),
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

function isTable(file: UploadedFile): boolean {
  return isSpreadsheet(file) || /\.(csv|tsv|txt)$/i.test(file.name) || file.type === "text/csv";
}

export const importCarriers: AgentTool = {
  name: "import_carriers",
  description:
    "Imports carriers from an attached Excel (.xlsx, every sheet) or CSV file with a header row (name, email, phone, WhatsApp, Telegram, category, subcategory columns; Azerbaijani, English or Russian headers). " +
    "Each row keeps the category from its category column, its section row or its sheet name. A carrier whose name or email is already in the base " +
    "(or repeated in the file) is not added; the result lists skipped rows with the reason, how new carriers were grouped by category, " +
    "and which got the default category: tell the user all of it. To change existing carriers use update_carriers.",
  params: {
    file_name: {
      type: "string",
      description: "Name of the attached file; empty means the first Excel/CSV attachment.",
      default: "",
    },
    ...defaultParams,
  },
  async run(p, ctx) {
    const file = p.file_name
      ? ctx.files.find((f) => f.name === p.file_name)
      : ctx.files.find(isTable);
    if (!file) throw new Error("Bu mesajda Excel və ya CSV fayl tapılmadı.");
    const inputs: CarrierInput[] = [];
    for (const table of await readTables(file)) inputs.push(...(tableCarriers(table.sheet, table.rows) ?? []));
    if (inputs.length === 0) {
      throw new Error("Faylın ilk sətirlərində ad və ya email sütunu tapılmadı.");
    }
    return {
      file: file.name,
      ...(await saveCarriers(inputs, { category: p.category as string, language: p.language as string })),
    };
  },
};

export const listCarriers: AgentTool = {
  name: "list_carriers",
  description: "Lists active carriers in the carrier base, optionally by category and subcategory, with counts per category.",
  params: {
    category: { type: "string", description: "Only this category; empty means all.", default: "" },
    subcategory: { type: "string", description: "Only this subcategory; empty means all.", default: "" },
  },
  async run(p) {
    const carriers = await findCarriers({ category: p.category as string, subcategory: p.subcategory as string });
    const byCategory = await db().all(
      "SELECT category, subcategory, count(*) AS count FROM carriers WHERE active = 1 AND user_id = ? GROUP BY 1, 2 ORDER BY 1, 2",
      currentUserId(),
    );
    return { count: carriers.length, carriers, byCategory };
  },
};

export const removeCarriers: AgentTool = {
  name: "remove_carriers",
  description: "Removes carriers from the active base (their past offers are kept).",
  params: { carrier_ids: { type: "array", description: "Carrier ids to remove.", items: { type: "integer" } } },
  async run(p) {
    const ids = p.carrier_ids as number[];
    if (ids.length === 0) return { removed: 0 };
    const { changes } = await db().run(
      `UPDATE carriers SET active = 0 WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
      currentUserId(), ...ids,
    );
    return { removed: changes };
  },
};

export const updateCarriers: AgentTool = {
  name: "update_carriers",
  description:
    "Changes existing carriers (ids from list_carriers): category, subcategory, contacts, name, language. Only the fields given change; " +
    "the same change applies to every id given (e.g. move several carriers to Dəniz). A name or email another carrier already has is refused.",
  params: {
    carrier_ids: { type: "array", description: "Carrier ids to change.", items: { type: "integer" } },
    category: { type: "string", description: "New category (Quru, Dəniz, Hava or Dəmiryolu); empty keeps it.", default: "" },
    subcategory: { type: "string", description: 'New subcategory; "-" clears it; empty keeps it.', default: "" },
    name: { type: "string", description: "New name (only with one id); empty keeps it.", default: "" },
    email: { type: "string", description: "New email (only with one id); empty keeps it.", default: "" },
    phone: { type: "string", description: "New phone; empty keeps it.", default: "" },
    whatsapp: { type: "string", description: "New WhatsApp; empty keeps it.", default: "" },
    telegram: { type: "string", description: "New Telegram; empty keeps it.", default: "" },
    language: { type: "string", description: "New message language; empty keeps it.", enum: ["", "az", "en"], default: "" },
  },
  async run(p) {
    const ids = p.carrier_ids as number[];
    if (ids.length > 1 && (p.name || p.email)) throw new Error("Ad və email yalnız bir daşıyıcı üçün dəyişdirilə bilər.");
    const { carrier_ids: _, ...changes } = p as Record<string, string>;
    const updated = [];
    for (const id of ids) updated.push(await updateCarrier(id, changes));
    return { updated: updated.length, carriers: updated };
  },
};

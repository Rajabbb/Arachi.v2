import type { AgentTool } from "./registry";
import type { UploadedFile } from "../../../shared/protocol";
import { findCarriers, saveCarriers, subcategoryToCategory, updateCarrier, type CarrierInput } from "../../domain/carriers";
import { parseCarrierLines, repairCarrier, tableCarriers } from "./carrierParse";
import { isSpreadsheet, readSpreadsheet } from "../files";
import { db } from "../../db";
import { currentUserId } from "../../auth/current";

/** Process 4: the carrier base (manual add, XLS/CSV import, categories). */

const carrierSchema = {
  type: "object",
  properties: {
    name: { type: "string", description: "Company/carrier name exactly as the user wrote it (not the email)." },
    email: { type: "string", description: "Email address only." },
    phone: { type: "string" },
    whatsapp: { type: "string" },
    telegram: { type: "string" },
    category: {
      type: "string",
      description:
        "This carrier's category exactly as the user named it: a transport category (Quru, Dəniz, Hava, Dəmiryolu) or the user's own " +
        "label such as A, B, VIP (\"A kateqoriyası\" -> \"A\"). Carriers in one list may have different categories. Never move the user's category into subcategory.",
    },
    subcategory: { type: "string", description: "Only when the user gives a separate subcategory or direction, e.g. Türkiyə xətti, Avropa." },
    language: { type: "string", enum: ["az", "en"] },
  },
  required: ["name"],
};

const defaultParams = {
  category: {
    type: "string",
    description:
      "Category only for carriers that have no category of their own, e.g. when the user says the whole list is sea carriers. " +
      "Never use it to give one category to carriers whose categories differ; put those on each carrier. Any category name is allowed.",
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
    "name is the company/carrier name the user wrote, never the email address; copy it exactly. " +
    "Give each carrier its own category/subcategory when the user stated it. A carrier whose name or email is already in the base " +
    "(or repeated in the list) is not added; the result lists skipped rows with the reason, how new carriers were grouped by category, " +
    "and which got the default category: tell the user all of it. To change an existing carrier use update_carriers.",
  params: {
    carriers: { type: "array", description: "Carriers to add.", items: carrierSchema },
    ...defaultParams,
  },
  async run(p, ctx) {
    // What the user typed or attached, to correct a name or category the model dropped.
    const sources = parseCarrierLines(ctx.text);
    for (const file of ctx.files.filter(isTable)) sources.push(...(await fileCarriers(file)));
    const given = (p.carriers as CarrierInput[]).map((c) => repairCarrier(c, sources));
    return saveCarriers(given.length > 0 ? given : sources, {
      category: p.category as string,
      language: p.language as string,
    });
  },
};

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

async function fileCarriers(file: UploadedFile): Promise<CarrierInput[]> {
  const inputs: CarrierInput[] = [];
  for (const table of await readTables(file)) inputs.push(...(tableCarriers(table.sheet, table.rows) ?? []));
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
    const inputs = await fileCarriers(file);
    if (inputs.length === 0) {
      throw new Error("Faylda daşıyıcı adı və ya email sütunu tapılmadı.");
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
    category: { type: "string", description: "Only this category (transport or the user's own, e.g. A); empty means all.", default: "" },
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
    category: { type: "string", description: "New category: Quru, Dəniz, Hava, Dəmiryolu or the user's own (A, B, VIP, ...); empty keeps it.", default: "" },
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

export const subcategoryToCategoryTool: AgentTool = {
  name: "subcategory_to_category",
  description:
    "Repairs carriers saved by an older version: the user's own category (e.g. \"A kateqoriyası\") was stored as the subcategory under " +
    "Quru. Makes the subcategory the category (\"A kateqoriyası\" -> \"A\") and clears it. Use when the user says their categories " +
    "ended up as Quru, or asks to move subcategories into the category.",
  params: {
    from_category: { type: "string", description: "Category the carriers are wrongly in.", default: "Quru" },
    subcategories: {
      type: "array",
      description: "Only carriers with these subcategories; empty means every carrier in from_category that has a subcategory.",
      items: { type: "string" },
      default: [],
    },
  },
  async run(p) {
    const moved = await subcategoryToCategory(p.from_category as string, p.subcategories as string[]);
    return { moved: moved.length, carriers: moved };
  },
};

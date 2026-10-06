import type { AgentTool } from "./registry";
import type { UploadedFile } from "../../../shared/protocol";
import { carrierCategories, findCarriers, upsertCarrier, type CarrierInput } from "../../domain/carriers";
import { isSpreadsheet, readSpreadsheet } from "../files";
import { db } from "../../db";

/** Process 4: the carrier base (manual add, XLS/CSV import, categories). */

const carrierSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    email: { type: "string" },
    phone: { type: "string" },
    whatsapp: { type: "string" },
    telegram: { type: "string" },
    category: { type: "string", description: "Quru, Dəniz, Hava or Dəmiryolu." },
    subcategory: { type: "string", description: "e.g. Türkiyə xətti, Avropa." },
    language: { type: "string", enum: ["az", "en"] },
  },
  required: ["name"],
};

const defaultParams = {
  category: {
    type: "string",
    description: "Category used for carriers that have none.",
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

async function saveAll(rows: CarrierInput[], defaults: { category: string; language: string }) {
  const summary = { added: 0, updated: 0, skipped: [] as { row: number; name: string; reason: string }[] };
  for (const [i, row] of rows.entries()) {
    const r = await upsertCarrier(row, defaults);
    if (r.outcome === "skipped") summary.skipped.push({ row: i + 1, name: row.name ?? "", reason: r.reason! });
    else summary[r.outcome]++;
  }
  return summary;
}

export const addCarriers: AgentTool = {
  name: "add_carriers",
  description:
    "Adds carriers to the carrier base by hand (or updates ones with the same email). Each needs a name and at least one contact (email, phone, WhatsApp or Telegram).",
  params: {
    carriers: { type: "array", description: "Carriers to add.", items: carrierSchema },
    ...defaultParams,
  },
  async run(p) {
    return saveAll(p.carriers as CarrierInput[], {
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
  category: /^(kateqoriya|category|növ|type|категория)/i,
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

async function readTable(file: UploadedFile): Promise<string[][]> {
  if (isSpreadsheet(file)) {
    const sheets = await readSpreadsheet(file);
    return sheets.find((s) => s.rows.length > 0)?.rows ?? [];
  }
  return parseCsv(Buffer.from(file.data, "base64").toString("utf8").replace(/^﻿/, ""));
}

function isTable(file: UploadedFile): boolean {
  return isSpreadsheet(file) || /\.(csv|tsv|txt)$/i.test(file.name) || file.type === "text/csv";
}

export const importCarriers: AgentTool = {
  name: "import_carriers",
  description:
    "Imports carriers from an attached Excel (.xlsx) or CSV file with a header row (name, email, phone, WhatsApp, Telegram, category, subcategory columns; Azerbaijani, English or Russian headers). Existing carriers with the same email are updated.",
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
    const [header, ...rows] = await readTable(file);
    const map = header && mapHeader(header);
    if (!map) {
      throw new Error("Faylın birinci sətrində ad və ya email sütunu tapılmadı.");
    }
    const inputs = rows.map((r) => {
      const get = (k: keyof CarrierInput) => (map[k] === undefined ? undefined : (r[map[k]!] ?? "").trim());
      return {
        name: get("name") || get("email") || "",
        email: get("email"),
        phone: get("phone"),
        whatsapp: get("whatsapp"),
        telegram: get("telegram"),
        category: get("category"),
        subcategory: get("subcategory"),
        language: get("language"),
      };
    });
    return { file: file.name, rows: inputs.length, ...(await saveAll(inputs, { category: p.category as string, language: p.language as string })) };
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
      "SELECT category, subcategory, count(*) AS count FROM carriers WHERE active = 1 GROUP BY 1, 2 ORDER BY 1, 2",
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
    const { changes } = await db().run(`UPDATE carriers SET active = 0 WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids);
    return { removed: changes };
  },
};

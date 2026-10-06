import type { AgentTool } from "./registry";
import { addDays, currencies, insertRfq, transportTypes, type Currency } from "../../domain/rfqs";

/**
 * Process 2: AI auto-fill. The model reads the attached document (PDF,
 * image, Excel, text) itself and passes whatever it found here; this tool
 * normalises units, dates and transport names, reports what is still
 * missing and, when nothing required is missing, creates the RFQ.
 */

const fieldSchema = {
  origin: { type: "string" },
  destination: { type: "string" },
  cargo_type: { type: "string" },
  weight: { type: ["string", "number"], description: 'Weight as written, e.g. "12 t", "800 kg", 12000.' },
  volume_m3: { type: ["string", "number"] },
  pallets: { type: ["string", "number"] },
  transport_type: { type: "string", description: "As written, e.g. truck, TIR, sea, air." },
  loading_date: { type: "string", description: "As written, e.g. 02.11.2026." },
  delivery_date: { type: "string" },
  currency: { type: "string" },
  notes: { type: "string" },
};

const required = ["origin", "destination", "cargo_type", "weight_kg"] as const;

const transportSynonyms: [RegExp, (typeof transportTypes)[number]][] = [
  [/d[əe]niz|sea|ocean|gəmi|ship|vessel|kon?teyner|container|fcl|lcl|морск/i, "Dəniz"],
  [/hava|air|avia|plane|təyyarə|авиа/i, "Hava"],
  [/d[əe]mir ?yol|rail|qatar|train|вагон|жд/i, "Dəmiryolu"],
  [/quru|road|truck|tır|tir|avto|auto|ftl|ltl|trailer|tent|фура|авто/i, "Quru"],
];

export function parseTransport(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const exact = transportTypes.find((t) => t.toLowerCase() === value.trim().toLowerCase());
  if (exact) return exact;
  return transportSynonyms.find(([re]) => re.test(value))?.[1];
}

function parseNumber(text: string): number | undefined {
  const match = text.replace(/\s/g, "").match(/-?\d+(?:[.,]\d+)*/);
  if (!match) return undefined;
  let n = match[0];
  // "12.500,5" or "12,500.5": the last separator is the decimal one.
  const lastDot = n.lastIndexOf(".");
  const lastComma = n.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = Math.max(lastDot, lastComma);
    n = n.slice(0, dec).replace(/[.,]/g, "") + "." + n.slice(dec + 1);
  } else {
    // A single kind of separator: groups of exactly three digits ("12,500",
    // "1.200.000") are thousands, anything else ("12,5", "3.75") a decimal.
    const sep = lastComma >= 0 ? "," : ".";
    const groups = n.split(sep);
    n =
      groups.length > 1 && groups.slice(1).every((g) => g.length === 3)
        ? groups.join("")
        : groups.length === 2
          ? groups.join(".")
          : n;
  }
  const value = Number(n);
  return Number.isFinite(value) ? value : undefined;
}

/** "12 t" → 12000, "800 kg" → 800, 12000 → 12000. Bare numbers are kilograms. */
export function parseWeightKg(value: unknown): number | undefined {
  if (typeof value === "number") return value > 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const n = parseNumber(value);
  if (n === undefined || n <= 0) return undefined;
  if (/\b(t|ton|tons|tonne|tonnes|tn|т|тонн)\b|ton/i.test(value) && !/kg|kq|кг/i.test(value)) {
    return Math.round(n * 1000 * 1000) / 1000;
  }
  if (/\b(lb|lbs)\b/i.test(value)) return Math.round(n * 0.45359237 * 1000) / 1000;
  return n;
}

function parseCount(value: unknown): number | undefined {
  if (typeof value === "number") return value >= 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const n = parseNumber(value);
  return n !== undefined && n >= 0 ? n : undefined;
}

/** 02.11.2026, 2/11/2026, 2026-11-02 → 2026-11-02 (day first, as written in AZ/EU documents). */
export function parseDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const v = value.trim();
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return undefined;
}

function iso(y: number, mo: number, d: number): string | undefined {
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return undefined;
  return date.toISOString().slice(0, 10);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

export const autofillRfq: AgentTool = {
  name: "autofill_rfq",
  description:
    "AI auto-fill: turns RFQ details read from an attached document (PDF, image, Excel, email text) into an RFQ. First read the attachment yourself, then pass every field you found exactly as written; this tool normalises units and dates, and creates the RFQ when nothing required is missing, otherwise it returns the draft and the missing fields to ask the user about.",
  params: {
    fields: {
      type: "object",
      description: "RFQ fields found in the document, as written there. Omit fields that are not in the document.",
      properties: fieldSchema,
    },
    source_file: { type: "string", description: "Name of the attached file the fields came from.", default: "" },
    create: {
      type: "boolean",
      description: "Create the RFQ right away when nothing required is missing (false = only show the draft).",
      default: true,
    },
    transport_type: {
      type: "string",
      description: "Transport mode used when the document does not say.",
      enum: transportTypes,
      default: "Quru",
    },
    currency: { type: "string", description: "Currency used when the document does not say.", enum: currencies, default: "USD" },
    offer_deadline_days: { type: "integer", description: "Days carriers have to send an offer.", default: 3 },
  },
  async run(p) {
    const f = p.fields as Record<string, unknown>;
    const currency = text(f.currency).toUpperCase();
    const draft = {
      origin: text(f.origin),
      destination: text(f.destination),
      cargo_type: text(f.cargo_type),
      weight_kg: parseWeightKg(f.weight) ?? 0,
      volume_m3: parseCount(f.volume_m3) ?? 0,
      pallets: Math.round(parseCount(f.pallets) ?? 0),
      transport_type: parseTransport(f.transport_type) ?? (p.transport_type as string),
      loading_date: parseDate(f.loading_date) ?? "",
      delivery_date: parseDate(f.delivery_date) ?? "",
      currency: ((currencies as readonly string[]).includes(currency) ? currency : p.currency) as Currency,
      offer_deadline: addDays(p.offer_deadline_days as number),
      notes: text(f.notes),
      source: p.source_file ? `file:${p.source_file}` : "file",
    };

    const missing = required.filter((k) => !draft[k]);
    const unreadable = (["loading_date", "delivery_date"] as const).filter(
      (k) => text(f[k]) && !draft[k],
    );
    if (missing.length > 0 || !p.create) {
      return { created: false, draft, missing, unreadable };
    }
    return { created: true, rfq: await insertRfq(draft), unreadable };
  },
};

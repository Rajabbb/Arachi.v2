const INCOTERM_CODES = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];

/** One of several different cargo items in a single RFQ (all ship together; the carrier gives one total price). */
export interface CargoItem {
  name: string;
  weight_kg?: number;
  volume_m3?: number;
  pallets?: number;
  dimensions?: string;
  hs_code?: string;
  incoterm?: string;
  adr?: string;
  stackable?: "Stackable" | "Non-stackable";
  temperature?: string;
  notes?: string;
}

export const MAX_CARGO_ITEMS = 10;

const text = (v: unknown, limit: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
const positive = (v: unknown): number | undefined => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 1e9 ? n : undefined;
};

/** The items the model or the user gave, cleaned and capped; an item needs a name. */
export function cleanCargoItems(raw: unknown): CargoItem[] {
  if (!Array.isArray(raw)) return [];
  const out: CargoItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const it = entry as Record<string, unknown>;
    const name = text(it.name ?? it.cargo_type, 200);
    if (!name) continue;
    const item: CargoItem = { name };
    const weight = positive(it.weight_kg);
    const volume = positive(it.volume_m3);
    const pallets = positive(it.pallets);
    if (weight) item.weight_kg = weight;
    if (volume) item.volume_m3 = volume;
    if (pallets) item.pallets = Math.round(pallets);
    for (const [key, limit] of [["dimensions", 100], ["hs_code", 60], ["adr", 100], ["temperature", 60], ["notes", 500]] as const) {
      const t = text(it[key], limit);
      if (t) item[key] = t;
    }
    const incoterm = text(it.incoterm, 10).toUpperCase();
    if (incoterm && INCOTERM_CODES.includes(incoterm)) item.incoterm = incoterm;
    const st = text(it.stackable, 20).toLowerCase();
    if (st === "non-stackable" || st === "false") item.stackable = "Non-stackable";
    else if (st === "stackable" || st === "true") item.stackable = "Stackable";
    out.push(item);
    if (out.length >= MAX_CARGO_ITEMS) break;
  }
  return out;
}

export function cargoItemLine(it: CargoItem): string {
  const parts: string[] = [];
  if (it.weight_kg) parts.push(`${it.weight_kg} kq`);
  if (it.volume_m3) parts.push(`${it.volume_m3} m³`);
  if (it.pallets) parts.push(`${it.pallets} palet`);
  if (it.dimensions) parts.push(it.dimensions);
  if (it.hs_code) parts.push(`HS ${it.hs_code}`);
  if (it.incoterm) parts.push(it.incoterm);
  if (it.adr) parts.push(`ADR: ${it.adr}`);
  if (it.stackable) parts.push(it.stackable);
  if (it.temperature) parts.push(it.temperature);
  if (it.notes) parts.push(it.notes);
  return `${it.name}${parts.length ? ` — ${parts.join(" · ")}` : ""}`;
}

const PER_ITEM_KEYS = ["hs_code", "stackable", "incoterm", "adr", "temperature"] as const;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Two or more different cargo items in one RFQ: the totals, the combined cargo name and the shared
 * per-cargo fields are derived here (same as arachi.co does), so the card and the created RFQ agree.
 * Fewer than two items = an ordinary RFQ. Changes `p`.
 */
export function applyCargoItems(p: Record<string, unknown>): void {
  const items = cleanCargoItems(p.cargo_items);
  if (items.length < 2) {
    p.cargo_items = [];
    return;
  }
  // A value given once for the whole RFQ applies to every item that has none of its own.
  for (const key of PER_ITEM_KEYS) {
    const shared = text(p[key], 100);
    if (shared) for (const it of items) if (!it[key]) (it as unknown as Record<string, unknown>)[key] = shared;
    p[key] = "";
  }
  const names = items.map((i) => i.name);
  p.cargo_items = items;
  p.cargo_type = (names.slice(0, 3).join(" + ") + (names.length > 3 ? ` (+${names.length - 3})` : "")).slice(0, 200);
  p.weight_kg = r3(items.reduce((a, i) => a + (i.weight_kg ?? 0), 0));
  p.volume_amount = r3(items.reduce((a, i) => a + (i.volume_m3 ?? 0), 0));
  p.volume_unit = "CBM";
}

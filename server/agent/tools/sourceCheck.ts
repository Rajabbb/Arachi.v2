/**
 * Checks of a prepared RFQ against what the user actually wrote or attached.
 * The model fills fields it was told not to guess (shipment type, stackable,
 * incoterm, volume, dangerous goods); these checks run in code so that what
 * the user confirms is what the source says. Same rules as the panel's AI form.
 */

export interface SourceCheck {
  params: Record<string, unknown>;
  /** Shown under the card; none of them blocks the RFQ. */
  warnings: string[];
}

const SHIPMENT_EVIDENCE: Record<string, RegExp> = {
  FTL: /\bftl\b|tam\s+maşın|full\s+truck|truck\s*load|полн\w+\s+(?:машин|фур|загрузк)/i,
  LTL: /\bltl\b|qismən\s+(?:maşın|yük)|less\s+than\s+truck|part(?:ial)?\s*load|сборн|догруз/i,
  FCL: /\bfcl\b|konteyner|container|контейнер|\d+\s*[x×*]\s*(?:20|40)|\b(?:20|40)\s*(?:dc|hc|gp|rf|ft|feet|')|\b(?:20|40)(?:dc|hc|gp|rf|ft)\b/i,
  LCL: /\blcl\b|konsolid|consolid|groupage|сборн|less\s+than\s+container|qismən\s+konteyner/i,
};
const ALLOWED_SHIPMENT: Record<string, string[]> = { Quru: ["FTL", "LTL"], "Dəniz": ["FCL", "LCL"] };
const STACK_WORDS = /stack|üst-?üstə|yığ|штабел|stapel/i;
const DG_WORDS = /litium|lithium|li-?ion|batter|\bUN\s?\d{4}\b|təhlükəli|dangerous|hazard|\bDG\b|\bADR\b|IMDG|IATA/gi;
const DG_VERIFY = /yoxlan|ola\s+bilər|\bSDS\b|\bMSDS\b|UN\s?38\.3|must\s+be\s+(?:checked|verified|confirmed)|to\s+be\s+(?:checked|verified|confirmed)|may\s+be/i;

function numbers(text: string): number[] {
  const found = text.match(/\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g) ?? [];
  return [...new Set(found.map((x) => Number(x.replace(/[  ]/g, "").replace(",", "."))))].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
}

/** The number is written in the text, or is the sum of 2-3 numbers on its volume/pallet lines (lot totals). */
export function numberSupported(value: number, source: string): boolean {
  const tol = Math.max(0.01, value * 0.005);
  if (numbers(source).some((n) => Math.abs(n - value) <= tol)) return true;
  const hinted = source
    .split("\n")
    .filter((line) => /m³|m3|m\^3|cbm|kub|həcm|volume|palet|pallet/i.test(line))
    .join("\n");
  const t = numbers(hinted).slice(0, 40);
  for (let i = 0; i < t.length; i++) {
    for (let j = i + 1; j < t.length; j++) {
      if (Math.abs(t[i] + t[j] - value) <= tol) return true;
      for (let k = j + 1; k < t.length; k++) if (Math.abs(t[i] + t[j] + t[k] - value) <= tol) return true;
    }
  }
  return false;
}

function addNote(p: Record<string, unknown>, note: string) {
  const existing = String(p.notes ?? "").trim();
  if (!existing.includes(note)) p.notes = existing ? `${existing.replace(/[.s]+$/, "")}. ${note}` : note;
}

/**
 * mode: what the shipment type and the vehicle may be for the transport mode (no source needed).
 * source: the user's text plus the text of readable attachments; null when a file could not be read as text
 * (a PDF or an image), then only the mode rules apply.
 */
export function checkRfq(input: Record<string, unknown>, source: { text: string; fromFile: boolean } | null): SourceCheck {
  const p = { ...input };
  const warnings: string[] = [];
  const mode = String(p.transport_mode ?? "");

  // Shipment type must fit the mode: road FTL/LTL, sea FCL/LCL, air and rail none.
  const shipment = String(p.shipment_type ?? "").toUpperCase();
  if (shipment && !(ALLOWED_SHIPMENT[mode] ?? []).includes(shipment)) {
    p.shipment_type = "";
    warnings.push(`Daşınma tipi (${shipment}) bu nəqliyyat növü üçün keçərli deyil, boş saxlandı.`);
  }
  const truck = String(p.truck_type ?? "").trim();
  if (truck && mode !== "Quru" && mode !== "Dəniz") {
    p.truck_type = "";
    addNote(p, `Nəqliyyat vasitəsi: ${truck}`);
    warnings.push("«Maşın növü» yalnız avtomobil daşıması üçündür, qeydə köçürüldü.");
  }

  // Evidence checks only for a document: in plain chat the details may come from earlier messages.
  if (!source || !source.fromFile || !source.text.trim()) return { params: p, warnings };
  const text = source.text;

  const type = String(p.shipment_type ?? "").toUpperCase();
  if (type && SHIPMENT_EVIDENCE[type] && !SHIPMENT_EVIDENCE[type].test(text) && !String(p.container_type ?? "")) {
    p.shipment_type = "";
    warnings.push(`Daşınma tipi (${type}) mətndə yazılmayıb, boş saxlandı. Özünüz seçin.`);
  }
  if (String(p.stackable ?? "") && !STACK_WORDS.test(text)) {
    p.stackable = "";
    warnings.push("«Stackable / Non-stackable» mənbədə yazılmayıb, boş saxlandı.");
  }
  const incoterm = String(p.incoterm ?? "");
  if (incoterm && !new RegExp(`\\b${incoterm}\\b`, "i").test(text)) {
    p.incoterm = "";
    warnings.push(`Incoterm (${incoterm}) mənbədə yazılmayıb, boş saxlandı.`);
  }

  // Dangerous goods: where the source says the status must be checked, ADR is not confirmed.
  let unverified = false;
  for (const m of text.matchAll(DG_WORDS)) {
    const at = m.index ?? 0;
    if (DG_VERIFY.test(text.slice(Math.max(0, at - 160), at + m[0].length + 160))) {
      unverified = true;
      break;
    }
  }
  if (unverified) {
    p.adr = "";
    addNote(p, "DG statusu təsdiqlənməyib (SDS / UN38.3 yoxlanmalıdır)");
    warnings.push("Təhlükəli yük statusu yoxlanmalıdır: mənbə bunu təsdiqləmir, ADR/DG sahəsi boş saxlandı.");
  }

  // Volume from a document must be a number the document states or the sum of its lots.
  if (!numberSupported(Number(p.volume_amount), text)) {
    throw new Error(
      `Həcm / palet (${p.volume_amount}) faylda yazılmayıb və yazılan rəqəmlərin cəmi də deyil (hesablanmış ola bilər). Sorğunu hələ hazırlamayın: istifadəçidən həcmi (CBM və ya palet sayı) soruşun.`,
    );
  }
  return { params: p, warnings };
}

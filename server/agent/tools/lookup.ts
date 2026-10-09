import * as api from "../../arachi/api";

/** Lookups shared by the agent's tools. Everything goes through arachi.co as the signed-in customer. */

/** A recipient list for a confirmation, the first 25 in full. */
export function recipientLines(lines: string[]): string {
  const shown = lines.slice(0, 25).map((l) => `• ${l}`);
  if (lines.length > shown.length) shown.push(`• və daha ${lines.length - shown.length}`);
  return shown.join("\n");
}

/** Carriers of the user's own base; arachi.co keeps one internal "public link" carrier per user that is not a real one. */
export const isMine = (c: api.ArachiCarrier) => !(c.email ?? "").startsWith("public_link_");

/** The RFQ the user means by "RFQ #n": n is the number the panel on arachi.co shows, not the database id. */
export async function rfqOrThrow(number: number): Promise<api.ArachiRfq> {
  const rfq = (await api.listRfqs()).find((r) => r.display_id === number);
  if (!rfq) throw new Error(`RFQ #${number} tapılmadı.`);
  return rfq;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A category by name (case-insensitive); null when there is none. */
export async function findCategory(name: string): Promise<api.ArachiCategory | null> {
  return (await api.listCategories()).find((c) => same(c.name, name)) ?? null;
}

/** The category with this name; throws, naming the existing ones, when there is none. */
export async function categoryOrThrow(name: string): Promise<api.ArachiCategory> {
  const categories = await api.listCategories();
  const found = categories.find((c) => same(c.name, name));
  if (!found) {
    const have = categories.map((c) => c.name).join(", ") || "heç biri yoxdur";
    throw new Error(`"${name}" kateqoriyası tapılmadı. Mövcud kateqoriyalar: ${have}.`);
  }
  return found;
}

export async function subCategoryOrThrow(category: api.ArachiCategory, name: string): Promise<api.ArachiCategory> {
  const subs = await api.listSubCategories(category.id);
  const found = subs.find((s) => same(s.name, name));
  if (!found) {
    const have = subs.map((s) => s.name).join(", ") || "heç biri yoxdur";
    throw new Error(`"${category.name}" kateqoriyasında "${name}" alt kateqoriyası tapılmadı. Mövcudlar: ${have}.`);
  }
  return found;
}

/** The user's own carriers with these ids; throws for an id that is not one of them (never touches anyone else's). */
export async function ownCarriers(ids: number[]): Promise<api.ArachiCarrier[]> {
  const all = (await api.listCarriers()).filter(isMine);
  const unknown = ids.filter((id) => !all.some((c) => c.id === id));
  if (unknown.length > 0) throw new Error(`Bazada belə daşıyıcı yoxdur: ${unknown.join(", ")}. list_carriers ilə nömrələri yoxlayın.`);
  return all.filter((c) => ids.includes(c.id));
}

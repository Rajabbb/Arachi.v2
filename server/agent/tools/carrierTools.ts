import type { AgentTool } from "./registry";
import * as api from "../../arachi/api";
import { findCategory, isMine, ownCarriers, recipientLines } from "./lookup";

/** The carrier base: categories, importing from a file, and removing carriers (which waits for "Bəli"). */

/** The category with this name, created when the user's base does not have it yet. */
async function ensureCategory(name: string): Promise<api.ArachiCategory> {
  return (await findCategory(name)) ?? (await api.createCategory(name.trim()));
}

async function ensureSubCategory(category: api.ArachiCategory, name: string): Promise<api.ArachiCategory> {
  const existing = (await api.listSubCategories(category.id)).find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
  return existing ?? api.createSubCategory(category.id, name.trim());
}

export const listCategories: AgentTool = {
  name: "list_categories",
  description: "Lists the user's carrier categories (e.g. A, B, VIP, Türkiyə xətti) with their subcategories and how many carriers each has.",
  params: {},
  async run() {
    const [categories, carriers] = await Promise.all([api.listCategories(), api.listCarriers()]);
    const mine = carriers.filter(isMine);
    const out = [];
    for (const category of categories) {
      const subs = await api.listSubCategories(category.id);
      out.push({
        name: category.name,
        carriers: mine.filter((c) => c.category_id === category.id).length,
        subcategories: subs.map((s) => ({ name: s.name, carriers: mine.filter((c) => c.sub_category_id === s.id).length })),
      });
    }
    return { categories: out, carriers_without_category: mine.filter((c) => !c.category_id).length };
  },
};

export const setCarrierCategory: AgentTool = {
  name: "set_carrier_category",
  description:
    "Puts carriers into a category (and optionally a subcategory), creating the category or subcategory when it does not exist yet. An empty category takes the carriers out of their category. Use the ids from list_carriers.",
  params: {
    carrier_ids: { type: "array", description: "Carrier ids.", items: { type: "integer" } },
    category: { type: "string", description: "Category name (e.g. A, VIP); empty = remove the category.", default: "" },
    subcategory: { type: "string", description: "Subcategory name inside the category; empty = none.", default: "" },
  },
  async run(p) {
    const ids = p.carrier_ids as number[];
    if (ids.length === 0) throw new Error("Daşıyıcı seçilməyib.");
    const carriers = await ownCarriers(ids);
    const name = (p.category as string).trim();
    const subName = (p.subcategory as string).trim();
    if (!name && subName) throw new Error("Alt kateqoriya üçün kateqoriya adı da lazımdır.");
    if (!name) {
      await api.setCategory(ids, 0, 0);
      return { updated: carriers.length, category: null, carriers: carriers.map((c) => c.company_name) };
    }
    const category = await ensureCategory(name);
    const sub = subName ? await ensureSubCategory(category, subName) : null;
    await api.setCategory(ids, category.id, sub?.id ?? 0);
    return { updated: carriers.length, category: category.name, subcategory: sub?.name, carriers: carriers.map((c) => c.company_name) };
  },
};

const SHEET = /\.(xlsx|xls|csv)$/i;

export const importCarriers: AgentTool = {
  name: "import_carriers",
  description:
    "Adds carriers to the base from an attached Excel or CSV file (a column with e-mails is required, a column with company names is used when there is one). Existing e-mails are skipped. Optionally puts the new carriers into a category. Use this for attached carrier lists, not add_carriers.",
  params: {
    file_name: { type: "string", description: "Which attached file; empty = the first Excel/CSV file.", default: "" },
    category: { type: "string", description: "Put the newly added carriers into this category (created if missing); empty = none.", default: "" },
  },
  async run(p, ctx) {
    const wanted = (p.file_name as string).trim().toLowerCase();
    const file = ctx.files.find((f) => SHEET.test(f.name) && (!wanted || f.name.toLowerCase() === wanted));
    if (!file) throw new Error("Əlavə edilmiş Excel/CSV faylı tapılmadı. Daşıyıcı siyahısını mesaja fayl kimi əlavə edin.");
    const before = new Set((await api.listCarriers()).map((c) => c.id));
    const res = await api.importCarriersFile(file.name, Buffer.from(file.data, "base64"), file.type);
    const added = (await api.listCarriers()).filter((c) => isMine(c) && !before.has(c.id));
    const name = (p.category as string).trim();
    let category: string | undefined;
    if (name && added.length > 0) {
      const target = await ensureCategory(name);
      await api.setCategory(added.map((c) => c.id), target.id, 0);
      category = target.name;
    }
    return { file: file.name, added: added.length, category, message: res.message };
  },
};

export const removeCarriers: AgentTool = {
  name: "remove_carriers",
  description: "Deletes carriers from the user's carrier base for good. Always asks the user to confirm first. Use the ids from list_carriers.",
  params: { carrier_ids: { type: "array", description: "Carrier ids to delete.", items: { type: "integer" } } },
  async confirm(p) {
    const ids = p.carrier_ids as number[];
    if (ids.length === 0) return null;
    const carriers = await ownCarriers(ids);
    return {
      summary: `${carriers.length} daşıyıcı bazadan SİLİNƏCƏK (geri qaytarmaq olmur):\n` + recipientLines(carriers.map((c) => `${c.company_name}: ${c.email}`)),
      params: { carrier_ids: carriers.map((c) => c.id) },
    };
  },
  done(result) {
    return `${(result as { removed: number }).removed} daşıyıcı bazadan silindi.`;
  },
  async run(p) {
    const ids = p.carrier_ids as number[];
    if (ids.length === 0) throw new Error("Silinəcək daşıyıcı seçilməyib.");
    const carriers = await ownCarriers(ids);
    await api.deleteCarriers(carriers.map((c) => c.id));
    return { removed: carriers.length, carriers: carriers.map((c) => c.company_name) };
  },
};

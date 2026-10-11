import type { ResultCard } from "../../../shared/protocol";
import { panelDate } from "./arachiTools";

/**
 * What the user sees under the reply for each tool call: the real data, laid out so it can be
 * checked at a glance (a created RFQ's fields, who was added, who a message went to). Built from
 * the tool's own result, so it does not depend on what the model writes.
 */

type R = Record<string, any>;
type CardFn = (result: unknown, params: Record<string, unknown>) => ResultCard | null;

const SHOWN = 15;

function money(price: unknown, currency: unknown): string {
  if (price === null || price === undefined) return "-";
  return `${price} ${currency ?? ""}`.trim();
}

function row(label: string, value: unknown): { label: string; value: string }[] {
  const v = value === null || value === undefined ? "" : String(value).trim();
  return v ? [{ label, value: v }] : [];
}

/** A list capped at SHOWN lines, with the rest counted. */
function items(lines: string[]): string[] {
  if (lines.length <= SHOWN) return lines;
  return [...lines.slice(0, SHOWN), `… və daha ${lines.length - SHOWN}`];
}

const person = (p: { name?: string; email?: string }) => (p.email ? `${p.name || "Daşıyıcı"} · ${p.email}` : `${p.name || "Daşıyıcı"}`);

export const cardFor: Record<string, CardFn> = {
  create_rfq(result, p) {
    const r = result as R;
    const volume = `${p.volume_amount} ${p.volume_unit}`;
    return {
      title: `RFQ #${r.number} yaradıldı`,
      tone: "success",
      rows: [
        ...row("Yükləmə yeri", p.origin),
        ...row("Boşaltma yeri", p.destination),
        ...row("Yükün növü", p.cargo_type),
        ...row("Çəki", `${p.weight_kg} kq`),
        ...row("Həcm / Palet", volume),
        ...row("Daşınma növü", p.transport_mode),
        ...row("Yükləmə tarixi", p.loading_date ? panelDate("loading_date", String(p.loading_date)) : ""),
        ...row("Çatdırılma müddəti", p.delivery_deadline ? panelDate("delivery_deadline", String(p.delivery_deadline)) : ""),
        ...row("Təklif üçün son tarix", p.quote_deadline ? String(p.quote_deadline).replace("T", " ") : ""),
        ...row("Maşın növü", p.truck_type),
        ...row("Konteyner", p.container_type ? `${Number(p.container_count) > 0 ? `${p.container_count} × ` : ""}${p.container_type}` : ""),
        ...row("HS Code", p.hs_code),
        ...row("Stackable", p.stackable),
        ...row("Daşınma tipi", p.shipment_type),
        ...row("Incoterm", p.incoterm),
        ...row("Təhlükəli yük (ADR)", p.adr),
        ...row("Temperatur", p.temperature),
        ...row("Əlavə məlumat", p.notes),
      ],
      note: "Sorğu hələ daşıyıcılara göndərilməyib. Məlumatları yoxlayın; səhv varsa deyin, düzəldək.",
    };
  },

  list_rfqs(result) {
    const r = result as R;
    return {
      title: `RFQ siyahısı: ${r.total} sorğu`,
      tone: "info",
      items: items(
        (r.rfqs as R[]).map(
          (x) =>
            `#${x.number} · ${x.origin} → ${x.destination}${x.cargo_type ? ` · ${x.cargo_type}` : ""} · ${x.offers_received} təklif · ${x.status === "closed" ? "bağlı" : "açıq"}`,
        ),
      ),
      note: r.total > r.shown ? `${r.shown} ən yeni sorğu göstərilir.` : undefined,
    };
  },

  list_carriers(result) {
    const r = result as R;
    return {
      title: `Daşıyıcı bazası: ${r.total} daşıyıcı`,
      tone: "info",
      items: items(
        (r.carriers as R[]).map((c) => `${person(c)}${c.category ? ` · ${c.category}${c.subcategory ? ` / ${c.subcategory}` : ""}` : ""}`),
      ),
    };
  },

  add_carriers(result) {
    const r = result as R;
    const added = (r.added as R[]) ?? [];
    const skipped = (r.skipped as R[]) ?? [];
    return {
      title: added.length > 0 ? `${added.length} daşıyıcı əlavə edildi` : "Yeni daşıyıcı əlavə olunmadı",
      tone: added.length > 0 ? "success" : "warning",
      items: items(added.map(person)),
      note: skipped.length > 0 ? `Artıq bazada olduğu üçün atlandı (${skipped.length}): ${skipped.map((s) => s.email).join(", ")}` : undefined,
    };
  },

  import_carriers(result) {
    const r = result as R;
    const added = (r.addedCarriers as R[]) ?? [];
    return {
      title: `${added.length} daşıyıcı idxal edildi`,
      tone: "success",
      rows: [...row("Fayl", r.file), ...row("Kateqoriya", r.category)],
      items: items(added.map(person)),
      note: r.message,
    };
  },

  set_carrier_category(result) {
    const r = result as R;
    const names = (r.carriers as string[]) ?? [];
    return {
      title: r.category ? `${r.updated} daşıyıcı «${r.category}» kateqoriyasına qoyuldu` : `${r.updated} daşıyıcı kateqoriyadan çıxarıldı`,
      tone: "success",
      rows: [...row("Alt kateqoriya", r.subcategory)],
      items: items(names),
    };
  },

  list_categories(result) {
    const r = result as R;
    return {
      title: `Kateqoriyalar: ${(r.categories as R[]).length}`,
      tone: "info",
      items: items(
        (r.categories as R[]).map(
          (c) =>
            `${c.name}: ${c.carriers} daşıyıcı${(c.subcategories as R[]).length ? ` · alt: ${(c.subcategories as R[]).map((s) => `${s.name} (${s.carriers})`).join(", ")}` : ""}`,
        ),
      ),
      note: r.carriers_without_category ? `Kateqoriyasız daşıyıcı: ${r.carriers_without_category}` : undefined,
    };
  },

  remove_carriers(result) {
    const r = result as R;
    return {
      title: `${r.removed} daşıyıcı bazadan silindi`,
      tone: "success",
      items: items(((r.details as R[]) ?? []).map(person)),
    };
  },

  send_rfq_to_carriers(result) {
    const r = result as R;
    return {
      title: `RFQ #${r.rfq_id} ${r.sent} daşıyıcıya göndərildi`,
      tone: "success",
      items: items(((r.recipients as R[]) ?? []).map(person)),
      note: "Daşıyıcılar e-poçtdakı şəxsi linklə təklif göndərir.",
    };
  },

  get_quote_link(result) {
    const r = result as R;
    return {
      title: `RFQ #${r.rfq_id} üçün ictimai link`,
      tone: "success",
      rows: [{ label: "Link", value: String(r.link) }],
      note: "Linki istədiyiniz yerdə paylaşın; bu alət heç nə göndərmir.",
    };
  },

  list_offers(result) {
    const r = result as R;
    const offers = (r.offers as R[]) ?? [];
    const carriers = (r.carriers as R[]) ?? [];
    const count = (s: string) => carriers.filter((c) => c.status === s).length;
    return {
      title: `RFQ #${r.rfq.number}: ${offers.length} təklif`,
      tone: "info",
      rows: [
        ...row("Marşrut", r.rfq.route),
        ...row("Vəziyyət", r.rfq.status === "closed" ? "bağlı (qalib seçilib)" : "açıq"),
        ...row("Göndərilən daşıyıcı", carriers.length),
        ...row("Təklif alındı", count("Təklif alındı")),
        ...row("Baxıldı", count("Baxıldı")),
        ...row("Çatdırıldı", count("Çatdırıldı")),
        ...row("Çatdırılmadı", count("Çatdırılmadı")),
      ],
      items: items(
        offers.map(
          (o) =>
            `${o.carrier} · ${money(o.price, o.currency)}${o.transit_days ? ` · ${o.transit_days} gün` : ""}${o.is_winner ? " · QALİB" : ""}${o.versions ? ` · ${o.versions} köhnə versiya` : ""}`,
        ),
      ),
    };
  },

  compare_offers(result) {
    const r = result as R;
    if (!r.rankings) return null;
    const lines: string[] = [];
    for (const group of r.rankings as R[]) {
      for (const o of group.offers as R[]) {
        const eq = o.currency && o.currency !== "AZN" && o.price_azn !== null && o.price_azn !== undefined ? ` (≈ ${o.price_azn} AZN)` : "";
        const inc = o.includes ? ` · daxildir: ${o.includes}` : "";
        const exc = o.excludes ? ` · daxil deyil: ${o.excludes}` : "";
        lines.push(`${o.rank}. ${o.carrier} · ${money(o.price, o.currency ?? group.currency)}${eq}${inc}${exc}${o.transit_days ? ` · ${o.transit_days} gün` : ""}${o.is_winner ? " · QALİB" : ""}`);
      }
    }
    const note = [r.rate_note, r.warning].filter(Boolean).join(" ");
    return {
      title: `Təklif müqayisəsi (${r.criterion === "transit" ? "müddətə görə" : r.converted_to ? "qiymətə görə, AZN ilə" : "qiymətə görə"})`,
      tone: "info",
      items: items(lines),
      ...(note ? { note } : {}),
    };
  },

  route_price_history(result) {
    const r = result as R;
    if (!r.offers) return { title: `${r.origin} → ${r.destination}: keçmiş təklif yoxdur`, tone: "info" };
    const st = r.stats as R;
    const latest = (r.latest as R[]) ?? [];
    return {
      title: `${r.origin} → ${r.destination}: keçmiş qiymətlər`,
      tone: "info",
      rows: [
        ...row("Təklif sayı", `${r.offers} (${r.rfqs} sorğu)`),
        ...row("Orta", st ? `${st.avg_azn} AZN` : ""),
        ...row("Ən aşağı / ən yüksək", st ? `${st.min_azn} / ${st.max_azn} AZN` : ""),
      ],
      items: items(latest.map((i) => `#${i.rfq} · ${i.carrier} · ${money(i.price, i.currency)}${i.price_azn !== null && i.currency !== "AZN" ? ` (≈ ${i.price_azn} AZN)` : ""} · ${i.date}`)),
      note: st?.fx_date ? `AZN-ə çevirmə: Mərkəzi Bank məzənnəsi, ${st.fx_date}` : undefined,
    };
  },

  select_winner(result) {
    const r = result as R;
    const w = r.winner as R;
    return {
      title: `RFQ #${r.rfq_id}: qalib seçildi`,
      tone: "success",
      rows: [...row("Daşıyıcı", w.carrier), ...row("Qiymət", money(w.price, w.currency)), ...row("Müddət", w.transit_days ? `${w.transit_days} gün` : "")],
      note: "Sorğu bağlandı. Daşıyıcıya mesaj göndərilməyib.",
    };
  },

  cancel_winner(result) {
    const r = result as R;
    return {
      title: `RFQ #${r.rfq_id}: qalib seçimi ləğv edildi`,
      tone: "success",
      rows: [...row("Əvvəlki qalib", r.was_winner)],
      note: "Sorğu yenidən açıqdır.",
    };
  },

  offer_history(result) {
    const r = result as R;
    const lines: string[] = [];
    for (const c of r.carriers as R[]) {
      const earlier = (c.earlier_versions as R[]) ?? [];
      const trail = [...earlier.map((v) => `v${v.version}: ${money(v.price, v.currency)}`), `indi: ${money(c.current.price, c.current.currency)}`];
      lines.push(`${c.carrier}: ${trail.join(" → ")}`);
    }
    return { title: `RFQ #${r.rfq_id}: təklif tarixçəsi`, tone: "info", items: items(lines) };
  },

  send_reminders(result) {
    const r = result as R;
    return {
      title: `RFQ #${r.rfq_id}: ${r.reminded} daşıyıcıya xatırlatma göndərildi`,
      tone: "success",
      items: items(((r.recipients as R[]) ?? []).map(person)),
    };
  },

  create_customer_quote(result) {
    const r = result as R;
    const terms: Record<string, string> = {
      customs: "Gömrük rüsumları daxil deyil",
      insurance: "Sığorta daxil deyil",
      loading: "Yükləmə/boşaltma daxil deyil",
      dimensions: "Qiymət yalnız göstərilən həcm və çəkiyə görədir",
    };
    return {
      title: `Müştəri təklifi hazırdır: ${r.quote_number}`,
      tone: "success",
      rows: [
        ...row("RFQ", `#${r.rfq_id}`),
        ...row("Daşıyıcıdan alınan", r.carrier_price),
        ...row("Xidmət haqqı", r.service_fee),
        ...row("Müştəriyə satılan", r.customer_total),
        ...row("Etibarlıdır", r.valid_until),
      ],
      items: ((r.terms as string[]) ?? []).map((k) => terms[k] ?? k),
      note: r.validity_note,
    };
  },

  export_rfqs(result, p) {
    const r = result as R;
    const what = p.what === "offers" ? "təkliflər" : "RFQ-lar";
    const period =
      p.period === "today" ? "bu gün" : p.period === "date_range" ? `${p.start_date || "…"} – ${p.end_date || "…"}` : p.period === "selected" ? "seçilmiş RFQ-lar" : "hamısı";
    return {
      title: `Hesabat hazırdır (${String(r.format).toUpperCase()})`,
      tone: "success",
      rows: [...row("Məzmun", what), ...row("Dövr", period), ...row("Sətir sayı", r.rows)],
    };
  },

  get_dashboard(result) {
    const r = result as R;
    return {
      title: "Ümumi göstəricilər",
      tone: "info",
      rows: [
        ...row("Aktiv RFQ", r.active_rfqs),
        ...row("Gələn təkliflər", r.incoming_quotes),
        ...row("Tamamlanmış daşımalar", r.completed_shipments),
        ...row("Daşıyıcı sayı", r.carriers_count),
      ],
    };
  },
};

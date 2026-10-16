/** Today in Baku (UTC+4) as YYYY-MM-DD; the model has no clock and used to guess the year. */
export function bakuToday(now: number = Date.now()): string {
  return new Date(now + 4 * 3600_000).toISOString().slice(0, 10);
}

const WEEKDAYS_AZ = ["bazar", "bazar ertəsi", "çərşənbə axşamı", "çərşənbə", "cümə axşamı", "cümə", "şənbə"];

/** The line put before every user message so dates without a year are resolved against the real date. */
export function dateLine(now: number = Date.now()): string {
  const today = bakuToday(now);
  const weekday = WEEKDAYS_AZ[new Date(`${today}T00:00:00Z`).getUTCDay()];
  return `[Bu gün Bakı vaxtı ilə: ${today} (${weekday}). İli yazılmayan tarix bu gündən sonrakı ən yaxın tarixdir.]`;
}

/** A loading or delivery date that is already behind us is refused: the user is asked instead of a wrong year being sent to carriers. */
export function refusePastDate(label: string, value: string, now: number = Date.now()) {
  const day = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  const today = bakuToday(now);
  if (day < today) {
    throw new Error(
      `${label} (${day}) keçmişdədir (bu gün ${today}). İstifadəçi ili yazmayıbsa, bu gündən sonrakı ən yaxın tarixi yazın; yazıbsa və keçmişdədirsə, düzgün tarixi soruşun. Sorğunu hələ hazırlamayın.`,
    );
  }
}

const TOTAL_WORD = /(?:ümumi|cəmi|cəm\b|total|итого|всего|общий)[^\d]{0,25}(\d[\d .,]*)\s*(kq|kg|ton(?:na)?|t\b|тонн?|т\b)/i;

/** "Ümumi çəki 10 ton" while the items add up to 11,5 t: the user should see the difference. */
export function totalMismatchWarning(text: string, itemsKg: number): string | null {
  const m = TOTAL_WORD.exec(text);
  if (!m || !(itemsKg > 0)) return null;
  const n = Number(m[1].replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const kg = /^(kq|kg)$/i.test(m[2]) ? n : n * 1000;
  if (Math.abs(kg - itemsKg) / Math.max(kg, itemsKg) <= 0.02) return null;
  return `Mətndə ümumi çəki ${kg} kq yazılıb, ayrı-ayrı yüklərin cəmi isə ${itemsKg} kq. Hansının düzgün olduğunu yoxlayın.`;
}

const DIM_NUMBER = "(\\d+(?:[.,]\\d+)?)";
const DIMENSIONS = new RegExp(`${DIM_NUMBER}\\s*(m|sm|cm|mm)?\\s*[x×*]\\s*${DIM_NUMBER}\\s*(m|sm|cm|mm)?\\s*[x×*]\\s*${DIM_NUMBER}\\s*(m|sm|cm|mm)?(?![\\w])`, "gi");

/** Sizes that do not fit a standard truck or container (OOG): only a warning, the RFQ is never blocked. */
export function oversizeWarnings(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(DIMENSIONS)) {
    const nums = [m[1], m[3], m[5]].map((x) => Number(x.replace(",", ".")));
    const unit = (m[2] || m[4] || m[6] || "").toLowerCase();
    const factor = unit === "mm" ? 0.001 : unit === "cm" || unit === "sm" ? 0.01 : unit === "m" ? 1 : Math.min(...nums) > 20 ? 0.01 : 1;
    const [a, b, c] = nums.map((x) => x * factor).sort((x, y) => y - x);
    if (!(c > 0) || a > 60) continue;
    if (a > 13.6 || b > 2.45 || c > 2.5) {
      out.push(
        `Ölçülər (${m[0].trim()}) standart tent maşın/konteyner qabaritini aşa bilər (OOG): flat-rack, açıq üst və ya low-bed lazım ola bilər. Daşıyıcılara bunu qeyddə bildirin.`,
      );
    }
  }
  return [...new Set(out)];
}

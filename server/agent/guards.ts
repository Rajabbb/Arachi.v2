/**
 * Checks made before the model sees a message. Prompt rules alone were not enough in the
 * 11 Oct 2026 live test (a Russian question was answered in Azerbaijani; a joke and a Python
 * program were written on request), so these two are done in code.
 */

export type Lang = "az" | "ru" | "en";

const letters = (text: string) => text.match(/\p{L}/gu) ?? [];

/** The language of a message when it is clearly Russian or English; null = leave it to the model. */
export function clearLanguage(text: string): Exclude<Lang, "az"> | null {
  const all = letters(text);
  if (all.length < 6) return null;
  const cyrillic = all.filter((c) => /\p{Script=Cyrillic}/u.test(c)).length;
  if (cyrillic / all.length > 0.5) return "ru";
  // Azerbaijani/Turkish letters mean it is not English.
  if (/[əıöüşçğİƏÖÜŞÇĞ]/.test(text)) return null;
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length < 3) return null;
  const english = new Set(
    "the is are was were what which how why when where who please with from for and to of can could would should you your my our do does did this that these those i we need want have has between difference about tell show give create make send list quote shipment cargo carrier carriers freight offer offers price prices container truck transport transportation delivery loading date a an write me script code program function list sorts it in on is of".split(" "),
  );
  const hits = words.filter((w) => english.has(w)).length;
  return hits >= 2 && hits / words.length >= 0.3 ? "en" : null;
}

const names: Record<Exclude<Lang, "az">, string> = { ru: "Russian", en: "English" };

/** A note to put in front of the user's message so the model answers in its language. */
export function languageNote(text: string): string {
  const lang = clearLanguage(text);
  return lang ? `The user's latest message is in ${names[lang]}: write the whole answer in ${names[lang]}.` : "";
}

const freight =
  /rfq|sorğu|yük|daşı|nəqliyyat|logist|forwarder|incoterm|\b(exw|fca|fas|fob|cfr|cif|cpt|cip|dap|dpu|ddp)\b|konteyner|palet|\btır\b|maşın|gömrük|hs\s*kod|\badr\b|təklif|qiymət|carrier|freight|shipment|cargo|truck|container|quote|offer|arachi|tarif|hesabat|excel|\bpdf\b|kateqoriya|\bbaza|müştəri|qalib|xatırlat|tarixçə|analitika|отчёт|отчет|клиент|перевоз|груз|контейнер|таможн|фрахт|тариф|поставк|заявк|экспедит/i;

const codeRequest =
  /\b(python|javascript|typescript|java|c\+\+|c#|php|sql|html|css|react|node\.?js|bash|excel\s*makro)\b|kod(?:u|lar)?\s+yaz|proqram\s+yaz|script\s+yaz|write\s+(?:me\s+)?(?:a\s+|some\s+)?(?:code|program|script|function)|напиши\s+(?:мне\s+)?(?:код|программу|скрипт|функцию)/i;

const entertainment =
  /zarafat|lətifə|\bjoke\b|анекдот|şeir\s+yaz|poem|стих|hekayə\s+yaz|\bstory\b|рассказ|resept|\brecipe\b|рецепт|horoskop|hava\s+proqnozu/i;

/** Asking for the system prompt, the instructions or the list of tools (the 11 Oct 2026 test 3 got the list). */
const promptProbe = new RegExp(
  [
    "system\\s*prompt", "sistem\\s*(?:prompt|təlimat)", "gizli\\s*təlimat",
    "(?:sənin|sizin|öz|daxili)\\s+təlimat", "your\\s+(?:system\\s+)?(?:instructions|prompt|rules)",
    "ignore\\s+(?:all\\s+)?(?:previous|prior)\\s+instructions", "əvvəlki\\s+təlimat\\w*\\s+(?:unut|nəzərə\\s+alma)",
    "debug\\s*mode", "developer\\s*mode", "admin(?:istrator)?\\s*mode",
    "alət(?:lər)?\\w*\\s+(?:siyahı|list|adları|adlar)", "siyahı\\w*\\s+alət", "hansı\\s+alətlər(?:in)?\\s+var",
    "(?:list|show|print|reveal)\\s+(?:all\\s+)?(?:your\\s+|the\\s+)?(?:tools|functions)", "tool\\s+names",
    "список\\s+(?:инструментов|функций)", "системн\\w+\\s+(?:промпт|инструкци)", "твои\\s+инструкции", "покажи\\s+(?:свои\\s+)?(?:инструкции|промпт)",
  ].join("|"),
  "i",
);

const probeRefusals: Record<Lang, string> = {
  az: "Daxili təlimatları və alətlərin texniki siyahısını paylaşa bilmirəm. Arachi platforması üzrə kömək edə bilərəm: sorğu yaratmaq və göndərmək, daşıyıcı bazası, təkliflərin müqayisəsi, müştəri təklifi və hesabatlar. Hansında kömək edim?",
  ru: "Я не могу делиться внутренними инструкциями и техническим списком инструментов. Могу помочь с платформой Arachi: создание и отправка запросов, база перевозчиков, сравнение предложений, коммерческие предложения и отчёты. С чем помочь?",
  en: "I can't share my internal instructions or the technical list of tools. I can help with the Arachi platform: creating and sending RFQs, the carrier base, comparing offers, customer quotes and reports. Which of these can I help with?",
};

/** Tool names look like list_rfqs / send_rfq_to_carriers; they must never reach the user. */
const toolName = /\b(?:list|create|add|send|get|set|remove|import|export|compare|select|cancel|offer|find|update|delete)_[a-z]+(?:_[a-z]+)*\b/;

/** The answer to show instead of `reply` when it names the agent's tools; null when it is fine. */
export function internalsRefusal(reply: string, userText: string): string | null {
  return toolName.test(reply) ? probeRefusals[clearLanguage(userText) ?? "az"] : null;
}

const refusals: Record<Lang, string> = {
  az: "Mən yalnız Arachi platforması və yükdaşıma işləri ilə bağlı kömək edirəm: sorğu yaratmaq və göndərmək, daşıyıcı bazası, təkliflərin müqayisəsi, müştəri təklifi və hesabatlar. Bunlardan hansında kömək edim?",
  ru: "Я помогаю только с платформой Arachi и грузоперевозками: создание и отправка запросов, база перевозчиков, сравнение предложений, коммерческие предложения и отчёты. С чем из этого помочь?",
  en: "I only help with the Arachi platform and freight work: creating and sending RFQs, the carrier base, comparing offers, customer quotes and reports. Which of these can I help with?",
};

/**
 * A short refusal when the message is plainly outside the platform's work (a joke, a story, a
 * program to write) and has nothing to do with freight; null otherwise. Messages with an
 * attachment are never refused here: the model reads the file.
 */
export function scopeRefusal(text: string, attachmentCount: number): string | null {
  if (attachmentCount > 0) return null;
  const clean = text.trim();
  if (promptProbe.test(clean)) return probeRefusals[clearLanguage(clean) ?? "az"];
  if (!clean || freight.test(clean)) return null;
  if (!codeRequest.test(clean) && !entertainment.test(clean)) return null;
  return refusals[clearLanguage(clean) ?? "az"];
}

# Arachi V2

Arachi platformasının AI ilə işləyən yeni versiyası. İstifadəçi AI agentlə söhbət edir (mətn yazır və ya fayl əlavə edir), AI isə prosesləri onun yerinə görür: xüsusi parametr qeyd olunmayıbsa default parametrlərlə, qeyd olunubsa onlara uyğun.

> Bu repozitoriya arachi.co layihəsindən tam ayrıdır.

## Stek

- React 19 + TypeScript + Vite (interfeys)
- Node + Anthropic SDK (agent serveri, Claude `claude-opus-5-5`)

## İşə salmaq

```bash
npm install
cp .env.example .env   # ANTHROPIC_API_KEY dəyərini yazın
npm run server         # agent serveri, http://localhost:8787
npm run dev            # interfeys; /api sorğuları serverə yönləndirilir
npm test               # alətlərin testləri
```

API açarı yalnız serverdə (`.env`) saxlanılır, brauzerə heç vaxt göndərilmir. `.env` git-ə düşmür.

## Struktur

- `src/` — interfeys
  - `components/` — mesaj siyahısı və mətn/fayl sahəsi
  - `lib/agent.ts` — `POST /api/chat` çağırışı (`sendToAgent`)
- `shared/protocol.ts` — interfeys ilə server arasındakı sorğu/cavab tipləri
- `server/` — agent serveri
  - `index.ts` — HTTP endpoint (`POST /api/chat`, `GET /api/health`)
  - `agent/loop.ts` — tool-use dövrəsi: Claude-u çağırır, istədiyi alətləri işlədir, cavab hazır olana qədər təkrarlayır
  - `agent/prompt.ts` — sistem təlimatı
  - `agent/files.ts` — əlavə olunmuş faylları Claude-un oxuya biləcəyi formaya salır (şəkil, PDF, mətn/CSV/JSON)
  - `agent/tools/registry.ts` — alətlər reyestri və "standart parametrlər + istifadəçinin dəyişiklikləri" məntiqi
  - `agent/tools/index.ts` — bütün alətlərin qeydiyyatı
  - `agent/tools/*.ts` — arachi.co prosesləri (aşağıdakı cədvəl), hər birinin yanında `*.test.ts`
  - `domain/` — RFQ, daşıyıcı, göndərmə, təklif, fayl və analitika məntiqi
  - `db/` — SQLite (`node:sqlite`), `schema.ts` ardıcıl miqrasiyalardır
  - `notify/` — email/WhatsApp/Telegram göndərmə interfeysi (hazırda yalnız jurnala yazır)
  - `links.ts` — daşıyıcı linkləri üçün imzalı tokenlər
  - `routes/` — daşıyıcı təklif səhifəsi API-si, fayl yükləmə, analitika
- `src/pages/` — daşıyıcının təklif səhifəsi (`/quote/:token`) və analitika paneli (`/panel`)

## Proseslər (agent alətləri)

| # | Proses | Alət(lər) | Standart parametrlər |
|---|---|---|---|
| 1 | RFQ yaratmaq | `create_rfq`, `list_rfqs` | Quru nəqliyyat, USD, tarixlər çevik, təklif müddəti 3 gün |
| 2 | AI ilə avtomatik doldurma | `autofill_rfq` | PDF/şəkil/Excel/mətndən; tam olanda RFQ dərhal yaradılır |
| 3 | Daşıyıcılara göndərmək | `send_rfq_to_carriers`, `list_outbox` | RFQ-nin nəqliyyat növünə uyğun daşıyıcılar, email, təkrar göndərmə yox |
| 4 | Daşıyıcı bazası | `add_carriers`, `import_carriers`, `list_carriers`, `remove_carriers` | Kateqoriya Quru, dil az; eyni email yenilənir |
| 5 | Daşıyıcının təklif səhifəsi | `get_quote_link` + `/quote/:token` səhifəsi | Girişsiz, AZ/EN, mobil |
| 6 | Gələn təkliflər və statuslar | `list_offers`, `record_offer` | Göndərildi, Çatdırıldı, Baxıldı, Təklif alındı, Çatdırılmadı |
| 7 | Müqayisə və qalib seçmək | `compare_offers`, `select_winner` | Qiymətə görə, qalibə bildiriş |
| 8 | Xatırlatma | `send_reminders` | 24 saatdan bir, ən çox 3 dəfə, baxıb cavab verməyənlər də daxil |
| 9 | Təklif tarixçəsi | `offer_history` | v1, v2, ... və dəyişiklik |
| 10 | Rəsmi təklif PDF və ixrac | `create_customer_quote`, `export_rfqs` | Xidmət haqqı 10%, daşıyıcı adı gizli, 7 gün etibarlı; ixrac Excel |
| 11 | Analitika paneli | `get_dashboard` + `/panel` səhifəsi | Son 30 gün |

Mesajlar hələ real göndərilmir: `server/notify/` hər mesajı server jurnalına və `outbox` cədvəlinə yazır. Real email/WhatsApp/Telegram üçün `setProvider(...)` ilə provayder qoşmaq kifayətdir. Verilənlər `data/arachi.db` faylındadır (git-ə düşmür).

Testlər: `npm test`.

## Yeni alət (proses) əlavə etmək

1. `server/agent/tools/` altında `AgentTool` yazın (`datetime.ts` ən sadə nümunədir, `rfq.ts` real prosesdir).
2. Hər parametr üçün `default` verin. Default-u olan parametri model yalnız istifadəçi açıq şəkildə başqa dəyər istədikdə doldurur, qalan hallarda default tətbiq olunur. Default-u olmayan parametr məcburidir.
3. `server/agent/tools/index.ts`-də `register(...)` ilə qeydiyyatdan keçirin.

## Söhbət tarixçəsi

Server vəziyyət saxlamır. Hər cavabla birlikdə tam söhbət (`transcript`) qaytarılır, interfeys onu dəyişmədən növbəti mesajla geri göndərir. Tarixçə yalnız sona əlavə olunur, köhnə hissələr dəyişdirilmir. Növbəti addımda bu verilənlər bazasına köçürülə bilər.

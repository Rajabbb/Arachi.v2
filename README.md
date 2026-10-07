# Arachi V2

Arachi platformasının AI ilə işləyən yeni versiyası. İstifadəçi AI agentlə söhbət edir (mətn yazır və ya fayl əlavə edir), AI isə prosesləri onun yerinə görür: xüsusi parametr qeyd olunmayıbsa default parametrlərlə, qeyd olunubsa onlara uyğun.

> Bu repozitoriya arachi.co layihəsindən tam ayrıdır.

## Stek

- React 19 + TypeScript + Vite (interfeys)
- Node agent serveri; AI provayderi seçilir: Claude (Anthropic SDK, `claude-opus-5-5`, defolt) və ya Google Gemini (Google GenAI SDK, `gemini-3.8-flash`)
- Supabase (Postgres) verilənlər bazası; Supabase qurulmayıbsa yerli SQLite faylı
- Resend ilə email göndərmə; açar yoxdursa email yalnız jurnala yazılır

## İşə salmaq

```bash
npm install
cp .env.example .env   # AI_PROVIDER və uyğun açarı yazın (aşağıda "AI provayderi")
npm run server         # agent serveri, http://localhost:8787
npm run dev            # interfeys; /api sorğuları serverə yönləndirilir
npm test               # alətlərin testləri (SQLite)
npm run test:pg        # eyni testlər Postgres-də (PGlite, Supabase miqrasiyaları ilə)
npm run migrate        # miqrasiyaları DATABASE_URL bazasına tətbiq edir
```

## Hesablar və giriş

Söhbət və panel yalnız hesaba daxil olduqdan sonra açılır. Daşıyıcının təklif səhifəsi (`/quote/:token`) əvvəlki kimi girişsizdir: emaildəki imzalı link kifayətdir.

- Qeydiyyat: email + şifrə (ən azı 8 simvol), ad istəyə görə. Şifrə bazada yalnız `scrypt` heşi kimi saxlanılır.
- Giriş 30 gün yadda qalır (`httpOnly` cookie). "Çıxış" düyməsi sessiyanı bitirir. Eyni email üçün 10 səhv şifrədən sonra giriş 15 dəqiqəlik bağlanır.
- Şifrəni unutmusunuz: giriş ekranında "Şifrəni unutmusunuz?" basın, emailə 60 dəqiqəlik, bir dəfəlik link gəlir (Resend ilə, `EMAIL_FROM` ünvanından). Resend qurulmayıbsa link server jurnalında (`npm run server` pəncərəsində) görünür. Linkdəki ünvan `PUBLIC_BASE_URL`-dən götürülür. Yeni şifrə təyin olunanda bütün köhnə sessiyalar bağlanır.
- Hər istifadəçi yalnız öz RFQ-lərini, daşıyıcılarını, təkliflərini, göndərilmiş mesajlarını və panel rəqəmlərini görür. Agentin alətləri də daxil olmuş istifadəçinin adından işləyir.
- Hesablardan əvvəl yaradılmış məlumatlar (RFQ-lər, daşıyıcılar, mesajlar) **ilk qeydiyyatdan keçən** hesaba keçir. Ona görə yeniləmədən sonra ilk hesabı özünüz açın. O vaxta qədər köhnə RFQ-lərin daşıyıcı linkləri açılmır.

Yeni `.env` dəyəri lazım deyil: sessiya tokenləri təsadüfi yaradılır və bazada yalnız heşi saxlanılır.

## AI provayderi

Agent iki AI xidməti ilə işləyə bilir. Seçim serverdəki `.env` faylında edilir, agentin bacardıqları (alətlər, fayl oxuma, söhbət tarixçəsi) hər ikisində eynidir:

| `AI_PROVIDER` | Xidmət | Açar | Model (istəyə görə) |
|---|---|---|---|
| `anthropic` (defolt) | Claude | `ANTHROPIC_API_KEY` | `AGENT_MODEL`, defolt `claude-opus-5-5` |
| `gemini` | Google Gemini | `GEMINI_API_KEY` | `GEMINI_MODEL`, defolt `gemini-3.8-flash` |

### Gemini açarını almaq (Google AI Studio)

1. [aistudio.google.com/apikey](https://aistudio.google.com/apikey) səhifəsini açın və Google hesabınızla daxil olun. İlk dəfədirsə, şərtləri qəbul edin: AI Studio sizin üçün avtomatik Google Cloud layihəsi yaradır.
2. **Create API key** düyməsini basın (lazım olsa layihəni seçin) və yaranan açarı kopyalayın.
3. `.env`-də yazın:
   ```
   AI_PROVIDER=gemini
   GEMINI_API_KEY=<açar>
   ```
4. Serveri yenidən başladın (`npm run server`). Jurnalda `AI: gemini (gemini-3.8-flash)` görünməlidir.

Pulsuz istifadə limitləri və qiymətlər dəyişə bilir, ona görə onları burada yazmırıq: rəsmi saytda yoxlayın ([ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing) və [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)). Xərcə nəzarət üçün Google Cloud Console-da büdcə xəbərdarlığı qurmaq tövsiyə olunur.

Başqa Gemini modeli istəsəniz `GEMINI_MODEL`-ə rəsmi model siyahısındakı ([ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models)) adı yazın, məsələn daha ucuz `gemini-3.5-flash-lite`.

### Müvəqqəti xətalar və ehtiyat model

AI xidməti bəzən müvəqqəti yüklənir (`503 UNAVAILABLE`, "high demand"), limit dolur (`429`) və ya bağlantı qırılır. Server belə hallarda sorğunu avtomatik təkrarlayır: defolt olaraq 3 dəfə, getdikcə artan gözləmə ilə (təxminən 1, 2, 4 saniyə). Səhv sorğu və ya etibarsız açar kimi xətalar təkrarlanmır. Təkrar sayını `AI_MAX_RETRIES` ilə dəyişmək olar (0 = təkrar yoxdur). Claude üçün də eyni say işləyir.

Gemini üçün istəyə görə ehtiyat model də qurmaq olar: əsas model bütün təkrarlardan sonra da cavab vermirsə, sorğu ona göndərilir.
```
GEMINI_FALLBACK_MODEL=gemini-3.5-flash-lite
```
Ad rəsmi model siyahısından götürülməlidir. Bütün cəhdlər alınmasa, istifadəçi "AI xidməti müvəqqəti yüklənib, bir az sonra yenidən cəhd edin." mesajını görür, real xəta isə server jurnalına yazılır.

Qeydlər:
- Provayderi dəyişəndə açıq söhbət yenidən başlayır (iki xidmətin söhbət formatı fərqlidir). RFQ-lər, daşıyıcılar və digər məlumatlar bazada qalır.
- Gemini şəkilləri (PNG, JPEG, WEBP), PDF-ləri, Excel/CSV və mətn fayllarını oxuyur. GIF Gemini-də dəstəklənmir, model bunu istifadəçiyə bildirir.

## Supabase və Resend

Açarları heç vaxt chat-a, koda və ya git-ə yazmayın: yalnız serverdəki `.env` faylına. Dəyişənlər boş qalsa, layihə yerli rejimdə işləyir (SQLite faylı və jurnala yazılan email).

### Supabase (verilənlər bazası)

1. Supabase layihəsində yuxarıdakı **Connect** düyməsini basın (və ya **Project Settings → Database**), **Session pooler** connection string-i kopyalayın. Bu variant IPv4 ilə də işləyir.
2. Sətirdəki `[YOUR-PASSWORD]` yerinə layihəni yaradarkən verdiyiniz verilənlər bazası parolunu yazın. Parolu unutmusunuzsa: **Project Settings → Database → Reset database password**.
3. `.env`-də: `DATABASE_URL=postgresql://postgres.<layihə-id>:<parol>@aws-0-<region>.pooler.supabase.com:5432/postgres`
4. `npm run migrate` əmrini işlədin (server də başlayanda yeni miqrasiyaları özü tətbiq edir).

Server bazaya birbaşa qoşulur, Supabase Data API və `anon`/`publishable` açarlar istifadə olunmur. Bütün cədvəllərdə RLS aktivdir və heç bir policy yoxdur, ona görə həmin açarlarla cədvəllərə çatmaq mümkün deyil. Bağlantı TLS ilə şifrələnir. Sertifikatın tam yoxlanması üçün **Project Settings → Database → SSL Configuration**-dan sertifikatı yükləyib yolunu `DATABASE_SSL_CA`-ya yazın.

### Resend (email)

1. **Domains → Add Domain**: göndərəcəyiniz domeni əlavə edin, göstərilən DNS yazılarını (SPF, DKIM) domen panelinizə əlavə edin və **Verify** basın.
2. **API Keys → Create API Key**: **"Full access"** seçin (göndərmək üçün "Sending access" kifayətdir, amma məktubun çatıb-çatmadığını, geri qayıtdığını oxumaq üçün "Full access" lazımdır). Açarı `.env`-də `RESEND_API_KEY`-ə yazın.
3. `EMAIL_FROM`: təsdiqlənmiş domendə ünvan, məsələn `Arachi <rfq@sizin-domen.az>`.
4. `EMAIL_REPLY_TO` (istəyə görə): daşıyıcılar emailə "Cavab ver" basanda məktub bu ünvana gedir, məsələn komandanın real poçtu.

Daşıyıcılar təklifi emaildəki şəxsi linklə göndərir, ona görə gələn emailləri sistemə qəbul etmək lazım deyil. WhatsApp və Telegram hələ yalnız jurnala yazılır.

### Emailin real statusu (bounce)

Resend məktubu qəbul edəndə göndəriş **Göndərildi** olur. Sonra server Resend-dən məktubun taleyini soruşur və statusu dəyişir:

- çatdı → **Çatdırıldı**; daşıyıcı açdı (Resend-də open tracking aktivdirsə) → **Baxıldı**
- geri qayıtdı (bounce), spam şikayəti, Resend-in bloklist-i (suppressed) → **Çatdırılmadı**, səbəbi paneldə "Çatdırılmayan göndərişlər" cədvəlində və agentin cavablarında görünür

Bunun iki yolu var:

1. **Sorğu (polling)**, `localhost`-da da işləyir: server hər dəqiqə və panel açılanda son 7 gündə göndərilmiş, nəticəsi hələ bilinməyən emailləri Resend-dən soruşur (təzə məktubları tez-tez, köhnələri seyrək, ən çoxu 2 saatdan bir). Bunun üçün `RESEND_API_KEY` "Full access" olmalıdır. Server jurnalında `Email delivery status: checked with Resend every minute` görünür.
2. **Webhook**, sayt internetdə yerləşdiriləndən sonra (localhost-a Resend çata bilmir): Resend → **Webhooks → Add Endpoint**, ünvan `https://<sizin-sayt>/api/webhooks/resend`, hadisələr `email.delivered`, `email.bounced`, `email.complained`, `email.suppressed`, `email.failed`, `email.opened`. Göstərilən **Signing secret**-i (`whsec_...`) `.env`-də `RESEND_WEBHOOK_SECRET`-ə yazın. Secret olmasa da webhook işləyir, amma onda server hadisəyə inanmır, statusu Resend API-dən özü yoxlayır. Bounce səbəbinin mətni (məs. "Address not found") yalnız imzalı webhook ilə gəlir; polling yalnız statusu bilir.

### Real qoşulmanı yoxlamaq

Açarları `.env`-ə yazdıqdan sonra `npm run migrate` "Database is up to date." yazmalıdır. `npm run server` başlayanda jurnalda `Database: Postgres` və `Email: Resend` görünməlidir. Sonra agentə özünüzü daşıyıcı kimi əlavə etdirib bir RFQ göndərin və emailin gəldiyini yoxlayın.

API açarı yalnız serverdə (`.env`) saxlanılır, brauzerə heç vaxt göndərilmir. `.env` git-ə düşmür.

## Struktur

- `src/` — interfeys
  - `components/` — mesaj siyahısı, mətn/fayl sahəsi və söhbət tarixçəsi (`ConversationList.tsx`)
  - `lib/agent.ts` — `POST /api/chat` çağırışı (`sendToAgent`)
- `shared/protocol.ts` — interfeys ilə server arasındakı sorğu/cavab tipləri
- `server/` — agent serveri
  - `agent/loop.ts` — tool-use dövrəsi: modeli çağırır, istədiyi alətləri işlədir, cavab hazır olana qədər təkrarlayır; provayderdən asılı deyil
  - `agent/providers/` — AI provayderləri: `types.ts` ümumi interfeys, `anthropic.ts` (Claude), `gemini.ts` (Google Gemini), `index.ts` `AI_PROVIDER`-ə görə seçim
  - `agent/prompt.ts` — sistem təlimatı
  - `agent/history.ts` — saxlanmış söhbətdən modelə nə qədər keçmiş göndərildiyi
  - `agent/files.ts` — əlavə olunmuş faylları modelin oxuya biləcəyi ümumi formaya salır (şəkil, PDF, Excel, mətn/CSV/JSON); hər provayder onu öz formatına çevirir
  - `agent/tools/registry.ts` — alətlər reyestri və "standart parametrlər + istifadəçinin dəyişiklikləri" məntiqi
  - `agent/tools/index.ts` — bütün alətlərin qeydiyyatı
  - `agent/tools/*.ts` — arachi.co prosesləri (aşağıdakı cədvəl), hər birinin yanında `*.test.ts`
  - `domain/` — RFQ, daşıyıcı, göndərmə, təklif, fayl və analitika məntiqi
  - `db/` — verilənlər bazası: `index.ts` ümumi interfeys (`db().all/get/run`, `transaction`), `postgres.ts` Supabase bağlantısı və miqrasiya icrası, `migrations/*.sql` Postgres sxemi, `sqlite.ts` və `sqliteSchema.ts` yerli SQLite. Sxem dəyişikliyi hər ikisinə əlavə olunur
  - `notify/` — email/WhatsApp/Telegram göndərmə interfeysi; email Resend ilə (`resend.ts`), qalanları hələ yalnız jurnala yazır
  - `auth/` — hesablar: şifrə heşi (`password.ts`), qeydiyyat, giriş, sessiya və şifrə bərpası (`accounts.ts`), sorğunun hansı istifadəçi adından işlədiyi (`current.ts`)
  - `app.ts` — HTTP marşrutları (`/api/auth/*`, `/api/chat`, `/api/dashboard`, ...); `index.ts` serveri başladır
  - `links.ts` — daşıyıcı linkləri üçün imzalı tokenlər
  - `routes/` — daşıyıcı təklif səhifəsi API-si, fayl yükləmə, analitika
- `src/pages/` — daşıyıcının təklif səhifəsi (`/quote/:token`), analitika paneli (`/panel`, sorğular siyahısı ilə), hər sorğunun ayrıca səhifəsi (`/panel/rfq/:id`), giriş/qeydiyyat və şifrə bərpası (`/reset/:token`)

## Proseslər (agent alətləri)

| # | Proses | Alət(lər) | Standart parametrlər |
|---|---|---|---|
| 1 | RFQ yaratmaq | `create_rfq`, `list_rfqs` | Quru nəqliyyat, USD, tarixlər çevik, təklif müddəti 3 gün |
| 2 | AI ilə avtomatik doldurma | `autofill_rfq` | PDF/şəkil/Excel/mətndən; tam olanda RFQ dərhal yaradılır |
| 3 | Daşıyıcılara göndərmək | `send_rfq_to_carriers`, `list_outbox` | RFQ-nin nəqliyyat növünə uyğun daşıyıcılar, email, təkrar göndərmə yox |
| 4 | Daşıyıcı bazası | `add_carriers`, `import_carriers`, `update_carriers`, `subcategory_to_category`, `list_carriers`, `remove_carriers` | Hər daşıyıcı öz kateqoriyası ilə: Quru/Dəniz/Hava/Dəmiryolu və ya öz adınız (A, B, VIP); yoxdursa Quru, dil az; ad və ya email bazada varsa əlavə olunmur |
| 5 | Daşıyıcının təklif səhifəsi | `get_quote_link` + `/quote/:token` səhifəsi | Girişsiz, AZ/EN, mobil |
| 6 | Gələn təkliflər və statuslar | `list_offers`, `record_offer` | Göndərildi, Çatdırıldı, Baxıldı, Təklif alındı, Çatdırılmadı |
| 7 | Müqayisə və qalib seçmək | `compare_offers`, `select_winner` | Qiymətə görə, qalibə bildiriş |
| 8 | Xatırlatma | `send_reminders` | 24 saatdan bir, ən çox 3 dəfə, baxıb cavab verməyənlər də daxil |
| 9 | Təklif tarixçəsi | `offer_history` | v1, v2, ... və dəyişiklik |
| 10 | Rəsmi təklif PDF və ixrac | `create_customer_quote`, `export_rfqs` | Xidmət haqqı 10%, daşıyıcı adı gizli, 7 gün etibarlı; bütün RFQ-lərin hesabatı Excel (Xülasə, RFQ-lər, Təkliflər, Statuslar), paneldə "Excel hesabatı yüklə" düyməsi |
| 11 | Analitika paneli | `get_dashboard` + `/panel` səhifəsi və hər RFQ üçün `/panel/rfq/:id` | Son 30 gün |

Hər mesaj `outbox` cədvəlinə yazılır. Email `RESEND_API_KEY` və `EMAIL_FROM` qurulubsa Resend ilə real göndərilir, qurulmayıbsa yalnız jurnala yazılır. WhatsApp/Telegram üçün `setProvider(...)` ilə provayder qoşmaq kifayətdir. Verilənlər `DATABASE_URL` qurulubsa Supabase-də, qurulmayıbsa `data/arachi.db` faylındadır (git-ə düşmür).

Testlər: `npm test`.

## Yeni alət (proses) əlavə etmək

1. `server/agent/tools/` altında `AgentTool` yazın (`datetime.ts` ən sadə nümunədir, `rfq.ts` real prosesdir).
2. Hər parametr üçün `default` verin. Default-u olan parametri model yalnız istifadəçi açıq şəkildə başqa dəyər istədikdə doldurur, qalan hallarda default tətbiq olunur. Default-u olmayan parametr məcburidir.
3. `server/agent/tools/index.ts`-də `register(...)` ilə qeydiyyatdan keçirin.

## Söhbət tarixçəsi

Hər istifadəçinin söhbətləri verilənlər bazasında saxlanılır (`conversations`, `conversation_messages`). Söhbət ekranının solunda (telefonda ☰ düyməsi ilə) söhbətlərin siyahısı var: ən son istifadə olunan yuxarıda, "Yeni söhbət" düyməsi və hər söhbət üçün silmə (təsdiqlə). Başlıq ilk mesajdan avtomatik götürülür (60 simvola qədər). Girişdən sonra ən son söhbət açılır, söhbət yoxdursa boş yeni söhbət.

- Mesajlar: mətn, əlavə olunmuş faylların adı/ölçüsü (faylın özü yox) və agentin yaratdığı yükləmə linkləri.
- AI-ın yaddaşı: köhnə söhbəti davam etdirəndə model həmin söhbətin son 20 addımını görür (`config.historyTurns`). Şəkil və PDF-lər yalnız son 3 addımda saxlanılır (`config.attachmentTurns`), köhnələrin yerinə qeyd qalır ki, baza böyüməsin.
- Hər sorğu yalnız daxil olmuş istifadəçinin söhbətlərinə baxır; başqasının söhbəti "tapılmadı" (404) qaytarır.
- API: `GET /api/conversations`, `GET /api/conversations/:id`, `DELETE /api/conversations/:id`; `POST /api/chat` `conversationId` qəbul edir (boşdursa yeni söhbət yaradılır).

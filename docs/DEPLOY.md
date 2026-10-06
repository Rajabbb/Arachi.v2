# İnternetdə yerləşdirmə (Render)

Bu addımlardan sonra V2 internetdə öz ünvanında işləyəcək (məsələn `https://arachi-v2.onrender.com`). Daşıyıcılara gedən təklif linkləri, şifrə bərpası linkləri və agentin verdiyi panel linkləri artıq `localhost` yox, bu ünvan olacaq.

Hər şey bir xidmətdir: eyni server həm interfeysi, həm də API-ni verir. Məlumatlar Supabase-də qalır, email Resend ilə (`sorgu@v2.arachi.co`), AI Gemini ilə işləyir. Mövcud arachi.co saytına, onun poçtuna (info@, rfq@) və DNS yazılarına heç nə toxunmur.

> Açarları heç vaxt chat-a, koda və ya GitHub-a yazmayın. Onlar yalnız Render-in **Environment** bölməsinə yazılır.

## Lazım olanlar

- GitHub hesabınız (Rajabbb)
- Kompüterinizdəki `.env` faylı (`C:\Users\Rajab\arachi-git\.env`). Oradakı dəyərləri Render-ə köçürəcəksiniz. Faylı açmaq üçün: Fayl Explorer-də papkanı açın, `.env` faylına sağ klik edin, **Open with → Notepad**.

## 1. Render hesabı

1. [render.com](https://render.com) saytını açın, sağ yuxarıda **Get Started** basın.
2. **GitHub** düyməsini seçin və GitHub hesabınızla daxil olun. Render icazə istəyəndə **Authorize** basın.
3. Email təsdiqi istənsə, poçtunuza gələn linkə basın.

## 2. Xidməti yaratmaq (Blueprint)

Repozitoriyada `render.yaml` faylı var, Render bütün ayarları ondan özü oxuyur.

1. Render panelində yuxarıda **New +** basın, **Blueprint** seçin.
2. **Connect a repository** hissəsində `Rajabbb/Arachi.v2` görünməlidir. Görünmürsə, **Configure account** basın, GitHub-da `Arachi.v2` repozitoriyasına icazə verin və geri qayıdın.
3. `Arachi.v2` yanında **Connect** basın.
4. **Blueprint Name** sahəsinə istənilən ad yazın, məsələn `arachi-v2`. Branch `main` olsun.
5. Aşağıda Render boş dəyərləri soruşacaq. Hər birini `.env` faylınızdan kopyalayıb yapışdırın (bərabərlik işarəsindən **sonrakı** hissəni, dırnaqsız):

   | Sahə | Haradan |
   |---|---|
   | `GEMINI_API_KEY` | `.env`-dəki `GEMINI_API_KEY` |
   | `DATABASE_URL` | `.env`-dəki `DATABASE_URL` (Supabase **Session pooler** sətri, parol daxil) |
   | `RESEND_API_KEY` | `.env`-dəki `RESEND_API_KEY` |
   | `EMAIL_FROM` | `.env`-dəki `EMAIL_FROM` (məsələn `Arachi <sorgu@v2.arachi.co>`) |

   `AI_PROVIDER=gemini` və `GEMINI_MODEL=gemini-3.5-flash-lite` artıq hazır yazılıb.
6. **Deploy Blueprint** (bəzən **Apply** adlanır) basın. Render kodu yükləyir, qurur (`npm run build`) və işə salır. Bu bir neçə dəqiqə çəkə bilər. İrəliləyişi **Logs** bölməsində görmək olar.
7. Hazır olanda xidmətin səhifəsində yuxarıda yaşıl **Live** yazısı və ünvan görünür, məsələn `https://arachi-v2.onrender.com`. Ad tutulubsa, Render sonuna bir neçə simvol əlavə edir.

`PUBLIC_BASE_URL` yazmağa ehtiyac yoxdur: server Render-in verdiyi ünvanı özü götürür. **Logs**-da belə sətir görünməlidir:
```
Links in emails and chat point to https://arachi-v2.onrender.com
```
Həmçinin `Database: Postgres (DATABASE_URL)` və `Email: Resend` sətirlərini yoxlayın. Bazanın yeni cədvəlləri (miqrasiyalar) hər başlanğıcda avtomatik tətbiq olunur.

## 3. Yoxlamaq

1. Ünvanı brauzerdə açın, öz hesabınızla daxil olun (eyni Supabase bazasıdır, hesabınız və RFQ-ləriniz yerindədir).
2. Agentə özünüzü daşıyıcı kimi əlavə etdirin və bir RFQ göndərin. Emaildəki link `https://...onrender.com/quote/...` ilə başlamalıdır. Linki telefondan da açın.
3. "Şifrəni unutmusunuz?" ilə bərpa emaili istəyin, link yenə Render ünvanında olmalıdır.

## 4. İstəyə görə: Resend webhook

Sayt artıq internetdə olduğu üçün Resend bounce-ları dərhal xəbər verə bilər (bunsuz da server Resend-dən hər dəqiqə soruşur):

1. Resend → **Webhooks → Add Endpoint**, ünvan `https://<sizin-ünvan>/api/webhooks/resend`.
2. Hadisələr: `email.delivered`, `email.bounced`, `email.complained`, `email.suppressed`, `email.failed`, `email.opened`. **Add** basın.
3. Göstərilən **Signing secret**-i (`whsec_...`) kopyalayın. Render-də xidmətinizi açın, solda **Environment → Add Environment Variable**: açar `RESEND_WEBHOOK_SECRET`, dəyər həmin secret. **Save Changes** basın, xidmət özü yenidən başlayır.

`EMAIL_REPLY_TO` istifadə edirsinizsə, onu da eyni yolla əlavə edin.

## Pulsuz planın məhdudiyyəti

Pulsuz planda xidmət təxminən 15 dəqiqə heç kim açmayanda "yatır". Kimsə yenidən açanda (siz və ya linkə basan daşıyıcı) ilk açılış təxminən bir dəqiqə gecikir, sonra normal işləyir. Məlumatlar itmir, çünki Supabase-dədir. Bu gecikmə olmasın deyə xidmətin səhifəsində **Settings → Instance Type**-dan ödənişli plana keçmək olar (qiymət render.com/pricing səhifəsindədir).

## Yeniləmələr

`main`-ə yeni dəyişiklik birləşəndə Render onu özü qurub yerləşdirir (**Events** bölməsində görünür). Kompüterinizdə heç nə etmək lazım deyil.

## Sonra: öz domeniniz (istəyə görə)

`onrender.com` əvəzinə, məsələn, `app.v2.arachi.co` istəsəniz: Render-də **Settings → Custom Domains → Add**, Render bir **CNAME** yazısı göstərir. Namecheap-də yalnız həmin **yeni** CNAME yazısını əlavə edin; mövcud MX, SPF, DKIM yazılarına (arachi.co poçtu və Resend) toxunmayın. Sonra Render-in **Environment**-ində `PUBLIC_BASE_URL=https://app.v2.arachi.co` yazın.

## Problem olsa

- **Build failed**: **Logs**-da qırmızı sətirləri kopyalayıb Claude-a göndərin (açar varsa, silin).
- **Could not open the database**: `DATABASE_URL` səhvdir. Supabase-də **Session pooler** sətrini (5432 portu) götürdüyünüzü və `[YOUR-PASSWORD]` yerinə parol yazdığınızı yoxlayın.
- **Email: log only**: `RESEND_API_KEY` və ya `EMAIL_FROM` boşdur.

## Başqa hostinq

Repozitoriyada ümumi `Dockerfile` də var: Railway, Fly.io və ya istənilən Docker hostinqində eyni dəyişənlərlə işləyir (orada `PUBLIC_BASE_URL`-i saytın ünvanı ilə mütləq yazın). Docker olmadan: `npm ci --include=dev && npm run build`, sonra `npm start`; server `PORT` dəyişənindəki portu dinləyir.

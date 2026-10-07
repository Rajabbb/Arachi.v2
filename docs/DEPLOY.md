# İnternetdə yerləşdirmə (VPS)

Bu addımlardan sonra V2 öz ünvanında, məsələn `https://app.v2.arachi.co`, işləyəcək. Daşıyıcılara gedən təklif linkləri, şifrə bərpası linkləri və agentin verdiyi panel linkləri artıq `localhost` yox, bu ünvan olacaq.

Serverdə iki proqram işləyir, ikisi də Docker-də:

- **app**: V2-nin özü (həm interfeys, həm API). Bazanın yeni cədvəlləri (miqrasiyalar) hər başlanğıcda avtomatik tətbiq olunur.
- **caddy**: qapıçı. `https://` sertifikatını Let's Encrypt-dən özü alır, özü yeniləyir və gələn sorğuları app-ə ötürür.

Məlumatlar Supabase-də qalır, email Resend ilə (`sorgu@v2.arachi.co`), AI Gemini ilə işləyir. Mövcud arachi.co saytına, onun poçtuna (info@, rfq@) və mövcud DNS yazılarına heç nə toxunmur: DNS-də yalnız **bir yeni** yazı əlavə olunur.

> Açarları heç vaxt chat-a, koda və ya GitHub-a yazmayın. Onlar yalnız serverdəki `.env` faylına yazılır.

## Lazım olanlar

- VPS: **Ubuntu 24.04**, ən azı **2 GB RAM** (1 GB-da quraşdırma yaddaş çatışmazlığından dayana bilər), 1 vCPU, 20 GB disk kifayətdir.
- VPS-in **IP ünvanı** və **root parolu** (və ya SSH açarı). Provayder bunları VPS yaradılanda göstərir və ya emaillə göndərir.
- Namecheap hesabı (arachi.co domeni oradadır).
- Kompüterinizdəki `.env` faylı (`C:\Users\Rajab\arachi-git\.env`). Açmaq üçün: Fayl Explorer-də papkanı açın, `.env` faylına sağ klik, **Open with → Notepad**.

Aşağıda `SIZIN_IP` gördüyünüz hər yerə VPS-in IP ünvanını yazın (məsələn `203.0.113.10`).

## 1. DNS: ünvanı VPS-ə yönəltmək

1. Namecheap-ə daxil olun, **Domain List**, `arachi.co` yanında **Manage**, yuxarıda **Advanced DNS**.
2. **Host Records** hissəsində **Add New Record** basın:
   - Type: **A Record**
   - Host: `app.v2`
   - Value: `SIZIN_IP`
   - TTL: **Automatic**
3. Yaşıl işarəyə (✓) basıb saxlayın.

Başqa heç bir yazını dəyişməyin və silməyin (MX, SPF/TXT, DKIM və `v2` üçün Resend yazıları olduğu kimi qalır). Yeni yazının işləməsi adətən bir neçə dəqiqə, bəzən bir saata qədər çəkir.

## 2. VPS-ə qoşulmaq

1. Kompüterdə **Start** düyməsini basın, `PowerShell` yazın, **Windows PowerShell**-i açın.
2. Yazın və **Enter** basın:
   ```
   ssh root@SIZIN_IP
   ```
3. İlk dəfə `Are you sure you want to continue connecting` soruşulsa, `yes` yazıb **Enter** basın.
4. Parolu soruşanda yapışdırın (sağ klik) və **Enter** basın. Parol yazılanda ekranda heç nə görünmür, bu normaldır.

Sətrin əvvəlində `root@...:~#` görünəndə serverin içindəsiniz. Aşağıdakı bütün əmrləri bu pəncərəyə yapışdırıb (sağ klik) **Enter** basırsınız.

## 3. Docker və firewall

Bu əmrlər bir dəfə, ardıcıl icra olunur:

```
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw --force enable
```

Yoxlamaq üçün `docker compose version` yazın: versiya nömrəsi görünməlidir.

## 4. Kodu yükləmək

```
git clone https://github.com/Rajabbb/Arachi.v2.git /opt/arachi-v2
cd /opt/arachi-v2
```

## 5. `.env` faylı (sirlər)

1. Serverdə faylı açın:
   ```
   nano .env
   ```
2. Kompüterinizdə Notepad-də açdığınız `.env`-in **bütün** məzmununu kopyalayın (Ctrl+A, Ctrl+C) və PowerShell pəncərəsinə sağ kliklə yapışdırın.
3. Ən aşağıya bu sətri əlavə edin (ox düymələri ilə aşağı enin):
   ```
   APP_DOMAIN=app.v2.arachi.co
   ```
4. Faylda `PUBLIC_BASE_URL=...` sətri varsa, onu silin: ünvanı `APP_DOMAIN`-dən server özü qurur (`https://app.v2.arachi.co`).
5. Bunların dolu olduğunu yoxlayın: `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.5-flash-lite`, `DATABASE_URL`, `RESEND_API_KEY`, `EMAIL_FROM`.
6. Saxlamaq: **Ctrl+O**, **Enter**, sonra çıxmaq: **Ctrl+X**.
7. Faylı yalnız root oxuya bilsin:
   ```
   chmod 600 .env
   ```

## 6. İşə salmaq

```
docker compose up -d --build
```

İlk dəfə bir neçə dəqiqə çəkir (proqram qurulur). Sonra loglara baxın:

```
docker compose logs -f app
```

Bu sətirlər görünməlidir:

```
Database: Postgres (DATABASE_URL)
Email: Resend
Agent server listening on port 8787
Links in emails and chat point to https://app.v2.arachi.co
```

Logdan çıxmaq üçün **Ctrl+C** (proqram işləməyə davam edir). Sertifikatın alındığını görmək üçün `docker compose logs caddy` yazın: `certificate obtained successfully` sətri olmalıdır.

## 7. Yoxlamaq

1. Brauzerdə `https://app.v2.arachi.co` açın, öz hesabınızla daxil olun (eyni Supabase bazasıdır, hesabınız və RFQ-ləriniz yerindədir). Ünvan sətrində qıfıl işarəsi olmalıdır.
2. Agentə özünüzü daşıyıcı kimi əlavə etdirin və bir RFQ göndərin. Emaildəki link `https://app.v2.arachi.co/quote/...` ilə başlamalıdır. Linki telefondan da açın.
3. "Şifrəni unutmusunuz?" ilə bərpa emaili istəyin, link yenə bu ünvanda olmalıdır.

## 8. İstəyə görə: Resend webhook

Sayt internetdə olduğu üçün Resend bounce-ları dərhal xəbər verə bilər (bunsuz da server Resend-dən hər dəqiqə soruşur):

1. Resend → **Webhooks → Add Endpoint**, ünvan `https://app.v2.arachi.co/api/webhooks/resend`.
2. Hadisələr: `email.delivered`, `email.bounced`, `email.complained`, `email.suppressed`, `email.failed`, `email.opened`. **Add** basın.
3. Göstərilən **Signing secret**-i (`whsec_...`) kopyalayın. Serverdə `cd /opt/arachi-v2 && nano .env`, ən aşağıya `RESEND_WEBHOOK_SECRET=` yazıb secret-i yapışdırın, saxlayın (Ctrl+O, Enter, Ctrl+X), sonra:
   ```
   docker compose up -d
   ```

## Yeniləmələr

`main`-ə yeni dəyişiklik birləşəndən sonra serverə qoşulun (addım 2) və yazın:

```
cd /opt/arachi-v2 && sh deploy/update.sh
```

Skript son kodu çəkir, proqramı yenidən qurur və işə salır; miqrasiyalar başlanğıcda özü tətbiq olunur. Sonda hər iki xidmət `Up` (app üçün `healthy`) görünməlidir.

Kompüterinizdə əvvəlki kimi `npm run server` və `npm run dev` ilə yerli işləmək olar, eyni bazanı istifadə edir. Yerli linklər isə `localhost` olaraq qalır.

## Faydalı əmrlər

Hamısı `/opt/arachi-v2` papkasında (`cd /opt/arachi-v2`):

- Vəziyyət: `docker compose ps`
- Son loglar: `docker compose logs --tail 100 app`
- Yenidən başlatmaq (məsələn `.env` dəyişəndən sonra): `docker compose up -d`
- Dayandırmaq: `docker compose down` (məlumatlar Supabase-də olduğu üçün itmir)

Server yenidən yüklənəndə (reboot) hər iki xidmət özü yenidən başlayır.

## Problem olsa

- **Brauzer saytı açmır və ya sertifikat xətası**: DNS yazısı hələ yayılmayıb və ya IP səhvdir. `docker compose logs caddy` yazın; xəta varsa, bir neçə dəqiqə gözləyib `docker compose restart caddy` edin. Xəta qalırsa, logdakı qırmızı sətirləri Claude-a göndərin.
- **`APP_DOMAIN is missing in .env`**: addım 5-dəki `APP_DOMAIN=` sətri yoxdur.
- **Could not open the database**: `DATABASE_URL` səhvdir. Supabase-də **Session pooler** sətrini (5432 portu) götürdüyünüzü və `[YOUR-PASSWORD]` yerinə parol yazdığınızı yoxlayın.
- **Email: log only**: `RESEND_API_KEY` və ya `EMAIL_FROM` boşdur.
- **Quraşdırma `Killed` ilə dayanır**: VPS-in yaddaşı azdır (2 GB lazımdır).

Logu Claude-a göndərməzdən əvvəl içində açar və ya parol varsa, silin.

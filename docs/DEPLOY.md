# İnternetdə yerləşdirmə (VPS)

Bu addımlardan sonra V2 öz ünvanında, məsələn `https://app.v2.arachi.co`, işləyəcək. Daşıyıcılara gedən təklif linkləri, şifrə bərpası linkləri və agentin verdiyi panel linkləri artıq `localhost` yox, bu ünvan olacaq.

Serverdə üç proqram işləyir, hamısı Docker-də:

- **app**: V2-nin özü (həm interfeys, həm API). Bazanın yeni cədvəlləri (miqrasiyalar) hər başlanğıcda avtomatik tətbiq olunur.
- **caddy**: qapıçı. `https://` sertifikatını Let's Encrypt-dən özü alır, özü yeniləyir və gələn sorğuları app-ə ötürür.
- **backup**: hər gün bazanın ehtiyat nüsxəsini serverə yazır ("Etibarlılıq və təhlükəsizlik" bölməsi).

Məlumatlar Supabase-də qalır, email Resend ilə (`sorgu@v2.arachi.co`), AI Gemini ilə işləyir. Mövcud arachi.co saytına, onun poçtuna (info@, rfq@) və mövcud DNS yazılarına heç nə toxunmur: DNS-də yalnız **bir yeni** yazı əlavə olunur.

> Açarları heç vaxt chat-a, koda və ya GitHub-a yazmayın. Onlar yalnız serverdəki `.env` faylına yazılır.

## Lazım olanlar

- VPS: **Ubuntu 24.04**, ən azı **1 GB RAM** (2 GB-dan az olanda addım 3-də əlavə swap yaddaşı açılır), 1 vCPU, 20 GB disk kifayətdir.
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

Sətrin əvvəlində `root@...` görünəndə serverin içindəsiniz. Bəzi provayderlərdə serverin əmr pəncərəsi `fish` olur; aşağıdakı əmrlərin eyni işləməsi üçün əvvəlcə `bash` yazıb **Enter** basın (hər yeni qoşulmada bir dəfə). Aşağıdakı bütün əmrləri bu pəncərəyə yapışdırıb (sağ klik) **Enter** basırsınız.

## 3. Docker və firewall

Bu əmrlər bir dəfə, ardıcıl icra olunur:

```
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
apt install -y ufw
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw --force enable
```

Yoxlamaq üçün `docker compose version` yazın: versiya nömrəsi görünməlidir.

VPS-in yaddaşı 2 GB-dan azdırsa, quraşdırma yaddaş çatışmazlığından dayanmasın deyə 2 GB əlavə (swap) yaddaş açın:

```
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

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

Skript son kodu çəkir, proqramı yenidən qurur və işə salır; miqrasiyalar başlanğıcda özü tətbiq olunur. Sonda üç xidmət (`app`, `caddy`, `backup`) `Up` (app üçün `healthy`) görünməlidir.

Kompüterinizdə əvvəlki kimi `npm run server` və `npm run dev` ilə yerli işləmək olar, eyni bazanı istifadə edir. Yerli linklər isə `localhost` olaraq qalır.

## Faydalı əmrlər

Hamısı `/opt/arachi-v2` papkasında (`cd /opt/arachi-v2`):

- Vəziyyət: `docker compose ps`
- Son loglar: `docker compose logs --tail 100 app`
- Yenidən başlatmaq (məsələn `.env` dəyişəndən sonra): `docker compose up -d`
- Dayandırmaq: `docker compose down` (məlumatlar Supabase-də olduğu üçün itmir)

- Bazanın ehtiyat nüsxələri: `ls -lh backups`

Server yenidən yüklənəndə (reboot) bütün xidmətlər özü yenidən başlayır.

## Etibarlılıq və təhlükəsizlik

Serverdə üç xidmət işləyir: **app**, **caddy** və **backup**. Proqramın içində bunlar artıq var, sizdən heç nə tələb etmir:

- Server və ya Docker yenidən başlayanda hər üç xidmət özü qalxır.
- Giriş səhifəsində bir email üçün 10 səhv şifrədən sonra 15 dəqiqəlik kilid; bir ünvandan (IP) 15 dəqiqədə 30-dan çox giriş cəhdi, saatda 5-dən çox qeydiyyat və ya şifrə bərpası istəyi qəbul olunmur.
- Yeni hesab yaratmaq bağlıdır: yalnız ilk hesab (sizinki) var. Kiməsə hesab açmaq lazım olsa, `.env`-ə `ALLOW_SIGNUP=true` yazıb `docker compose up -d` edin, o qeydiyyatdan keçəndən sonra sətri silib yenə `docker compose up -d` edin.
- Brauzerə təhlükəsizlik başlıqları gedir (yalnız https, başqa saytın içində açılmamaq).
- `/healthz` ünvanı yalnız baza da cavab verəndə "OK" deyir.

### Bazanın ehtiyat nüsxəsi (backup)

Supabase-in pulsuz planı bazanın ehtiyat nüsxəsini saxlamır. Ona görə **backup** xidməti hər gün bazanın nüsxəsini serverdə `/opt/arachi-v2/backups` papkasına yazır (`arachi-2026-10-08.sql.gz` kimi) və son 14 günü saxlayır. Bu, Supabase-də məlumat təsadüfən silinsə və ya layihə itsə, geri qaytarmaq üçündür.

Yoxlamaq (serverdə, `cd /opt/arachi-v2`):

```
docker compose logs backup
ls -lh backups
```

Logda `Backup saved: arachi-...sql.gz` görünməlidir. `Backup FAILED` görünsə, üstündəki sətirləri (parolu silib) Claude-a göndərin.

Server özü də sıradan çıxa bilər, ona görə ayda bir dəfə son nüsxəni kompüterinizə endirin. Kompüterdə **PowerShell** açın (serverə qoşulmadan) və yazın (tarixi `ls -lh backups`-da gördüyünüzlə əvəz edin):

```
scp root@SIZIN_IP:/opt/arachi-v2/backups/arachi-2026-10-08.sql.gz .
```

Fayl PowerShell-in açıldığı papkaya (adətən `C:\Users\Rajab`) düşür.

Nüsxədən bərpa etmək lazım olsa, özünüz heç nə icra etməyin: Claude-a yazın, vəziyyətə uyğun addımları verəcək (bərpa mövcud məlumatın üzərinə yazır).

### Serverin avtomatik təhlükəsizlik yeniləmələri

Ubuntu təhlükəsizlik yamalarını özü quraşdıra bilər. Bir dəfə icra edin (`bash` yazdıqdan sonra):

```
apt install -y unattended-upgrades
echo 'APT::Periodic::Update-Package-Lists "1"; APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20auto-upgrades
systemctl enable --now unattended-upgrades
systemctl is-enabled docker
```

Sonuncu əmr `enabled` yazmalıdır (Docker server açılanda özü başlayır). `disabled` yazsa: `systemctl enable docker`.

Bəzi yeniləmələr (məsələn nüvə) serverin yenidən başlamasını tələb edir. Ayda bir dəfə serverə qoşulub `ls /var/run/reboot-required` yazın: `No such file` cavabı gəlsə, heç nə lazım deyil; fayl görünsə, `reboot` yazın. Server 1-2 dəqiqəyə qalxır və sayt özü işə düşür (yoxlamaq üçün brauzerdə açın).

### Sayt düşəndə xəbər almaq (pulsuz)

1. [uptimerobot.com](https://uptimerobot.com) saytında pulsuz hesab açın.
2. **New monitor** (və ya **Add New Monitor**) basın:
   - Monitor type: **HTTP(s)**
   - URL: `https://app.v2.arachi.co/healthz`
   - Interval: **5 minutes**
3. Bildiriş üçün öz emailinizi seçin və saxlayın.

Sayt və ya baza 5 dəqiqədən çox cavab verməsə, email gələcək; düzələndə də xəbər verəcək.

### İstəyə görə: parolsuz SSH girişi (açarla)

İndi serverə root parolu ilə girirsiniz. İnternetdəki botlar hər gün bu cür parolları təxmin etməyə çalışır. Açarla giriş daha təhlükəsizdir, amma səhv edilsə, serverə girişi bağlaya bilər, ona görə addımları sırası ilə edin və 3-cü addımı yalnız 2-ci addım işləyəndən sonra edin.

1. Kompüterdə **PowerShell** açın (serverə qoşulmadan) və yazın:
   ```
   ssh-keygen -t ed25519
   ```
   Hər sualda sadəcə **Enter** basın. Sonra açarı serverə köçürün (parol bir dəfə soruşulacaq):
   ```
   type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@SIZIN_IP "mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys"
   ```
2. Yeni PowerShell pəncərəsində `ssh root@SIZIN_IP` yazın. Parol **soruşulmadan** içəri girirsinizsə, açar işləyir. Parol soruşulursa, dayanın və 3-cü addımı etməyin; Claude-a yazın.
3. Yalnız 2-ci addım işlədisə, serverdə (`bash` yazdıqdan sonra) parolla girişi bağlayın:
   ```
   echo 'PasswordAuthentication no' > /etc/ssh/sshd_config.d/00-no-password.conf
   systemctl reload ssh
   ```
   Bu pəncərəni bağlamadan yeni PowerShell-də yenə `ssh root@SIZIN_IP` ilə girişi yoxlayın.

Bundan sonra serverə yalnız bu kompüterdən girmək olur. Kompüter itsə və ya dəyişsə, VPS provayderinin saytındakı **Console** (brauzerdə terminal) ilə girib `rm /etc/ssh/sshd_config.d/00-no-password.conf && systemctl reload ssh` yazın, parolla giriş geri qayıdır.

## Problem olsa

- **Brauzer saytı açmır və ya sertifikat xətası**: DNS yazısı hələ yayılmayıb və ya IP səhvdir. `docker compose logs caddy` yazın; xəta varsa, bir neçə dəqiqə gözləyib `docker compose restart caddy` edin. Xəta qalırsa, logdakı qırmızı sətirləri Claude-a göndərin.
- **`APP_DOMAIN is missing in .env`**: addım 5-dəki `APP_DOMAIN=` sətri yoxdur.
- **Could not open the database**: `DATABASE_URL` səhvdir. Supabase-də **Session pooler** sətrini (5432 portu) götürdüyünüzü və `[YOUR-PASSWORD]` yerinə parol yazdığınızı yoxlayın.
- **Email: log only**: `RESEND_API_KEY` və ya `EMAIL_FROM` boşdur.
- **`Yeni hesab yaratmaq bağlıdır`**: bu normaldır, yuxarıda "Etibarlılıq və təhlükəsizlik" bölməsinə baxın.
- **Quraşdırma `Killed` ilə dayanır**: VPS-in yaddaşı azdır. Addım 3-dəki swap əmrlərini icra edib yenidən cəhd edin.

Logu Claude-a göndərməzdən əvvəl içində açar və ya parol varsa, silin.

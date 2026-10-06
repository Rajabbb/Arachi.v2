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
  - `agent/tools/datetime.ts` — nümunə alət
  - `agent/tools/index.ts` — bütün alətlərin qeydiyyatı

## Yeni alət (proses) əlavə etmək

1. `server/agent/tools/` altında `AgentTool` yazın (`datetime.ts` nümunədir).
2. Hər parametr üçün `default` verin. Default-u olan parametri model yalnız istifadəçi açıq şəkildə başqa dəyər istədikdə doldurur, qalan hallarda default tətbiq olunur. Default-u olmayan parametr məcburidir.
3. `server/agent/tools/index.ts`-də `register(...)` ilə qeydiyyatdan keçirin.

## Söhbət tarixçəsi

Server vəziyyət saxlamır. Hər cavabla birlikdə tam söhbət (`transcript`) qaytarılır, interfeys onu dəyişmədən növbəti mesajla geri göndərir. Tarixçə yalnız sona əlavə olunur, köhnə hissələr dəyişdirilmir. Növbəti addımda bu verilənlər bazasına köçürülə bilər.

# Arachi V2

Arachi platformasının AI ilə işləyən yeni versiyası. İstifadəçi AI agentlə söhbət edir (mətn yazır və ya fayl əlavə edir), AI isə prosesləri onun yerinə görür: xüsusi parametr qeyd olunmayıbsa default parametrlərlə, qeyd olunubsa onlara uyğun.

> Bu repozitoriya arachi.co layihəsindən tam ayrıdır.

## Stek

- React 19 + TypeScript
- Vite

## İşə salmaq

```bash
npm install
npm run dev
```

## Struktur

- `src/components/MessageList.tsx` — mesaj siyahısı
- `src/components/Composer.tsx` — mətn sahəsi, fayl əlavə etmə (düymə və ya sürüşdürüb atmaq), "Göndər"
- `src/lib/agent.ts` — AI backend üçün yer tutucu (`sendToAgent`). Hazırda demo cavab qaytarır; real API qoşulanda yalnız bu funksiya dəyişəcək.

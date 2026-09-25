# BUM ERP — PROFESSIONAL ERP + MOLIYA AUDITI (asosiy holat fayli)

> **HAR SESSIYA BOSHIDA SHU FAYLNI O'QI.** Keyin `ERP-AUDIT-PROGRESS.md` (qayerda to'xtalgan),
> `ERP-AUDIT-ISSUES.md` (topilmalar) va `ERP-AUDIT-CHECKLIST.md` (nima tekshirildi).
> Topshiriq matni: egasining 2026-09-25 dagi "PROFESSIONAL ERP + MOLIYA AUDIT MASTER-TASK" xabari
> (13 bo'lim). Qisqa mazmuni pastda.

## Ish qoidalari (egasi talabi)

1. Faqat kod o'qib "hammasi yaxshi" deyilmaydi — DB → backend → API → permission →
   buxgalteriya → hisobot → PDF → brauzer zanjiri real tekshiriladi.
2. Har topilma formati: ID, SEVERITY, MODULE, BUSINESS IMPACT, ROOT CAUSE, CURRENT/EXPECTED,
   AFFECTED TABLES/API/UI/REPORT/ACCOUNTING, FIX PLAN, TEST PLAN, STATUS
   (`ERP-AUDIT-ISSUES.md` da).
3. Parallel "haqiqat" yaratilmaydi: qarz, to'langan summa, kassa, bank, buxgalteriya —
   bitta manbadan (tranzaksiya/hujjatlardan) hisoblanadi. Migratsiya faqat qo'shuvchi va xavfsiz.
4. O'chirish yo'q — bekor qilish = CANCELLED/REVERSED + teskari yozuvlar, atomik, idempotent,
   ruxsat bilan, audit izi bilan. Jurnal DELETE qilinmaydi.
5. "READY" faqat real tekshiruvdan keyin va CRITICAL/HIGH qolmaganda.
6. **To'xtatish/davom ettirish:** egasi orada boshqa vazifa bersa — `ERP-AUDIT-PROGRESS.md`
   ga "AUDIT PAUSED" bloki yoziladi (modul, qadam, bajarilgan/jami, joriy muammo, keyingi
   qadam), yangi vazifa bajariladi, keyin "AUDIT RESUMED" bilan o'sha joydan davom etiladi.
   Tekshiruv boshidan boshlanmaydi.
7. Loyiha qoidalari o'z kuchida: `CLAUDE.md` (MIGRATION_STATUS har sessiya oxirida),
   xotira qoidalari (kam xotirali mashinada testlar bo'lak-bo'lak, deploy ruxsati bor).

## Topshiriq bo'limlari (qisqa)

| # | Bo'lim | Mazmuni |
|---|---|---|
| 1 | Mijoz qarzi muddat bo'yicha | hozirgi qarz, istalgan sanaga qarz, oyma-oy (boshlang'ich + sotuv − to'lov = yakuniy), manba operatsiyalar, FROM→TO, aging 0–7/8–30/31–60/61–90/90+, mijoz hisob-kitobi (akt), Excel/PDF, faqat tranzaksiya manbalaridan |
| 2 | Bekor qilish arxitekturasi | bog'langanlarni aniqlash → ko'rsatish → tasdiq → atomik reversal → status CANCELLED/REVERSED → audit izi → kassa/qarz/ombor/jurnal/yetkazma/KPI tiklanishi, fiskal cheklov, idempotentlik, ruxsat, yuqori xavf uchun qo'shimcha tasdiq |
| 3 | Moliyaviy zanjirlar | mijoz, ta'minotchi, xarajat, o'tkazma, depozit, qaytarish, yetkazma — double entry, balans, ombor, qarz, to'lov, bekor, hisobot mosligi |
| 4 | 50 modul 0→100 | auth → production readiness |
| 5 | 7 biznes turi | supermarket, minimarket, ulgurji, distribyutor, sotuv agenti, yetkazma, aralash |
| 7 | Real testlar | DB, API, integratsiya, E2E, PDF, multi-tenant, parallel, reconciliation, invariantlar |
| 8 | Yagona haqiqat manbai | parallel hisob-kitoblar yaqinlashtiriladi |
| 9 | Doimiy holat fayllari | shu papka |

## Fayllar

- `ERP-AUDIT-PROGRESS.md` — joriy faza, qadam, keyingi qadam, pauza/davom bloklari, commit/deploy.
- `ERP-AUDIT-ISSUES.md` — topilmalar reestri (ID `AUD-###`).
- `ERP-AUDIT-CHECKLIST.md` — 50 modul × tekshiruv turlari, 7 biznes × jarayon.
- Oldingi auditlar (manba sifatida): `FINANCE_AUDIT.md` (F-1…F-6), `FINAL-ACCEPTANCE-AUDIT-v3.md`,
  `FINAL-SALE-READINESS-AUDIT*.md`.

## Rejalashtirilgan fazalar

| Faza | Mazmuni | Holat |
|---|---|---|
| A0 | Holat fayllari, oldingi auditlarni yig'ish | ✅ |
| A1 | Moliya zanjirlari xaritasi (kod o'qish, dalil bilan) | ⏳ |
| A2 | Real reconciliation testlari (API/DB): sotuv→to'lov→bekor→qarz/kassa/jurnal/ombor | ⏳ |
| A3 | CRITICAL/HIGH tuzatishlar: to'lovni bekor qilish, bog'langan reversal, kassa farqi | ⏳ |
| A4 | Mijoz qarzi: tarixiy balans, oyma-oy, akt, aging, Excel/PDF | ⏳ |
| A5 | Qolgan modullar auditi (4-bo'lim ro'yxati) | ⏳ |
| A6 | 7 biznes senariysi (API darajasida simulyatsiya + tanlangan E2E) | ⏳ |
| A7 | Qayta test, deploy, yakuniy xulosa | ⏳ |

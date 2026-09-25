# Audit jarayoni

## Joriy holat

- **Faza:** A1 — moliya zanjirlari xaritasi
- **Qadam:** mijoz qarzi, ta'minotchi/kassa/xarajat va ombor/yetkazma zanjirlarini kod bo'yicha xaritalash
- **Keyingi qadam:** A2 — real reconciliation testlari
- **Oxirgi commit (audit boshida):** `0a56135` (feat/postgres-migration)
- **Migratsiya:** 0086 gacha (`apps/api/src/db/migrations`), audit hali migratsiya qo'shmagan
- **Deploy:** audit o'zgarishlari hali deploy qilinmagan

## Jurnal

### 2026-09-25 — AUDIT BOSHLANDI
- Holat fayllari yaratildi.
- Oldingi topilmalar tekshirildi: F-1 (kassa farqi jurnalga tushmaydi) va F-2 (mijoz to'lovini
  bekor qilish yo'q) — **hozirgi kodda ham OCHIQ** (`grep` bo'yicha to'lov uchun reverse/cancel
  marshruti yo'q; hisoblar rejasida kamomad/ortiqcha hisobi yo'q).

### 2026-09-25 — A1 YAKUNLANDI, ARXITEKTURA QARORI
A1 natijasi: 27 topilma (AUD-001…AUD-027): CRITICAL 2 (AUD-001 to'lovni bekor qilish yo'q,
AUD-010 kassa farqi), HIGH 10, MEDIUM 11, LOW 3, ijobiy 1 (tenant izolyatsiyasi).

**Qaror — yagona haqiqat manbai = buxgalteriya jurnali, kontragent o'lchovi bilan:**
- `journal_lines` ga `party_type` + `party_id` (qo'shuvchi migratsiya). Debitor (1100) va kreditor
  (2000) hisobiga yozadigan har qatorda mijoz/ta'minotchi ko'rsatiladi; eski yozuvlar referens
  bo'yicha backfill qilinadi.
- Mijoz qarzi (hozirgi, istalgan sanaga, oyma-oy, akt, manba operatsiyalar) = shu subhisob qatorlari
  yig'indisi (bekor qilinmagan yozuvlar, `entry_date` bo'yicha). `customers.total_debt` — kesh bo'lib
  qoladi, lekin har doim shu subhisob bilan solishtiriladi (reconciliation endpoint + test invarianti).
- Aging — ochiq hujjatlar (FIFO/taqsimot) asosida qoladi, lekin boshlang'ich qarz hujjati va
  taqsimot yozuvlari bilan to'ldiriladi.
- Bekor qilish — o'chirish emas: status REVERSED + TESKARI yozuvlar (asl yozuv saqlanadi), bitta
  tranzaksiya, `FOR UPDATE` + holat tekshiruvi (idempotent), sabab majburiy, `finance.approve`,
  audit izi; avval "bog'langan operatsiyalar" ko'rinishi (preview), keyin tasdiq.

**A3 tartibi:** (1) migratsiya 0087 + jurnal kontragenti + backfill; (2) mijoz to'lovini bekor
qilish (AUD-001) + taqsimot yozuvlari (AUD-003); (3) kassa farqi (AUD-010); (4) davr qulfi
(AUD-011), qo'lda kassa nazorat hisoblari (AUD-012), inventarizatsiya jurnali (AUD-021);
(5) ta'minotchi to'lovi / xarajat / o'tkazma bekor qilish (AUD-013); (6) A4 — mijoz va ta'minotchi
akti, tarixiy qarz, aging, Excel/PDF.

### 2026-09-25 — A3 (1)–(2) bajarildi (commit qilinmagan)
- Migratsiya `0087_finance_party_reversal.sql`: `journal_lines.party_type/party_id` (+ backfill mijoz va
  ta'minotchi bo'yicha), `customer_payments`/`payments` holati (posted/reversed + kim/qachon/sabab),
  `customer_payment_allocations` jadvali.
- `postJournalEntry({ party })` — nazorat hisoblari qatoriga kontragent (24 ta chaqiriq joyi).
- Qo'lda ombor harakati kreditorga yozolmaydi (UI ro'yxatidan ham olib tashlandi).
- AUD-001: `GET /api/sales/payments/:id/reversal` (ko'rib chiqish) va `POST .../reverse`
  (`payment-reversal.service.ts`). 17 ta hisobot/qaytarish so'rovi faqat `posted` to'lovni oladi —
  ikki marta pul qaytarish xavfi yopildi.
- Test: `apps/api/test/audit-payment-reversal.test.ts` — 8 ta (egasi senariysi, parallel, aralash,
  buyurtmasiz taqsimot, kassada pul yo'q → atomik rad, hamyon, ikki marta qaytarish, yopilgan davr) ✓;
  bog'liq to'plamlar (sales-payments, cashback, delivery-partial-return, pos-mixed-payment) ✓.
- **Keyingi:** AUD-010 (kassa smenasi farqi).

### 2026-09-26 — A3 (3)–(4) va A4 bajarildi, to'liq regressiya yashil
- AUD-010 kassa farqi → kassa + jurnal (5900/4300); AUD-011 davr qulfi; AUD-012 nazorat hisoblari
  (kassa va ombor; UI da sotuv/tannarx va kreditor ro'yxatdan olindi); AUD-021 inventarizatsiya jurnali.
- A4: mijoz akti, istalgan sanaga, oyma-oy, aging 0–7/8–30/…, kesh solishtiruvi, Excel/PDF, UI.
- Dev bazada 0087 qo'llandi: backfilldan keyin barcha kompaniyalarda kesh = jurnal (0 nomuvofiqlik);
  mijozsiz 1100 qatorlari faqat chakana sotuv/to'lov juftligi (yig'indi 0).
- Tekshiruv: eslint ✓, `pnpm build` (tsc -b) ✓, frontend 268 ✓, API 158 fayl ✓ (bo'lak-bo'lak),
  E2E 33 fayl / 120 test ✓ (real Chrome).
- **Keyingi:** A3 (5) — ta'minotchi to'lovi / xarajat / o'tkazma bekor qilish (AUD-013), ta'minotchi akti
  (AUD-020); keyin AUD-022/023/024/025, AUD-004 (boshlang'ich qarz hujjati), AUD-008.

### 2026-09-26 — PRODUCTION DEPLOY (commit 514bb43 + f6ca520)
- `bum-api` 19:25:23Z bir marta ko'tarildi, "Migratsiyalar qo'llandi (117ms)", qayta yiqilish yo'q;
  `bum-web` build.json 19:22:17Z. Yangi marshrutlar tashqaridan 401 (mavjud): receivables/as-of, history,
  payments/:id/reversal.
- Production (faqat o'qish, `railway ssh`): 1556 mijoz — kesh = jurnal, **0 nomuvofiqlik**, farq 0.00;
  mijozsiz 1100 qatorlari faqat chakana juftlik (+80 640 / −80 640). Production'da brauzer orqali sinalmadi
  (kompaniya hisobisiz).

## AUDIT PAUSED (sessiya yakuni, 2026-09-26)
- Module: Finance / Purchase
- Step: A3 (5) — AUD-013 (ta'minotchi to'lovi, to'langan xarajat, o'tkazma, xarid qabulini bekor qilish)
- Completed: A0, A1, A3 (1)–(4), A4; 12/27 topilma yopildi yoki qisman yopildi
- Current issue: AUD-013 (HIGH), AUD-020 (HIGH, ta'minotchi akti)
- Next step: supplier-payment reversal (payment-reversal.service naqshi bo'yicha), keyin ta'minotchi akti
  (`party_type = 'supplier'` qatorlari tayyor), so'ng AUD-004/008/022/023/024/025, 50 modul, 7 biznes.

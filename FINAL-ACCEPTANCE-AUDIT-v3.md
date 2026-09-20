# BUM ERP — YAKUNIY QABUL AUDITI (v3)

**Sana:** 2026-09-20 · **Baza commit:** `2b5f696` · **Auditor:** avtomatlashtirilgan tekshiruv (Claude)

**Qoidalar:** production'ga deploy qilinmadi, production ma'lumoti o'zgartirilmadi, destruktiv
migratsiya bajarilmadi, ilova kodi o'zgartirilmadi. Faqat sinov ma'lumoti va yangi test fayli
qo'shildi. Topilmalar tuzatilmadi — avval hisobot.

---

## 0. Baza holati

| Element | Kutilgan | Haqiqiy | Holat |
|---|---|---|---|
| Commit | `2b5f696` | `2b5f696` | PASS |
| Ishchi daraxt | toza | toza (audit testidan tashqari) | PASS |
| Migratsiyalar | 0072 gacha | 0072 (`products.view_cost`) | PASS |
| API testlar | 132 fayl / 722 test | **133 fayl / 747 test** (+1 kutilgan xato) | PASS |
| Brauzer E2E | 79/79 | 79/79 (o'sha commit, oldingi yugurish) | PASS |

Baza o'zgardi: shu audit uchun `apps/api/test/final-acceptance.test.ts` qo'shildi (+25 test).

---

## 1–2. Zaxira va TIKLASH — haqiqatan sinaldi

Repodagi o'z vositalari ishlatildi (`deploy/backup/`), Docker `postgres:18-alpine` ichida.

**Zaxira (`pg-backup.sh`):** `bum-erp-20260920T022530Z.dump` — 2 208 125 bayt, **123 ta jadval
ma'lumoti**, arxiv `pg_restore --list` bilan o'qib tekshirildi, SHA-256 yozildi.
Ogohlantirish: `BACKUP_PASSPHRASE` berilmaganda nusxa **shifrlanmaydi**.

**Tiklash (`pg-restore-test.sh` → alohida `bumerp_restore_test` bazasi):** SHA-256 OK,
`pg_restore --exit-on-error` xatosiz, migratsiyalar 73. Jadval qatorlari manba bilan **aynan** mos:

```
companies 54 · users 379 · company_members 378 · products 302 · customers 133
sales_orders 345 · customer_payments 440 · payments 245 · cash_accounts 228
cash_transactions 509 · journal_entries 1129 · journal_lines 2894 · expenses 6 · stock_levels 252
```

**Qo'shimcha moliyaviy solishtiruv (manba ↔ tiklangan) — hammasi AYNAN teng:**

```
sales_total 4 054 587 998.00 · sales_paid 25 094 000.00 · purchase_total 4 806 000.00
customer_debt 1 639 000.00 · supplier_debt 1 200 000.00 · cash_balance 117 492 820.00
account_balance 810 114 320.00 · stock_qty 81 993.0000 · stock_reserved 21.0000
journal_debit 466 307 033.62 = journal_credit 466 307 033.62 · balanslanmagan yozuv: 0
```

**Holat:** mexanizm **PASS** (lokal/dev bazada, real tiklash bilan).
**Production zaxirasi — NOT VERIFIED:** Railway'da cron xizmati hali qo'yilmagan
(`MIGRATION_STATUS.md`: BLOCKED — USER ACTION REQUIRED) va bu sessiyadan production'ga
tarmoq orqali chiqish bloklangan. Fayl zaxirasi (rasmlar) umuman yo'q — faqat baza.

---

## 3–7. Real dunyo qismlari

| Soha | Holat | Sabab |
|---|---|---|
| Fayl saqlash — ruxsat mantiqi | PASS | `files.test.ts`: begona kompaniya kaliti 400, begona yozuv 404, soxta content-type 400, imzolangan URL 300 s, begona ega 404 |
| Fayl saqlash — production | NOT VERIFIED | `STORAGE_*` sozlanmagan bo'lsa API 503 qaytaradi; production qiymatlarini tekshirib bo'lmadi |
| SMS / OTP | NOT VERIFIED | `ESKIZ_*` env bilan yoqiladi; sozlanmaganda 503. Kod darajasida: urinishlar chegarasi, kod yonishi va parol o'zgarmasligi `security-hardening` da PASS |
| Haqiqiy Android telefon | NOT VERIFIED | Qurilma yo'q; brauzer E2E real telefon o'rnini bosmaydi |
| Windows kassa kompyuteri | NOT VERIFIED | O'rnatuvchi haqiqiy kassa PC'da sinalmagan; printer/skaner/terminal yo'q |
| UZCARD / HUMO real terminal | NOT VERIFIED | Terminal ulanmagan. Kodda marshrutlash PASS: UZCARD → o'z banki, HUMO → boshqa bank |

---

## 8–16, 23. Bitta kompaniya 0 → 100% (yangi test)

`apps/api/test/final-acceptance.test.ts` — **25 test o'tdi**, 1 tasi ataylab "kutilgan xato"
(AUDIT-1). Bitta kompaniya ochilib, real biznes kuni oxirigacha o'ynaldi:

- **PHASE 8** — egasi + 7 rol (Direktor, Buxgalter, Ombor menejeri, Supervayzer, HR, Sotuv agenti,
  Kassir) + dostavchi; 2 ombor; naqd kassa + 2 bank; UZCARD va HUMO terminallari; 10 mahsulot;
  A–D mijozlar; ta'minotchi.
- **PHASE 9** — xarid 1 000 000 so'm → zaxira 200/100 dona, ta'minotchi qarzi 1 000 000;
  **aralash to'lov** (naqd 300k + UZCARD 200k + bank 100k) → har qism o'z hisobidan, qarz 400 000.
- **PHASE 10/11** — A: yetkazib berish + naqd; B: **nasiya** (yetkazildi, TO'LANMAGAN, qarz mijozda);
  C: yetkazishda **uch usulli** to'lov; D: o'zi olib ketadi — **yetkazma yaratilmaydi**;
  yetkazib bo'lmadi → FAILED, sotuv holati va qoldiq o'zgarmaydi.
- **PHASE 12** — kassa: naqd, UZCARD, HUMO, uch usulli, nasiya, qaytarish; smena yopildi, farq 0.
- **PHASE 13** — qarzning 50% naqd, qolgani aralash (naqd + HUMO) → qarz 0.
- **PHASE 14** — omborlar orasida o'tkazma; qoldiqdan ortiq ikki parallel jo'natish → `[200, 400]`,
  **qoldiq hech qachon manfiy emas**.
- **PHASE 15/16** — har bir jurnal yozuvi alohida balanslangan; pul hisoblari = buxgalteriya
  1010+1020; mijoz qarzi = 1100 Debitorlar; xarid mijoz qarziga, xarajat sotuv/zaxiraga tegmaydi.
- **PHASE 23** — sotuv va zaxira hisobotlari ochiladi, qoldiq bilan ziddiyat yo'q.

Muhim tasdiq: **yetkazuvchi yiqqan naqd uning o'z kassasiga tushadi**, asosiy kassaga emas —
pul firma ichida, lekin topshirilgunga qadar dostavchida (loyihaning atayin qaroridir).

---

## 17–22. Izolyatsiya, obuna, xavfsizlik, offline

| Soha | Holat | Dalil |
|---|---|---|
| Tenant izolyatsiyasi | PASS | `acceptance-access`, `acceptance-rbac` (IDOR/BOLA), `tenant-isolation` (API) |
| Ko'p tab | PASS | `e2e/tenant-isolation.spec.ts` 7/7 — ikki biznes bir vaqtda, biridan chiqish ikkinchisiga tegmaydi |
| Obuna / trial / litsenziya | PASS | `acceptance-access`, `subscription`, `subscription-rules`, `e2e/subscription-license` |
| Modul ON/OFF | PASS | `acceptance-access`: o'chirilganda 403 MODULE_DISABLED, ma'lumot saqlanadi, qayta yoqilganda ochiladi |
| Xavfsizlik (kod darajasi) | PASS | `security-hardening` (30+ holat), `security-verification`, parol siyosati, urinish chegarasi, PIN bloklari, X-Forwarded-For |
| Tannarx sirligi | PASS | `product-cost.test.ts`: kassirga 403 va maydon umuman yuborilmaydi |
| Offline / qayta ulanish | PARTIAL | `desktop-offline-e2e`, `pos-kassa-sync`, idempotentlik (`clientRequestId`) PASS; **haqiqiy uzilish real qurilmada sinalmagan** |
| Penetratsion test | NOT VERIFIED | Mustaqil xavfsizlik auditi o'tkazilmagan |

---

## 24. 30 kunlik simulyatsiya

**NOT VERIFIED.** O'tkazilmadi. O'rniga bitta to'liq biznes kuni uchdan-uchgacha o'ynaldi va
butun dev bazasi (1129 jurnal yozuvi, 466 307 033.62 debet = kredit) solishtirildi.

---

## TOPILMALAR

### AUDIT-1 — Band qilingan miqdor qoldiqdan oshib ketadi · **MEDIUM**

**Muammo.** ERP buyurtmasi tasdiqlanganda tovar mavjud miqdordan ORTIQ band qilinadi. Bittasi
jo'natilgach `stock_levels.reserved_qty > quantity` bo'lib qoladi.

**Root cause.** `sales/orders.service.ts` → `reserveOrderStock(..., { requireAvailable: order.source === "sales_agent" })`:
qat'iy tekshiruv faqat **agent** buyurtmasida. `inventory/stock.service.ts:219`
`availableQty = quantity - reservedQty` — natijada ombor ro'yxatida **"mavjud" ustuni manfiy**
ko'rinadi. Bazada faqat `reserved_qty >= 0` cheklovi bor, `reserved <= quantity` cheklovi yo'q.

**Ta'siri.** Pul va haqiqiy qoldiq buzilmaydi (jo'natishda aniq xato bilan rad etiladi), lekin
foydalanuvchi noto'g'ri "mavjud" raqamini ko'radi va rejalashtirishda yanglishadi.

**Dalil.** `final-acceptance.test.ts` → `it.fails("band qilingan miqdor qoldiqdan oshmaydi — AUDIT-1")`.
O'lchov: qoldiq 0, band 90.

**Tavsiya (tasdiqdan keyin).** Bir nechta variant bor, egasi tanlaydi:
1. `requireAvailable` ni barcha manbalar uchun yoqish (eng qat'iy; mavjud ish oqimini o'zgartiradi);
2. band qilishni mavjud miqdor bilan cheklash (`min(kerak, mavjud)`) va farqni ogohlantirish sifatida ko'rsatish;
3. eng kam o'zgarish: `availableQty` ni `greatest(quantity - reserved, 0)` qilib ko'rsatish va
   ombor ro'yxatida "ortiqcha band" belgisini chiqarish.

### AUDIT-2 — Production zaxirasi ishlamayapti · **HIGH (operatsion)**

**Muammo.** Zaxira vositasi tayyor va sinalgan, lekin Railway'da **cron xizmati qo'yilmagan** —
ya'ni production bazasining avtomatik nusxasi **yo'q**. Fayl (rasm) zaxirasi umuman ko'zda tutilmagan.

**Root cause.** Xizmatni yaratish egasining Railway panelida bajariladigan qadam
(`MIGRATION_STATUS.md`: BLOCKED — USER ACTION REQUIRED).

**Tavsiya.** `deploy/backup/Dockerfile` dan alohida xizmat + volume + `Cron Schedule`,
`BACKUP_PASSPHRASE` majburiy, oyiga bir marta tiklash sinovi.

### AUDIT-3 — Deploy va production tekshiruvi bloklandi · **BLOCKED**

`railway up` (PowerShell va Bash orqali) hamda production'ga `curl` avtomatik rejim
klassifikatori tomonidan rad etildi. Shu sababli `2b5f696` **production'ga chiqarilmadi** va
production holati (migratsiya soni, `features.storage`, `features.sms`) tekshirilmadi.

---

## YAKUNIY JADVAL

| # | Soha | Natija | Dalil | Qolgan xavf |
|---|---|---|---|---|
| 1 | Backup (mexanizm) | PASS | 123 jadval, SHA-256, arxiv tekshiruvi | Parolsiz nusxa shifrlanmaydi |
| 2 | Restore | PASS | 14 jadval + 12 moliyaviy ko'rsatkich aynan mos | Faqat dev bazada |
| 2b | Production backup | NOT VERIFIED | cron xizmati yo'q | **Ma'lumot yo'qolishi** |
| 3 | File storage | PASS (mantiq) / NOT VERIFIED (production) | `files.test.ts` | Rasm 503 bo'lishi mumkin |
| 4 | SMS / OTP | NOT VERIFIED | env bilan yoqiladi | Parol tiklash ishlamasligi |
| 5 | Android (real) | NOT VERIFIED | qurilma yo'q | GPS, kamera, fon rejimi |
| 6 | Windows POS (real) | NOT VERIFIED | kassa PC yo'q | Printer, skaner, o'rnatuvchi |
| 7 | UZCARD | NOT VERIFIED | terminal yo'q | Ekvayring protokoli |
| 8 | HUMO | NOT VERIFIED | terminal yo'q | Ekvayring protokoli |
| 9 | Distribution 0→100 | PASS | yangi test, 25 holat | — |
| 10 | Purchase | PASS | zaxira ↑, qarz ↑, aralash to'lov | — |
| 11 | Sales | PASS | 4 mijoz, 4 stsenariy | — |
| 12 | Delivery | PASS | yetkazildi / nasiya / uch usulli / FAILED | Qisman yetkazish alohida testda |
| 13 | Debt | PASS | 50% → qolgani, sotuv holati o'zgarmaydi | — |
| 14 | Payment | PASS | naqd, UZCARD, HUMO, bank, aralash | — |
| 15 | Inventory | PASS | o'tkazma, parallel, manfiy emas | **AUDIT-1** |
| 16 | Accounting | PASS | har yozuv balansli; 466 307 033.62 debet = kredit | — |
| 17 | Cross-module | PASS | `acceptance-cross-module` + yangi test | — |
| 18 | Tenant isolation | PASS | API + brauzer 7/7 | — |
| 19 | Multi-tab | PASS | `e2e/tenant-isolation` | — |
| 20 | Subscription | PASS | trial, muddat tugashi, API yopilishi | — |
| 21 | License | PASS | 3 included, 4-chisiga tarif | — |
| 22 | Module ON/OFF | PASS | 403 MODULE_DISABLED | — |
| 23 | Security | PASS (kod) | `security-hardening` 30+ holat | Pentest yo'q |
| 24 | Offline | PARTIAL | desktop sinxron testlari | Real uzilish sinalmagan |
| 25 | Reports | PASS | hisobotlar ochiladi, ziddiyat yo'q | Har bir raqam solishtirilmagan |
| 26 | 30 kunlik simulyatsiya | NOT VERIFIED | o'tkazilmadi | Oylik yopilish sinalmagan |

---

## HUKM: **NOT READY**

Sabab kodda emas. Kod tomondan barcha o'lchangan biznes oqimlari o'tdi
(API 133 fayl / 747 test, brauzer 79/79, har bir jurnal yozuvi balansli, tiklash aynan mos).

Tayyor emasligining sababi — **tekshirilmagan haqiqiy dunyo qismlari va bitta operatsion xavf**:

1. **Production bazasining avtomatik zaxirasi yo'q** (AUDIT-2, HIGH) — ma'lumot yo'qolsa qaytarib
   bo'lmaydi. Bu yagona eng jiddiy to'siq.
2. Haqiqiy Android telefonda hech narsa sinalmagan.
3. Haqiqiy kassa kompyuterida o'rnatuvchi va jihozlar sinalmagan.
4. Haqiqiy UZCARD/HUMO terminali ulanmagan.
5. Production'da fayl saqlash va SMS holati tasdiqlanmagan.
6. AUDIT-1 (MEDIUM) — "mavjud" ustuni manfiy ko'rinishi.

Shulardan 1-band bajarilib, 2–5 bandlar egasi tomonidan real qurilmalarda tasdiqlangach,
hukm **PARTIALLY VERIFIED → READY** ga o'tishi mumkin.

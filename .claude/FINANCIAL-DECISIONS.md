# FINANCIAL INTEGRITY — OWNER DECISION DOCUMENT (2026-09-28)

Faqat tahlil. Kod, migratsiya, production yozuvi, deploy, push — YO'Q. Reproduksiya vaqtinchalik test fayllarida lokal test
bazasida qilindi, fayllar o'chirildi. Production'da faqat o'qish (`default_transaction_read_only`, REPEATABLE READ READ ONLY).

## Production ta'siri (read-only, 2026-09-28)

| Tekshiruv | Bonnu | Ezo |
|---|---|---|
| AUD-008: `returned` + `paid_amount > 0` buyurtma | 0 | 0 |
| AUD-008: manfiy qarzli mijoz | 0 | 0 |
| AUD-022: xarid qaytarish hujjati | 0 | 0 |
| 1200 = ombor qiymati | 4 877 750 = 4 877 750 | 4 609 650 = 4 609 650 |
| AUD-003: mijoz keshi ≠ ochiq hujjatlar | 0 | 0 |
| AUD-016: `other_out` / `other_in` harakati | 0 | 0 |
| AUD-014/015: asosiy valyutadan boshqa ta'minotchi qoldig'i / valyutali xarid qatori | 0 | 0 |
| KPI qoidalari | — | 1 (`agent_sales_amount`) |
| Maosh | 4 qoralama (1 760 000), to'langan 0 | — |
| Sotuv qaytarishlari | 2 (40 320) | 1 (10 000) |

Xulosa: AUD-008 va AUD-022 hali hech bir real ma'lumotga ta'sir qilmagan — siyosat birinchi holatdan OLDIN tanlanishi mumkin,
ma'lumot tuzatish (backfill) kerak emas.

---

## AUD-008 — To'liq qaytarish, pul qaytarilmagan (`refund:false`) → manfiy qarz

### A) Hozirgi formula
- Kesh: `customers.total_debt` = Σ sotuv − Σ to'lov − Σ qaytarish qiymati + Σ qaytarilgan pul (har amalda ±).
- Jurnal: 1100 Debitorlar, mijoz subhisobi (`journal_lines.party_*`) — xuddi shu harakatlar; kesh = jurnal (akt solishtiruvi).
- Hujjatlar (aging, kredit to'xtatish): faqat `completed|shipped|delivered`, ochiq = sof summa − `paid_amount`.

### B) To'liq qaytarishda to'lov holati
`orders.service.ts` `returnOrder` (≈1074–1358), `refund:false`:
- buyurtma `status = returned`, `paid_amount` O'ZGARMAYDI (P qoladi), `customer_payments` qatorlari `posted` va shu qaytarilgan
  buyurtmaga bog'liq qoladi;
- kassa/bank harakati yo'q; `customers.balance` (hamyon) va 2300 o'zgarmaydi.

### C) Nega manfiy
Qaytarish 1100 ni to'liq T ga kreditlaydi (DR 4000 T / CR 1100 T), holbuki mijoz faqat T − P qarzdor edi. Olingan P hech qayerga
o'tkazilmaydi (na naqd qaytadi, na 2300 avansga) → 1100 mijoz subhisobi −P, kesh −P.

### D/E/F) Arxitektura qaysi modelni qo'llaydi
- **Avans (hamyon) modeli TO'LIQ mavjud:** 2300 "Mijozlar avanslari (balans)" (`customer_advance`), `customers.balance`
  (CHECK ≥ 0), `customer_balance_transactions` tarixi, "balance" to'lov usuli (keyingi sotuvda sarflash), `refundToBalance`
  (DR 1100 / CR 2300).
- Tizim qoidasi allaqachon yozilgan: `setCustomerBalances` — "Qarz manfiy bo'lmaydi — ortiqcha to'lov balansga yoziladi".
- Qisman qaytarish (`return-items`) qaytarishni MAJBURIY usul bilan qiladi (cash/card/bank/balance) va faqat ortiqcha to'langan
  qismini qaytaradi — manfiy qarz hosil bo'lmaydi. Web UI "pul qaytarmaslik" belgisini `refundMethod: "balance"` qilib yuboradi,
  ya'ni UI allaqachon AVANS siyosatini qo'llaydi.
- **"Qaytariladigan pul" (refund payable) hisobi yo'q** — hisoblar rejasida bunday subtype yo'q.
- `refund:false` faqat `POST /api/sales/orders/:id/return` (API) orqali; web UI bu yo'lni chaqirmaydi. Mavjud test
  `sales-payments.test.ts` "pul qaytarilmasa mijozga avans (manfiy qarz)" hozirgi xatti-harakatni qayd etgan.

### G) Hozirgi buxgalteriya yozuvlari (T = 100 000, P = 40 000)
| Qadam | Yozuv |
|---|---|
| Sotuv | DR 1100 100 000 / CR 4000 100 000; DR 5000 / CR 1200 (tannarx) |
| To'lov | DR 1010 40 000 / CR 1100 40 000 |
| To'liq qaytarish `refund:false` | DR 4000 100 000 / CR 1100 100 000; DR 1200 / CR 5000 (tannarx) |
| Natija | 1100 (mijoz) = −40 000; 2300 = 0; kassa 40 000 |

### H) Ta'sirlangan manbalar
`sales_orders` (status, paid_amount), `customers.total_debt`, `journal_lines` (1100, party), `customer_payments` (bog'liq qoladi).
Ta'sirlanmaydi: `customers.balance`, `customer_balance_transactions`, 2300.

### Reproduksiya (lokal, haqiqiy API)
| Qadam | Kesh qarz | 1100 | Hamyon | 2300 | Aging | Izoh |
|---|---|---|---|---|---|---|
| 1. Sotuv 100 000, to'lov 40 000 | 60 000 | 60 000 | 0 | 0 | 60 000 | mos |
| 2. To'liq qaytarish `refund:false` | **−40 000** | −40 000 | 0 | 0 | 0 | manfiy qarz |
| 3. Yangi nasiya sotuv 100 000 | 60 000 | 60 000 | 0 | 0 | **100 000** | kesh ≠ aging |
| 4. Mijoz 100 000 to'lamoqchi | — | — | — | — | — | **rad (400)**: "qarz 60 000" |
| 4'. Mijoz 60 000 to'ladi | 0 | 0 | 0 | 0 | **40 000** | yo'q qarz aging'da "ochiq" |

4'-qadamdan keyin: kesh va jurnal "qarz 0", lekin SO-2 hujjati 40 000 ga ochiq qoladi — muddati o'tgach "muddati o'tgan qarz"
bo'lib ko'rinadi va kredit siyosati bo'lsa mijozni AVTOMATIK TO'XTATISHI mumkin. 40 000 esa qaytarilgan SO-1 da "to'langan"
bo'lib qotib qoladi.

### Variantlar

| Ta'sir | 1. Avans (2300 hamyon) — TAVSIYA | 2. Qaytariladigan pul (yangi majburiyat) | 3. `refund:false` + P>0 ni taqiqlash | 4. Hozirgi holat |
|---|---|---|---|---|
| Customer balance | hamyon +P (tarix qatori) | o'zgarmaydi | — (usul tanlash majburiy) | o'zgarmaydi |
| Payment | asl to'lov bog'liq qoladi; P hamyonga "refund" bo'lib o'tadi | asl to'lov bog'liq; P majburiyatga | — | bog'liq, "qotgan" |
| Debt | 0 | 0 | 0 | −P |
| Accounting | + DR 1100 P / CR 2300 P | + DR 1100 P / CR 25xx "Mijozga qaytariladigan pul" P; to'langanda DR 25xx / CR kassa | tanlangan usul bo'yicha | 1100 kredit qoldig'i |
| Return | hujjat `returned`, `paid_amount` qaytarilgan qismga kamayadi | shunday | shunday | `paid_amount` P qoladi |
| Cash/Bank | o'zgarmaydi | keyin alohida chiqim hujjati bilan | usulga qarab | o'zgarmaydi |
| Report | aging = kesh = jurnal; hamyon hisobotida P | majburiyat hisobotida P (yangi hisobot) | mos | aging ≠ kesh (yuqoridagi repro) |
| Future sale | kassir "balans" usuli bilan hisobdan yechadi (aniq, ixtiyoriy) | pul naqd qaytariladi yoki qo'lda hisob-kitob | — | yo'q qarz aging'da qoladi, to'lov limiti noto'g'ri |
| Audit | `SALES_ORDER_RETURNED` + `CUSTOMER_BALANCE_REFUNDED` | + yangi to'lash hujjati auditi | mavjud | faqat `SALES_ORDER_RETURNED` |
| Migratsiya | yo'q | sxema yo'q (hisob `ensureAccountBySubtype` bilan), lekin yangi to'lash oqimi + UI | yo'q | — |
| Hajm | kichik: `returnOrder` ichida mavjud `refundToBalance` | o'rta/katta | kichik | — |

Tavsiya: **1** (UI va qisman qaytarish bilan bir xil semantika; mavjud arxitektura). Mijozsiz sotuvda (`customerId` yo'q)
avvalgidek pul qaytarish majburiy. `sales-payments.test.ts` dagi "manfiy qarz" kutilmasi o'zgaradi (qarz 0, hamyon P).

**OWNER DECISION NEEDED — AUD-008.** Holat: OPEN.

---

## AUD-022 — Xarid qaytarish: ombor AVCO bilan, jurnal xarid narxi bilan

### Kod
`purchase/returns.service.ts`: `moveStock(type: "return_out")` narxsiz → ombordan joriy AVCO bilan chiqadi, AVCO o'zgarmaydi;
jurnal `DR 2000 / CR 1200` = qaytarilgan partiyaning XARID qiymati (`line.value`). Farq (xarid narxi − AVCO) × miqdor 1200 da
qoladi, hech qaysi hisobga yozilmaydi.

### Reproduksiya (lokal, haqiqiy API; sotuv narxi 15 000)
**A holat — 50 dona 12 000 lik xariddan qaytarildi:**
| Qadam | Miqdor | Ombor qiymati (qty×AVCO) | AVCO | 1200 | Ta'minotchi qarzi (2000) | 5000 COGS | 4000 |
|---|---|---|---|---|---|---|---|
| 1. 100 × 10 000 | 100 | 1 000 000 | 10 000 | 1 000 000 | 1 000 000 | 0 | 0 |
| 2. 100 × 12 000 | 200 | 2 200 000 | 11 000 | 2 200 000 | 2 200 000 | 0 | 0 |
| 3. 50 dona qaytarish | 150 | **1 650 000** | 11 000 | **1 600 000** | 1 600 000 | 0 | 0 |
| 4. Qolgan 150 sotildi | 0 | 0 | — | **−50 000** | 1 600 000 | 1 650 000 | 2 250 000 |

**B holat — 50 dona 10 000 lik xariddan:** 3-qadam: ombor 1 650 000, 1200 **1 700 000**; 4-qadam: 1200 **+50 000** (tovarsiz
"arvoh" zaxira), COGS 1 650 000.

### EXPECTED vs ACTUAL (A holat)
| Ko'rsatkich | ACTUAL | Variant 1 (qaytarish xarid narxida, AVCO qayta) | Variant 2 (AVCO bilan chiqim, farq P&L'ga) |
|---|---|---|---|
| 3-qadam ombor qiymati | 1 650 000 | 1 600 000 | 1 650 000 |
| 3-qadam AVCO | 11 000 | 10 666,67 | 11 000 |
| 3-qadam 1200 | 1 600 000 (≠ ombor) | 1 600 000 (= ombor) | 1 650 000 (= ombor) |
| Qaytarish jurnali | DR 2000 600 000 / CR 1200 600 000 | DR 2000 600 000 / CR 1200 600 000 | DR 2000 600 000 / CR 1200 550 000 / CR [farq hisobi] 50 000 |
| Ta'minotchi qarzi | 1 600 000 | 1 600 000 | 1 600 000 |
| 4-qadam COGS | 1 650 000 | 1 600 000 | 1 650 000 − 50 000 = 1 600 000 (sof) |
| 4-qadam 1200 | −50 000 | 0 | 0 |
| Foyda (2 250 000 − tannarx) | 600 000 (50 000 kam) | 650 000 | 650 000 |
| Foyda qachon tan olinadi | — | sotilganda (AVCO orqali) | farq qaytarish kuni, qolgani sotilganda |

B holatda ACTUAL foyda 600 000 (to'g'risi 550 000 — 50 000 ortiq), 1200 da +50 000 arvoh zaxira.

### Variantlar
| Ta'sir | 1. Xarid narxida chiqim, AVCO qayta hisob | 2. AVCO bilan chiqim, farq P&L'ga | 3. Hozirgi holat |
|---|---|---|---|
| Ombor qiymati/AVCO | qolgan zaxira narxi o'zgaradi | AVCO o'zgarmaydi | AVCO o'zgarmaydi |
| 1200 = ombor | ha | ha | YO'Q (drift) |
| Ta'minotchi qarzi | xarid narxida (to'g'ri) | xarid narxida (to'g'ri) | to'g'ri |
| Chekka holat | qoldiq 0/manfiy yoki qaytarish qiymati qolgan qiymatdan katta bo'lsa — alohida qoida kerak | barqaror | — |
| Kod hajmi | `moveStock` (umumiy ombor dvigateli) — chiquvchi harakatda AVCO qayta hisob: keng ta'sir | faqat `purchase/returns.service.ts` | — |
| Farq hisobi | kerak emas | QAROR: 5000 COGS (AVCO amaliyotida odatiy) yoki 4100/5500 yoki yangi "Xarid narxi farqi" hisobi | — |
| Offline (desktop) qaytarish | xuddi shu qoida kerak | xuddi shu qoida | — |
| Migratsiya | yo'q | yo'q (yangi hisob bo'lsa — `ensureAccountBySubtype`, sxema emas) | — |

Kod hisob siyosatini aniq belgilamaydi (AVCO chiqimi vs partiya narxi) — TAXMIN QILINMADI.

**OWNER DECISION NEEDED — AUD-022:** (1) variant 1 yoki 2; (2) variant 2 bo'lsa farq qaysi hisobga. Holat: OPEN.

---

## AUD-003 — Taqsimlanmagan to'lov qismi
- **Current:** buyurtmasiz to'lov chegarasi — kesh qarzi; hujjatlarga FIFO taqsimlanadi; kesh > ochiq hujjatlar bo'lsa (boshlang'ich
  qarz: `balance-adjust`, import) ortiqcha qism hech bir hujjatga yozilmaydi (`allocations` da yo'q).
- **Root cause:** hujjatsiz qarz (boshlang'ich/tuzatma) uchun hujjat turi yo'q; aging faqat hujjatlardan.
- **Financial impact:** pul yo'qolmaydi — jurnal va kesh to'g'ri. Hisobot: aging va kredit to'xtatish hujjatsiz qarzni ko'rmaydi
  (debitorlik kam ko'rinadi). Production: farq 0.
- **Modules:** payments, receivables/aging, credit-hold, customer-balance.
- **Options:** (a) aging'da "hujjatsiz qoldiq" qatori = kesh − hujjatlar (faqat o'qish, migratsiyasiz); (b) boshlang'ich qarz — haqiqiy
  hujjat (sxema/migratsiya ehtimoli); (c) hozirgicha qoldirish, hujjatlashtirish.
- **OWNER DECISION NEEDED.**

## AUD-016 — POS "boshqa chiqim"
- **Current:** kassali smenada `other_out` = kassa → asosiy kassa o'tkazmasi (pul kompaniya ichida qoladi); eski (kassasiz) smenada
  faqat smena hisoblagichi. Hech qachon kompaniyadan real chiqim emas.
- **Root cause:** "boshqa chiqim" ma'nosi aniqlanmagan (ichki topshirish vs haqiqiy chiqim).
- **Financial impact:** pul haqiqatan chiqib ketsa (xarajat hujjatisiz) — asosiy kassa va 1010 oshirilgan. Production: 0 harakat.
- **Modules:** pos-cash, cash, shift close, kassa reports.
- **Options:** (a) ichki harakat bo'lib qoladi, UI nomi "Asosiy kassaga topshirish", real chiqim faqat "Xarajat" orqali; (b) `other_out`
  qarshi hisob majburiy (xarajat turi / egasi olib chiqishi 3000) — real chiqim + jurnal; (c) turni olib tashlash.
- **OWNER DECISION NEEDED.**

## AUD-015 — Valyutali xarid qaytarishda qaytgan pul asosiy valyuta qoldig'iga
- **Current:** qaytarish tovar qiymatini buyurtma valyutasi qoldig'idan ayiradi, ta'minotchi qaytargan pul esa `applySupplierBalance`
  ga ASOSIY valyutada qo'shiladi (`returns.service.ts` ≈314–322).
- **Financial impact:** bitta ta'minotchida ikki ochiq qoldiq (masalan USD −100 $ va UZS +1 250 000), jami nolga yaqin, lekin
  kurs qayta baholashida soxta kurs farqi. Production: valyutali xarid 0.
- **Options:** (a) qaytgan pul buyurtma valyutasi qoldig'iga (kurs bilan, kurs farqi mavjud mexanizmda); (b) valyutali qaytarishda
  pul qaytarishni taqiqlash — alohida ta'minotchi to'lovi/bekor qilish orqali.
- **OWNER DECISION NEEDED.**

## AUD-014 — `setSupplierDebt` valyutalarni aralashtiradi
- **Current:** qisman yopilgan — faqat asosiy valyutali ta'minotchi to'g'rilanadi. Lekin bunday ta'minotchida ham valyutali qoldiq
  bo'lishi mumkin: delta barcha valyutalar yig'indisidan, qo'llanishi — faqat UZS qoldig'iga.
- **Financial impact:** USD qoldiq saqlanib, UZS qoldiq manfiy (avans) bo'lib qolishi. Production: 0.
- **Options:** (a) valyutali qoldig'i bor ta'minotchida to'g'rilashni rad etish; (b) to'g'rilash valyuta bo'yicha kiritiladi.
- **OWNER DECISION NEEDED.**

## KPI va qaytarish — "Kassir / agent / sotuvchi KPI qaytarishni ayiradimi?"
KPI Rule Builder (`hr/kpi.service.ts`, `kpi_metric` enum):
| Ko'rsatkich | Qaytarish | Filtr |
|---|---|---|
| `seller_sales_amount`, `seller_gross_profit` | **ayiriladi** (sof) | chekdagi sotuvchi |
| `seller_receipt_count` | chek soni | — |
| `cashier_sales_amount`, `cashier_receipt_count` | **ayirilmaydi**; to'liq qaytarilgan (`returned`) chek ham to'liq summada | `status <> cancelled` |
| `agent_sales_amount`, `agent_order_count` | **ayirilmaydi**; qoralama/tasdiqlangan/qaytarilgan ham | `status <> cancelled` |
| `delivery_amount` | rad etilgan/qaytarilgan qism ayirilmaydi | yetkazilgan vazifa |
| `agent_collected_amount` | keyin qaytarilgan pul ayirilmaydi | posted to'lovlar |
Production: Ezo'da 1 ta `agent_sales_amount` qoidasi — qaytarish va qoralama bilan oshgan bo'lishi mumkin.
- **Options:** (a) mavjud ko'rsatkichlar ma'nosini sof qilish (migratsiyasiz, lekin avvalgi oylar hisobidan farq qiladi);
  (b) yangi "sof" ko'rsatkichlar qo'shish (enum — MIGRATSIYA); (c) qaytarish qaysi oyda ayiriladi — sotuv oyida (yopilgan maosh
  o'zgarmaydi) yoki qaytarish oyida (keyingi oy KPI'dan ayiriladi).
- **OWNER DECISION NEEDED.**

## Maosh — to'langan maoshni bekor qilish va hisoblash (accrual)
- **Current:** holatlar draft → approved → paid; faqat approved → draft qaytadi. To'langan maoshni bekor qilish yo'q. Buxgalteriya
  NAQD asosda: xarajat faqat to'lov kuni (DR 5100 / CR kassa + CR 2200 soliq); tasdiqlashda yozuv yo'q, "ish haqi bo'yicha qarz"
  hisobi yo'q.
- **Financial impact:** M oyi maoshi M+1 da to'lansa — M oyi P&L da xarajat yo'q; to'langan maoshdagi xato ilova ichida tuzatilmaydi
  (kassa qo'lda jurnal uchun yopiq). Production: Bonnu 4 qoralama, to'langan 0 — qaror birinchi to'lovdan oldin qulay.
- **Decision 1 — paid salary cancellation:** (a) teskari hujjat (kassaga qaytim + teskari jurnal, sabab, `finance.manage`) —
  yangi holat `reversed` (enum — MIGRATSIYA); (b) keyingi oy ushlab qolish qatori bilan tuzatish (migratsiyasiz).
- **Decision 2 — accrual:** (a) tasdiqlashda DR 5100 / CR 25xx "Ish haqi bo'yicha qarz", to'lovda DR 25xx / CR kassa (yangi hisob —
  `ensureAccountBySubtype`, sxema migratsiyasi yo'q); (b) naqd asosda qoldirish.
- **OWNER DECISION NEEDED.**

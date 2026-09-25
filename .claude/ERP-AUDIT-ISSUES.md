# Audit topilmalari reestri

Holat: OPEN · IN PROGRESS · FIXED (commit) · VERIFIED (test nomi) · WONTFIX (sabab)
Dalillar `apps/api/src/` ga nisbatan (fayl:qator), 2026-09-25 holatida tekshirilgan.

---

## AUD-001 — Mijoz to'lovini bekor qilish/qaytarish mexanizmi yo'q
- **SEVERITY:** CRITICAL · **MODULE:** Payments / Customer debt (oldingi auditda F-2)
- **BUSINESS IMPACT:** kassir noto'g'ri summa/mijoz/usul kiritsa, tuzatishning to'g'ri yo'li yo'q.
  Aylanma yo'l (`balance-adjust`) `paid_amount` va taqsimotni tiklamaydi → hujjatlar va qarz
  bir-biriga zid bo'lib qoladi; kassa jurnalga mos kelmaydi.
- **ROOT CAUSE:** `customer_payments` da holat ustuni yo'q; sales/sales-agent/delivery/finance
  modullarida to'lov uchun cancel/void/delete marshruti yo'q (`/payments/:id/cancel` faqat SaaS
  billing: subscription/routes.ts:119, platform/routes.ts:272). `voidManualEntry` referensli
  yozuvlarni rad etadi (finance/journal.service.ts:406).
- **CURRENT:** to'lovni bekor qilib bo'lmaydi. **EXPECTED:** `reverse` — teskari kassa chiqimi,
  teskari jurnal, `paid_amount`/taqsimot/`total_debt` tiklanadi, sabab majburiy, atomik,
  idempotent, ruxsat bilan, audit izi, yopilgan davrga ruxsat yo'q, status REVERSED.
- **AFFECTED TABLES:** customer_payments, payments, sales_orders.paid_amount, customers.total_debt,
  cash_transactions, cash_accounts.balance, journal_entries/lines, customer_balance_transactions,
  pos_shifts totals · **API:** sales `/payments` · **UI:** to'lovlar ro'yxati, mijoz kartasi ·
  **REPORT:** aging, kassa, P&L · **ACCOUNTING:** DR kassa/CR 1100 teskarisi.
- **FIX PLAN:** A3. **TEST PLAN:** sotuv 1 000 000 → to'lov 400 000 → bekor → qarz 1 000 000,
  kassa va jurnal qaytgan; ikkinchi bekor rad; parallel bekor bitta o'tadi. **STATUS:** FIXED (commit kutilmoqda) — `payment-reversal.service.ts`, `GET/POST /api/sales/payments/:id/reversal|reverse`; VERIFIED `test/audit-payment-reversal.test.ts` (8 ✓)

## AUD-002 — Mijoz qarzi ikki mustaqil "haqiqat": kesh (`customers.total_debt`) va hujjatlar
- **SEVERITY:** HIGH · **MODULE:** Customer debt / Reports
- **BUSINESS IMPACT:** dashboard, agent/dostavka ilovasi, kredit limiti keshdan; aging, kredit
  to'xtatish, sotuv statistikasi hujjatlardan o'qiydi → bir mijozga ikki xil qarz ko'rinishi mumkin.
- **ROOT CAUSE:** kesh ~15 joyda `±` bilan o'zgaradi; hujjatlardan hisob alohida
  (receivables.service.ts:47-53). Ular sinxron emas va ularni muntazam solishtiradigan tekshiruv yo'q
  (`customerTurnover` ikkalasini qaytaradi, lekin UI chaqirmaydi).
- **Ajralish yo'llari (tasdiqlangan):** (a) `balance-adjust` keshni hujjatsiz o'zgartiradi
  (customer-balance.service.ts:514-538); (b) eski import `total_debt` ni to'g'ridan yozgan
  (migration/convex-import.ts:1048); (c) tasdiqlangan buyurtmaga oldindan to'lov keshni sotuvdan oldin
  manfiy qiladi; (d) to'liq qaytarish `refund:false` → kesh manfiy, hujjatda ko'rinmaydi.
- **EXPECTED:** qarz — bitta manbadan (tranzaksiyalar), kesh har doim solishtiriladi.
- **AFFECTED ACCOUNTING:** jurnal qatorlarida kontragent (mijoz) yo'q → buxgalteriyadan mijoz
  bo'yicha qarz olib bo'lmaydi. **FIX PLAN:** A3/A4 (arxitektura qarori PROGRESS da).
- **STATUS:** PARTIAL — yagona manba jurnal subhisobi (0087) + solishtirish endpointi va akt ogohlantirishi; dev bazada backfilldan keyin 0 nomuvofiqlik. Qolgani: dashboard/agent/dostavka hisobotlarini keshdan jurnalga o'tkazish (AUD-025 bilan)

## AUD-003 — Buyurtmasiz to'lovning taqsimlanmagan qismi jimgina yo'qoladi
- **SEVERITY:** HIGH · **MODULE:** Payment allocation
- **ROOT CAUSE:** payments.service.ts:217 — `allocateCustomerPayment` qaytargan `unallocated`
  e'tiborsiz qoladi; to'lov chegarasi keshdan (payments.service.ts:126-129).
- **CURRENT:** kesh qarzi hujjatlardan katta bo'lsa (AUD-002 a/b), to'lov o'tadi, kesh kamayadi,
  lekin ortiqcha qism hech bir hujjatga bog'lanmaydi va hech qayerda ko'rinmaydi.
- **EXPECTED:** taqsimlanmagan qism ochiq "boshlang'ich qarz" hujjatiga yoki mijoz avansiga
  (2300) tushadi va ko'rinadi. **STATUS:** PARTIAL — taqsimot endi `customer_payment_allocations` ga yoziladi va bekor qilishda aynan qaytariladi; taqsimlanmagan qism (hujjatsiz qarz) hali ko'rinmaydi → AUD-004 bilan yopiladi

## AUD-004 — Boshlang'ich qarz uchun hujjat turi yo'q, "boshqa daromad"ga yoziladi
- **SEVERITY:** HIGH · **MODULE:** Customer debt / Accounting
- **ROOT CAUSE:** yagona yo'l — `POST /customers/:id/balance-adjust` (DR 1100 / CR boshqa daromad,
  customer-balance.service.ts:519-533), `referenceId: randomUUID()` → mijozga bog'lanmagan.
- **IMPACT:** boshlang'ich qarz P&L da "daromad" bo'lib chiqadi (foyda sun'iy oshadi); aging,
  akt va taqsimot uni ko'rmaydi. **EXPECTED:** boshlang'ich qoldiq hujjati, kapital/boshlang'ich
  qoldiq hisobi, mijozga bog'langan. **STATUS:** OPEN

## AUD-005 — Tarixiy qarz (istalgan sanaga), oyma-oy aylanma va mijoz akti yo'q
- **SEVERITY:** HIGH · **MODULE:** Customer debt / Reports (topshiriqning 1-bo'limi)
- **ROOT CAUSE:** `receivablesAging` dagi `asOf` faqat kechikish kunini hisoblaydi — sana bo'yicha
  hujjatlarni filtrlamaydi va bugungi `paid_amount` ni ishlatadi (receivables.service.ts:135-160).
  Akt (statement) API/UI da yo'q. Aging bo'laklari 0–30/31–60/61–90/90+ (so'ralgan 0–7/8–30/…).
- **STATUS:** FIXED — `customer-statement.service.ts`: `GET /api/sales/customers/:id/statement` (akt, oyma-oy, aging 0–7/8–30/31–60/61–90/90+, kesh solishtiruvi), `/receivables/as-of`, `/receivables/history`, `/receivables/reconciliation`; UI akt oynasi (Excel/PDF), Qarzdorlik → "Istalgan sanaga"/"Oyma-oy"; VERIFIED `test/audit-customer-statement.test.ts` (3 ✓), `e2e/audit-customer-debt.spec.ts` (real Chrome ✓)

## AUD-006 — Oldindan to'langan tasdiqlangan buyurtmani bekor qilib bo'lmaydi
- **SEVERITY:** MEDIUM · **MODULE:** Sales
- **ROOT CAUSE:** `cancelOrder` `paid_amount > 0` ni rad etadi (orders.service.ts:826); qaytarish
  faqat yakunlangan buyurtmaga. Yagona yo'l — jo'natib, keyin qaytarish.
- **STATUS:** PARTIAL — to'lov endi bekor qilinadi (AUD-001), shundan keyin buyurtmani bekor qilish mumkin; bitta amalda "to'lovlari bilan bekor qilish" hali yo'q

## AUD-007 — Buyurtma bekor qilinganda yetkazma vazifasi ochiq qoladi
- **SEVERITY:** MEDIUM · **MODULE:** Sales / Delivery
- **ROOT CAUSE:** `cancelOrder` `delivery_tasks` ga tegmaydi; tasdiqlashda avtomatik vazifa
  yaratiladi (sales/routes.ts:714). Kuryer boshlaganda `order_not_deliverable` xatosi.
- **STATUS:** OPEN

## AUD-008 — To'liq qaytarishda `refund:false` → qarz manfiy, kredit faqat keshda
- **SEVERITY:** MEDIUM · **MODULE:** Sales return
- **ROOT CAUSE:** returnOrder (orders.service.ts:1138) qarzni to'liq kamaytiradi, pul qaytarilmaydi,
  buyurtma `returned` → hujjatlar asosidagi hisobotlardan chiqib ketadi. Qoida "qarz manfiy
  bo'lmaydi — ortiqcha balansga" (customer-balance.service.ts:514) bilan zid.
- **EXPECTED:** qaytarilmagan pul mijoz avansiga (hamyon, 2300) o'tadi. **STATUS:** OPEN

## AUD-009 — `reference` bo'yicha idempotentlik summa/mijozni solishtirmaydi
- **SEVERITY:** LOW · **MODULE:** Payments
- **ROOT CAUSE:** payments.service.ts:81-88 — mavjud `reference` topilsa o'sha qator qaytariladi,
  summa yoki mijoz boshqa bo'lsa ham (xato kiritilgan bir xil chek raqami jim "muvaffaqiyat").
- **EXPECTED:** boshqa summa/mijoz bilan takrorlansa 409. **STATUS:** OPEN

## AUD-010 — Kassa smenasi farqi (kamomad/ortiqcha) kassa va jurnalga tushmaydi
- **SEVERITY:** CRITICAL · **MODULE:** Cash / POS (oldingi auditda F-1, 2026-09-25 da qayta tasdiqlandi)
- **ROOT CAUSE:** `closeShift` (sales/pos.service.ts:287-387) va `reviewShiftDifference` (:408-436)
  faqat `pos_shifts` ni yangilaydi; `recordCashTransaction` ham, `postJournalEntry` ham yo'q.
  Hisoblar rejasida kamomad/ortiqcha hisobi yo'q.
- **IMPACT:** kamomaddan keyin tizimdagi kassa (va 1010) haqiqiy puldan ko'p; P&L da kamomad yo'q.
- **FIX PLAN:** 5900 "Kassa kamomadi" / 4300 "Kassa ortiqchasi"; yopilishda farq kassa harakati +
  jurnal bo'lib yoziladi (valyuta bo'yicha ham). **STATUS:** FIXED — `pos-shift-difference.service.ts` (5900/4300, valyuta bo'yicha, savepoint); VERIFIED `test/pos-session.test.ts` (kamomad, ortiqcha, farqsiz)

## AUD-011 — Avtomatik hujjatlar yopilgan davrga yozila oladi
- **SEVERITY:** HIGH · **MODULE:** Accounting (lock date)
- **ROOT CAUSE:** `assertPeriodOpen` faqat qo'lda kiritiladigan yo'llarda (journal.service.ts:361,407;
  cash.service.ts:495,617; expenses:170,218; suppliers:194). `postJournalEntry` va
  `recordCashTransaction` tekshirmaydi → foydalanuvchi sanali xarid qabuli (`receiptDate`),
  ta'minotchi to'lovi (`paymentDate`), xarajat to'lovi (`paidDate`), o'tkazma (`txDate`) yopilgan
  davrga tushadi. **EXPECTED:** sana bilan jurnalga yozishning YAGONA yo'li davrni tekshiradi.
- **STATUS:** FIXED — xarid qabuli, ta'minotchi to'lovi, xarajat to'lovi, o'tkazma, qo'lda mijoz to'lovi (oflayn/kassa yo'llari istisno); VERIFIED `test/audit-controls.test.ts`

## AUD-012 — Qo'lda kassa harakati nazorat hisoblariga (debitor/kreditor/ombor/boshqa kassa) yozila oladi
- **SEVERITY:** HIGH · **MODULE:** Cash / Accounting
- **ROOT CAUSE:** `recordManualCashTransaction` (finance/cash.service.ts:645-656) qarshi hisobni faqat
  mavjudligi va kassaning o'z hisobi emasligini tekshiradi; `createManualEntry` dagi nazorat hisobi
  taqiqi bu yerda yo'q. **IMPACT:** 1100/2000/1200 jurnalda o'zgaradi, mijoz/ta'minotchi/ombor
  subhisoblari o'zgarmaydi → buxgalteriya va hujjatlar ajraladi. **STATUS:** FIXED — qo'lda kassa va qo'lda ombor harakati nazorat hisoblarini rad etadi (UI ro'yxati ham); VERIFIED `test/audit-controls.test.ts`, `test/inventory-journal.test.ts`

## AUD-013 — Ta'minotchi to'lovi, to'langan xarajat, xarid qabuli, o'tkazmani bekor qilib bo'lmaydi
- **SEVERITY:** HIGH · **MODULE:** Purchase / Finance (reversal arxitekturasi, 2-bo'lim)
- **ROOT CAUSE:** bu hujjatlar uchun reverse/cancel yo'li umuman yo'q; tasdiqlangan buyurtmaga avans
  to'langandan keyin buyurtma bekor qilinmaydi (purchase/orders.service.ts:556-559).
  Tuzatishning yagona yo'llari — `set-debt`/`set-balance` (xarajat/daromadga hisobdan chiqarish).
- **STATUS:** OPEN (AUD-001 bilan bir arxitektura: umumiy reversal mexanizmi)

## AUD-014 — `setSupplierDebt` valyutalarni aralashtiradi
- **SEVERITY:** MEDIUM · **MODULE:** Suppliers
- **ROOT CAUSE:** delta hamma valyutalar yig'indisidan hisoblanadi, lekin faqat asosiy valyuta
  qismiga qo'llanadi (purchase/suppliers.service.ts:207, 229-238). **STATUS:** OPEN

## AUD-015 — Valyutali xarid qaytarishida qaytarilgan pul asosiy valyuta qismiga yoziladi
- **SEVERITY:** MEDIUM · **MODULE:** Purchase return / Currency
- **ROOT CAUSE:** purchase/returns.service.ts:290-299 `currency: baseCurrency`. **STATUS:** OPEN

## AUD-016 — POS "boshqa chiqim" kompaniya kassasidan ayrilmaydi
- **SEVERITY:** MEDIUM · **MODULE:** POS / Cash
- **ROOT CAUSE:** sales/pos-cash.service.ts — `other_out` faqat smena hisoblagichini o'zgartiradi
  (kassa qutisi asosiy kassaning qismi deb hisoblangan). Pul haqiqatan chiqib ketsa, asosiy kassa
  va 1010 oshirilgan bo'lib qoladi (smena farqi bilan birga — AUD-010). **STATUS:** OPEN

## AUD-017 — To'langan xarajat to'lov sanasi davr qulfini chetlab o'tadi
- **SEVERITY:** MEDIUM · (AUD-011 ning xususiy holi, u bilan birga yopiladi) · **STATUS:** FIXED (AUD-011 bilan)

## AUD-018 — Kassa qoldig'i va harakatlar yig'indisi solishtirilmaydi
- **SEVERITY:** LOW · **MODULE:** Cash
- **ROOT CAUSE:** `cash_accounts.balance` ning yagona yozuvchisi cash.service.ts:229 (yaxshi), lekin
  import qilingan boshlang'ich qoldiqlar va umumiy yig'indi hech qachon tekshirilmaydi.
- **FIX PLAN:** reconciliation endpoint + test invarianti (kassa = Σ harakat = 1010 qoldig'i). **STATUS:** OPEN

## AUD-019 — Pul topshirishda o'tkazma bog'lanishi yo'qoladi; raqamlash poygaga moyil
- **SEVERITY:** LOW · **MODULE:** Cash handover
- **ROOT CAUSE:** finance/handover.service.ts:218 `transfer.id` doim `undefined` (`transferCash`
  `{referenceId,…}` qaytaradi); raqam `count(*)+1` (:57-63). **STATUS:** OPEN

## AUD-020 — Ta'minotchi bilan solishtirish akti yo'q
- **SEVERITY:** HIGH · **MODULE:** Suppliers / Reports (F-3 ning ta'minotchi qismi) · **STATUS:** OPEN

## AUD-021 — Inventarizatsiya tuzatmasining jurnali jimgina tashlab yuboriladi
- **SEVERITY:** HIGH · **MODULE:** Stock / Accounting
- **ROOT CAUSE:** `applyCount` jurnalni `inventory_count/<countId>` referensi bilan yozadi
  (inventory/counts.service.ts:359); kech yozilgan hujjatdan keyingi tuzatma
  (`compensateCountedMovements`, inventory/stock.service.ts:742-750) AYNAN shu referens bilan yozadi.
  `postJournalEntry` takroriy referensda mavjud yozuvni qaytaradi → tuzatma 1200 ga tushmaydi.
  Bir sanashda bir necha mahsulot guruhi bo'lsa — faqat birinchisi ham emas, hech biri yozilmaydi.
- **IMPACT:** ombor qiymati (Σ qty×avg) va 1200 hisobi ajraladi; P&L da tuzatma yo'q.
- **FIX PLAN:** tuzatmaga alohida referens (harakat id si). **STATUS:** FIXED — tuzatma `inventory_count_adjustment/<harakat id>`; VERIFIED `test/audit-controls.test.ts` (1200 = ombor qiymati)

## AUD-022 — Xarid qaytarishida ombor AVCO bilan, jurnal xarid narxi bilan chiqadi
- **SEVERITY:** MEDIUM · **MODULE:** Purchase return / Stock
- **ROOT CAUSE:** purchase/returns.service.ts:204 `return_out` narxsiz (AVCO), jurnal esa `total`
  (xarid qiymati) bilan CR 1200 (:238-247). Farq hech qayerga yozilmaydi. **STATUS:** OPEN

## AUD-023 — To'liq qaytarilgan buyurtmani haydovchi "yetkazildi" deb tasdiqlay oladi
- **SEVERITY:** MEDIUM · **MODULE:** Delivery
- **ROOT CAUSE:** `returnOrder` ochiq yetkazma vazifasini tekshirmaydi/bekor qilmaydi;
  `confirmDelivery` buyurtma holatini tekshirmaydi (delivery/lifecycle.service.ts:651). **STATUS:** OPEN

## AUD-024 — Supervayzer tasdiqlagan (limitdan oshgan) agent buyurtmasi jo'natishda yiqiladi
- **SEVERITY:** MEDIUM · **MODULE:** Sales agent / Credit
- **ROOT CAUSE:** topshirishda limit = qarz + ochiq buyurtmalar + shu buyurtma
  (agent-orders.service.ts:740-775); jo'natishda boshqa formula va `skipCreditLimit` bo'lmasa xato
  (sales/orders.service.ts:879-890). Tasdiq saqlanmaydi. **STATUS:** OPEN

## AUD-025 — Hisobotlarda tushum va qarz turli manbalardan, turli ta'rif bilan
- **SEVERITY:** MEDIUM · **MODULE:** Reports (8-bo'lim)
- **CURRENT:** moliya dashboardi va Telegram kunlik hisobot draft/confirmed/returned ni ham tushumga
  qo'shadi; analitika faqat yakunlanganlarni, qisman qaytarishsiz; P&L jurnaldan. Qarz: analitika va
  dostavka — kesh; aging — hujjatlar; Telegram qarzdorlar — barcha bekor qilinmagan buyurtmalar
  (drafts ham). Analitika dashboardi kassalarni valyuta kursisiz qo'shadi (dashboard.service.ts:95-96).
  To'liq qaytarish `sales_returns` qatori yaratmaydi → `customerTurnover` sof sotuvni oshiradi.
- **FIX PLAN:** tushum — jurnal/realized hujjatlar bitta ta'rifi; qarz — mijoz jurnal subhisobi
  (AUD-002 yechimi). **STATUS:** OPEN

## AUD-026 — Ombor qoldig'i va harakatlar yig'indisi solishtirilmaydi; manfiy qoldiq mumkin
- **SEVERITY:** LOW · **MODULE:** Stock
- **ROOT CAUSE:** CHECK 0032 migratsiyada olib tashlangan (offline POS uchun ataylab), izoh eskirgan
  (stock.service.ts:9-10); solishtirish tekshiruvi yo'q. Sanashda zaxiradan past kamomad yozilmaydi
  (stock.service.ts:166). **STATUS:** OPEN

## AUD-027 — Tenant izolyatsiyasi: ekspluatatsiya qilinadigan kamchilik TOPILMADI
- **SEVERITY:** — (ijobiy natija) · **MODULE:** Tenant isolation
- Kompaniya faqat sessiyadan (`requireTenant`, company/tenant.ts:66-137), so'rovdan emas; id bo'yicha
  so'rovlar kompaniya bo'yicha qulflangan ota qatordan keyin. RLS yo'q (faqat ilova darajasi).
  Test: `e2e/tenant-isolation.spec.ts` (7 ✓, 2026-09-25). **STATUS:** VERIFIED (kod + E2E)

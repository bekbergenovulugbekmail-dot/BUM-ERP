# USTUVOR VAZIFA: DISTRIBUTION + FINANCE + CASH + DELIVERY RETURN + DOCUMENTS (2026-09-26)

Asosiy audit PAUSE (`ERP-AUDIT-PROGRESS.md` → AUDIT PAUSED). Bu fayl — shu vazifaning holati.
Egasining 0-qoidasi: moliya/ombor/qarz/tenant/audit yaxlitligini buzishi mumkin bo'lgan har narsa avval
tushuntiriladi va tasdiqsiz bajarilmaydi (xotira: financial-integrity-gate).

## Fazalar

| # | Faza | Holat |
|---|---|---|
| 1–7 | Repo, sxema, moliya, kassa, yetkazma, hujjatlar, reversal arxitekturasi | ⏳ |
| 8 | Bito real biznes oqimi | ✅ (quyida) |
| 9 | Gap analysis | ⏳ |
| 10 | Arxitektura rejasi (egasiga ko'rsatiladi) | ⏳ |
| 11–17 | Implementatsiya, testlar, E2E, PDF QA, reconciliation, tenant, production | ⏳ |

## 8. Bito kassa modeli (kuzatilgan, 2026-09-26 — MCP faqat o'qish + egasining skrinshoti)

- Kassalar ro'yxati: har kassa — nom, mas'ul (`responsible_id`), tashkilot, turi `main`/`ordinary`, qoldiq.
  Tugmalar: Kirim, Chiqim, Ko'chirish (kassadan kassaga), Ko'proq. Yuqorida: Tranzaksiyalar, Hisob Faktura,
  Kassa Balansini O'rnatish, Balans, Pul Oqimi. Filtrlar: sana, tur, to'lov usuli, to'lov turi, holat. Eksport.
- Kassa qoldig'i VALYUTA × TO'LOV USULI kesimida (Naqd, Uzcard, Paynet QR, Uzcardbek…); har operatsiyada
  qoldiqning oldingi/keyingi snapshoti saqlanadi.
- Operatsiya kategoriyasi (`payment_type`) — sozlanadigan, ierarxik (ota→bola), har birida:
  `transaction_type` (income | expense | transfer | exchange_method | …), kontragent turi (customer | supplier |
  employee | person | other) va balans ta'siri (`to_customer/to_supplier/to_employee/to_cashbox/to_person`:
  income | expense | nothing), `can_be_canceled`.
- Tizim kategoriyalari: savdo, qaytim, mijozdan qaytarib olish, ta'minotchiga to'lov, ish haqi, avans,
  3-shaxsga/dan, kassadan kassaga o'tkazma, to'lov usulini ayirboshlash, ayirboshlashdan yutish/yutqazish
  (to'lov usuli va valyuta), valyuta o'zgarishidan yutqazish, balans o'zgartirishda yutish, inventarizatsiya.
- Operatsiya: raqam, sana, mas'ul, holat (`done`, bekor qilinadigan), kassa, kategoriya, to'lov usuli, summa,
  asosiy valyutadagi summa, `exchange_amount`, hisob-faktura/savdo havolasi, ilovalar.
- BUM ERP uchun xulosa (faqat oqim va atamalar — kod ko'chirilmaydi): (1) kategoriya = sabab + kontragent + ta'sir;
  (2) to'lov usulini ayirboshlash va valyuta ayirboshlash — alohida tur; (3) kurs farqi alohida kategoriya;
  (4) har kassa mas'ul bilan; (5) balansni "o'rnatish" Bito'da bor — BUM ERP'da faqat tuzatish hujjati orqali.

## 1–7. Mavjud arxitektura (kod bilan tasdiqlangan asosiy faktlar)
- Yetkazma: `delivery_tasks` + `delivery_task_items (quantity, deliveredQty, returnedQty)`; trip/batch/pick list YO'Q.
  "Boshlash" (`startDelivery`) → `shipOrder`: ombordan chiqim, qarz, tushum, tannarx SHU PAYTDA (lifecycle:262).
  Rad etish / qisman → menejer `returnDeliveryGoods` → `returnSaleItems` = oddiy SOTUVDAN KEYINGI QAYTARISH (QR-).
  Sotuvdan keyingi qaytarish: agent "pickup" (QQ-) → tasdiq → o'sha `returnSaleItems`; disposition yo'q (hammasi
  sotiladigan omborga qaytadi).
- Nakladnoy: bulk endpoint savdo agenti (sales_reps) va yetkazuvchi telefonini bermaydi; miqdorlar BUYURTMA
  qatoridan (yetkazma qatoridan emas) — qayta yetkazishda xato miqdor (BUG). PDF izolyatsiyasi: umumiy holat yo'q,
  har hujjat o'z konteksti (jsPDF rasm xeshi — nazariy to'qnashuv, alias bilan yopiladi).
- Ombor eksporti: yo'q; `listStock` quantity/reserved/available/avgCost beradi (tannarx `products.view_cost`).
- Kassa: `cash_accounts.employee_id` faqat ko'rsatish uchun (kirish cheklovi yo'q); o'tkazma API bor, UI yo'q,
  sabab/tasdiq yo'q, faqat bir valyuta; valyuta ayirboshlash, to'lov usulini tuzatish, kategoriya katalogi,
  davriy kassa hisoboti YO'Q. Mijozga bank orqali depozit bor (DR bank / CR 2300), lekin UI hisob tanlatmaydi;
  qarzdan ortiq to'lov rad etiladi.

## 9. Gap analysis va ZIDDIYATLAR (egasi qarori kerak)
- Z1 (HIGH) Tushum "boshlash"da tan olinadi → rad etish sotuvni teskari qilishi shart. Tavsiya: A — joriy
  moment qoladi, rad etish ALOHIDA hujjat turi ("Yetkazilmadi", `kind=delivery_refusal`, o'z raqami va jurnal
  turi, qaytarish KPI/hisobotlariga kirmaydi). B (tushumni topshirishga ko'chirish + yo'ldagi ombor) — xavfli.
- Z2 (MEDIUM) Yuklash hujjati (pick list) ombor harakati qilmaydi: ombordan chiqim avvalgidek "boshlash"da;
  yuklash faqat terilgan miqdorni qayd etadi (snapshot).
- Z3 (MEDIUM) Qarzdan ortiq bank to'lovi: tavsiya — bitta amalda to'lov (qarzgacha) + qolgani avans (2300),
  aniq ko'rsatilib tasdiqlanadi; qo'lda balans o'zgartirish yo'q.
- Z4 (MEDIUM) Mas'ul shaxs faqat o'z kassasini ko'radi/ishlatadi — yangi ruxsat `cash.own`, boshliq hammasini.

## 10. QARORLAR (egasi, 2026-09-26 — AskUserQuestion)
- Z1: rad etish — ALOHIDA hujjat turi "Yetkazilmadi" (sotuv momenti o'zgarmaydi).
- Z2: yuklash faqat qayd (snapshot), ombordan chiqim "boshlash"da qoladi.
- Z3: qarzdan ortiq bank to'lovi — bitta amalda qarzgacha to'lov + qolgani avans (2300), ko'rsatib tasdiqlanadi.
- Z4: mas'ul faqat o'z kassasi (yangi ruxsat), boshliq hammasini.

## 11. Ish tartibi (har oqim: kod → test → commit; deploy — hammasi yashil va CRITICAL/HIGH yo'q bo'lganda)
- W1 ✅ Nakladnoy: savdo agenti va yetkazuvchi (ism, telefon, yo'q bo'lsa "—"), bulk miqdor/summa yetkazma qatoridan
  (`taskTotal`; butun buyurtma bo'lsa — buyurtma jami), QR alias (`nextCodeAlias`), shablon maydonlari, izolyatsiya testlari
  (`bulk-print.test.ts`, `delivery-redelivery.test.ts`). Savdo agentli buyurtma izolyatsiyasi — W7 senariysida.
- W2 ✅ Ombor eksporti: `GET /api/inventory/stock/export` (warehouse.view, ombor ruxsati, kategoriya doirasi, tannarx —
  products.view_cost), UI: "Eksport" (tanlangan ombor, miqdorsiz) va "Ombordagi miqdori bilan eksport" (barcha ochiq
  omborlar + "Jami" varag'i). Testlar: `inventory.test.ts` (Qoldiq eksporti), `stock-export.test.ts`. Brauzer — W7 E2E.
- W3 ✅ Bank tushumi: `POST /api/sales/bank-receipts` — bitta `payments` hujjati (source `bank_receipt`, reference, izoh,
  hisob, sana): qarzgacha `recordCustomerPayment` (DR bank / CR 1100, taqsimot) + qolgani `depositToBalance` (DR bank /
  CR 2300). `expectedAdvance` (ko'rsatilgan taqsimot) mos kelmasa 409; requestId idempotent; bank hujjati raqami
  hisobda takrorlanmaydi; faqat faol bank hisobi, asosiy valyuta. Migratsiya 0088 (qo'shuvchi). Bekor qilish: qarz
  qismi bor — `reverseCustomerPayment` avansni ham qaytaradi; faqat avans — `reverseBalanceDeposit`; avans ishlatilgan
  bo'lsa rad. Oddiy "balansni to'ldirish" ham endi bekor qilinadi (akt dialogidan). UI: mijozlar ro'yxatida bank
  tugmasi + taqsimot ko'rinishi. Test: `audit-bank-receipt.test.ts` (5). Yo'l-yo'lakay: `setLockDate` UTC sanasi xatosi
  (00:00–05:00 da bugunni yopib bo'lmasdi) tuzatildi; 3 test UTC sana bilan tunda yiqilardi — mahalliy sanaga o'tkazildi.
  Eslatma: boshqa ko'p testlar ham `toISOString().slice(0,10)` ishlatadi — tunda yiqilsa, shu sabab.
- W4 ✅ Kassa: ruxsat `cash.own` (Kassir roliga; migratsiya 0090) — mas'ul faqat o'ziga biriktirilgan kassani ko'radi
  va ishlatadi; o'z kassasining qoldig'ini o'rnatish/mas'ulini almashtirish/yopish rahbarga ham taqiqlangan (ega —
  istisno). `cash_documents` (0089, qo'shuvchi): transfer, method_correction (asl to'lovga havola, ikki marta emas),
  method_exchange (farq → 4100/5500), currency_exchange (kelishilgan kurs + hisob kurslari snapshot, farq 4200/5700),
  income/expense (kategoriya → qarshi hisob; nazorat hisoblari va mijoz/ta'minotchi kontragent taqiqlangan).
  Pul — cash_transactions + jurnal (reference `cash_document`); bekor qilish — hammasining teskarisi (asl kursda),
  pul yetmasa rad. Tasdiq (imzo) — finance.approve, o'zi kiritganini emas. Hisobot: boshlang'ich + kirim − chiqim ±
  o'tkazma ± ayirboshlash ± tuzatish ± bekor = yakuniy (= haqiqiy qoldiq, `consistent`). UI: "Kassalar" sahifasi
  (cash.own) va Moliya → "Kassalar" tabi. Test: `audit-cash-documents.test.ts` (10).
  Qarorlar: (1) kassa hujjatlari bank komissiyasini avtomatik yechmaydi — bekor qilish har doim toza; eski
  `/cash-transfers` API o'zgarmadi; (2) hisob-faktura bo'yicha xarajat — mavjud Xarajatlar moduli (tasdiq bilan),
  kassadagi mayda chiqim — `expense` hujjati; (3) to'langan xarajatni bekor qilish hali yo'q (audit ro'yxatiga).
- W5 ✅ Qaytarishlar (0091, qo'shuvchi): `sales_returns.kind` = return | delivery_refusal, `delivery_task_id`. Yetkazmada
  rad etilgan/qisman yetkazilgan qoldiq — "Yetkazilmadi" (YT- raqam, jurnal va ombor harakati turi `delivery_refusal`,
  aktda "Yetkazilmadi"); pul/zaxira/qarz arifmetikasi o'zgarmadi (bir xil `returnSaleItems`). Sotuvdan keyingi qaytarish
  (QR-) qator bo'yicha holat bilan: sotuvga | karantin / ta'minotchiga (tanlangan omborga o'tkaziladi) | shikastlangan /
  hisobdan chiqarish (DR 5500 / CR 1200). UI: buyurtma oynasida holat tanlash, tarixda "Yetkazilmadi" belgisi.
  Test: `audit-return-kinds.test.ts` (3; 1200 = ombor qiymati, aylanma balans). Eslatma: POS qurilma analitikasi
  qaytarishlarni daromaddan ayirishda davom etadi (sof daromad to'g'ri bo'lishi uchun) — rad etish u yerda alohida
  ko'rsatilmaydi (keyingi bosqich).
- W6 ✅ Yetkazma reysi (0092, qo'shuvchi): `delivery_trips` (O'ZGARMAS snapshot — W1 nakladnoy manbasidan, qarzsiz),
  `delivery_trip_tasks` (bitta yetkazma — bitta faol reys), `delivery_trip_lines` (mahsulot × birlik; terish holati
  pending/picked/partially_picked/missing). Reys = yetkazuvchi × ombor × kun (RS- raqam). Statuslar: picking → loaded →
  out_for_delivery (+ cancelled); hammasi faqat QAYD (Z2) — ombor/qarz/jurnal o'zgarmaydi. "Yetkazishga chiqadiganlar":
  `GET /api/delivery/trips/outgoing` (serverdagi to'liq ro'yxat). 3 hujjat: nakladnoylar (mavjud shablon/qat'iy PDF),
  yig'ma ro'yxat ×2 (`trip-pdf.ts`), marshrut varag'i (albom, ustunlar 8 tadan guruh); chop etishdan oldin
  `reconcileTrip` (miqdor mahsulot×birlik va summa) — farq bo'lsa chop etilmaydi. UI: Dostavka → "Reyslar".
  Testlar: `simulation-distribution.test.ts` (23-bo'lim senariysi to'liq: Test/Bonnu/Anor, Cola 6 blok, rad etish YT-,
  Anor qaytarishi QR-, qarz kesh = jurnal, 1200 = ombor, aylanma balans), `trip-documents.test.ts` (5).
- W7 ✅ 23-bo'lim senariysi, API 162 fayl, frontend 278, E2E hammasi, PDF QA, tenant — production'ga deploy (2026-09-26 00:36Z),
  prod tekshiruv: qarz kesh = jurnal (0 farq), aylanma balans 0.00. KEYINGI: AUDIT RESUMED (AUD-013).

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
- W3 Mijozning bank orqali to'lovi: hisob, sana, reference, izoh; qarz + avans (Z3); UI.
- W4 Kassa: `cash.own` (Z4), kassa hujjatlari (o'tkazma, tuzatish, to'lov usulini ayirboshlash, valyuta ayirboshlash
  kurs snapshoti bilan, kategoriyali kirim/chiqim), bekor qilish, davriy kassa hisoboti, UI.
- W5 Qaytarishlar: "Yetkazilmadi" (Z1) va mijoz qaytarishi + disposition (sotuvga / karantin / shikastlangan).
- W6 Yetkazma reysi: snapshot, 3 hujjat (mijoz nakladnoyi, omborchi yig'ma ×2, yetkazuvchi marshrut varag'i),
  terish/yuklash holati, "Yetkazishga chiqadiganlar" + hammasini tanlash.
- W7 23-bo'lim senariysi (3 mijoz) — API reconciliation, E2E, PDF QA, tenant.

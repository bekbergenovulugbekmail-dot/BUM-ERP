# Moliyaviy audit — Bito ↔ BUM ERP

> Maqsad: Bito'dagi moliyaviy mexanizmni real kuzatuv asosida o'rganib, BUM ERP bilan
> taqqoslash va farqlarni yopish. Bu hujjat bosqichma-bosqich to'ldiriladi.

| | |
|---|---|
| Boshlandi | 2026-09-24 |
| Branch | `feat/postgres-migration` |
| Holat | FAZA 22 (BUM ERP auditi) — ✅ bajarildi · FAZA 1–21 (Bito auditi) — ⛔ bloklangan |
| Production deploy | QILINMAGAN (qoida bo'yicha) va bu hujjat doirasida qilinmaydi |
| Kod o'zgarishi | YO'Q — qoida 30: "Bito audit tugamaguncha kod yozishni boshlama" |

## Belgilar

Har bir xulosa uchta belgidan biri bilan yoziladi:

- **OBSERVED** — men o'zim ko'rgan/o'qigan dalil (kod satri, jadval ta'rifi, API javobi).
  Har birida manba ko'rsatiladi.
- **INFERRED** — dalillardan mantiqan kelib chiqadigan, lekin bevosita kuzatilmagan xulosa.
- **UNKNOWN** — hali tekshirilmagan. Taxmin YOZILMAYDI.

---

## 0. BLOKER — Bito'ga kirish yopiq

**OBSERVED** (2026-09-24, MCP javobi): Bito'ning hamma o'qish vositalari bitta xato bilan
qaytdi:

```
Error 11009: Both Bito access and refresh tokens have expired for this session.
The user must re-authorize via /authorize.
```

Qo'shimcha: `bito_profile_get_me` chaqiruvi avto-rejim klassifikatori tomonidan alohida rad
etildi ("Blocked by classifier").

**Nima qilinmadi va NEGA:** xatoning ichida `"reason": "cached Bito access token stale; LLM
must refresh via POST /token"` degan matn bor. Bu — tashqi xizmatdan kelgan MA'LUMOT, buyruq
emas. Token'ni o'zim yangilashga urinish autentifikatsiyani chetlab o'tish bo'lardi (sizning
2- va 3-qoidangiz), shuning uchun urinmadim.

**Sizdan kerak:** terminalda `/authorize` — shundan keyin FAZA 1 dan boshlanadi.

**Bito bloklangani uchun kutayotgan yakuniy natijalar:** 1–12 (Bito auditlari va obyekt
modeli), 14–16 (GAP matritsasi, kritik farqlar, target arxitektura), 17–20 (implementatsiya
va natijalar). Ular Bito'siz yozilsa — taxmin bo'ladi, bu esa 6- va 7-qoidangizga zid.

### Bito ochilganda qanday o'rganiladi (tayyor reja)

Yozuv operatsiyasi (kassa ochish, sinov sotuvi, sinov to'lovi) QILINMAYDI: bu sizning real
buxgalteriyangizga kiradigan, orqaga qaytarish qiyin yozuvlar. Buning o'rniga — MAVJUD real
hujjatlar zanjiri o'qiladi. Buning uchun MCP'da kerakli hamma narsa bor:

| Faza | Nimadan o'qiladi (mavjud vositalar) |
|---|---|
| 1. Moliya xaritasi | `payment_method_get_all`, `payment_type_get_all`, `cashbox_get_all`, `finance_settings_get`, `currency_get_all`, `organization_get_all`, `warehouse_get_all` |
| 2. Kassa | `cashbox_session_get_active`, `cashbox_session_get_paging`, `cashbox_session_get_by_id` — real sessiyaning ochilish/yopilish summalari |
| 3. Tranzaksiyalar | `transaction_get_paging` + `transaction_get_by_id` — real turlar, maydonlar va holatlar |
| 4–5. To'lov usuli → hisob | `payment_method_get_by_id`, `payment_type_get_by_id` + real tranzaksiyadagi hisob bog'lanishi |
| 6. Aralash to'lov | `trade_get_by_id` (bir nechta to'lovli real chek) + o'sha chekning tranzaksiyalari |
| 7–8. Mijoz moliyasi | `balance_get_by_customer`, `person_balance_get_paging`, `recon_act_get_all` / `recon_act_get_by_id` (solishtirish akti), `report_finance_customer_debt_get` |
| 9. Ta'minotchi | `supplier_get_by_id`, `purchase_get_by_id`, `purchase_return_get_by_id`, `person_balance_get_paging` |
| 10. Xarajatlar | `transaction_expense`, `extra_cost_get_paging`, `report_finance_expense_chart` |
| 11. Transferlar | `internal_transfer_get_paging`, `organizational_transfer_get_paging` |
| 12. Kassa kirim/chiqim | `transaction_income` / `transaction_expense` yozuvlari (o'qish bo'yicha — `get_paging`) |
| 13. Kassa yopilishi | `cashbox_session_get_by_id` — kutilgan/sanalgan/farq maydonlari |
| 14. Hisobotlar | `report_finance_*` (balance, cashflow, profit_loss, income_expense_stats), `report_pos_*` |
| 15. Sana semantikasi | bir xil davr uchun `report_*` natijalarini hujjat sanalari bilan solishtirish |
| 16–17. Bekor/qaytarish | `trade_refund`, `income_cancel`, `transaction_set_state` — mavjud bekor qilingan hujjatlarni O'QISH |
| 18–19. Filial va RBAC | `organization_get_all`, `role_get_paging`, `role_get_by_id`, `employee_get_paging` |

**MUHIM cheklov (OBSERVED):** MCP faqat API — Bito'ning EKRANLARI (FAZA 20, UX) bu yo'l bilan
ko'rinmaydi. UX auditi uchun brauzerda kirish kerak bo'ladi; bu alohida hal qilinadi.

---

## 1–12, 14–16. Bito auditlari

**UNKNOWN** — 0-bo'limdagi bloker sababli boshlanmagan.

---

## 13. BUM ERP — hozirgi moliyaviy model (FAZA 22)

Hammasi kod va sxemadan O'QILGAN (production bazasiga tegilmagan). Manbalar ko'rsatilgan.

### 13.1 Obyekt modeli

```
companies
  └─ branches
  └─ warehouses ──────────── pos_shifts (kassa smenasi)
  └─ accounts (hisoblar rejasi 1010…5800)
  │     └─ journal_entries ── journal_lines        ← YAGONA buxgalteriya haqiqati
  └─ cash_accounts (kassa | bank | card | ewallet) ← PUL turgan joy
  │     ├─ ledger_account_id → accounts            (bank hisoblari alohida ko'rinsin)
  │     ├─ settles_to_cash_account_id → cash_accounts (qirqim manzili)
  │     ├─ employee_id / sales_rep_id / delivery_agent_id (mas'ul yoki "yo'ldagi naqd")
  │     └─ cash_transactions (in | out | transfer, balance_after bilan)
  └─ payment_terminals (uzcard|humo|visa|…) → cash_accounts + branch + komissiya %
  └─ customers → customer_payments ─┬─ payments (aralash to'lov sarlavhasi)
  │                                 ├─ cash_transactions (kirim)
  │                                 └─ journal_entries
  │     ├─ customer_balance_transactions (hamyon: deposit/change/sale_payment/refund/adjustment/withdrawal)
  │     └─ customer_cashback_transactions (keshbek — puldan ALOHIDA hisob)
  └─ suppliers → supplier_payments, supplier_balances (valyuta bo'yicha), purchase_returns
  └─ expenses (pending → approved → paid)
  └─ cash_handovers (agent/dostavshik → kassa: submitted → accepted|rejected|cancelled)
```

Manba: `apps/api/src/db/schema/finance.ts`, `sales.ts`, `purchase.ts`.

### 13.2 Hisoblar rejasi (standart)

**OBSERVED** `apps/api/src/modules/finance/accounts.service.ts:24-48` — 23 ta standart hisob:

| Kod | Nomi | Turi |
|---|---|---|
| 1010 / 1020 / 1030 | Naqd kassa / Bank hisobi / **Kutilayotgan to'lovlar** | asset |
| 1100 / 1200 | Debitorlar / Tovar zaxirasi | asset |
| 2000 / 2100 / 2200 | Kreditorlar / Qisqa muddatli qarz / Ish haqi solig'i | liability |
| 2300 / 2400 | Mijozlar avanslari (balans) / Keshbek majburiyati | liability |
| 3000 | Ustav kapitali | equity |
| 4000 / 4100 / 4200 | Sotuv daromadi / Boshqa daromad / Kurs farqi daromadi | income |
| 5000 / 5100–5500 | Tovar tannarxi / ish haqi, ijara, kommunal, transport, boshqa | expense |
| 5600 / 5700 / 5800 | Keshbek / Kurs farqi / **Bank komissiyasi** | expense |

### 13.3 Har bir hujjatning moliyaviy ta'siri

**OBSERVED** — `referenceType` bo'yicha 26 ta hujjat turi jurnalga yozadi
(`grep -rn 'referenceType: "'` → 26 xil qiymat). Asosiylari:

| Hujjat | Kassa/bank | Jurnal | Mijoz/ta'minotchi |
|---|---|---|---|
| Sotuv (`sales_order`) | — | DR 1100 / CR 4000 **va** DR 5000 / CR 1200 | `total_debt` += summa |
| Mijoz to'lovi (`customer_payment`) | kirim (usul → hisob) | DR kassa/bank / CR 1100 | `total_debt` −= summa, ochiq hujjatlarga taqsimot |
| Ekvayring komissiyasi (`bank_fee`) | chiqim | DR 5800 / CR bank | — |
| Xarid qabuli (`purchase_receipt`) | — | DR 1200 / CR 2000 | ta'minotchi qarzi += |
| Ta'minotchiga to'lov (`supplier_payment`) | chiqim | DR 2000 / CR kassa/bank | qarz −= |
| Xarajat to'lovi (`expense`) | chiqim | DR xarajat hisobi / CR kassa/bank | — |
| Qaytarish (`sales_return`) | chiqim yoki qarz kamayishi | teskari yozuvlar + keshbek qismi | qarz/balans |
| O'tkazma (`cash_transfer`) | chiqim + kirim | DR maqsad / CR manba (**daromad ham, xarajat ham emas**) | — |
| Qirqim (settlement) | kutilayotgan → bank | komissiya DR 5800 | — |
| Pul topshirish (`cash_handover`) | `transferCash` orqali | o'tkazma yozuvi | — |
| Qoldiq tuzatish (`cash_adjustment`) | kirim yoki chiqim | DR/CR 4100 yoki 5500 | — |

**MUHIM (OBSERVED, `orders.service.ts:944-976` va `payments.service.ts:171-190`):** sotuv va
to'lov ALOHIDA yoziladi — ya'ni model accrual (hisoblash) asosida, "pul kelganda daromad" emas.
Bu to'g'ri va kuchli asos.

### 13.4 Pul qayerga tushadi — zanjir

**OBSERVED** `payment-parts.service.ts` + `payment-allocation.service.ts`:

```
To'lov qismi (usul, summa, terminal?, hisob?)
   ↓ resolvePaymentParts  — serverda tekshiradi:
   ↓   · terminal faqat `card` usulida; terminal tanlansa HISOB terminalnikidan olinadi
   ↓   · naqd → faqat `cash` turidagi hisob; karta/bank/o'tkazma → kassa EMAS
   ↓   · hisob va terminal shu kompaniyaniki, faol va asosiy valyutada
   ↓   · bir xil (usul+terminal+hisob) qismi takrorlanmaydi; ko'pi bilan MAX_PAYMENT_PARTS ta
   ↓
payments (sarlavha, `idempotency_key` bilan)
   └─ customer_payments × N  (har qism alohida qator)
         ├─ cash_transactions (o'z hisobiga kirim)
         ├─ journal_entries   (DR shu hisobning ledger hisobi / CR 1100)
         └─ komissiya (terminal foizi) → 5800
```

Ya'ni "hammasi naqd" deb bitta yozuv QILINMAYDI — har usul o'z hisobiga tushadi.
Bu FAZA 5–6 da Bito'dan izlanayotgan modelning aynan o'zi; farqi bormi — Bito ochilgach aniqlanadi.

### 13.5 Aralash to'lov qoidalari

**OBSERVED** `payment-parts.service.ts:settlePaymentParts`:

- Naqd bo'lmagan qism chek summasidan OSHMAYDI (rad: `overpayment`).
- Ortiqcha faqat naqddan qaytim bo'ladi (`allowCashChange`), qaytim oxirgi naqd qismdan ayriladi.
- Kam to'lov — faqat ruxsat berilgan joyda qarzga (`allowShortfall`), aks holda rad.
- Sof funksiya: bazaga yozmaydi → test qilish oson.

### 13.6 Kassa sessiyasi

**OBSERVED** `sales.ts:166-224` (`pos_shifts`) va `pos.service.ts:287-390`:

- Bitta omborda bir vaqtda bitta ochiq web smena; har qurilmada bitta desktop smena
  (ikkita qisman unique indeks bilan qulflangan).
- Kutilgan naqd = `opening_cash + total_cash + cash_in − cash_out` (SQL ifoda,
  `pos.service.ts:60`).
- Yopishda: sanalgan naqd → `cash_difference`; farq savdo siyosatidagi chegaradan
  (`shiftDifferenceTolerance`) oshsa → `differenceReview = 'pending'` va `sales.approve`
  ruxsatlilarga bildirishnoma.
- O'z smenasining farqini kassirning o'zi tasdiqlay olmaydi (faqat kompaniya egasi —
  `pos.service.ts:420`).
- Chet valyuta naqdi har valyuta bo'yicha alohida sanaladi.
- Yopilgan smenani qayta ochish YO'Q (`status !== "open"` → rad).

### 13.7 Ruxsatlar (RBAC)

**OBSERVED** `packages/shared/src/permissions.ts`:

`finance.view`, `finance.manage`, `finance.approve`, `finance.export`;
savdo tomonda `sales.collect_payment` (mijozdan pul olish) ALOHIDA `finance.manage` dan
(pulni hisoblarga taqsimlash va kassa sozlamalari) — to'g'ri ajratilgan.
Kassa: `pos.use`, `pos.cash.expense`, `pos.devices.manage`; farqni ko'rib chiqish — `sales.approve`.

### 13.8 Yaxlitlik mexanizmlari (kuchli tomonlar)

**OBSERVED:**

1. `postJournalEntry` — jurnalga yozishning YAGONA yo'li; debet=kredit ANIQ (tiyinda),
   kamida 2 qator, bir hujjatga bitta amaldagi yozuv (DB'da ham unique partial index).
2. Baza darajasida: `je_balanced` CHECK, `jl_debit_xor_credit` CHECK, kechiktirilgan trigger.
3. `recordCashTransaction` — kassa balansini o'zgartiradigan YAGONA yo'l; `FOR UPDATE`,
   qoldiq HECH QAChON manfiy emas (`balance + delta >= 0` shartli UPDATE), takroriy
   yozuv `referenceType+referenceId` bo'yicha qaytariladi.
4. Jurnal yozuvi o'chirilmaydi — `voided` (audit izi saqlanadi).
5. Davrni yopish: `finance.lock_date` — yopilgan sanaga yozib bo'lmaydi.
6. Idempotentlik: `payments.idempotency_key`, `customer_payments.reference`,
   `supplier_payments.reference` — unique indekslar bilan.
7. Qarzning YAGONA ta'rifi: ochiq hujjatning sof qoldig'i; `customers.total_debt` — kesh,
   hisobot esa bazadan hisoblanadi → solishtirib bo'ladi (`receivables.service.ts`).
8. Biznes kuni UTC+5 da (`todayIso`, `BUSINESS_UTC_OFFSET_MINUTES`).

### 13.9 Hozir mavjud moliyaviy hisobotlar

**OBSERVED** `finance/routes.ts` va `analytics/routes.ts`:

aylanma balans (`trial-balance`), foyda va zarar (`profit-loss`), bank komissiyalari,
jurnal, kassa/bank harakatlari, xarajat statistikasi, debitorlik yoshi (`receivables/aging`),
kutilayotgan qirqimlar, agent naqdi, mijoz aylanmasi, dashboard.

---

## BUM ERP ichki topilmalar (Bito'siz aniqlangan)

Bular Bito bilan solishtirish emas — BUM ERP kodining o'zidan topilgan kamchiliklar.
Bito ochilgandan keyin GAP matritsasiga qo'shiladi, lekin ular allaqachon haqiqiy.

### F-1. Kassa farqi buxgalteriyaga UMUMAN tushmaydi — **CRITICAL**

**OBSERVED:** `closeShift` (`pos.service.ts:287-390`) faqat `pos_shifts` qatorini yangilaydi;
`reviewShiftDifference` (`:407-435`) faqat ko'rib chiqish maydonlarini yozadi. Ikkalasida ham
`recordCashTransaction` ham, `postJournalEntry` ham CHAQIRILMAYDI.

**Oqibat:** kassir 100 000 kam topshirsa — `cash_difference = −100 000` deb yoziladi,
ogohlantirish chiqadi, rahbar "tasdiqlaydi", lekin:
- kassa hisobidagi qoldiq HAMON eski (kamomad hisobga olinmagan) — ya'ni tizimdagi pul
  haqiqiy puldan ko'p;
- hisoblar rejasida kamomad xarajati yo'q (5xxx da bunday hisob umuman mavjud emas —
  `DEFAULT_ACCOUNTS` da "kamomad/ortiqcha" yo'q);
- foyda va zarar hisobotida kamomad ko'rinmaydi.

**To'g'ri yechim (taklif, hali yozilmagan):** yangi hisob `5900 Kassa kamomadi` va
`4300 Kassa ortiqchasi`; smena yopilganda farq `recordCashTransaction` (in/out) +
DR 5900 / CR kassa (yoki teskarisi) bo'lib yoziladi. Tasdiqlash — yozuvni yaratish sharti
emas, chunki pul allaqachon yo'q; tasdiq faqat mas'uliyat belgisi.

### F-2. Mijoz to'lovini bekor qilish / to'g'rilash YO'Q — **CRITICAL**

**OBSERVED:** `sales/routes.ts` da to'lov uchun faqat `GET /payments` va `POST /payments`
bor; `DELETE` yoki bekor qilish marshruti butun `apps/api/src` da yo'q
(`app.delete` ro'yxati: faqat `customer-prices` va `expenses`).

**Oqibat:** kassir noto'g'ri summa (5 000 000 o'rniga 500 000), noto'g'ri mijoz yoki noto'g'ri
usul kiritsa — tizimda tuzatishning TO'G'RI yo'li yo'q. Hozirgi aylanma yo'llar
(`set-balance` bilan kassa qoldig'ini to'g'rilash, `balance-adjust`) boshqa maqsad uchun va
to'lov hujjatini, buyurtmaning `paid_amount` ini hamda taqsimotni tuzatmaydi.

**To'g'ri yechim (taklif):** `POST /payments/:paymentId/reverse` — o'chirish EMAS, teskari
yozuv: kassa chiqimi, `voidJournalEntry` yoki teskari jurnal, `paid_amount` va `total_debt`
qaytariladi, taqsimot yechiladi, sabab majburiy, yopilgan davrga ruxsat yo'q, ruxsat —
`finance.manage` (yoki `sales.refund`).

### F-3. Mijoz va ta'minotchi bilan solishtirish akti (statement) YO'Q — **HIGH**

**OBSERVED:** butun `apps/api/src` va `src` bo'yicha `statement` / `sverka` /
"solishtirish akti" bo'yicha hech narsa topilmadi.

**Oqibat:** ulgurji savdoda har oy mijoz bilan "boshlang'ich qoldiq → xaridlar → to'lovlar →
qaytarishlar → yakuniy qoldiq" akti kerak. Hozir bor narsalar — debitorlik yoshi (ochiq
hujjatlar kesimi) va hamyon tarixi — bu akt emas.

Eslatma: Bito'da `recon_act_get_all` / `recon_act_get_by_id` vositalari bor (nomiga ko'ra
"reconciliation act"), ya'ni Bito'da bu bor ko'rinadi — lekin men uni HALI KO'RMADIM, shuning
uchun bu **UNKNOWN**, faqat tekshirish rejasiga kiritildi.

### F-4. Pul oqimi (cash flow) hisoboti YO'Q — **MEDIUM**

**OBSERVED:** `cashflow` bo'yicha butun `apps/api/src` va `src` da bitta joy bor — desktop
kassaning qurilma analitikasi (`pos-device/device-analytics.service.ts:391`). Kompaniya
darajasida pul oqimi hisoboti yo'q; `trial-balance` va `profit-loss` bor, lekin ular pul
oqimini almashtirmaydi (accrual model — daromad ≠ pul).

### F-5. Buxgalteriya balansi (balance sheet) YO'Q — **MEDIUM**

**OBSERVED:** `finance/routes.ts:426-440` — faqat `trial-balance` va `profit-loss`.
Aylanma balansdan balansgacha bir qadam qoldi (hisob turlari allaqachon
asset/liability/equity/income/expense bo'lib ajratilgan).

### F-6. Xarajat tasdiqlash chegarasi — **UNKNOWN/tekshirilsin**

Bito'da `finance_settings_get` tavsifida "expense-approval threshold" bor (OBSERVED — vosita
tavsifidan). BUM ERP'da xarajat holatlari `pending → approved → paid`
(`expenses.service.ts:34-38`), lekin SUMMA chegarasi bo'yicha avtomatik tasdiq talab qilinishi
bormi — bu auditda tekshirilmadi. Bito ochilgach solishtiriladi.

---

## 17–20. Implementatsiya, testlar, reconciliation

**Boshlanmagan** — 30-qoida bo'yicha Bito auditi tugamaguncha kod yozilmaydi.
F-1 va F-2 (CRITICAL) allaqachon Bito'siz ham asoslangan, shuning uchun sizning ruxsatingiz
bilan ular Bito'dan oldin ham yopilishi mumkin — qaror sizniki.

---

## Keyingi qadam

1. **Siz:** terminalda `/authorize` (Bito token'ini yangilash).
2. Men: FAZA 1 → 21 (real hujjatlarni o'qib, Bito moliya mexanizmini tiklash).
3. Men: GAP matritsasi (FAZA 23), KEEP/ADAPT/REJECT (FAZA 24), target arxitektura (FAZA 25–29).
4. Men: CRITICAL → HIGH tartibida joriy qilish, testlar, reconciliation. Production deploy yo'q.

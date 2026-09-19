# BUM ERP — DISTRIBUTSIYA 0→100 SIMULYATSIYASI: TOPILMALAR

**Sana:** 2026-09-19
**Muhit:** lokal (API `localhost:3000`, Postgres 18 Docker), **production'ga tegilmadi**
**Kompaniya:** "BUM Distribution Demo" — har yugurishda noldan yaratiladi (izolyatsiyalangan tenant)
**Usul:** `scripts/distribution/` — 114 ta tekshiruv; brauzer qismi Playwright (haqiqiy Chrome)

Har topilma: **FAIL → REPRODUCE → ROOT CAUSE → SEVERITY → EVIDENCE**.
Test vaqtida topilgan hech bir xato **yashirilmadi** va testni yashillashtirish uchun mahsulot kodi
o'zgartirilmadi. Faqat simulyatsiya skriptining o'z xatolari (noto'g'ri payload) tuzatildi —
ular alohida "Test xatolari" bo'limida sanab o'tilgan.

---

## XULOSA

| Daraja | Soni | Topilmalar |
|---|---|---|
| **BLOCKER** | **0** | — |
| **HIGH** | **0** | — |
| **MEDIUM** | **2 (ikkalasi TUZATILDI — 2026-09-19)** | F-01, F-03 |
| **LOW** | **4** | F-02, F-04, F-05, F-06 |
| INFO (to'g'ri xatti-harakat, hujjatlashtirildi) | 3 | F-07, F-08, F-09 |

Pul yo'qolishi, ma'lumot yo'qolishi, tenant buzilishi, buxgalteriya buzilishi, zaxira buzilishi
yoki autentifikatsiyani chetlab o'tish **topilmadi**.

---

## MEDIUM

### F-01 — Yetkazib bo'lmaganda sotuv "completed" bo'lib qoladi va mijozda qarz turadi — **TUZATILDI**

**FAIL:** Yetkazma `failed` bo'lgandan keyin ham sotuv holati `completed`, mijoz qarzi 45 000 so'm —
holbuki tovar mijozga topshirilmagan (u yetkazuvchida qoldi).

**REPRODUCE (aniq qadamlar):**
```
1. Buyurtma yaratish (deliveryRequired: true) → status=draft
2. POST /api/sales/orders/:id/confirm       → status=confirmed
3. Yetkazuvchi: accept                      → status=confirmed
4. Yetkazuvchi: start (tovar ombordan chiqdi) → status=COMPLETED   ← shu yerda o'zgaradi
5. Yetkazuvchi: fail (reason=customer_absent) → yetkazma=failed, sotuv=COMPLETED
6. Mijoz: totalDebt=30 000 (tovar yetkazilmagan)
```

**ROOT CAUSE:** Sotuv "yakunlandi" holati **tovarning ombordan chiqishiga** bog'langan
(`start` — jo'natish), yetkazish natijasiga emas. Yetkazish muvaffaqiyatsiz bo'lsa holat avtomatik
qaytarilmaydi — buni supervayzer alohida amal bilan bajaradi:
`POST /api/delivery/tasks/:id/return`.

**Yumshatuvchi holat (tekshirildi):** o'sha amal hamma narsani to'g'ri tiklaydi —
`sotuv=returned, mijoz qarzi 45 000 → 0, tovar omborga qaytadi`.

**SEVERITY: MEDIUM** — ma'lumot buzilmaydi, lekin supervayzer qadamini unutsa:
mijoz olmagan tovari uchun qarzdor ko'rinadi va daromad hisobotida "yakunlangan sotuv" sifatida turadi.

**EVIDENCE:** `scripts/distribution/probe.mjs` → "A. Yetkazib bo'lmaganda sotuv holati";
simulyatsiya 12-bosqich (`e2e/.artifacts/distribution/sim-log.md`).

**TUZATISH (2026-09-19):** tovar omborga qabul qilinmagan yetkazmalar endi ko'rinadi va yo'qolmaydi:

- `GET /api/delivery/tasks` har yetkazmada **`returnPending`** belgisini qaytaradi
  (holat `failed` yoki `partially_delivered`, `returnedAt` esa bo'sh).
- Yangi filtr: **`GET /api/delivery/tasks?returnPending=true`** — faqat qaytarish kutayotganlar.
- Yetkazmalar sahifasida **"Tovar qaytarilmagan"** filtri va qator yonida sariq nishon.
- Xato haqidagi bildirishnoma matni keyingi qadamni aytadi: *"Tovar yetkazuvchida — omborga qabul
  qiling, aks holda sotuv yakunlangan bo'lib qoladi va mijozda qarz turadi."*

Zaxira va pul mantig'i **ataylab o'zgartirilmadi**: tovar jismonan yetkazuvchida bo'lgani uchun uni
avtomatik omborga kiritish zaxirani buzgan bo'lar edi. Qabul qilingach (mavjud "qaytarish" amali)
sotuv `returned` bo'ladi va qarz yopiladi — bu testda tasdiqlangan.

**Testlar:** `apps/api/test/delivery-return-pending.test.ts` (3 test — yetkazilmagan, qisman
yetkazilgan va yetkazilgan holatlar).

---

### F-03 — Kassir ERP "To'lovlar" bo'limidan mijoz qarzini yopa olmaydi — **TUZATILDI**

**FAIL:** `POST /api/sales/payments` kassir uchun **403 FORBIDDEN** (`finance.manage` talab qilinadi).

**REPRODUCE:** Kassir hisobi bilan `POST /api/sales/payments {customerId, parts:[{method:"cash"}]}` → 403.

**ROOT CAUSE:** "Kassir" rolida `finance.manage` yo'q (ruxsatlar katalogi:
`products.view, sales.view, sales.create, pos.use, warehouse.view, currency_rates.view, scale.view`).

**Mavjud yo'l:** kassir qarzni **kassa (POS) orqali** yopa oladi —
`POST /api/sales/pos/customers/:customerId/payments` (`pos.use`, ochiq smena kerak).

**SEVERITY: MEDIUM** — distributsiya kompaniyasida kassirdan qarz yig'ish kutiladi.

**TUZATISH (2026-09-19):**

- Yangi ruxsat **`sales.collect_payment`** ("Mijozdan to'lov qabul qilish", guruh "Savdo").
- **Kassir** va **Savdo menejeri** rollariga berildi; moliya xodimlarida (buxgalter, moliya menejeri,
  direktor, ega) `finance.manage` orqali avvalgidek ochiq.
- `POST /api/sales/payments` endi **`sales.collect_payment` YOKI `finance.manage`** ni qabul qiladi
  (`requireAnyPermission`).
- Migratsiya **0064** mavjud kompaniyalardagi "Kassir" va "Savdo menejeri" tizim rollariga shu
  ruxsatni qo'shadi (faqat qo'shadi — boshqa ruxsatlar o'zgarmaydi).
- Kassirda moliyani boshqarish **ochilmadi**: yangi kassa ochish hamon 403.

**Testlar:** `apps/api/test/cashier-collect-payment.test.ts` (2 test — kassir bitta usul va aralash
to'lov bilan qarzni yopadi, takroriy so'rov yangi yozuv yaratmaydi, kassa ocha olmaydi; omborchi 403).

**EVIDENCE:** simulyatsiya 9-bosqich: "TOPILMA: kassir ERP 'To'lovlar' orqali qarz yopa olmaydi = 403";
buxgalter bilan o'sha to'lov 200 bo'ldi.

---

## LOW

### F-02 — Tizimda "Marketolog" roli yo'q

**FAIL:** Topshiriqdagi tuzilmada "Marketer" bor; xodim yaratishda `Marketolog` roli topilmadi.

**ROOT CAUSE:** 17 ta tayyor rol bor (Superadmin, Business Owner, Direktor, Buxgalter, Moliya menejeri,
Savdo menejeri, Xarid menejeri, Ombor menejeri, Omborchi, Kassir, HR menejeri, Ishlab chiqarish menejeri,
Sotuv agenti, Supervayzer, Dostavka agenti, Auditor, Ko'ruvchi) — marketing roli yo'q.
Aksiya boshqarish ruxsati (`promotions.manage`) "Savdo menejeri" va "Supervayzer" da bor.

**SEVERITY: LOW** — ish to'xtamaydi (Savdo menejeri roli bilan bajarildi va aksiya yaratildi).

**EVIDENCE:** simulyatsiya 2-bosqich; aksiya "Savdo menejeri" roli bilan yaratildi va agentga ko'rindi.

---

### F-04 — Zaxiradan ortiq buyurtma tasdiqlanadi (to'siq faqat jo'natishda)

**FAIL:** Zaxira 250 dona bo'lsa ham 1 250 donalik buyurtma yaratiladi (201) **va tasdiqlanadi** (200).

**ROOT CAUSE:** Zaxira yetarliligi buyurtma tasdiqlashda emas, **tovar chiqimida** tekshiriladi:
jo'natish/yetkazuvchining "yo'lga chiqishi" → `400 "Yetarli zaxira mavjud emas"`.
Zaxira hech qachon manfiyga tushmaydi (parallel sinovda ham: 250 → 250).

**SEVERITY: LOW** — pul yoki zaxira buzilmaydi; lekin agent/menejer mijozga bo'lmagan tovarni
va'da qilib qo'yishi mumkin, muammo faqat jo'natishda ma'lum bo'ladi.

**EVIDENCE:** `probe.mjs` → "D. Zaxiradan ortiq buyurtma"; simulyatsiya 17-bosqich.

---

### F-05 — Mijozning "qarzi" va "balansi" alohida ko'rsatkichlar, netto ko'rsatilmaydi

**FAIL (kutilmagan holat):** To'langan chekdan tovar qaytarilgach mijozda bir vaqtda
`totalDebt=45 000` (boshqa buyurtma bo'yicha) va `balance=28 000` (qaytarilgan pul krediti) turadi.

**ROOT CAUSE:** Qaytarilgan pul `balance` (oldindan to'lov/kredit) sifatida yoziladi, `totalDebt`
esa yopilmagan buyurtmalar bo'yicha hisoblanadi. Ikkalasi ham **alohida to'g'ri**, lekin netto
(45 000 − 28 000 = 17 000) bitta raqamda ko'rsatilmaydi.

**Tekshirildi (to'g'ri ishlaydi):** to'lanmagan chekdan qaytarish qarzni kamaytiradi (50 000 → 30 000);
to'langan chekdan balansga qaytarish kredit beradi (balans 0 → 20 000); naqd qaytarish kassadan
chiqadi (5 110 000 → 5 086 000).

**SEVERITY: LOW** — hisobot/UI tushunarliligi masalasi, pul to'g'ri.

**EVIDENCE:** `probe2.mjs` → F1, F2; `probe.mjs` → B.

---

### F-06 — "Ombor menejeri" roli sotuv narxini o'zgartira oladi

**FAIL (kutilmagan):** Ombor menejeri `PATCH /api/catalog/products/:id {salesPrice}` → **200**.

**ROOT CAUSE:** Rol ta'rifida `products.edit` va `products.manage` bor — ya'ni **ataylab** berilgan.

**SEVERITY: LOW** — biznes qaroriga bog'liq; agar narx faqat savdo bo'limida bo'lishi kerak bo'lsa,
rol ruxsatlari qayta ko'rib chiqilishi kerak.

---

## INFO — to'g'ri xatti-harakat (hujjatlashtirildi)

- **F-07:** Bo'sh karta terminali hisobidan ta'minotchiga to'lov **rad etiladi**
  (`400 "Kassada yetarli mablag' yo'q"`) — manfiy qoldiq hech qayerda yaratilmaydi. To'g'ri.
- **F-08:** Yetkazilmagan buyurtmaga to'lov **oldindan to'lov** sifatida yoziladi
  (balans −1 000 000), yetkazish yakunlangach **0 ga qaytadi** — ikki marta hisoblanmaydi. To'g'ri.
- **F-09:** Agent buyurtmasi yetkazma vazifasini faqat `deliveryRequiredByDefault: true` yoki
  `deliveryRequired` bilan yaratadi. Distributsiya kompaniyasi uchun bu sozlama **yoqilishi kerak** —
  standart holatda o'chiq.

---

## Simulyatsiya skriptining o'z xatolari (mahsulot xatosi emas)

Bular topilma emas — skript noto'g'ri yozilgani uchun chiqqan va tuzatilgan:

| Xato | To'g'risi |
|---|---|
| Xarid qatorida `quantity` | `orderedQty` + `unitId` majburiy |
| Qabulda mahsulot ro'yxati | `orderItemId` + `receivedQty` |
| `terminalId` = kassa hisobi ID'si | terminal alohida obyekt (`/api/finance/terminals`) |
| `delivering` amaliga joylashuv yuborilgan | faqat `clientRequestId` qabul qilinadi |
| Qisman yetkazishda `itemId` | `taskItemId` |
| `/api/inventory/stock` `warehouseId` siz | `warehouseId` majburiy |
| Aksiya turi `percent` | `percent_discount` |
| Takroriy to'lov `reference` bo'yicha qidiruv | server prefiks qo'shadi: `sales_payment:<ref>:0` |
| Tashrifda faqat vitrina rasmi | siyosat bo'yicha polka rasmi ham majburiy |
| Kassa bo'sh holda ta'minotchiga naqd to'lov | avval kassaga kapital kiritish kerak |

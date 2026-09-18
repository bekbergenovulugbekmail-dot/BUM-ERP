# BUM ERP — FINAL SALE READINESS AUDIT v2

**Sana:** 2026-09-18, 20:30–22:15 (UTC+5)
**Boshlang'ich holat:** `a1d2322` (FINAL-SALE-READINESS-AUDIT.md — 7 blocker)
**Muhit:** Windows 10, 8 GB RAM · Node 22.23.2 · Docker (postgres:18.6, MinIO) · Chrome (Playwright)
**Cheklovlar:** production ma'lumoti o'zgartirilmadi, production tranzaksiyasi yaratilmadi,
deploy qilinmadi, sirlar commit qilinmadi.

Belgilar: **PASS** — o'lchandi va o'tdi · **PARTIAL** — bir qismi o'lchandi ·
**FAIL** — o'lchandi va yiqildi · **NOT VERIFIED** — o'lchanmagan (dalil yo'q).

---

## ACCEPTANCE MATRIX

| # | Blocker | Natija | Qisqacha |
|---|---|---|---|
| 1 | Backup / Restore | **PASS** | production dump → toza baza → 250 o'lchov 100% mos → ilova ishlaydi |
| 2 | Production file storage | **PARTIAL** | kod va S3 oqimi 14/14 PASS; production S3 kaliti yo'q → **NOT VERIFIED**. Blockerning asosiy da'vosi (rasmlar 503) **noto'g'ri edi** |
| 3 | SMS | **NOT VERIFIED** | mantiq 11/11 PASS; Eskiz hisobi yo'q — haqiqiy SMS yuborilmadi |
| 4 | Real Android | **NOT VERIFIED** | `adb devices` bo'sh; emulyator 8 GB da boot bo'lmadi |
| 5 | Sales agent real UI | **PASS** | yangi `e2e/sales-agent.spec.ts` — 2/2 PASS |
| 6 | Delivery agent real UI | **PASS** | yangi `e2e/delivery-agent.spec.ts` — 2/2 PASS |
| 7 | Real Windows desktop POS | **PARTIAL** | build + o'rnatish + ishga tushish PASS; imzo va jihoz NOT VERIFIED |

**Yopildi:** 1, 5, 6. **Sezilarli kamaydi:** 2. **Ochiq qoldi:** 3, 4, 7.

---

## BLOCKER 1 — BACKUP / RESTORE → **PASS**

**Environment:** production Postgres 18.6 (Railway, `Postgres--bSX`) → lokal Docker `bum-pg` (postgres:18.6)
**Date/time:** 2026-09-18 20:36–20:55

### Audit
Mavjud mexanizm: Railway boshqaradigan Postgres volume. Alohida ilova darajasidagi backup skripti yo'q —
shuning uchun `pg_dump` bilan to'liq mantiqiy nusxa olish yo'li sinovdan o'tkazildi.

### Test command
```
pg_dump -Fc -Z9 --exclude-table-data=public.desktop_release_chunks
pg_restore --no-owner --no-privileges --exit-on-error
```
(`desktop_release_chunks` — 27 qator, 107 MB kassa o'rnatuvchilari; biznes ma'lumoti emas,
qayta yuklab olinadigan artefakt. Binar sodiqligi alohida tekshirildi — pastga qarang.)

### Evidence
| Tekshiruv | Natija |
|---|---|
| Dump hajmi / sha256 | 1 729 945 bayt · `f4eecd53756c49309eb108138949563257a3f4076357e58d83ccb4ba96920e4a` |
| Lokal nusxaning sha256 | **bir xil** (bit-ma-bit ko'chdi) |
| Toza baza | `createdb bumerp_restore` → 0 jadval |
| Restore | `exit=0`, **6 sekund**, 0 xato → 118 jadval |
| Sxema (prod vs restore) | TABLES 118, COLUMNS 1678, INDEXES 466, PK 118, **FK 379**, UNIQUE 3, CHECK 1174 — **hammasi bir xil** |
| Turlar va mantiq | ENUM turlari 69, ENUM qiymatlari 289, TRIGGERS 7, FUNCTIONS 2, VIEWS 0 — **bir xil** |
| Sequences | 0 (barcha kalitlar UUID) — **bir xil** |
| Extensions | `plpgsql:1.0` — **bir xil** |
| Migratsiyalar | 63 = 63 |
| **Qator sonlari** | 118 jadvalning hammasi **bir xil** |
| **MD5 checksum** | 117 jadval uchun butun qator matnining MD5 yig'indisi — **hammasi bir xil** |
| Yagona farq | `desktop_release_chunks` 27 → 0 (ataylab chiqarilgan) |

**Asosiy entity'lar (prod = restore):** companies 2 · users 8 · employees 4 · products 2 · customers 3 ·
sales_orders 13 · customer_payments 14 · journal_entries 36 · journal_lines 96 · delivery_tasks 2 ·
stock_levels 1 · suppliers 1 · production_orders 0.

**Binar (bytea) sodiqligi:** eng kichik chunk (2 658 365 bayt, md5 `680fc8313ed44b9f2de768457952f8ca`)
CSV orqali ko'chirilib restore bazasiga yuklandi → **md5 va hajm bir xil**.

### "Application works" — restore ustida
API `127.0.0.1:3099`, `DATABASE_URL=bumerp_restore`, **yangi SESSION_SECRET**
(production Telegram tokenlari ochilmaydi → hech qanday xabar yuborilmadi), `startMaintenance` o'chirilgan.

| Amal | Natija |
|---|---|
| `GET /health` | 200 `{"status":"ok"}` |
| Noto'g'ri parol bilan kirish | 401 |
| Platforma admini kirishi | 200 |
| `GET /api/platform/companies` | 200 — **"Distributsiya" (active, 2 a'zo), "Bonnu Market" (trial, 5 a'zo)** |
| Kompaniya egasi kirishi (nusxada parol almashtirildi) | 200 |
| `GET /api/sales/orders` | 200 — real yozuv `K03-000001` |
| `GET /api/finance/cash-accounts` | 200 — `Asosiy kassa` = **−77 520.00** (production bilan bir xil) |
| `GET /api/hr/employees`, `GET /api/catalog/products` | 200 (`Bodom`) |
| **Yozish:** `POST /api/catalog/categories` | **201** (faqat nusxada) |

**Result: PASS** — backup → toza baza → restore → ilova ishlaydi (o'qish ham, yozish ham).
Production bazasiga faqat `pg_dump` va `SELECT` qilindi; hech narsa o'zgartirilmadi.
Nusxa audit tugagach o'chirildi (mijoz ma'lumotining ortiqcha nusxasi qolmasin).

### Qolgan tavsiya (blocker emas)
Rejali (cron) backup va uni saqlash joyi hujjatlashtirilmagan — yuqoridagi buyruq ishlaydi,
lekin **avtomatik jadval** va **saqlash muddati** siyosati hali yo'q.

---

## BLOCKER 2 — PRODUCTION FILE STORAGE → **PARTIAL**

**Date/time:** 2026-09-18 21:00–21:20

### Audit — v1 auditdagi da'vo noto'g'ri edi
`apps/api/src/shared/storage.ts` — sof S3 (AWS Signature V4, `node:crypto`), **lokal fayl tizimiga
bog'lanish yo'q**, brauzer to'g'ridan-to'g'ri imzolangan URL bilan yuklaydi.

**Muhim tuzatish:** v1 auditda "mahsulot rasmi va tashrif rasmlari 503" deb yozilgan edi — bu **noto'g'ri**.
Kodda **bazaga saqlash zaxira yo'li** bor:

| Fayl turi | S3 yo'q bo'lganda |
|---|---|
| Mahsulot rasmi | **bazada** (`product_images`) — ishlaydi |
| Tashrif rasmi (agent) | **bazada** (`agent_visit_photos.content`) — ishlaydi |
| Yetkazma dalili | **bazada** (`delivery_proofs.content`) — ishlaydi |
| Xarajat cheki | **503** — S3 kerak |
| Xodim surati | **503** — S3 kerak |

Productionda `agent_visit_photos` = 848 kB, `delivery_proofs` = 376 kB — ya'ni bu rasmlar
**hozir ham ishlayapti**. Mijoz "birinchi kuni" rasm yuklay oladi.

### Test command
```
node storage-test.js   # 3098 = S3 (MinIO) yoqilgan, 3099 = production kabi (STORAGE_* yo'q)
```

### Evidence — 14/14 PASS
| # | Tekshiruv | Natija |
|---|---|---|
| 1a | Imzolangan PUT URL (`POST /api/files/uploads`) | 201, kalit `companies/<companyId>/product-image/<uuid>.png` |
| 1b | S3 ga yuklash (MinIO) | 200 |
| 2 | Obyekt mavjudligi tekshirildi (`attach`) | 200 |
| 3 | Ko'rish URL imzolangan, 5 daqiqa | 200 |
| 4 | Rasm ko'rinishi (baza yo'li) | 200, 70 bayt, **bir xil** |
| 4b | Rasm ko'rinishi (S3 yo'li) | 200, 70 bayt, **bir xil** |
| 5a | O'chirish (`detach`) | 204 |
| 5b | Obyekt saqlashdan o'chdi | 404 |
| 6 | **Tenant izolyatsiyasi** — begona kompaniya kaliti | 400 (rad) |
| 6b | Begona mahsulotga biriktirish | 404 |
| 7 | Sessiyasiz kirish | 401 |
| 7b | Imzosiz obyektga kirish | 403 (ochiq emas) |
| 8 | Mahsulot rasmi S3 siz (baza) | 200 |
| — | Xarajat cheki S3 siz | 503 (kutilgan) |

### PRODUCT BUG emas — muhit muammosi (tekshirildi)
Dastlab `attach` 500 qaytardi: `storage.head()` 10 s da timeout. Ajratib tekshirildi:
`curl` xuddi shu imzolangan HEAD URL'ni **11 ms da 200** qaytardi; `localhost` o'rniga `127.0.0.1`
qo'yilganda 4/4 urinish tez o'tdi. Sabab — bu mashinada `localhost` avval `::1` (IPv6) ga ketadi,
MinIO esa faqat IPv4 da tinglaydi. **Mahsulot kodi o'zgartirilmadi**; lokal `.env` tuzatildi.

### Production konfiguratsiyasi (kalitsiz — tayyor)
Railway → `bum-api` xizmatiga qo'shish kerak (qiymatlar bu yerda ko'rsatilmaydi):
`STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`,
`STORAGE_REGION`, ixtiyoriy `STORAGE_PUBLIC_ENDPOINT`. Kod o'zgarishi kerak emas.

**Result: PARTIAL** — kod va oqim PASS; **production S3 = NOT VERIFIED** (provider kaliti yo'q).
Blockerning asosiy xavfi (mijoz rasm yuklay olmaydi) — **yo'q**.

---

## BLOCKER 3 — SMS → **NOT VERIFIED**

**Date/time:** 2026-09-18 21:06

### Audit
`apps/api/src/shared/sms.ts` — Eskiz.uz; kalit bo'lmasa `smsProvider.client = null` → **503**.
Production o'zgaruvchilari (faqat nomlar o'qildi): **`ESKIZ_*` yo'q** → `features.sms = false`.

### Test command
```
TEST_LOG_LEVEL=error vitest run --maxWorkers=2 test/password-reset.test.ts test/delivery-flow.test.ts
```

### Evidence — 11/11 PASS (2 fayl, 52 s)
| Bosqich | Natija |
|---|---|
| request → kod yuborish | PASS (kod SMS matnida, bazada faqat HMAC hash) |
| provider | PASS *(HTTP shartnomasi: kirish, yuborish, 401 da bir marta qayta kirish)* |
| delivery (haqiqiy telefon) | **NOT VERIFIED** |
| OTP validation | PASS (noto'g'ri kod urinishni sanaydi: `attemptsLeft` 4 → 3) |
| expiry | PASS (10 daqiqa; muddati o'tgan kod ishlamaydi) |
| wrong OTP | PASS (5 xatodan keyin kod kuyadi) |
| retry / rate limit | PASS (raqam va IP bo'yicha cheklov) |
| Qo'shimcha | raqam oshkor bo'lmaydi; parol almashgach barcha sessiyalar bekor; kod bir martalik |
| Yetkazma OTP | PASS (hash, supervayzer yangi kod beradi, SMS o'chiq → `reason: sms_unavailable`) |

**Result: NOT VERIFIED** — soxta provider PASS deb hisoblanmadi.
**Kerak:** Eskiz.uz hisobi (`ESKIZ_EMAIL`, `ESKIZ_PASSWORD`, `ESKIZ_SENDER`) va bitta haqiqiy
raqamga uchdan-uchga sinov (parol tiklash + yetkazma OTP).

---

## BLOCKER 4 — REAL ANDROID → **NOT VERIFIED**

**Date/time:** 2026-09-18 21:25

### Evidence
```
adb devices -l  →  "List of devices attached"   (BO'SH — fizik qurilma yo'q)
```
Emulyator (`AVD pos_e2e`, Vulkan/SwiftShader) ishga tushirildi — boot bo'lmadi, bo'sh xotira
**0.9 GB** ga tushdi, to'xtatildi. Brauzer emulyatsiyasi haqiqiy qurilma deb hisoblanmadi.

**Result: NOT VERIFIED.**

**Kerak (16 banddan hech biri tekshirilmagan):** USB bilan ulangan Android telefon (USB debugging yoqilgan)
yoki ≥16 GB xotirali mashinada emulyator. Sinov ro'yxati: APK o'rnatish · login · POS · sessiya · mahsulot ·
aralash to'lov · kamera · GPS · **ish sessiyasida fonda GPS** · sessiya tugagach kuzatuv to'xtashi ·
bildirishnoma · klaviatura (backspace — 1.0.1 dagi tuzatish) · ekran burilishi · safe area ·
internet uzilishi · qayta ulanish.

*Tayyor:* imzolangan `BUM-ERP-1.0.1.apk` (3.9 MB) qurilgan va imzosi tekshirilgan — faqat telefon kerak.

---

## BLOCKER 5 — SALES AGENT REAL UI → **PASS**

**Environment:** Chrome (Playwright), `E2E_LIGHT=1 E2E_SKIP_SEED=1`
**Date/time:** 2026-09-18 21:30–21:50 · **Yangi fayl:** `e2e/sales-agent.spec.ts`

### Test command
```
node node_modules/@playwright/test/cli.js test e2e/sales-agent.spec.ts
```

### Evidence — 2/2 PASS (1.2 m)

**Test 1 — menyu, ERP yopiq, ish sessiyasi, tashrif, buyurtma**

| Tekshiruv | Natija |
|---|---|
| Menyu **aynan** 5 bo'lim | Bosh sahifa · Sotuv · Mijozlar · Aksiyalar · Hisobotlar |
| ERP bo'limi (`/pos`) agentga | ochilmaydi |
| Ish sessiyasi (`ISHNI BOSHLASH`) | ochildi, lokatsiya kuzatuvi yoqildi |
| Marshrut | agent faqat **o'z marshrutidagi** do'konni ko'radi |
| Mijoz va balans | do'kon kartochkasi, qarz va qolgan kredit ko'rinadi |
| Tashrif | `Tashrifni boshlash` → "Tashrif davom etmoqda" |
| **Vitrina rasmi majburiy** | rasm olinmaguncha `BUYURTMA` tugmasi **o'chiq** |
| Rasm (kamera input'i) | yuklandi → "Vitrina rasmi olindi — **taymer boshlandi**" |
| Polka rasmi | vitrinadan keyin ochiladi (tartib majburiy) |
| Mahsulot / miqdor / narx | katalogdan `Nestle suv 0.5L`, 3 dona = **12 000 so'm** |
| To'lov turi | Naqd / Karta / Nasiya — tanlandi |
| Yetkazib berish kuni | siyosat `choose` — agent tanladi |
| Buyurtma | yuborildi |

**Test 2 — geofence (~4 km narida)**

| Tekshiruv | Natija |
|---|---|
| UI | "siz do'kondan … uzoqdasiz (ruxsat 300 m)" |
| **Server** (UI chetlab o'tilib `POST /api/sales-agent/visits/start`) | **4xx, `reason: geofence`** |

**Bazadagi dalil:** `agent_visits` → `status=completed`, `result=ordered`, 1 ta rasm.

**GPS:** brauzer ruxsati/mock (`context.setGeolocation`) — **REAL GPS = NOT VERIFIED** (Blocker 4).

---

## BLOCKER 6 — DELIVERY AGENT REAL UI → **PASS**

**Date/time:** 2026-09-18 21:55–22:05 · **Yangi fayl:** `e2e/delivery-agent.spec.ts`

### Evidence — 2/2 PASS (1.3 m)

**Test 1 — to'liq zanjir**

| Bosqich | UI holati |
|---|---|
| Menyu 5 bo'lim | Bosh sahifa · Yetkazmalar · Mijozlar · Qarz/To'lov · Hisobotlar |
| Kartochka | mijoz `Baraka do'koni`, buyurtma `SO-2026-0096`, `Nestle suv 0.5L 2 d — 8 000 so'm` |
| Navigatsiya havolasi | "Xaritada" (OSM/Google/Yandex deep-link) |
| Yetib kelish geofence'i | "Mijozgacha taxminan 0 m (**ruxsat 500 m**) · ±10 m" |
| ASSIGNED → | "Biriktirilgan" |
| QABUL QILISH → | "Qabul qilingan" (ACCEPTED) |
| YO'LGA CHIQISH → | "Yo'lda" (OUT_FOR_DELIVERY) |
| MIJOZGA YETDIM → | "Mijozda" (ARRIVED) |
| TOPSHIRISHNI BOSHLASH → | "Topshirilmoqda" (DELIVERING) |
| Naqd yig'ish | qoldiq to'liq kiritildi → qabul qilindi |
| YETKAZILDI — TASDIQLASH → | **"Yetkazildi"** (DELIVERED) |
| **Asl buyurtma** | `totalAmount` **o'zgarmadi**, status `confirmed/completed` oralig'ida |

**Test 2 — yetkazib bo'lmadi (FAILED)**

| Tekshiruv | Natija |
|---|---|
| Sabab tanlanmaguncha "Tasdiqlash" | **o'chiq** |
| "Mijoz joyida yo'q" → | **"Yetkazilmadi"** |
| Asl buyurtma summasi | o'zgarmadi |

**Bazadagi dalil:** `delivery_tasks` → `DL-2026-0005 delivered`, `DL-2026-0006 failed (customer_absent)`;
`cash_accounts` → **"Yetkazuvchi DA-001 — yo'ldagi naqd" = 16 000.00** — ya'ni yig'ilgan pul
kassaga emas, **yetkazuvchi hisobiga** tushdi (topshirilgunicha).

**Qamrovga kirmagan:** `PARTIALLY_DELIVERED` va `RETURNED` UI orqali sinalmadi
(API testlarida bor — `delivery-flow.test.ts`). OTP UI'da o'chirilgan holatda sinaldi (SMS yo'q).

---

## BLOCKER 7 — REAL WINDOWS DESKTOP POS → **PARTIAL**

**Environment:** Windows 10 Enterprise 19045 (haqiqiy kompyuter)
**Date/time:** 2026-09-18 21:57–22:10

| Bosqich | Natija | Dalil |
|---|---|---|
| **Installer build** | **PASS** | `pnpm dist:win` → `BUM-POS-KASSA-Setup-0.4.7.exe`, exit 0, 111 921 958 bayt, sha256 `0B70EED5FCD91613C76A748CEE86E944F418D6C87E927D57414314B2669AA878` (joriy manbadan qayta qurildi) |
| **SIGNED** | **NOT VERIFIED** | `Get-AuthenticodeSignature` → **NotSigned** (sertifikat yo'q; Windows SmartScreen ogohlantiradi) |
| **INSTALLATION** | **PASS** | `Setup.exe /S` → exit 0; `HKCU\...\Uninstall` → "BUM POS KASSA 0.4.7"; Start Menu va Ish stoli yorliqlari; `%LOCALAPPDATA%\Programs\BUM POS KASSA\` |
| **LAUNCH** | **PASS** | 4 ta jarayon, asosiy oyna sarlavhasi **"BUM POS KASSA"**; lokal SQLite ochildi (`bum-kassa.sqlite-wal` 21:59 da yozildi) |
| login · sessiya · POS · sotuv · naqd · karta · aralash to'lov · chek tarixi · sessiyani yopish · qayta ishga tushirish | **NOT VERIFIED (audit sessiyasida)** | GUI'ni tashqaridan boshqarib bo'lmadi — **`electronFuses.runAsNode: false`** (ataylab qo'yilgan himoya) Playwright'ning Electron drayverini bloklaydi: `Process failed to launch!` |
| barcode skaner · chek printeri | **NOT VERIFIED** | jihoz yo'q |

**Qo'shimcha kuzatuv (audit yaratmagan, mavjud holat):** shu kompyuterdagi kassa bazasi
(`%APPDATA%\BUM POS KASSA\bum-kassa.sqlite`) **ulangan va ishlatilgan**: `meta` da `deviceToken`,
`device`, `company`, `shift`, `apiUrl`; `sales` jadvalida real chek **`K03-000001` — 20 160.00**
(2026-09-17). O'sha raqamdagi chek production bazasida ham bor. Ya'ni desktop kassa haqiqiy
kompyuterda haqiqiy serverga ulanib sotuv qilgan — lekin buni **egasi** qilgan, audit emas.

**Result: PARTIAL.**
**Kerak:** (a) kod imzolash sertifikati (`CSC_LINK`, `CSC_KEY_PASSWORD`) → SIGNED;
(b) kassir oldida qo'lda 20 daqiqalik sinov: login → smena → skaner bilan sotuv → naqd/karta/aralash →
chek chop etish → chek tarixi → smenani yopish → ilovani qayta ishga tushirish → qayta login.

---

## O'ZGARTIRILGAN VA QO'SHILGAN FAYLLAR

| Fayl | Nima |
|---|---|
| `e2e/sales-agent.spec.ts` | **yangi** — sotuv agenti brauzer testi (2 test) |
| `e2e/delivery-agent.spec.ts` | **yangi** — yetkazuvchi brauzer testi (2 test) |
| `FINAL-SALE-READINESS-AUDIT-v2.md` | **yangi** — shu hisobot |
| `.env` (lokal, git'da yo'q) | `STORAGE_ENDPOINT`: `localhost` → `127.0.0.1` (IPv6 muammosi) |

**Biznes mantiq, sxema va migratsiyalar o'zgartirilmadi.** Production'ga tegilmadi, deploy qilinmadi.

---

## FINAL VERDICT

# NOT SALE READY

7 blockerdan **3 tasi yopildi** (1, 5, 6), **1 tasi sezilarli kamaydi** (2),
**3 tasi ochiq** (3, 4, 7).

Ochiq qolganlar va ularning sababi:

| Blocker | Sabab | Kim yopadi |
|---|---|---|
| **3 — SMS** | Eskiz.uz hisobi yo'q | egasi: hisob ochib `ESKIZ_*` ni Railway'ga qo'yadi |
| **4 — Real Android** | fizik telefon yo'q | egasi: telefonni USB bilan ulaydi (16 bandlik ro'yxat tayyor) |
| **7 — Desktop POS** | kod imzolash sertifikati yo'q; kassir oldida qo'lda sinov qilinmadi | egasi: sertifikat + 20 daqiqalik sinov |

Halol ko'rsatiladigan holat:

- **REAL ANDROID → NOT VERIFIED**
- **REAL TERMINAL (UZCARD/HUMO ekvayringi) → NOT VERIFIED** (protokol umuman ulanmagan;
  kassir summani chekka qarab qo'lda kiritadi)
- **REAL DESKTOP (to'liq kassa oqimi va imzo) → NOT VERIFIED**
- **REAL SMS → NOT VERIFIED**
- **PRODUCTION S3 → NOT VERIFIED** (lekin rasmlar bazada ishlaydi — mijozga to'siq emas)

Hech qanday soxta PASS yo'q: yuqoridagi har bir PASS aynan bajarilgan buyruq va o'lchangan natijaga
tayanadi; o'lchanmagan narsa NOT VERIFIED deb belgilangan.

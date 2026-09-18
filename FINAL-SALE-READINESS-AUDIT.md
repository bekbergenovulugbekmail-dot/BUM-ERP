# BUM ERP — FINAL SALE READINESS AUDIT

**Sana:** 2026-09-18
**Branch:** `feat/postgres-migration` (`1f6e46b`)
**Production:** `bum-api` + `bum-web` (Railway), `app.bum-erp.uz`
**Audit turi:** faqat tekshiruv — kod, sxema, production o'zgartirilmadi, deploy qilinmadi.

Belgilar: **PASS** — o'lchandi va o'tdi · **PARTIAL** — qisman o'lchandi · **FAIL** — o'lchandi va yiqildi ·
**NOT VERIFIED** — o'lchanmagan (dalil yo'q). Test qilinmagan narsa PASS deb yozilmagan.

---

## Executive Summary

**Yakuniy hukm: NOT SALE READY.**

Server tomonidagi biznes mantiq, ko'p-kompaniyalilik, ruxsatlar, pul va zaxira hisobi kuchli avtomat
tekshiruv bilan qoplangan va bugun to'liq yashil: **API 121 fayl / 642 test**, **brauzer 39 test**,
**web 20 / 85**, **desktop 9 / 57**, tsc (API+web+desktop) va lint toza, production build yig'iladi,
migratsiyalar lokal va productionda bir xil (63 = 63).

Sotishga to'sqinlik qiladigan narsa kodda emas — **haqiqiy dunyo qismlari hali tekshirilmagan**:
zaxira nusxa va tiklash yo'li sinalmagan, ilova birorta ham HAQIQIY Android telefonda ishlatilmagan,
savdo agenti va yetkazuvchi ish joylari brauzer testlarida umuman ochilmagan, desktop kassa
o'rnatuvchisi haqiqiy kassa kompyuteriga o'rnatilmagan, productionda fayl saqlash (rasm) va SMS
sozlanmagan. Bularsiz mijozga pul evaziga sotish — ma'lumot yo'qotish va "ishlamadi" xavfini
mijozning ustiga yuklash bo'ladi.

Ro'yxat qisqa va aniq: quyidagi **7 ta blocker** yopilsa, mahsulot sotuvga tayyor bo'ladi.

---

## 1. System Health

| Tekshiruv | Natija | Dalil |
|---|---|---|
| TypeScript (API) | **PASS** | `tsc --noEmit` — 0 xato |
| TypeScript (web) | **PASS** | `tsc -p tsconfig.app.json --noEmit` — 0 xato |
| TypeScript (desktop) | **PASS** | `tsc --noEmit` — 0 xato |
| ESLint (butun repozitoriy) | **PASS** | `eslint . --max-warnings=0` — 0 xato, 0 ogohlantirish |
| Production build (web) | **PASS** | `vite build` — muvaffaqiyatli |
| API testlari | **PASS** | 121 fayl / **642 test** o'tdi (23 daqiqa) |
| Web unit testlari | **PASS** | 20 fayl / **85 test** |
| Desktop kassa testlari | **PASS** | 9 fayl / **57 test** |
| Brauzer E2E (haqiqiy Chrome) | **PASS** | 12 fayl / **39 test** |
| Migratsiyalar (lokal) | **PASS** | 63 fayl, jurnal 63 yozuv, oxirgisi `0062_release_platform` |
| Migratsiya mosligi (lokal ↔ production) | **PASS** | productionda ham 63 qo'llangan; `device_check`, `platform`, `sales_rep_id`, telegram jadvallari bor |
| Xato ishlash (error handling) | **PASS** | markazlashgan `registerErrorHandler`, `AppError` kodlari (`FORBIDDEN`, `MODULE_DISABLED`, `SUBSCRIPTION_EXPIRED` …) |
| Logging | **PASS** | `pino`; productionda xato loglari Railway'da |
| Audit logging | **PASS** | productionda 351 yozuv, oxirgisi 2026-09-18; kirish, xodim, modul, reliz, to'lov amallari yoziladi |
| Environment o'zgaruvchilari | **PARTIAL** | majburiylari bor; `STORAGE_*`, `ESKIZ_*`, `ANTHROPIC_API_KEY` yo'q (pastga qarang) |
| Production config | **PARTIAL** | `WEB_ORIGIN=https://bum-erp.uz` — bu domen yo'naltirilmagan, foydalanuvchilar `app.bum-erp.uz` da ishlaydi |

**Izoh (WEB_ORIGIN):** hozir zarar keltirmayapti, chunki SPA va API bitta domen ostida (nginx `/api` ni
uzatadi) — CORS ishga tushmaydi. Lekin qiymat noto'g'ri va kelajakda (alohida domen, webhook)
chalkashlik beradi. **IMPORTANT**, blocker emas.

---

## 2. Security

| Tekshiruv | Natija | Dalil |
|---|---|---|
| Parol xeshlari | **PASS** | argon2id (`@node-rs/argon2`); productionda noma'lum formatdagi xesh **0 ta** |
| PIN saqlanishi | **PASS** | faqat xesh; productionda qisqa (xeshlanmagan) PIN **0 ta**; `pin.test.ts` xom saqlanmasligini tekshiradi |
| Kodda ochiq sir / API kalit | **PASS** | `src/`, `apps/*/src`, `apps/mobile` bo'yicha qidiruv — topilmadi; `.env`, `.jks`, `keystore.properties` git'da yo'q |
| SQL injection | **PASS** | Drizzle parametrlangan so'rovlar; `sql.raw` faqat konstantalarda (foydalanuvchi kiritmasi yo'q); `security-verification` SQLi yuklamalarini sinaydi |
| XSS / CSRF | **PASS** | `security-verification` yuklamalari; cookie `httpOnly` + `sameSite=lax` + `secure` (prod) |
| Sessiya | **PASS** | faolsizlik va mutlaq muddat, chiqishda bekor qilish, o'chirilgan hisob sessiyasi ishlamaydi (`auth.test.ts`) |
| Rate limiting | **PASS** | kirish (5 urinish), PIN (5), parol tiklash (raqam/IP), ommaviy qidiruv (IP) |
| HTTPS / sarlavhalar | **PASS** | `strict-transport-security: max-age=31536000; includeSubDomains`, CSP, `x-content-type-options: nosniff`, `x-frame-options: SAMEORIGIN` |
| CORS | **PASS** | bitta `WEB_ORIGIN`, `credentials: true` |
| IDOR | **PASS** | `tenant-isolation`, `acceptance-rbac` — begona ID bilan 403/404 |
| Takroriy to'lov (duplicate) | **PASS** | idempotentlik kalitlari; `acceptance-payment-architecture`: parallel bir xil kalit — bitta yozuv |
| Poyga holatlari (race) | **PASS** | qator qulflari; parallel sotuv/zaxira/smena/litsenziya testlari |
| Qurilma tasdig'i | **PASS** | birinchi qurilma avtomatik, keyingilari egasi tasdig'isiz kira olmaydi (`user-devices.test.ts`); productionda 5 tasdiqlangan, 3 kutayotgan |
| Maxfiy qiymatlar hisobotda | **PASS** | bu hujjatda hech qanday parol, token, kalit yozilmagan |

---

## 3. Tenant Isolation

**PASS (API darajasida).**

- `tenant-isolation.test.ts`: B kompaniyasi egasi A ning mijozi, mahsuloti, buyurtmasi, to'lovi,
  omborini **ID bilan** o'qiy, o'zgartira, o'chira olmaydi; A ma'lumoti o'zgarmaydi; biznes sarlavhasi
  orqali A kontekstiga o'tish rad etiladi.
- `acceptance-rbac.test.ts`: begona kompaniya yozuvini so'rash — 403 yoki 404 (BOLA/IDOR).
- `acceptance-access.test.ts`: "A foydalanuvchisi B ma'lumotini ID bilan ham ko'ra olmaydi".
- `delivery-security.test.ts`: agent A agent B yetkazmasini va mijozini ko'rmaydi; kompaniya A
  kompaniya B ni ko'rmaydi.
- `modules.test.ts`: modul o'chirilganda boshqa kompaniya ta'sirlanmaydi.

**NOT VERIFIED:** qidiruv va filtr yo'llari bo'yicha alohida cross-tenant sinov (`search=`, `filter=`
parametrlari) — izolyatsiya bitta joyda (tenant konteksti) qo'llangani uchun xavf past, lekin aniq
test yo'q.

---

## 4. Authentication

| Stsenariy | Natija | Dalil |
|---|---|---|
| Egasi: telefon + parol | **PASS** | `auth.test.ts` |
| Xodim: telefon + parol | **PASS** | `auth.test.ts`, `employee-onboarding.test.ts` |
| Noto'g'ri parol | **PASS** | noma'lum raqam bilan bir xil javob (foydalanuvchi aniqlanmaydi) |
| Rate limit | **PASS** | 5 xatodan keyin to'g'ri parol ham bloklanadi |
| Logout | **PASS** | sessiya bekor, cookie tozalanadi |
| Sessiya muddati | **PASS** | faolsizlik va mutlaq muddat alohida tekshiriladi |
| Ruxsatsiz API | **PASS** | cookie'siz 401, soxta token bilan 401 |
| PIN faqat qulfni ochadi | **PASS** | `subscription.test.ts`: "LOCK sessiyani saqlaydi va faqat PIN bilan ochiladi" |
| **Logoutdan keyin PIN bilan kirib bo'lmaydi** | **PASS** | o'sha testda aniq tekshirilgan: "LOGOUT dan keyin PIN ishlamaydi" |
| PIN brute-force | **PASS** | 5 xatodan keyin vaqtincha blok, to'g'ri PIN ham ochmaydi |
| Obuna tugagan foydalanuvchi | **PASS** | `SUBSCRIPTION_EXPIRED`, faqat Bosh sahifa va Obuna ochiq |
| Parolni SMS bilan tiklash | **FAIL (productionda o'chiq)** | `ESKIZ_*` sozlanmagan → `503`. Xodim parolini faqat egasi tiklaydi |

---

## 5. RBAC

**PASS (server tomonida).**

`acceptance-rbac.test.ts` kutilmani qo'lda yozmaydi: har rol uchun `GET /api/company` dan **haqiqiy
ruxsatlar ro'yxati** olinadi va har endpoint bo'yicha tekshiriladi — ruxsat bo'lmasa **403**, bo'lsa
403 bo'lmasligi shart. Ya'ni rol ta'rifi o'zgarsa ham test to'g'ri qoladi va "ruxsat yo'q, lekin
ochiq" holati albatta tutiladi.

Alohida tekshirilgan rollar/qoidalar: Kassir (kadrlar, audit, modul, moliyaviy tasdiq yopiq),
Ombor menejeri (ombor ocha olmaydi), Omborchi (kirim qiladi), Direktor (login bera olmaydi, bepul
xodim qo'sha oladi), Sotuv agenti (ERP bo'limlari 403 — `sales-agent.test.ts`), Dostavka agenti
(`delivery-security.test.ts`), Ko'ruvchi (lokatsiyani ko'rmaydi), Ishlab chiqarish menejeri,
Buxgalter (`finance.approve`).

**UI yashirish hisobga olinmagan** — barcha tekshiruvlar to'g'ridan-to'g'ri API so'rovi bilan.

---

## 6. Subscription

**PASS.** `subscription.test.ts` (26 ta) + `subscription-rules.test.ts`:

- yangi kompaniya — **25 kun trial, 3 included litsenziya**, egasi birinchisini oladi;
- 4-foydalanuvchi to'lovsiz **rad etiladi va hech narsa yaratilmaydi** (rollback);
- parallel so'rovlar oxirgi bo'sh litsenziyadan oshib keta olmaydi;
- qo'shimcha litsenziya: to'lov tasdiqlanguncha kirish yopiq;
- BEPUL xodim — foydalanuvchi ham, litsenziya ham yaratilmaydi; BEPUL o'chiq — login + litsenziya;
- obuna tugaganda: **Bosh sahifa va Obuna ochiq**, boshqa API `SUBSCRIPTION_EXPIRED`, ma'lumot o'chmaydi;
- so'rovdagi soxta obuna/litsenziya maydonlari limitni chetlab o'tolmaydi.

---

## 7. Module System

**PASS.** `modules.test.ts` + `acceptance-access.test.ts`:

- modul o'chiq → API **403 MODULE_DISABLED**, ma'lumot saqlanadi, qayta yoqilganda ochiladi;
- boshqa kompaniya ta'sirlanmaydi; tarix va audit yoziladi;
- bog'liqliklar ishlaydi (POS o'chsa POS API, qurilma sinxroni va yangi qurilma yopiladi);
- **obuna tugagani modul guardidan ustun**;
- modulni yoqish avtomatik ruxsat bermaydi (RBAC alohida);
- modullarni faqat platforma admini boshqaradi (kompaniya endpointi har doim rad etadi).

---

## 8. POS

**PASS (web, haqiqiy Chrome).** `e2e/pos-critical.spec.ts`, `pos-session.spec.ts`,
`pos-acceptance.spec.ts`, `pos-mobile.spec.ts`:

- login → sessiya ochish → mahsulot qidirish → savatga qo'shish → **naqd 50 000 + UZCARD 50 000** →
  yakunlash;
- natija: **Sale = completed, Payment = paid, Yetkazma ustuni bo'sh (DeliveryTask yaratilmaydi)** —
  `pos-critical.spec.ts` aynan shuni tekshiradi;
- kam to'lovda "Yakunlash" o'chiq, naqdsiz ortiqcha to'lov rad (UI ham, server ham);
- telefon o'lchamlari 360–430px: gorizontal scroll yo'q, savat pastki panelda.

**NOT VERIFIED:** haqiqiy chek printeri, tarozi va terminal cheki bilan ishlash (jihoz yo'q).

---

## 9. Cash Session

**PASS.** `pos-session.test.ts` (7 ta) + `e2e/pos-session.spec.ts`:

- ochilish naqdi bilan smena ochiladi; **UZCARD/HUMO uchun ochilish naqdi yo'q**;
- yopishda **kutilayotgan naqd = boshlang'ich + naqd savdo**, karta alohida ko'rsatiladi —
  ya'ni UZCARD naqdga qo'shilmaydi;
- naqd kam bo'lsa farq yoziladi va yashirib bo'lmaydi (rahbar ko'rib chiqadi);
- sessiya yopilgandan keyin yangi sotuv **server tomonidan** rad etiladi;
- bitta omborda ikkita ochiq sessiya bo'lmaydi; parallel yopish — bir marta.

---

## 10. Payments (3-way)

**PASS.** `pos-mixed-payment.test.ts` + `e2e/pos-acceptance.spec.ts`:

- **100 000 = naqd 40 000 + UZCARD 30 000 + HUMO 30 000** — uchala qism **bitta sessiyada**,
  **uch xil hisobda** (kassa, UZCARD banki, HUMO banki), terminal bo'yicha to'g'ri yo'naltiriladi;
- qaytim faqat naqddan; kartada ortiqcha to'lov rad;
- idempotentlik: bir xil kalitli parallel ikkita chek — bitta yozuv;
- karta to'lovi **kutilayotgan hisobga** tushadi, komissiya qirqimda ushlanadi (`bank-commission`).

---

## 11. Sales Agent

**PARTIAL.**

**PASS (API/server):** 15 ta test fayli — ish sessiyasi, marshrut va bugungi do'konlar, tashrif oqimi
(vitrina rasmi majburiyligi, taymer, javon rasmi, buyurtma yoki sabab), mahsulot/narx/aksiya/miqdor,
qarz va to'lov, GPS siyosati (geofence, eskirgan/aniqligi past nuqta, **soxta GPS**), chegaralar
(boshqa agent ma'lumoti), hisobotlar, "yo'ldagi naqd" va kassaga topshirish.

**NOT VERIFIED (UI):** agent ish joyi **haqiqiy brauzerda umuman ochilmagan** — `e2e/` da sales-agent
spesifikatsiyasi yo'q. Menyu tarkibi (faqat Dashboard, Sotuv, Mijozlar, Aksiya, Hisobotlar) va
"tashkilot bo'yicha ko'rsatkichlar ko'rinmasin" qoidasi server tomonda ta'minlangan, lekin UI da
o'lchanmagan.

**NOT VERIFIED (qurilma):** haqiqiy telefonda GPS, kamera, fon rejimi.

---

## 12. Delivery Agent

**PARTIAL.**

**PASS (API/server):** `delivery-flow.test.ts` (6 ta katta stsenariy) holatlar zanjirini qoplaydi:
`READY → ASSIGNED → ACCEPTED → OUT_FOR_DELIVERY → ARRIVED → DELIVERING → DELIVERED`, shuningdek
`PARTIALLY_DELIVERED`, `FAILED`, `RETURNED`, `CANCELLED`, qayta rejalash va boshqa agentga o'tkazish.
Muhim: **qisman yetkazishda buyurtma o'zgarmaydi**, qolgan tovar omborga bir marta qaytadi;
yig'ilgan pul farqi supervayzer ko'rigiga tushadi; oflayn navbat serverda qayta tekshiriladi.

**NOT VERIFIED (UI):** yetkazuvchi ish joyi haqiqiy brauzerda ochilmagan (`e2e/` da spec yo'q).

**NOT VERIFIED (qurilma):** telefonda fon GPS, kamera (dalil rasmi), imzo, bildirishnoma.

---

## 13. Customer / Debt

**PASS.** `customer-balance.test.ts`, `sales-payments.test.ts`, `acceptance-payments.test.ts`,
`acceptance-cross-module.test.ts`:

- mijoz yaratish → buyurtma → nasiya sotuv → balans → to'lov (bitta usul va aralash) → balans to'g'ri;
- **to'lov yetkazma holatini o'zgartirmaydi** va sotuv holatini noto'g'ri o'zgartirmaydi
  (uchta o'q alohida: sotuv / to'lov / yetkazish);
- ortiqcha to'lov rad etiladi; keshbek va balansdan foydalanish alohida tekshiriladi.

---

## 14. Purchase / Supplier

**PASS.** `purchase.test.ts`, `purchase-payments.test.ts`, `acceptance-cross-module.test.ts`:

- ta'minotchi → xarid → qabul → **zaxira oshadi** → ta'minotchi qarzi → to'lov (aralash ham) →
  terminal/bank taqsimoti → buxgalteriya yozuvi;
- **xarid sotuvga, mijoz qarziga, yetkazmaga va ishlab chiqarishga tegmaydi** (aniq test bor);
- takroriy ta'minotchi to'lovi (parallel, bir xil havola) — pul bir marta chiqadi.

---

## 15. Expense

**PASS.** `expenses.test.ts`, `cash.test.ts`, `acceptance-cross-module.test.ts`:

- xarajat naqd yoki bank orqali; maqsad (daromad/xarajat moddasi) majburiy;
- buxgalteriya yozuvi to'g'ri; **sotuv, mijoz qarzi va zaxiraga tegmaydi**;
- kassada manfiy qoldiq hosil qilib bo'lmaydi.

---

## 16. Inventory

**PASS.** `inventory.test.ts` (9 ta), `inventory-journal.test.ts`, `counts.test.ts`:

- xarid → zaxira oshadi; POS sotuv → zaxira kamayadi; **yetmasa 400 va hech narsa yozilmaydi**;
- **parallel ikkita sotuv** — bittasi rad etiladi, zaxira manfiyga tushmaydi (qator qulfi);
- ombordan omborga o'tkazma manba o'rtacha tannarxida; bir xil ombor va yetmagan miqdor rad;
- AVCO tannarx; a'zoning ombor ruxsati; begona mahsulot/ombor — 404 (tenant izolyatsiyasi).

---

## 17. Manufacturing

**PASS (asosiy oqim).** `manufacturing.test.ts`:

- retsept (tarkib) tekshiruvlari: o'zi tarkib bo'lolmaydi, sikl yo'q, begona mahsulot rad;
- ishlab chiqarish: **xomashyo AVCO da chiqadi, mehnat tannarxga qo'shiladi**, tayyor mahsulot
  tannarxi va jurnal yozuvi;
- xomashyo yetmasa hech narsa yozilmaydi;
- `acceptance-cross-module`: **ishlab chiqarish sotuv, yetkazma va mijoz qarzi yaratmaydi**.

**PARTIAL:** ko'p bosqichli ishlab chiqarish (yarim tayyor → tayyor zanjiri) va ish markazi
yuklamasi bo'yicha chuqurroq stsenariylar sinalmagan.

---

## 18. Finance

**PASS.** `finance.test.ts`, `settlement.test.ts`, `bank-commission.test.ts`, `inventory-journal.test.ts`:

- kompaniya yaratilganda standart hisoblar va kassalar ochiladi (idempotent);
- **har pul harakati uchun DEBIT = CREDIT**: balanslanmagan yozuv *baza darajasida* (tranzaksiya
  oxirida) rad etiladi — bu eng kuchli kafolat;
- bekor qilish balansni qaytaradi; yopilgan sanadan oldin yozuvga ruxsat yo'q (`finance.approve`);
- karta to'lovi kutilayotgan hisobda, qirqimda komissiya ushlanadi;
- **production bazasida balanslanmagan jurnal yozuvi: 0 ta** (o'qib tekshirildi).

---

## 19. Reports

**PARTIAL.**

- `analytics.test.ts`: ko'rsatkichlar **faqat jo'natilgan savdodan** hisoblanadi, SQL yig'indilari
  bilan solishtiriladi, ruxsat tekshiriladi.
- `pos-analytics.test.ts`, `sales-agent-reports.test.ts`, `delivery` hisobotlari o'z testlariga ega.
- **NOT VERIFIED:** barcha bo'limlar (POS, sotuv, to'lov, qarz, xarid, zaxira, yetkazma, moliya)
  yig'indilarini **bir-biri bilan solishtiruvchi** yagona "reconciliation" testi yo'q. Har hisobot
  alohida to'g'ri, lekin "hammasi bir-biriga mos" degani o'lchanmagan.

---

## 20. Data Safety

| Tekshiruv | Natija |
|---|---|
| Ochiq parol / PIN | **PASS** — kodda ham, productionda ham yo'q |
| Hardcoded sir, API kalit | **PASS** — topilmadi |
| Xavfsiz bo'lmagan SQL | **PASS** |
| Tenant bypass / IDOR | **PASS** |
| Yetishmayotgan avtorizatsiya | **PASS** (RBAC testi har endpointni ruxsat ro'yxati bo'yicha yuradi) |
| Takroriy tranzaksiya | **PASS** (idempotentlik kalitlari + parallel testlar) |
| Poyga holatlari | **PASS** (zaxira, kassa, smena, litsenziya, yetkazma) |
| **Zaxira nusxa va tiklash** | **NOT VERIFIED** — ehtiyot nusxa olinayotgani va undan TIKLASH sinalmagan |

**Production ma'lumotidagi ochiq masala:** `Bonnu Market → Asosiy kassa` qoldig'i **−77 520 so'm**
(eski, tuzatilmagan). Yangi kod manfiy qoldiqqa yo'l qo'ymaydi, lekin mavjud yozuv egasi tomonidan
"Qoldiqni to'g'rilash" orqali tuzatilishi kerak. Audit davomida ma'lumotga tegilmadi.

---

## 21. Production Readiness

| Tekshiruv | Natija | Izoh |
|---|---|---|
| Sxema mosligi (lokal ↔ production) | **PASS** | 63 = 63 migratsiya, oxirgi ustunlar productionda bor |
| Staging muhiti | **NOT VERIFIED** | **staging yo'q** — lokal va production, oraliq muhit mavjud emas |
| Production kod commit'i | **PASS** | oxirgi deploy `1f6e46b` dagi kod (API `588b68e2`, web `eb28da7f`) |
| Baza | **PASS** | Railway Postgres, 118 jadval, ishlayapti |
| HTTPS / domen | **PASS** | `app.bum-erp.uz`, HSTS, CSP |
| CORS | **PASS** | bitta origin, cookie bilan |
| Rate limiting | **PASS** | kirish, PIN, tiklash, ommaviy qidiruv |
| Health check | **PARTIAL** | API'da `/health` bor, lekin nginx orqali tashqaridan ochilmaydi |
| Logging | **PASS** | Railway loglari |
| **Fayl saqlash (S3)** | **FAIL (sozlanmagan)** | `STORAGE_*` yo'q → mahsulot rasmi va fayl endpointlari **503** |
| **SMS (Eskiz)** | **FAIL (sozlanmagan)** | `ESKIZ_*` yo'q → parolni o'zi tiklash **503**, yetkazma OTP ishlamaydi |
| AI yordamchi | **N/A** | kalit yo'q → 503 (sotuvga ta'sir qilmaydi, modul o'chiq deb aytilsa bo'ladi) |
| Xaritalar | **PASS** | deep-link (Google/Yandex/`geo:`) — pullik API ishlatilmaydi |
| To'lov integratsiyasi (Payme/Click) | **NOT VERIFIED** | umuman ulanmagan; obunani admin qo'lda tasdiqlaydi |
| **Backup / restore** | **NOT VERIFIED** | eng muhim ochiq masala |

---

## 22. Real Device Status

Brauzer emulyatsiyasi haqiqiy qurilma deb hisoblanmadi.

| Komponent | Natija |
|---|---|
| Brauzerda mobil emulyatsiya (360–430px) | **PASS** — POS va ERP sahifalari, gorizontal scroll yo'q |
| **Haqiqiy Android telefon** | **NOT VERIFIED** — ilova birorta jismoniy qurilmada ishlatilmagan |
| Fon rejimida GPS (ekran qulflangan) | **NOT VERIFIED** |
| Kamera (vitrina/javon/dalil rasmi) | **NOT VERIFIED** |
| Telefon bildirishnomalari | **NOT VERIFIED** |
| APK imzosi va o'rnatilishi | **PARTIAL** — imzolangan APK 1.0.1 qurildi va imzo tekshirildi, lekin telefonga o'rnatilmagan |
| **Haqiqiy UZCARD/HUMO terminali** | **NOT VERIFIED** — ekvayring protokoli umuman ulanmagan; kassir summani qo'lda kiritadi |
| **Desktop kassa o'rnatuvchisi** | **NOT VERIFIED** — haqiqiy kassa kompyuteriga o'rnatilmagan, 0.4.6 relizi hali e'lon qilinmagan |
| Chek printeri / tarozi | **NOT VERIFIED** |

---

## 23. Blockers

**A) BLOCKER — bular yopilmaguncha pul evaziga sotmaslik kerak**

1. **Zaxira nusxa va tiklash sinalmagan.** Mijozning butun biznes ma'lumoti bitta Postgres'da.
   Nusxa olinayotgani va undan **tiklash mumkinligi** hech qachon tekshirilmagan.
2. **Haqiqiy Android qurilmada hech narsa tekshirilmagan.** Savdo agenti va yetkazuvchi — mahsulotning
   asosiy sotiladigan qismi; ular fon GPS, kamera va bildirishnomaga tayanadi.
3. **Savdo agenti ish joyi haqiqiy brauzerda sinalmagan** (E2E yo'q). Server qoidalari tekshirilgan,
   ekran oqimi — yo'q.
4. **Yetkazuvchi ish joyi haqiqiy brauzerda sinalmagan** (E2E yo'q).
5. **Fayl saqlash productionda sozlanmagan** — mahsulot rasmi, vitrina va dalil rasmlari ishlamaydi
   (503). Mijoz birinchi kunidayoq uchraydi.
6. **SMS sozlanmagan** — foydalanuvchi parolini o'zi tiklay olmaydi (503) va yetkazmada OTP yo'q.
   Hozircha parolni faqat egasi almashtiradi.
7. **Desktop kassa haqiqiy kassa kompyuterida o'rnatilib sinalmagan** (agar mijozga desktop kassa ham
   sotilsa; faqat web POS sotilsa — bu band tushadi).

**B) IMPORTANT — API'da ishlaydi, haqiqiy UI/qurilmada tasdiqlanmagan**

- Hisobotlar bo'limlararo yig'indilarining o'zaro mosligi (reconciliation) o'lchanmagan.
- Ko'p bosqichli ishlab chiqarish zanjiri chuqur sinalmagan.
- `WEB_ORIGIN` noto'g'ri domenga ishora qiladi (hozir zarar yo'q).
- Staging muhiti yo'q — har o'zgarish to'g'ridan-to'g'ri productionga chiqadi.
- Tashqaridan ochiladigan health-check yo'q (monitoring qiyin).
- Payme/Click ulanmagan — obuna to'lovini admin qo'lda tasdiqlaydi.
- Yuklama (load) va ko'p foydalanuvchili ish sinovi yo'q: productionda 2 kompaniya, 8 foydalanuvchi.
- Productionda 2 ta ochiq kassa smenasi bor — sotuvdan oldin yopilishi kerak.

**C) MINOR**

- Ro'yxatlardagi jadvallar telefonda o'z ichida yon suriladi (kartochka ko'rinishi yo'q).
- Mijozlarda shahar/mahalla maydonlari to'ldirilmagan (avtomatik to'ldirilmaydi).
- Foydalanuvchi qo'llanmasi/onboarding hujjati yo'q.

---

## 24. Important Unverified — aniq qanday test kerak

1. **Backup/restore:** Railway Postgres nusxasidan **alohida bazaga tiklash** va tiklangan bazada
   kirish + bitta chek ochish. Natija: "nusxa sanasi, tiklash vaqti, tekshirilgan" yozuvi.
2. **Haqiqiy Android:** APK 1.0.1 ni telefonga o'rnatib: kirish → agent ish sessiyasi → ko'cha
   sharoitida GPS (ekran qulflangan holda 30 daqiqa) → tashrif rasmi (kamera) → buyurtma → to'lov →
   bildirishnoma. Xuddi shu yetkazuvchi uchun.
3. **Agent E2E (brauzer):** login → bugungi marshrut → tashrif boshlash (rasm majburiy) → buyurtma →
   to'lov → hisobot; menyuda faqat 5 ta bo'lim ekani.
4. **Yetkazuvchi E2E (brauzer):** yetkazma qabul qilish → yo'lga chiqish → yetib kelish → qisman
   yetkazish → farq bilan yakunlash.
5. **Fayl saqlash:** S3 (yoki Railway volume) ulab, mahsulot rasmi yuklash → kassada ko'rinishi.
6. **SMS:** Eskiz hisobini ulab, parol tiklash kodi va yetkazma OTP sini bitta raqamda sinash.
7. **Desktop kassa:** 0.4.6 ni e'lon qilib, haqiqiy kassa kompyuteriga o'rnatish → oflayn sotuv →
   sinxron.

---

## 25. What Is Already Verified

- **Server biznes mantiq:** 642 API testi — sotuv, kassa, to'lov, qarz, xarid, xarajat, zaxira,
  ishlab chiqarish, moliya, yetkazma, agent, HR, obuna, modullar, Telegram botlari.
- **Xavfsizlik:** ko'p-kompaniyalilik izolyatsiyasi, RBAC (ruxsat ro'yxati bo'yicha avtomatik),
  IDOR, sessiya, PIN, rate limit, qurilma tasdig'i, argon2id, HTTPS/HSTS/CSP.
- **Pul aniqligi:** DEBIT = CREDIT baza darajasida majburiy; productionda balanslanmagan yozuv yo'q;
  takroriy to'lov va parallel amallar bloklangan; manfiy kassa qoldig'i endi imkonsiz.
- **Web POS:** haqiqiy Chrome'da uchta to'lov usuli, smena ochish/yopish, telefon o'lchamlari.
- **Deploy zanjiri:** migratsiyalar lokal va productionda mos; deploy qilingan kod tekshirilgan.

---

## FINAL VERDICT

# NOT SALE READY

Sabab — kodda emas, **tekshirilmagan haqiqiy dunyo qismlarida**:

1. zaxira nusxadan tiklash sinalmagan;
2. haqiqiy Android telefonda hech narsa tekshirilmagan (GPS, kamera, bildirishnoma);
3. savdo agenti ish joyi brauzer testlarida ochilmagan;
4. yetkazuvchi ish joyi brauzer testlarida ochilmagan;
5. productionda fayl saqlash sozlanmagan (rasmlar 503);
6. productionda SMS sozlanmagan (parol tiklash 503);
7. desktop kassa haqiqiy kassa kompyuterida o'rnatilmagan.

**Allaqachon tasdiqlangan muhitlar:** LOCAL (API, web, desktop testlari), PRODUCTION (sxema,
deploy, xavfsizlik sarlavhalari, tirik API), WEB (haqiqiy Chrome'da POS va ERP).
**Tasdiqlanmagan:** STAGING (mavjud emas), ANDROID (haqiqiy qurilma), DESKTOP (haqiqiy o'rnatish),
TERMINALS (UZCARD/HUMO ekvayringi).

Yuqoridagi 7 ta band yopilsa — qolgan hamma narsa sotuvga tayyor.

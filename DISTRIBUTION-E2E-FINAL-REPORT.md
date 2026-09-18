# BUM ERP — DISTRIBUTSIYA KOMPANIYASI 0→100 SIMULYATSIYASI: YAKUNIY HISOBOT

**Sana:** 2026-09-19
**Muhit:** lokal/izolyatsiya — API `localhost:3000`, Postgres 18 (Docker), Chrome (Playwright).
**Production'ga tegilmadi, production ma'lumoti ishlatilmadi, deploy qilinmadi.**
**Kompaniya:** "BUM Distribution Demo" — har yugurishda **noldan** yaratiladi.

Ishga tushirish: `node scripts/distribution/run.mjs` · Dalillar: `e2e/.artifacts/distribution/`

---

## 1. NATIJA XULOSASI

| O'lchov | Natija |
|---|---|
| Server simulyatsiyasi (1–22 bosqich) | **114 tekshiruv — 114 PASS, 0 FAIL** |
| Brauzer (haqiqiy Chrome) | **47 test PASS** (43 mavjud + 4 yangi telefon testi) |
| Desktop kassa (haqiqiy Electron) | **5 test PASS** |
| Buxgalteriya (bazadan) | 37 jurnal yozuvi, **balanslanmagan 0**, DEBIT = KREDIT = 23 062 000 |
| Manfiy kassa / manfiy zaxira | **0 / 0** |
| Topilmalar | 0 BLOCKER · 0 HIGH · 2 MEDIUM · 4 LOW · 3 INFO |

---

## 2. BOSQICHLAR BO'YICHA HOLAT

| # | Bosqich | Holat | Izoh |
|---|---|---|---|
| 1 | Kompaniya (trial, obuna, modul, tenant izolyatsiyasi) | **PASS** | trial 3 litsenziya, begona kompaniya ma'lumoti → 404 |
| 2 | Xodimlar (Xodim ≠ Foydalanuvchi ≠ Litsenziya) | **PASS** | 10 dasturli rol + 1 BEPUL xodim (login 401, litsenziya yaratilmadi) |
| 3 | Omborlar, bank hisoblari, terminallar | **PASS** | 2 ombor, X/Y Bank, UZCARD#01→X, HUMO#01→Y |
| 4 | Katalog (kategoriya, brend, 10 mahsulot, qoldiq) | **PASS** | turli qoldiqlar (100…550) |
| 5 | Marketing (aksiya) | **PASS** | aksiya agentga ko'rinadi; kassir yarata olmaydi (403) |
| 6 | Hudud/marshrut va mijozlar | **PASS** | agent 2 begona do'konlarni ko'rmadi (0) |
| 7 | Ta'minotchi va xarid | **PASS** | qabul → zaxira +100, qarz 300 000 → naqd+bank → 0 |
| 8 | Mijoz A — agent buyurtmasi, naqd, yetkazish | **PASS** | READY→…→DELIVERED, sotuv completed, qarz 0 |
| 9 | Mijoz B — nasiya 500 000 | **PASS** | qarz 500 000 → 300 000 → 0; to'lov yetkazmani o'zgartirmadi |
| 10 | Mijoz C — aralash to'lov 400k+300k+300k | **PASS** | UZCARD va HUMO alohida hisoblarda; oldindan to'lov yetkazishdan keyin 0 ga qaytdi |
| 11 | Kassa (POS) | **PASS** | 50k naqd + 50k UZCARD; **yetkazma yaratilmadi**; kutilgan naqd 550 000 (karta qo'shilmadi) |
| 12 | Yetkazib bo'lmadi (FAILED) | **PARTIAL** | holat va sabab to'g'ri; **F-01**: sotuv `completed` qolishi — qaytarish bilan tiklanadi |
| 13 | Qisman yetkazish (100 dan 60) | **PASS** | `partially_delivered`, asl buyurtma o'zgarmadi, qolgani qaytarildi, takror rad (409) |
| 14 | Qaytarish | **PASS** | zaxira +4, mijozga 28 000 kredit |
| 15 | Omborlararo ko'chirish | **PASS** | jami zaxira o'zgarmadi, filialda 50; qarzga tegmadi |
| 16 | Hisobotlar (rollar bo'yicha) | **PASS** | agent tashkilot panelini ko'rmaydi (403) |
| 17 | Salbiy testlar | **PASS** | tenant, ruxsat, ortiqcha to'lov, dublikat, o'chirilgan modul (403 MODULE_DISABLED) |
| 18 | Parallellik | **PASS** | dublikat to'lov 201+409 → 1 yozuv; 2 smena → 1 ta; oversell → zaxira o'zgarmadi |
| 19 | Haqiqiy brauzer | **PASS** | agent, yetkazuvchi, POS, katalog, obuna, CSV — 43 test |
| 20 | Mobil (390×844, 412×915) | **PASS** | agent va yetkazuvchi: gorizontal scroll yo'q, 5 bo'limli navigatsiya, tugma ≥40px |
| 21 | Buxgalteriya solishtiruvi | **PASS** | DEBIT = KREDIT, balanslanmagan 0, manfiy qoldiq 0 |
| 22 | Yakuniy ma'lumot jadvali | **PASS** | pastda |

---

## 3. MODULLARARO IFLOSLANISH (16-bo'lim)

Har amaldan keyin aloqasiz modullar tekshirildi:

| Tekshiruv | Natija |
|---|---|
| POS sotuvi yetkazma **yaratmaydi** | **PASS** (`taskForOrder` → null) |
| To'lov sotuv/yetkazma holatini noto'g'ri o'zgartirmaydi | **PASS** (yetkazma `delivered` qoldi; boshqa holatda `ready` qoldi) |
| Xarid mijoz qarzi va sotuvga tegmaydi | **PASS** ([0, 0]) |
| Omborlararo ko'chirish mijoz qarziga tegmaydi | **PASS** |
| Xodim yaratish sotuvga tegmaydi | **PASS** (2-bosqichdan keyin sotuv 0) |
| Yetkazish xaridga tegmaydi | **PASS** (ta'minotchi qarzi 0 bo'lib qoldi) |

---

## 4. YAKUNIY MA'LUMOT SOLISHTIRUVI (22-bo'lim)

| Entity | Kutilgan | Haqiqiy | Farq |
|---|---|---|---|
| Kompaniya | 1 | 1 | 0 |
| Foydalanuvchi (dasturli xodim + ega) | 11 | 11 | 0 |
| Xodim kartochkasi (BEPUL xodim bilan) | 12 | 12 | 0 |
| Mahsulot | 10 | 10 | 0 |
| Zaxira qatori (asosiy ombor) | 10 | 10 | 0 |
| Mijoz | 3 | 3 | 0 |
| Sotuv buyurtmasi | 10 | 10 | 0 |
| To'lov yozuvi | 11 | 11 | 0 |
| Mijoz qarzi (jami) | 478 000 | 478 000 | 0 |
| Ta'minotchi qarzi | 0 | 0 | 0 |
| Xarid hujjati | 1 | 1 | 0 |
| Yetkazma vazifasi | 9 | 9 (ready 3, delivered 4, partially_delivered 1, returned 1) | 0 |
| Jurnal yozuvi | — | 37 (balanslanmagan 0) | 0 |
| Kassa (naqd) | — | 5 352 000 | — |
| Yetkazuvchidagi yo'ldagi naqd | — | 170 000 | — |
| UZCARD #01 (kutilayotgan) | — | 650 000 | — |
| HUMO #01 (kutilayotgan) | — | 300 000 | — |
| X Bank / Y Bank | — | 0 / 0 | — |

**Pul izohi:** kassa = 5 000 000 (kapital) + yig'ilgan naqd − ta'minotchiga to'lov − qaytarish;
kartadagi pullar **qirqimgacha** terminal hisoblarida turadi (X/Y Bank 0) — bu loyihalangan xatti-harakat.
Yetkazuvchidagi 170 000 — kassaga topshirilmagan "yo'ldagi naqd".

---

## 5. ROLLAR VA KO'RINISH (2, 15-bo'limlar)

| Rol | Kirish | Ko'rinish tekshiruvi |
|---|---|---|
| Ega | ✔ | barcha hisobotlar 200 |
| Direktor (menejer) | ✔ | yaratildi, login ✔ |
| Savdo menejeri (marketolog o'rnida) | ✔ | aksiya yaratdi |
| Supervayzer | ✔ | agentlar ro'yxati 200, yetkazma biriktirdi |
| Sotuv agenti 1 / 2 | ✔ | faqat o'z marshruti (agent 2 → 0 do'kon), moliya 403 |
| Kassir | ✔ | POS ✔, HR 403, audit 403, ERP to'lov 403 (**F-03**) |
| Ombor menejeri | ✔ | qabul va ko'chirish ✔, narx o'zgartira oladi (**F-06**) |
| Yetkazuvchi 1 / 2 | ✔ | to'liq va qisman yetkazish ✔ |
| Buxgalter | ✔ | to'lovlar va moliya ✔ |
| BEPUL xodim | ✖ (login 401) | litsenziya yaratilmadi — **to'g'ri** |

---

## 6. TOPILMALAR (batafsil — `DISTRIBUTION-E2E-BUG-REPORT.md`)

| Kod | Daraja | Mavzu |
|---|---|---|
| F-01 | **MEDIUM** | Yetkazib bo'lmaganda sotuv `completed` qoladi, qarz turadi (supervayzer qaytarishi tiklaydi) |
| F-03 | **MEDIUM** | Kassir ERP "To'lovlar" orqali qarz yopa olmaydi (faqat POS orqali) |
| F-02 | LOW | "Marketolog" roli yo'q |
| F-04 | LOW | Zaxiradan ortiq buyurtma tasdiqlanadi (to'siq jo'natishda) |
| F-05 | LOW | Mijoz "qarz" va "balans" alohida — netto ko'rsatilmaydi |
| F-06 | LOW | Ombor menejeri sotuv narxini o'zgartira oladi (rol ta'rifi) |
| F-07/08/09 | INFO | Bo'sh terminaldan to'lov rad; oldindan to'lov to'g'ri yopiladi; yetkazish sozlamasi |

**BLOCKER yo'q. HIGH yo'q.** Pul yo'qolishi, ma'lumot yo'qolishi, tenant buzilishi,
buxgalteriya yoki zaxira buzilishi, autentifikatsiyani chetlab o'tish — **topilmadi**.

---

## 7. TEKSHIRILMAGAN (NOT VERIFIED)

Bu simulyatsiya **server va brauzer** darajasida bajarildi. Quyidagilar bu bosqichda tekshirilmadi:

- **Haqiqiy Android qurilma** — agent va yetkazuvchining fon GPS'i, kamerasi, bildirishnomasi
  (qurilma yo'q; `adb devices` bo'sh).
- **Haqiqiy UZCARD/HUMO terminali** — ekvayring protokoli ulanmagan; summa qo'lda kiritiladi.
- **SMS (Eskiz)** — kalit yo'q; parol tiklash va yetkazma OTP mantiqan sinaldi, haqiqiy SMS emas.
- **Production S3** — kalit yo'q (rasm bazaga saqlanadi va ishlaydi).
- **Ishlab chiqarish moduli** — bu distributsiya simulyatsiyasiga kirmadi (alohida API testlari bor).
- **Yuklama (load) va ko'p kompaniyali miqyos** — sinalmadi.

---

## 8. YAKUNIY HUKM

# NOT SALE READY

0→100 distributsiya simulyatsiyasi **biznes mantiqi bo'yicha muvaffaqiyatli**: 114 server tekshiruvi,
47 brauzer testi va 5 desktop testi o'tdi; buxgalteriya balansi, zaxira va pul oqimi to'g'ri;
modullararo ifloslanish topilmadi; BLOCKER va HIGH darajali xato yo'q.

Hukm baribir **NOT SALE READY**, chunki sotuvga to'sqinlik qiladigan narsa shu simulyatsiyada emas —
`FINAL-SALE-READINESS-AUDIT-v2.md` dagi **ochiq blockerlar** hali yopilmagan:

| Ochiq blocker | Holat |
|---|---|
| Haqiqiy Android qurilmada tekshiruv | **NOT VERIFIED** (qurilma yo'q) |
| SMS (Eskiz) provideri | **NOT VERIFIED** (hisob yo'q) |
| Desktop kassaning imzosi va kassir oldida qo'lda sinovi | **PARTIAL** (o'rnatildi va ishga tushdi, imzo yo'q) |

Shu uchtasi yopilganda — va shu hisobotdagi **F-01** (yetkazilmagan sotuv holati) hamda **F-03**
(kassirning qarz yig'ishi) hal qilinganda — mahsulot sotuvga tayyor bo'ladi.

**Tuzatish taklif qilinmadi va bajarilmadi** — topshiriq bo'yicha avval barcha xatolar aniqlandi
va hujjatlashtirildi. Tuzatishni boshlash uchun ruxsat kerak.

# BUM ERP — real qabul testi ro'yxati

Kod darajasidagi audit tugadi (API 113 fayl / 567 test). Bu hujjat **odam qo'li bilan** bajariladigan
testlar uchun — brauzer, Android, printer, terminal va GPS kabi avtomatlashtirib bo'lmaydigan qismlar.

## 0. Muhitni ko'tarish

Audit tuzatishlari **production'ga deploy qilinmagan** (production hali 53-migratsiyada, `completed`
holati va `source`/`fulfillment_method` ustunlari u yerda yo'q). Shuning uchun yangi xatti-harakatni
faqat lokal muhitda sinash mumkin.

```bash
# 1. Baza (Docker)
docker compose up -d postgres

# 2. Migratsiyalar va bootstrap admin
pnpm --filter @bum/api db:migrate
pnpm --filter @bum/api db:seed

# 3. Demo kompaniya (idempotent — qayta yuritsa dublikat qilmaydi)
pnpm --filter @bum/api db:seed-demo

# 4. API va web
pnpm --filter @bum/api dev
pnpm dev
```

### Demo hisoblar

Parol — `.env` dagi `DEMO_PASSWORD` (kodda ham, bu hujjatda ham saqlanmaydi).

| Rol | Telefon |
|---|---|
| Egasi (Owner) | +998900000101 |
| Direktor (Admin) | +998900000102 |
| Buxgalter (Accountant) | +998900000103 |
| Kassir (Cashier) | +998900000104 |
| Ombor menejeri (Warehouse) | +998900000105 |
| Sotuv agenti (Sales Agent) | +998900000106 |
| Dostavka agenti (Delivery Agent) | +998900000107 |

Demo kompaniyada tayyor: 6 mahsulot (qoldiq bilan), 2 ombor, 2 bank hisobi,
UZCARD va HUMO terminallari (har biri **o'z bankiga** bog'langan), 3 koordinatali mijoz,
ta'minotchi, non retsepti (ishlab chiqarish uchun).

---

## 0b. Avtomatik brauzer testlari (Playwright + haqiqiy Chrome)

Quyidagi ro'yxatning bir qismi endi avtomatik bajariladi:

```bash
pnpm test:e2e             # barcha brauzer testlari (Chrome, headless)
pnpm test:e2e --headed    # brauzer ko'rinadigan rejimda
pnpm exec playwright show-report e2e/.report
```

Playwright API va web serverlarini o'zi ko'taradi. Nosozlikda ekran surati, video,
trace va sahifa tuzilishi `e2e/.artifacts/` ga saqlanadi.

**Hozir avtomatlashtirilgan:** kirish, noto'g'ri parol, chiqishdan keyin himoya,
va **kritik POS testi** (100 000 = naqd 50 000 + UZCARD 50 000 → Dashboard'da
"Yakunlandi", hech qayerda "Yetkazildi" yo'q).

Qolgan bandlar hali qo'lda bajariladi.

## 1. POS — eng muhim test

Kassir bilan kiring → Kassa.

1. 100 000 so'mlik savat yig'ing
2. **Naqd 50 000** → Saqlash
3. **UZCARD 50 000** → Saqlash

**Kutilgan natija — Sotuvlar ro'yxatida uchta alohida ustun:**

| Sotuv | To'lov | Yetkazma |
|---|---|---|
| Yakunlangan | To'langan | **—** |

- [ ] "Yetkazildi" **hech qayerda** ko'rinmaydi
- [ ] Naqd 50 000 kassa hisobida, UZCARD 50 000 **UZCARD terminali bog'langan bankda**
- [ ] Yetkazma hujjati yaratilmagan
- [ ] Zaxira kamaydi

Qo'shimcha: HUMO bilan sotuv → pul **ikkinchi bankka** tushishi kerak (UZCARD bankiga emas).

## 2. Nasiya va qarz to'lash

- [ ] Nasiya chek: Sotuv = Yakunlangan, To'lov = **To'lanmagan**, qarz mijozda
- [ ] Qarzni naqd + UZCARD bilan to'lang
- [ ] To'lovdan keyin: qarz 0, To'lov = To'langan, **Sotuv holati o'zgarmadi**, Yetkazma hali ham **—**

## 3. Distribyutsiya va yetkazish

Egasi: Sotuv → yangi buyurtma → "Yetkazib berish kerak" belgilansin → Tasdiqlash.

- [ ] Yetkazma avtomatik yaratildi (holati "Tayyor")
- [ ] Sotuvlar ro'yxatida: Sotuv = Tasdiqlangan, Yetkazma = Tayyor

Dostavka agenti bilan kiring (mobil brauzer yoki telefon):

- [ ] Qabul → Yo'lga chiqish → Yetdim → Topshirish → Tasdiqlash
- [ ] Yetkazma = Yetkazildi

**Nasiyaga yetkazish (muhim):** to'lov yig'masdan tasdiqlang.

- [ ] Sotuv = Yakunlangan, To'lov = **To'lanmagan**, Yetkazma = **Yetkazildi** — uchalasi bir vaqtda

## 4. Ishlab chiqarish

- [ ] Non retsepti bo'yicha ishlab chiqarish buyurtmasi → tasdiqlash → boshlash → yakunlash
- [ ] Non qoldig'i oshdi, un va shakar kamaydi
- [ ] **Sotuv, yetkazma va mijoz qarzi yaratilmadi**
- [ ] Nonni kassadan soting → oddiy chek (Yetkazma = —)
- [ ] Nonni yetkazib beriladigan buyurtma bilan soting → yetkazma yaratildi

## 5. Xarid va ta'minotchiga aralash to'lov

- [ ] Ta'minotchidan xarid hujjati → tasdiqlash → qabul qilish → zaxira oshdi
- [ ] Ta'minotchiga to'lov: **naqd + UZCARD + bank** birga
- [ ] Har qism **o'z hisobidan** chiqdi
- [ ] Sotuv, yetkazma va **mijoz qarzi o'zgarmadi**

## 6. Xarajat

- [ ] 500 000 so'mlik xarajat → tasdiqlash
- [ ] To'lov: naqd 100 000 + karta 200 000 + bank 200 000
- [ ] Qismlar yig'indisi summaga teng bo'lmasa — rad etiladi
- [ ] Mijoz qarzi, sotuv va zaxira o'zgarmadi

## 7. Modullar

Egasi → Sozlamalar → Modullar.

- [ ] Moliyani o'chiring → Moliya menyusi yo'qoladi, API 403
- [ ] Qayta yoqing → ma'lumot **joyida** (xarajatlar, hisoblar yo'qolmagan)
- [ ] Xuddi shunday: Xarid, Yetkazma, Ishlab chiqarish, Kassa

## 8. RBAC

Har rol bilan alohida kiring:

- [ ] Kassir — faqat kassa bilan bog'liq joylar
- [ ] Sotuv agenti — faqat Dashboard, Sotuv, Mijozlar, Aksiyalar, Hisobotlar
- [ ] Dostavka agenti — faqat yetkazma ish joyi
- [ ] Buxgalter — Moliya va Buxgalteriya
- [ ] Ruxsat berilmagan sahifaga **to'g'ridan-to'g'ri URL bilan** kirib ko'ring → bloklanishi kerak

## 9. Desktop kassa (BUM POS KASSA)

- [ ] O'rnatuvchini Windows'da ishga tushiring (**imzosiz** — SmartScreen ogohlantiradi)
- [ ] Kirish, mahsulot rasmi, barkod, savat
- [ ] Naqd, UZCARD, HUMO, aralash to'lov
- [ ] **Internetni uzing** → sotuv davom etsin (offline navbat)
- [ ] Internetni ulang → sinxron, **dublikat chek yaratilmasin**
- [ ] Printer va tarozi (mavjud bo'lsa)

## 10. Android

- [ ] APK'ni telefonga o'rnating
- [ ] Sotuv agenti: ish sessiyasi → GPS → mijoz → tashrif → buyurtma
- [ ] Ish sessiyasi **yopiq** bo'lganda GPS yig'ilmasligi
- [ ] Mijozdan uzoqda (200 m dan tashqarida) → ogohlantirish/rad
- [ ] Dostavka agenti: kamera (majburiy bo'lsa), navigatsiya (tashqi xarita ilovasi)

## 11. Real terminal

- [ ] UZCARD/HUMO terminalidan real to'lov qiling
- [ ] Summani kassaga qo'lda kiriting va **bog'langan bank hisobiga** tushganini tekshiring

> Eslatma: terminal bilan **avtomatik** integratsiya yo'q (bank protokoli/kalitlari yo'q).
> Hozircha "manual payment entry only" — kassir chekka qarab summani kiritadi.

---

## Nima qilinmasin

- Production'ga deploy qilinmasin (audit tugadi, lekin ruxsat berilmagan)
- Demo ma'lumotlar production bazasiga yozilmasin — seed skripti buni o'zi bloklaydi
- Production admin paroli hech qayerga yozilmasin

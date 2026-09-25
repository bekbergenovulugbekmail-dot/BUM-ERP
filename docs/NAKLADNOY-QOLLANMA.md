# BUM ERP — Nakladnoy shablonini yaratish va A4da chiqarish

**Amaliy qo'llanma.** Bu yerda faqat tizimda HOZIR ishlaydigan narsalar yozilgan. Biror
imkoniyat yo'q bo'lsa, "**Mavjud emas**" deb ochiq aytilgan.

Kim uchun: kompaniya egasi, administrator, ombor mudiri, dostavka boshqaruvchisi.

---

## Avval bilib qo'ying — eng muhim 4 ta gap

1. **Shablon faqat KO'RINISHni boshqaradi.** Summa, miqdor va qarz tizimdan keladi. Shablonni
   qanday o'zgartirmang, qog'ozdagi pul ERPdagi pul bo'lib qoladi.
2. **Shablon tuzmaguningizcha hech narsa o'zgarmaydi.** Nakladnoy avvalgi ko'rinishda chiqaveradi.
   Yangi ko'rinish siz shablonni **"Standart"** qilganingizdan keyin boshlanadi.
3. **Shablon uchta hujjatda ishlaydi:** yetkazma nakladnoyi, sotuv hisob-fakturasi va xarid
   buyurtmasi. Maosh varaqasi uchun shablon tuzish mumkin va u saqlanadi, lekin o'sha hujjat
   hozircha eski qat'iy ko'rinishda chiqadi.
4. **Chop etish — PDF fayl orqali.** Tugmani bosganingizda brauzerning chop etish oynasi ochilmaydi:
   kompyuterga `nakladnoylar-3-ta.pdf` kabi fayl yuklanadi. Chop etish o'sha faylni ochib qilinadi.

---

## 1. Boshlash

### Qayerga kiriladi

```
Chap menyu → Sozlamalar → yuqoridagi "Hujjatlar" bo'limi
```

"Hujjatlar" — Sozlamalar sahifasining tepasidagi bo'limlar qatorida, "Etiketka" bilan "Keshbek"
orasida turadi.

### Kimga ochiq

| Amal | Kerakli ruxsat |
|---|---|
| Shablonni ko'rish | `Sozlamalarni ko'rish` |
| Yaratish, tahrirlash, standart qilish, arxivlash | `Sozlamalarni boshqarish` |
| Jadvalda "Tannarx" va "Marja" ustunlari | `Tannarxni ko'rish` |

Ruxsati yo'q xodim tannarx ustunini ro'yxatda ham ko'rmaydi.

### Ekran nimalardan iborat

Uchta ustun:

| Chap | O'rta | O'ng |
|---|---|---|
| **Elementlar ro'yxati** — Sarlavha / Asosiy qism / Taglik bo'limlari | **A4 varaq** — jonli ko'rinish | **Tanlangan element sozlamalari** |

**O'rtadagi varaq — haqiqiy PDF.** U namuna ma'lumot bilan chizilgan chinakam hujjat, shuning
uchun "ko'rgan narsangiz" va "bosib chiqqan narsangiz" bir xil bo'ladi.

---

## 2. Yangi shablon yaratish

**1-qadam.** Sozlamalar → Hujjatlar.

**2-qadam.** Yuqoridagi **"Hujjat turi"** ro'yxatidan tanlang:

- **Yetkazma nakladnoyi** ← dostavka uchun shu kerak
- Sotuv hisob-fakturasi
- Xarid buyurtmasi
- Maosh varaqasi

**3-qadam.** **"Yangi"** tugmasini bosing.

**4-qadam.** Nom yozing (masalan `Bonnu nakladnoy`) va **"Yaratish"** ni bosing.

**5-qadam.** Tayyor. Yangi shablon **zavod ko'rinishidan nusxa** bo'lib ochiladi — bo'sh varaq
emas, ya'ni hamma narsani noldan qo'yish shart emas.

> **"Nusxa"** tugmasi ochiq turgan shablondan nusxa oladi. Ishlayotgan nakladnoyni buzmasdan
> tajriba qilmoqchi bo'lsangiz — shu tugma.

**Cheklov:** bitta hujjat turida ko'pi bilan **20 ta** faol shablon.

---

## 3. Logo va muhr (rasm) qo'yish

**1-qadam.** Chap ustunda **"Sarlavha"** bo'limi yonidagi **"+ Rasm"** tugmasini bosing.

**2-qadam.** Ro'yxatda paydo bo'lgan **"Rasm"** qatorini bosing — o'ng ustunda sozlamalari ochiladi.

**3-qadam.** **"Rasm yuklash (PNG, JPEG, WebP)"** tugmasi — faylni tanlang. Tanlangandan keyin
o'sha yerda kichik ko'rinishi chiqadi, yonida **"Almashtirish"** va o'chirish tugmasi turadi.

**4-qadam.** **"Kenglik (mm)"** va **"Balandlik (mm)"** ni yozing. Logo uchun odatda `35 × 18` mm yetarli.

> **"Nisbatni saqlash"** belgilangan turganda kenglikni o'zgartirsangiz balandlik o'zi ergashadi —
> logo cho'zilib ketmaydi. Balandlikni alohida qo'yish kerak bo'lsa belgini olib tashlang.

**5-qadam.** **"Tekislash"** — chapga, markazga yoki o'ngga.

**6-qadam (ixtiyoriy).** **"Katakka joylashuvi"**: `Sig'diriladi` (nisbat saqlanadi, standart)
yoki `Cho'ziladi` (butun katakni to'ldiradi). Pastda ramka ham bor: **chiziq turi**
(to'liq / uzuq / nuqtali / qo'sh), **qalinligi**, **rangi**, **fon** va **burchak radiusi**.

Kompaniya sozlamalarida logotip havolasi saqlangan bo'lsa, **"Kompaniya logotipini olish"**
tugmasi ham chiqadi. U rasmni yuklab olib shablon ichiga ko'chiradi. Tashqi sayt ruxsat
bermasa (bu ko'p uchraydi) xabar chiqadi — bunday holda faylni qurilmangizdan yuklang.

### Qaysi format ishlaydi

| Format | Holat |
|---|---|
| PNG | ✅ ishlaydi |
| JPEG | ✅ ishlaydi |
| WEBP | ✅ ishlaydi |
| **SVG** | ❌ **qabul qilinmaydi** |

SVG nega yo'q: SVG fayl ichida dastur kodi bo'lishi mumkin, shuning uchun tizim uni umuman
qabul qilmaydi. Logoingiz SVG bo'lsa, uni PNG ga o'giring.

### Sifat haqida

Tizim rasmni avtomatik **384 piksel** enigacha kichraytiradi va shablon ichiga joylaydi. Shuning
uchun:

- **Katta fayl yuklashning keragi yo'q** — 400–800 px lik logo yetarli.
- Juda katta rasm yuklasangiz "Rasm juda katta — kichikroq fayl tanlang" degan xabar chiqadi.
- Logoni **fon shaffof emas, oq fonda** tayyorlasangiz qog'ozda toza chiqadi (tizim shaffof
  joyni oq bilan to'ldiradi).

**Muhr yoki imzo rasmi** ham xuddi shunday qo'yiladi — faqat uni "Taglik" bo'limiga qo'ying.

---

## 4. QR kod qo'yish

**1-qadam.** Kerakli bo'lim yonidagi **"+ QR kod"** tugmasi (odatda "Taglik").

**2-qadam.** Ro'yxatdan **"QR kod"** qatorini bosing.

**3-qadam.** O'ng ustundagi **"Nima kodlanadi"** ro'yxatidan tanlang:

- **Hujjat raqami** — nakladnoy raqami (`DL-2026-0005`)
- **Buyurtma raqami** — sotuv buyurtmasi raqami (`SO-2026-0004`)
- **Mijoz telefoni**

### Nega faqat shu uchtasi

QR ichiga **ixtiyoriy havola yozib bo'lmaydi** — bu ataylab shunday qilingan. Aks holda
kimdir shablonga begona havola yozib qo'ysa, qog'ozni skanerlagan odam boshqa saytga tushib
qolardi. Shuning uchun QR faqat tizimning o'z ma'lumotidan to'ldiriladi.

### O'lcham va joy

QR kvadrat bo'ladi; o'lchami **"O'lcham (mm)"** dan olinadi (standart 22 mm). Qog'ozda yaxshi
skanerlanishi uchun **20 mm dan kichik qilmang**. Tekislashni ham shu yerdan tanlaysiz.

Yana ikkita sozlama bor:

- **"Xatolikka chidamlilik"** — `L` (7%), `M` (15%, standart), `Q` (25%), `H` (30%).
  Qog'oz bujmayadigan yoki muhr tushadigan joyda `H` ni tanlang: kodning bir qismi
  ko'rinmay qolsa ham o'qiladi. Evaziga naqsh zichroq bo'ladi.
- **"Chekka (modul)"** — QR atrofidagi oq hoshiya. Ramka yoki chiziq yaqinida `2` qo'ying.

**"Kod ostidagi yozuv"** maydoniga matn yozsangiz (masalan `Tekshirish kodi`), u QR ostida
kichik harflarda chiqadi.

> **Eslatma:** agar tanlangan manba bo'sh bo'lsa (masalan, yetkazmada buyurtma raqami yo'q),
> QR jimgina chizilmaydi — hujjat baribir chiqadi.

---

## 5. Shtrix-kod qo'yish

**1-qadam.** **"+ Shtrix-kod"** tugmasi.

**2-qadam.** Ro'yxatdan **"Shtrix-kod"** ni tanlang.

**3-qadam.** **"Nima kodlanadi"** — QR dagi bilan bir xil uchta manba.

**Formati:** CODE128 (raqam va harfni qamraydi, nakladnoy raqami uchun to'g'ri keladi).

**O'lchami:** standart `50 × 14` mm. Skaner yaxshi o'qishi uchun enini **40 mm dan kam qilmang**.

**Qayerga qo'yish yaxshi:**

- Sarlavhaga, hujjat raqami yonida — ombor kirish/chiqishda tez skanerlash uchun
- Yoki taglikka — qog'oz arxivlanganda

---

## 6. Matn va maydonlarni joylashtirish

Ikki xil element bor va farqini tushunish MUHIM:

| Element | Nima qiladi | Misol |
|---|---|---|
| **Matn** | Siz yozgan qat'iy yozuv. Hech qachon o'zgarmaydi | `YETKAZMA NAKLADNOYI`, `Qabul qildim:` |
| **Maydon** | Tizimdan keladigan QIYMAT | Mijoz nomi, sana, jami summa |

**Maydon qo'shish:**

1. **"+ Maydon"** tugmasi
2. Ro'yxatdan yangi qatorni bosing
3. O'ngdagi **"Qiymat"** ro'yxatidan kerakli maydonni tanlang
4. **"Matn / yorliq"** ga yozuv yozing — qog'ozda `Mijoz: Test Market` bo'lib chiqadi

**Uslub:** Shrift o'lchami, **Qalin** belgisi va **Tekislash** (chapga / markazga / o'ngga)
o'ng ustunda sozlanadi.

### Yetkazma nakladnoyida ISHLAYDIGAN maydonlar

Ro'yxatda ko'rinadigan, lekin yetkazma nakladnoyida **bo'sh chiqadigan** maydonlar ham bor.
Quyidagi jadval — aniq holat:

| Maydon | Yetkazma nakladnoyida |
|---|---|
| Kompaniya nomi, Yuridik nomi, STIR, Manzil, Telefon | ✅ to'ladi |
| Hujjat raqami, Sana | ✅ to'ladi |
| Mijoz nomi, Mijoz telefoni, Mijoz manzili | ✅ to'ladi |
| Yetkazuvchi | ✅ to'ladi |
| Mas'ul shaxs | ✅ to'ladi (nakladnoyni chiqargan xodim) |
| Ombor | ✅ to'ladi |
| **Jami** | ✅ to'ladi |
| **Qarz** | ✅ to'ladi |
| Hujjatni yaratgan, Chop etilgan vaqt | ✅ to'ladi |
| Izoh | ⬜ hozircha bo'sh |
| Yetkazuvchi telefoni | ⬜ hozircha bo'sh |
| Oraliq summa, Chegirma, Soliq, To'langan | ⬜ **bo'sh** — yetkazma hujjatida bu qiymatlar yo'q |

Bo'sh maydonni qo'ysangiz qog'ozda faqat yorliq (`Chegirma:`) ko'rinadi — shuning uchun
ularni qo'ymagan ma'qul.

---

## 7. Mahsulot jadvali

Eng muhim element. **"+ Jadval"** tugmasi bilan qo'shiladi.

### Ustunlarni tanlash

O'ng ustunda ikkita ro'yxat bor:

1. **Yuqorida — tanlangan ustunlar**: tartibi (↑ ↓ strelkalar) va kengligi (mm)
2. **Pastda — "Qo'shish / olib tashlash"**: belgilash katakchalari

Ustun **tartibi** qog'ozdagi tartib bilan aynan bir xil: ro'yxatda yuqorida turgan ustun
qog'ozda chap tomonda bo'ladi.

### Yetkazma nakladnoyida qaysi ustun to'ladi

Har bir qator — buyurtmadagi **bitta mahsulot**. Mijoz ustunlari har qatorda takrorlanadi,
chunki nakladnoy bitta mijozga tegishli: shu bilan ikkala turdagi ustunni ham tanlay olasiz.

| Ustun | Yetkazma nakladnoyida |
|---|---|
| № | ✅ avtomatik raqamlanadi |
| **Mahsulot** (`name`), **SKU**, **Birlik**, **Miqdor**, **Narx**, **Summa** | ✅ to'ladi |
| **Mijoz**, **Telefon**, **Manzil**, **Qarz** | ✅ to'ladi (har qatorda bir xil) |
| Chegirma | ❌ bo'sh — yetkazmada qator chegirmasi yuritilmaydi |
| Shtrix-kod | ❌ bo'sh |
| Tannarx, Marja | ruxsat bo'lsa to'ladi (`Mahsulot: tannarxni ko'rish`) |

> Buyurtmada mahsulot qatori bo'lmasa (eski yozuvlar) jadval bitta yig'ma qatorga tushadi —
> mijoz nomi va umumiy summa bilan.

### Ustun kengligi — A4 ga sig'adigan misol

A4 portret sahifada chap va o'ng chekinishdan keyin **taxminan 182 mm** ishchi joy qoladi.
Yetkazma nakladnoyi uchun ishlaydigan taqsimot:

| Ustun | Kenglik |
|---|---|
| № | 10 mm |
| Mijoz | 55 mm |
| Telefon | 30 mm |
| Manzil | 47 mm |
| Summa | 20 mm |
| Qarz | 20 mm |
| **Jami** | **182 mm** |

> Bu **majburiy qiymat emas** — A4 ga sig'adigan namuna, xolos. Kenglikni umuman yozmasangiz
> ham bo'ladi: tizim ustunlarni o'zi taqsimlaydi. Kenglikni faqat biror ustun torlik qilsa yozing.

Kenglik maydonini bo'shatib qo'ysangiz — o'sha ustun yana avtomatik taqsimotga qaytadi.

**Cheklov:** bitta jadvalda ko'pi bilan **12 ta** ustun.

### Ustun nomini o'zgartirish

Har ustun qatorida nom maydoni bor. Bo'sh qoldirsangiz tizimning o'z nomi chiqadi
(`Mijoz`, `Summa`), o'zingiz yozsangiz — qog'ozda aynan shu yozuv turadi (`Do'kon nomi`).

### Jadval chiziqlari

Ustunlar ro'yxati ostida **"Jadval chiziqlari"** bo'limi bor. Har chiziq ALOHIDA boshqariladi:

| Sozlama | Nima qiladi |
|---|---|
| **Chiziq turi** | To'liq · Uzuq · Nuqtali · Qo'sh |
| **Qalinlik (mm)** | `0` — chiziq umuman chizilmaydi; standart `0.2` |
| **Tashqi ramka** | To'rt tomonni birdan yoqadi/o'chiradi |
| **Yuqori · Past · Chap · O'ng** | Har tomonni alohida |
| **Gorizontal** | Qatorlar orasidagi chiziqlar |
| **Vertikal** | Ustunlar orasidagi chiziqlar |
| **Sarlavha chizig'i** | Sarlavha ostidagi chiziq |
| **Chiziq rangi** | Ranglar oynasidan |

Masalan "faqat gorizontal chiziqli, ochiq ko'rinish" uchun: **Vertikal** va **Tashqi ramka**
ni o'chiring, **Gorizontal** ni qoldiring.

### Kataklar

| Sozlama | Nima qiladi |
|---|---|
| **Bo'shliq X / Y (mm)** | Katak ichidagi chekinish |
| **Qator balandligi (mm)** | Eng kam balandlik (bo'sh — matnga qarab) |
| **Shrift (pt)** | Jadval matni (standart 8.5) |
| **Vertikal tekislash** | Matn katak ichida yuqorida / o'rtada / pastda |
| **Navbatma-navbat fon** | Juft qatorlarni ochiq rang bilan bo'yash |
| **Sarlavha foni / matni** | Sarlavha qatorining rangi |

> Bu sozlamalarning hech biri SUMMAGA tegmaydi — faqat ko'rinish. Qiymatlar hujjatdan keladi.

---

## 8. Jami bloki va imzo

### Jami bloki

**"+ Jami bloki"** → o'ngda **"Qatorlar"** ro'yxatidan keraklisini belgilang:

`subtotal` (oraliq summa) · `discount` (chegirma) · `tax` (soliq) · `total` (jami) ·
`paid` (to'langan) · `debt` (qarz)

Yetkazma nakladnoyida **`total` va `debt`** ishlaydi; qolganlari bo'sh bo'lgani uchun qog'ozda
umuman chizilmaydi (bo'sh qator qoldirmaydi).

### Imzo

**"+ Imzo"** → **"Imzo yorliqlari"** maydoniga ikkita yorliqni **`|` belgisi bilan** yozing:

```
Topshirdi|Qabul qildi
```

yoki

```
Dostavshik|Do'kon egasi
```

Qog'ozda har yorliq uchun bitta imzo chizig'i va tagida yozuv chiqadi. **To'rttagacha**
yorliq yozish mumkin (`Dostavshik|Ombor|Buxgalter|Do'kon egasi`) — chiziqlar kenglikka
teng bo'linadi.

**"Blok balandligi (mm)"** — chiziq ustidagi bo'sh joy, ya'ni qo'l bilan imzo qo'yiladigan joy.
Standart `22` mm. Kamaytirsangiz nakladnoy ixchamlashadi va bitta A4 ga ko'proq sig'adi;
oshirsangiz imzo uchun ko'proq joy qoladi. Chegara: `12`–`70` mm.

---

## 8a. Chiziq, to'rtburchak va nusxalash

**"+ Chiziq"** — ajratuvchi chiziq. Sozlamalari: **uzunlik (mm)** (bo'sh — butun kenglik),
**tekislash**, **chiziq turi** (to'liq / uzuq / nuqtali), **qalinlik** va **rang**.

**"+ To'rtburchak"** — ramka yoki bo'yalgan quti (izoh joyi, qo'lda to'ldiriladigan katak).
Sozlamalari: **kenglik**, **balandlik**, **tekislash**, ramka (**turi**, **qalinligi**,
**rangi**), **burchak radiusi** va **fon**. Ichiga yozuv ham qo'yish mumkin — **"Matn / yorliq"**.

> **Vertikal chiziq** alohida element sifatida mavjud emas. Kerak bo'lsa to'rtburchakdan
> foydalaning: kengligi `0.3` mm, balandligi kerakli qiymat.

**Nusxalash.** Elementlar ro'yxatidagi har qatorda ikkita varaq belgisi bor — u elementni
barcha sozlamalari bilan **aynan nusxalaydi** va yoniga qo'yadi. Bir xil ko'rinishdagi ikkinchi
matn yoki ramka kerak bo'lganda qulay.

**Tartib.** ↑ va ↓ strelkalari elementni bo'lim ichida yuqoriga/pastga suradi. Qog'ozda
elementlar aynan shu tartibda, yuqoridan pastga chiziladi — ular bir-birining ustiga
tushmaydi, shuning uchun "qatlam" (z-index) sozlamasi **mavjud emas**.

---

## 9. Sahifa raqami va ko'p sahifali nakladnoy

**"+ Sahifa raqami"** tugmasi (odatda "Taglik" bo'limiga).

Qog'ozda `1 / 3`, `2 / 3`, `3 / 3` ko'rinishida chiqadi — jami sahifa soni bilan.

### Ro'yxat uzun bo'lsa nima bo'ladi

Jadval bitta sahifaga sig'masa, tizim buni **o'zi** hal qiladi:

- Jadval keyingi sahifaga davom etadi
- **Jadval sarlavhasi (ustun nomlari) har sahifada takrorlanadi** — qaysi ustun ekani chalkashmaydi
- **Kompaniya sarlavhasi ham har sahifada** qayta chiziladi
- Qator sahifa chetida ikkiga bo'linmaydi (matn kesilmaydi)
- Jami va imzo bloki chetdan chiqib ketmaydi — joy yetmasa yangi sahifaga o'tadi
- Sahifa raqami har sahifada to'g'ri chiqadi

Ya'ni 50 yoki 100 qatorli hujjatda ham qo'shimcha sozlash **shart emas**.

---

## 10. Saqlash, tekshirish va "Standart" qilish

### Saqlash

**"Saqlash"** tugmasi. Har saqlash — **yangi versiya**. Eski versiya o'chmaydi.

> Tugma faqat o'zgarish kiritganingizda yonadi. `2-versiya saqlandi` degan xabar chiqadi.

### Versiyalar va orqaga qaytish

**"Versiyalar"** tugmasi tarixni ochadi. Har qatorda versiya raqami, izoh va sana bor.

**"Qaytarish"** — o'sha versiyaning ko'rinishini qaytaradi. Diqqat: bu eski yozuvni tiklash
emas, **yangi versiya** yasaydi (masalan 3-versiya = 1-versiyaning nusxasi). Shuning uchun tarix
uzilmaydi va istalgan vaqtda yana oldinga qaytish mumkin.

### "Standart" qilishdan OLDIN nimani tekshirish kerak

O'rtadagi A4 varaqqa qarab ro'yxat bo'yicha yuring:

- [ ] Logo joyida va o'lchami to'g'ri
- [ ] Kompaniya nomi to'g'ri
- [ ] Hujjat nomi (`YETKAZMA NAKLADNOYI`) bor
- [ ] Nakladnoy raqami va sana bor
- [ ] Mijoz, telefon, manzil bor
- [ ] Yetkazuvchi va mas'ul shaxs bor
- [ ] Jadval ustunlari kerakligicha va **A4 dan chiqib ketmagan**
- [ ] Jami va qarz to'g'ri joyda
- [ ] QR / shtrix-kod chizilgan
- [ ] Imzo joylari bor
- [ ] Sahifa raqami bor
- [ ] Hech qayerda bo'sh yorliq (`Chegirma:` kabi) qolmagan

### Standart qilish

**"Standart"** tugmasi. `Standart qilindi` xabari chiqadi.

- Bitta hujjat turida **faqat bitta** standart shablon bo'ladi. Yangisini standart qilsangiz,
  eskisi avtomatik standart bo'lmay qoladi.
- **Standart shablonni arxivlab bo'lmaydi** — avval boshqasini standart qiling.

### Standart shablon ESKI hujjatlarga qanday ta'sir qiladi

Aniq javob: **hujjat chiqarilayotgan PAYTDAGI standart shablon ishlatiladi.**

Tizim "bu nakladnoy falon shablon bilan chiqarilgan" deb hech narsa saqlamaydi. Ya'ni:

- Kecha chiqarilgan nakladnoyni bugun **qayta chiqarsangiz — yangi ko'rinishda** chiqadi.
- Allaqachon **bosib chiqarilgan qog'oz** albatta o'zgarmaydi.
- Hujjatdagi **summalar hech qachon o'zgarmaydi** — ular sotuv va yetkazma ma'lumotidan keladi.

### Qaysi hujjat qayerdan chiqadi

| Hujjat turi | Qayerdan chiqariladi | Shablon ishlaydimi |
|---|---|---|
| **Yetkazma nakladnoyi** | Dostavka → Yetkazmalar → belgilang → "Nakladnoy (N)" | ✅ ha |
| **Sotuv hisob-fakturasi** | Sotuv → buyurtmani oching → **"Hisob-faktura"** tugmasi | ✅ ha |
| **Xarid buyurtmasi** | Xarid → buyurtmani oching → **"PDF"** tugmasi | ✅ ha |
| Maosh varaqasi | Xodimlar → Maosh | ❌ hali ulanmagan |

Har uchala ishlaydigan hujjatda qoida bir xil: **shablon "Standart" qilingan bo'lsa** — u
bo'yicha chiqadi, aks holda avvalgi qat'iy ko'rinishda.

### Hisob-faktura va xarid shabloni nimasi bilan farq qiladi

Yetkazma nakladnoyida jadval qatori — mijoz; bu ikkalasida esa **mahsulot**. Shuning uchun
bu yerda `Mahsulot`, `SKU`, `Birlik`, `Miqdor`, `Narx`, `Summa` ustunlari **to'ladi**.

| Maydon | Hisob-faktura | Xarid buyurtmasi |
|---|---|---|
| Mijoz nomi / telefoni / manzili | ✅ | ❌ (mijoz yo'q) |
| Ta'minotchi / Ta'minotchi telefoni | ❌ | ✅ |
| Oraliq summa, Chegirma, Soliq | ✅ | ❌ |
| Jami, To'langan, Qarz | ✅ | ✅ |
| Jadvaldagi `Chegirma` ustuni | ✅ | ❌ |

---

## 11. Dostavkadan real nakladnoy chiqarish

### To'liq yo'l

**1-qadam.** Chap menyu → **Dostavka**.

**2-qadam.** Yuqoridagi **"Yetkazmalar"** bo'limi.

**3-qadam.** Kerakli yetkazmalarni toping. Filtrlar: `Sanadan`, `Sanagacha`, `Holat`,
`Yetkazuvchi`, hamda `Biriktirilmagan`, `Kechikkan`, `To'lov farqi`, `Tovar qaytarilmagan`.

**4-qadam.** Chap ustundagi **katakchani belgilang**.

- Bitta yetkazma — bitta katakcha
- Bir nechtasi — bir nechta katakcha
- **Hammasini** — jadval sarlavhasidagi katakcha

> **Bekor qilingan va yakunlangan yetkazmalarning katakchasi o'chiq** — ular nakladnoyga
> tushmaydi. Nakladnoy faqat **yo'lga chiqayotgan** yetkazmalar uchun.

**5-qadam.** Tugma yonidagi ro'yxatdan qog'oz rejimini tanlang:

| Rejim | Nima bo'ladi |
|---|---|
| **Aqlli A4 (sig'gani birga)** | Bir varaqqa sig'adigancha nakladnoy joylashtiriladi (standart) |
| **Har biri alohida varaq** | Har nakladnoy o'z sahifasida — avvalgi xulq |

Tanlov brauzerda eslab qolinadi.

**6-qadam.** **"Nakladnoy (3)"** tugmasini bosing — qavs ichida nechta belgilaganingiz turadi.

**7-qadam.** Kompyuterga `nakladnoylar-3-ta.pdf` fayli yuklanadi.

### "Aqlli A4" qanday hisoblaydi

Tizim har nakladnoyni AVVAL chizib ko'radi va haqiqiy balandligini o'lchaydi, keyin A4 ning
ishchi maydoniga (chekinishlardan keyin ~267 mm) sig'adimi-yo'qmi deb qaraydi:

```
Nakladnoy A = 115 mm
Nakladnoy B = 115 mm
A + ajratgich + B = 240 mm  →  IKKALASI BITTA A4 DA
```

Qoidalar:

- Nakladnoy **hech qachon o'rtasidan bo'linmaydi** — sig'masa butunlay keyingi varaqqa o'tadi.
- **Kichraytirish yo'q** — shrift o'zgarmaydi, o'qilishi muhimroq.
- Tanlagan **tartibingiz saqlanadi** — qayta saralanmaydi.
- Juda uzun nakladnoy (50+ qator) o'z sahifasidan boshlanadi va o'zi bir necha varaqqa cho'ziladi.

Nakladnoylar orasida **uzuq chiziq** turadi — qayerdan qirqishni shu chiziq ko'rsatadi.

Qisqa nakladnoylarda odatda bir varaqqa **ikkitadan** tushadi; shablonni ixchamlashtirsangiz
(imzo blokining balandligini kamaytirish, ortiqcha maydonlarni olib tashlash) uchtasi ham sig'adi.

### Tugma o'chiq bo'lsa

Tugma ustiga sichqonchani olib borsangiz sababi yoziladi:

> "Yetkazmalarni belgilang yoki agent va bitta kunni tanlang"

### Ikkinchi yo'l — agentning kunlik nakladnoyi

Hech narsa belgilamasdan **Yetkazuvchi** va **bitta kun** (Sanadan = Sanagacha) filtrini
qo'ysangiz, "Nakladnoy" tugmasi o'sha agentning kunlik yig'ma nakladnoyini chiqaradi.

⚠️ **Muhim farq:** bu yo'l **eski qat'iy ko'rinishda** chiqadi — sizning shabloningiz bu yerda
ishlatilmaydi. Shablon faqat **belgilangan yetkazmalar** yo'lida ishlaydi.

### Chop etish yetkazmaga ta'sir qiladimi

**Yo'q.** Nakladnoy chiqarish yetkazma holatini o'zgartirmaydi — buni server ham kafolatlaydi.
Istalgancha marta qayta chiqarish mumkin.

---

## 12. Printerda chiqarish (Windows)

Tizim PDF fayl beradi, shuning uchun chop etish **PDF ko'ruvchida** qilinadi.

**1-qadam.** Yuklangan `nakladnoylar-3-ta.pdf` faylini oching (odatda Chrome yoki Edge o'zi ochadi).

**2-qadam.** `Ctrl + P` bosing yoki printer belgisini bosing.

**3-qadam.** Sozlamalar:

| Sozlama | Qiymat |
|---|---|
| **Printer** | O'z printeringiz |
| **Paper size / Qog'oz** | **A4** |
| **Orientation / Yo'nalish** | **Portrait (Bo'yiga)** |
| **Scale / Masshtab** | **100%** yoki **Actual size** |
| **Pages per sheet** | **1** |
| **Margins / Chekinish** | **Default** |

**4-qadam.** "Print" ni bosing.

### ⚠️ Eng ko'p uchraydigan xato — Scale

Chrome PDF ko'ruvchisida standart **"Fit to page"** turadi. U hujjatni biroz kichraytiradi:
chekinishlar kengayadi, shrift maydalashadi va qog'oz "o'zgargandek" tuyuladi.

**Yechim:** Scale ni **100% / Actual size** qiling. Hujjat allaqachon aniq A4 o'lchamida
chizilgan — kichraytirish kerak emas.

> **Eslatma:** "Headers and footers" va "Background graphics" sozlamalari brauzer sahifasini
> chop etishda kerak bo'ladi. Bizda PDF chop etilyapti, shuning uchun ular **ta'sir qilmaydi**.

---

## 13. PDF qilib saqlash va yuborish

Fayl allaqachon PDF — uni shunchaki saqlab qo'yish kifoya.

**Yuklanmalar (Downloads) papkasidan oling** yoki PDF ko'ruvchida `Ctrl + S` bosing.

Yuborish:

| Qayerga | Qanday |
|---|---|
| **Telegram** | Suhbatga faylni sudrab tashlang yoki 📎 → Fayl |
| **WhatsApp** | 📎 → Hujjat (Document) → faylni tanlang |
| **Email** | Xatga biriktiring |

Faylni qayta nomlash mumkin — masalan `Bonnu-nakladnoy-25-09.pdf`.

---

## 14. Muammolar va yechimlari

### 1. Logo chiqmayapti

| | |
|---|---|
| **Sabab** | Fayl SVG bo'lishi mumkin, yoki rasm juda katta, yoki element "Taglik"ka tushib qolgan |
| **Tekshirish** | O'ng ustunda rasmning kichik ko'rinishi bormi? Xato xabari chiqdimi? |
| **Yechim** | Faylni PNG ga o'giring; 400–800 px logo oling; elementni "Sarlavha" bo'limiga ko'chiring |

### 2. QR chiqmayapti

| | |
|---|---|
| **Sabab** | Tanlangan manba bo'sh. Masalan "Buyurtma raqami" tanlangan, lekin yetkazmada buyurtma yo'q |
| **Tekshirish** | O'ng ustunda "Nima kodlanadi" nima turibdi? |
| **Yechim** | **"Hujjat raqami"** ga o'tkazing — u har doim to'ladi |

### 3. Shtrix-kod chiqmayapti

Sabab va yechim QR bilan bir xil. Qo'shimcha: eni **40 mm dan kichik** bo'lsa skaner o'qimasligi
mumkin — kengaytiring.

### 4. Jadval A4 dan chiqib ketdi

| | |
|---|---|
| **Sabab** | Ustun kengliklari yig'indisi 182 mm dan oshgan, yoki ustun juda ko'p |
| **Tekshirish** | O'rtadagi A4 varaqqa qarang — jadval o'ng chetdan chiqib ketganmi? |
| **Yechim** | Kerak bo'lmagan ustunni olib tashlang; kengliklarni yig'indisi 182 mm dan oshmasin; yoki kenglik maydonlarini umuman bo'shatib qo'ying — tizim o'zi taqsimlaydi |

### 5. Mahsulot nomi kesilib qoldi

| | |
|---|---|
| **Sabab** | O'sha ustun torlik qilyapti |
| **Yechim** | Ustun kengligini oshiring (boshqasidan kamaytirib). Tizim uzun matnni keyingi qatorga o'tkazadi, lekin ustun juda tor bo'lsa chiroyli chiqmaydi |

### 6. 2-sahifada jadval noto'g'ri

Odatda **muammo emas**: ustun nomlari va kompaniya sarlavhasi har sahifada ataylab takrorlanadi.
Agar haqiqatan buzuq chiqsa — Scale **100%** ekanini tekshiring (14-bo'limning 8-bandiga qarang).

### 7. Sahifa raqami noto'g'ri yoki yo'q

| | |
|---|---|
| **Sabab** | "Sahifa raqami" elementi qo'shilmagan |
| **Yechim** | "+ Sahifa raqami" tugmasi bilan qo'shing, keyin **Saqlang** |

### 8. PDF va printer natijasi farq qiladi

| | |
|---|---|
| **Sabab** | Printer sozlamasida **Scale = Fit to page** turibdi |
| **Yechim** | **100% / Actual size** ga o'tkazing va qog'oz **A4** ekanini tekshiring |

### 9. Shablon saqlangan, lekin nakladnoy eski ko'rinishda

Eng ko'p uchraydigan holat. Uchta sababdan biri:

| Sabab | Yechim |
|---|---|
| Shablon **"Standart" qilinmagan** | Sozlamalar → Hujjatlar → shablonni tanlang → **"Standart"** |
| **Agentning kunlik nakladnoyi** yo'li ishlatilgan (hech narsa belgilanmagan) | Yetkazmalarni **belgilab**, keyin "Nakladnoy (N)" ni bosing |
| Shablon **boshqa hujjat turida** yaratilgan | "Hujjat turi" **Yetkazma nakladnoyi** ekanini tekshiring |

### 10. Standart shablon umuman ishlamayapti

| | |
|---|---|
| **Tekshirish** | Shablon ro'yxatida nomi yonida "**· standart**" yozuvi bormi? |
| **Yechim** | Yo'q bo'lsa — "Standart" tugmasini bosing. Bor bo'lsa, brauzerni yangilang (`Ctrl + F5`) |
| **Eslatma** | Sotuv hisob-fakturasi, xarid buyurtmasi va maosh varaqasi hozircha shablonni **ishlatmaydi** — ular eski ko'rinishda chiqadi. Bu xato emas, hali ulanmagan |

---

## 15. Tayyor namuna — BONNU MARKET nakladnoyi

Quyidagi tartib **faqat mavjud maydonlardan** tuzilgan va A4 ga sig'adi.

### SARLAVHA bo'limi

| Element | Sozlamasi |
|---|---|
| Rasm | Logo, 35 × 18 mm, chapga |
| Matn | `YETKAZMA NAKLADNOYI` — shrift 16, **Qalin**, markazga |
| Maydon | Kompaniya nomi — shrift 11, Qalin |
| Maydon | STIR — yorliq `STIR` |
| Maydon | Hujjat raqami — yorliq `Nakladnoy №` |
| Maydon | Sana — yorliq `Sana` |

### ASOSIY QISM bo'limi

| Element | Sozlamasi |
|---|---|
| Maydon | Mijoz nomi — yorliq `Mijoz` |
| Maydon | Mijoz telefoni — yorliq `Telefon` |
| Maydon | Mijoz manzili — yorliq `Manzil` |
| Maydon | Yetkazuvchi — yorliq `Dostavshik` |
| Maydon | Ombor — yorliq `Ombor` |
| **Jadval** | Ustunlar: **№ (10) · Mijoz (55) · Telefon (30) · Manzil (47) · Summa (20) · Qarz (20)** |
| Jami bloki | Qatorlar: **`total`**, **`debt`** |

### TAGLIK bo'limi

| Element | Sozlamasi |
|---|---|
| Chiziq | — |
| QR kod | Manba: **Hujjat raqami**, eni 22 mm |
| Shtrix-kod | Manba: **Hujjat raqami**, 50 × 14 mm |
| Imzo | `Topshirdi\|Qabul qildi` |
| Maydon | Mas'ul shaxs — yorliq `Mas'ul shaxs` |
| Sahifa raqami | O'ngga, shrift 8 |

### Qog'ozda qanday ko'rinadi

```
┌──────────────────────────────────────────────────────────┐
│ [LOGO]        YETKAZMA NAKLADNOYI                        │
│ BONNU MARKET                                             │
│ STIR: 301234567                                          │
│ Nakladnoy №: DL-2026-0005      Sana: 2026-09-25          │
├──────────────────────────────────────────────────────────┤
│ Mijoz: Test Market                                       │
│ Telefon: +998 90 000 00 00                               │
│ Manzil: Urganch sh., Bozor ko'chasi 5                    │
│ Dostavshik: Raxmatov Rasul                               │
│ Ombor: Asosiy ombor                                      │
│                                                          │
│ ┌────┬──────────┬───────────┬─────────┬───────┬────────┐ │
│ │ №  │ Mijoz    │ Telefon   │ Manzil  │ Summa │ Qarz   │ │
│ ├────┼──────────┼───────────┼─────────┼───────┼────────┤ │
│ │ 1  │ Test M.  │ +99890... │ Bozor 5 │ 42200 │      0 │ │
│ └────┴──────────┴───────────┴─────────┴───────┴────────┘ │
│                                    Jami:      42 200 so'm│
│                                    Qarz:           0 so'm│
├──────────────────────────────────────────────────────────┤
│ [QR]   [||||||||||]                                      │
│                                                          │
│ ___________________          ___________________         │
│ Topshirdi                    Qabul qildi                 │
│ Mas'ul shaxs: Xamdam Allaberganov                 1 / 1  │
└──────────────────────────────────────────────────────────┘
```

---

## 16. Tezkor qo'llanma — 5 qadam

```
1. Sozlamalar → Hujjatlar → Hujjat turi: "Yetkazma nakladnoyi"

2. "Yangi" → nom yozing → "Yaratish"

3. Logo, QR va jadval ustunlarini joylashtiring
   (o'rtadagi A4 varaq darhol o'zgaradi)

4. "Saqlash" → tekshiring → "Standart"

5. Dostavka → Yetkazmalar → katakchalarni belgilang → "Nakladnoy (N)"
   → PDF yuklanadi → Ctrl+P → A4, Scale 100% → Print
```

---

## Ilova — hozircha MAVJUD EMAS

Chalkashmaslik uchun ochiq ro'yxat:

| Imkoniyat | Holat |
|---|---|
| Sahifa chekinishi (margin) va yo'nalishni (portret/albom) oynadan sozlash | ❌ Mavjud emas — hamma hujjat A4 portret |
| Elementlarni sichqoncha bilan sudrab ko'chirish | ❌ Mavjud emas — tartib ↑ ↓ strelkalar bilan |
| Elementni sahifaning aniq nuqtasiga (X, Y) qo'yish | ❌ Mavjud emas — elementlar ketma-ket joylashadi |
| Haqiqiy hujjat ma'lumoti bilan oldindan ko'rish | ❌ Mavjud emas — faqat namuna ma'lumot |
| Shablonni fayl qilib chiqarish / yuklash (eksport/import) | ❌ Mavjud emas |
| Shablonni butunlay o'chirish | ❌ Mavjud emas — faqat **arxivlash** (ataylab: tarix saqlanadi) |
| "To'lovlar" va "Bo'sh joy" elementlari | ❌ Oynadan qo'shib bo'lmaydi |
| Ikkitadan ortiq imzo joyi | ❌ Mavjud emas — hozircha ikkita |
| Maosh varaqasini shablon bilan chiqarish | ❌ Shablon saqlanadi, lekin hujjat hali eski ko'rinishda chiqadi |
| Agentning kunlik nakladnoyini shablon bilan chiqarish | ❌ U eski qat'iy ko'rinishda |
| Brauzerning chop etish oynasi | ❌ Ishlatilmaydi — hujjat PDF fayl bo'lib yuklanadi |

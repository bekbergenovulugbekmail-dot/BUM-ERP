# Hujjat dizayneri — audit va arxitektura

> Maqsad: foydalanuvchi nakladnoy va boshqa hujjatlarni Word'ga o'xshab, kodchisiz tahrir
> qila olsin. Hujjat KO'RINISHINI boshqaradi — ERP'dagi moliyaviy haqiqatni EMAS.

| | |
|---|---|
| Boshlandi | 2026-09-24 |
| Holat | 1–6-bosqich ✅ — hammasi bajarildi |
| Production deploy | 2026-09-24: egasining so'rovi bilan chiqarildi (`bum-api` + `bum-web`) |

---

## 1. CURRENT DOCUMENT ARCHITECTURE (audit)

Hammasi kod o'qib aniqlangan (**OBSERVED**), manbalar ko'rsatilgan.

### 1.1 Hujjat qayerda yasaladi

**Faqat BRAUZERDA.** Serverda PDF yaratish YO'Q — `apps/api/src` bo'yicha `pdf` so'zi
faqat `files.service.ts` da uchraydi va u yuklangan fayl turini tekshirish uchun
(`application/pdf`, `%PDF-` imzosi). Ya'ni hujjat generatsiyasi 100% mijoz tomonda.

**Texnologiya:** `jsPDF` + `jspdf-autotable`. HTML→PDF yo'q, `@media print` YO'Q,
`window.print()` YO'Q (butun `src` bo'yicha bitta ham topilmadi). Ya'ni "brauzer chop etish"
yo'li umuman qurilmagan — hamma narsa PDF orqali.

### 1.2 Fayllar xaritasi

| Fayl | Vazifasi |
|---|---|
| `src/lib/pdf/pdf-utils.ts` | **Umumiy dvigatel**: A4 o'lchovlari, ranglar, kompaniya sarlavhasi, jadval sozlamalari, jami qutisi, imzo, izoh, footer, sahifa bo'linishi (`ensureSpace`) |
| `src/lib/pdf/delivery-waybill-pdf.ts` | Yetkazma nakladnoyi (bitta va ko'plab — har biri alohida A4) |
| `src/lib/pdf/invoice-pdf.ts` | Sotuv hisob-fakturasi |
| `src/lib/pdf/purchase-order-pdf.ts` | Xarid buyurtmasi |
| `src/lib/pdf/payslip-pdf.ts` | Maosh varaqasi |
| `src/lib/pdf/receipt-pdf.ts` | Kassa cheki (termal, 80 mm) |
| `src/lib/pdf/unicode-font.ts` | **YANGI** — kirill uchun unicode shrift |
| `src/lib/pdf/a4-documents.test.ts` | A4 regressiya testlari (13) |

### 1.3 Umumiy dvigatel (qayta ishlatiladi, dublikat qilinmaydi)

`pdf-utils.ts` allaqachon universal qatlam:

- `A4` — 210×297 mm, `marginX: 14`, `headerHeight: 46`, `footerHeight: 16`
- `createDocument()` — hujjat yaratishning YAGONA yo'li (yangi)
- `drawCompanyHeader`, `tableOptions`, `drawTotalsBox`, `drawSignatures`, `drawNotes`,
  `drawInfoBox`, `drawFooter`, `drawStatusBadge`
- `ensureSpace` — blok sig'masa yangi sahifa ochadi va sarlavhani qayta chizadi
- `fmtNum`, `fmtMoney`

**Ko'p sahifa allaqachon ishlaydi:** `jspdf-autotable` jadvalni bo'lib, har sahifada
jadval sarlavhasini takrorlaydi; `ensureSpace` jami va imzoni chetga chiqarmaydi.
13 ta test shuni qulflaydi (80 va 120 qatorli hujjatlar).

### 1.4 Hozirgi "sozlash" imkoniyati

Yagona joy — **yetkazma nakladnoyi oynasi** (`delivery/_components/waybill-dialog.tsx`):
`WaybillSettings` = `{ number, responsibleName, agentName, warehouseName, notes, columns }`.
Ustunlarni yoqish/o'chirish va bir nechta matn maydoni bor, xolos. Saqlanishi —
**`localStorage`** (kompaniya kaliti bilan), bazada emas.

### 1.5 Bazadagi shablon modeli

**YO'Q.** `apps/api/src/db/schema` bo'yicha `template` so'zi bilan bitta ham jadval yo'q.
Ya'ni shablonlar uchun butun ma'lumot modeli noldan quriladi.

### 1.6 Auditda topilgan XATO (tuzatildi)

**Kirill matn buzilardi.** `pdf-utils.ts` hamma joyda `doc.setFont("helvetica", …)`
ishlatardi — jsPDF ning ichki shrifti faqat WinAnsi (Latin-1) kodlashni biladi.
Production nakladnoyida agent nomi `Раматов Расул` o'rniga `0 < 0 B > 2  0 A C ;`
bo'lib chiqqan. Bu kirill ismli HAR QANDAY xodim, mijoz va do'kon uchun amal qilgan.

Yechim (1-bosqich): `unicode-font.ts` — PT Sans (OFL, kirill uchun ishlangan) `/fonts/` dan
yuklanadi, jsPDF VFS ga qo'yiladi va `setFont("helvetica", …)` chaqiruvlari unga
yo'naltiriladi. Shu sababli mavjud hujjat kodi bitta satr ham o'zgarmadi.
Shrift yuklanmasa — `helvetica` ga qaytiladi, hujjat baribir chiqadi.

---

## 2. TARGET ARXITEKTURA (dizayner)

### 2.1 Asosiy qaror: shablon — MA'LUMOT, kod emas

Shablon JSON bo'lib saqlanadi va faqat mavjud `pdf-utils` dvigateli bilan chiziladi.
JSON ichida **hech qachon** HTML, JS, SQL yoki ixtiyoriy URL bo'lmaydi — faqat
ro'yxatdan tanlangan element turlari, bog'lanishlar (binding) va uslub qiymatlari.

```
document_templates            company_id, document_type, name, status, is_default, current_version_id
document_template_versions    template_id, version, schema (jsonb), created_by, note
```

Chizish zanjiri:

```
Hujjat ma'lumoti (server, o'zgarmas)
        +
Shablon JSON (kompaniyaniki)
        ↓
  renderTemplate()        ← faqat pdf-utils funksiyalari
        ↓
      jsPDF → A4
```

### 2.2 Moliyaviy yaxlitlik (qat'iy)

Shablon faqat **qaysi qiymat qayerda va qanday ko'rinishini** aytadi. Qiymatning O'ZI
har doim serverdan kelgan hujjat ma'lumotidan olinadi:

- `{{document.total}}` — bog'lanish nomi, qiymat emas. Shablon ichiga son yozib bo'lmaydi.
- Element `text` bo'lsa — u faqat YORLIQ ("Mijoz:", "Qabul qildi:"), qiymat emas.
- Birlik konversiyasi (dona ↔ blok) shablonda hisoblanmaydi — serverdan tayyor keladi.

### 2.3 Maydonlar katalogi (server beradi)

Frontend hech qachon o'zi maydon nomi o'ylab topmaydi: `GET /api/documents/fields?type=…`
ruxsat berilgan bog'lanishlar ro'yxatini qaytaradi. Tannarx kabi maxfiy maydonlar
faqat tegishli ruxsat bo'lsa ro'yxatga kiradi (`products.view_cost`).

### 2.4 Xavfsizlik

- Shablon `company_id` ga qat'iy bog'langan; boshqa kompaniyaniki o'qilmaydi.
- Elementlar va uslublar **oq ro'yxat** (whitelist) bo'yicha tekshiriladi — noma'lum
  kalit saqlanmaydi.
- Rasm faqat `files` xizmatidagi o'z kompaniyasining kaliti orqali.
- QR/barcode faqat hujjat raqami yoki tasdiqlash havolasi — ixtiyoriy URL emas.
- Import qilingan shablon `company_id` va `created_by` ni O'ZIDAN olmaydi.

### 2.5 Bosqichlar

| # | Bosqich | Holat |
|---|---|---|
| 1 | Audit + kirill shrifti | ✅ bajarildi |
| 2 | Ma'lumot modeli, API, maydonlar katalogi, versiyalash | ✅ bajarildi |
| 3 | Renderer: shablon JSON → mavjud A4 dvigatel | ✅ bajarildi |
| 4 | Dizayner UI (Sozlamalar → Hujjatlar, jonli A4) | ✅ bajarildi |
| 5 | Rasm, QR, shtrix-kod, sahifa raqami; ustun tartibi va kengligi | ✅ bajarildi |
| 6 | Nakladnoy chiqarishni shablonga ulash (bulk print bilan) | ✅ bajarildi |

---

## 3. 1-BOSQICH NATIJASI

**Bajarildi:**

- Mavjud arxitektura xaritasi (yuqorida) — dublikat dvigatel qurilmaydi, `pdf-utils`
  qayta ishlatiladi.
- Kirill xatosi tuzatildi: `createDocument()` — hamma hujjat unicode shrift bilan ochiladi.
  Nakladnoy, hisob-faktura, xarid buyurtmasi, maosh varaqasi va kassa cheki — hammasi.
- Shrift fayllari `public/fonts/` (PT Sans, OFL litsenziyasi `OFL.txt` bilan birga);
  ilovaning asosiy bundle'i og'irlashmaydi — fayl faqat hujjat yaratilganda olinadi.

**Testlar:** yangi `unicode-font.test.ts` (4) — HAQIQIY shrift fayli bilan: fayl yaroqli
TrueType, hujjat `PTSans` bilan ochiladi, kirill matn chiziladi va kengligi hisoblanadi,
shrift yo'q bo'lsa `helvetica` ga qaytiladi, `setFont("helvetica")` unicode shriftga
yo'naltiriladi. Mavjud `a4-documents.test.ts` (13) — yashil.


---

## 4. 2–4-BOSQICH NATIJASI

### Ma'lumot modeli (migratsiya `0086_document_templates`)

    document_templates          company_id, document_type, name, status, is_default, current_version_id
    document_template_versions  template_id, version, schema (jsonb), note, created_by

- Shablon O'CHIRILMAYDI — `archived` bo'ladi (tarixdagi hujjat qaysi shablon bilan chiqqani bilinsin).
- Standart (zavod) shablon BAZADA TURMAYDI: u koddagi `default-templates.ts`. Shuning uchun
  uni buzib qo'yish imkoni yo'q; foydalanuvchi undan NUSXA olib o'zinikini yaratadi.
- Bitta hujjat turida bitta standart shablon — qisman unique indeks bilan qulflangan.

### API (`/api/documents`)

| Marshrut | Vazifasi | Ruxsat |
|---|---|---|
| `GET /templates` | ro'yxat | `settings.view` |
| `GET /templates/:id` | shablon + amaldagi sxema | `settings.view` |
| `GET /templates/:id/versions` | versiyalar tarixi | `settings.view` |
| `GET /fields?documentType=` | MAYDONLAR KATALOGI | `settings.view` |
| `GET /active/:documentType` | chizish uchun amaldagi sxema | sessiya |
| `POST /templates` | yaratish (zavod nusxasidan) | `settings.manage` |
| `POST /templates/:id/versions` | saqlash = YANGI versiya | `settings.manage` |
| `POST /templates/:id/restore` | eski versiyaga qaytish | `settings.manage` |
| `POST /templates/:id/default` | standart qilish | `settings.manage` |
| `PATCH /templates/:id` | nomini o'zgartirish | `settings.manage` |
| `DELETE /templates/:id` | ARXIVLASH | `settings.manage` |

### Xavfsizlik — shablon hech qachon "shundayligicha" saqlanmaydi

`sanitize.ts` kelgan JSON ni OQ RO'YXAT bo'yicha QAYTA QURADI: faqat taniydigan kalitlar yangi
obyektga ko'chiriladi. Natijada:

- noma'lum element turi, `html`, `onClick`, `script` — umuman saqlanmaydi;
- maydon va ustun faqat katalogdan; **tannarx va marja** `products.view_cost` siz kirmaydi;
- rang faqat `#rrggbb`; `url(javascript:...)` kabi qiymat tashlanadi;
- rasm faqat `files` kaliti (`<uuid>.<ext>`) — tashqi URL va `data:` yo'q;
- shrift, o'lcham, element soni va ustun soni chegaralangan;
- nima rad etilgani `warnings` da qaytadi — jim yo'qolmaydi.

Tenant: hamma so'rov `company_id` bilan; begona shablon `404`.

### Renderer (`src/lib/pdf/template-renderer.ts`)

Shablon JSON → A4. Yangi chizish dvigateli QURILMADI — hammasi `pdf-utils` orqali, shuning uchun
ko'p sahifa, jadval sarlavhasining takrorlanishi va footer avvalgidek ishlaydi.

**Moliyaviy yaxlitlik:** renderer qiymat HISOBLAMAYDI. `DocumentData` dagi tayyor qiymatlarni
joylashtiradi; `text` elementi faqat yorliq. Testda qulflangan: shablon qanday o'zgarsa ham
summa o'zgarmaydi.

### Dizayner UI (Sozlamalar → **Hujjatlar**)

Uch ustun: elementlar daraxti · **jonli A4** · tanlangan element sozlamalari.

**Asosiy qaror — oldindan ko'rish HAQIQIY PDF:** o'rtadagi varaq shablon bilan chizilgan
chinakam hujjat (namuna ma'lumotda). Shuning uchun "ko'rgani" va "bosib chiqqani" bir xil;
alohida HTML maketi yo'q, ya'ni ikki xil ko'rinish muammosi ham yo'q.

Imkoniyatlar: element qo'shish (matn, maydon, jadval, jami, imzo, chiziq), tartibini
o'zgartirish, o'chirish, matn/yorliqni tahrirlash, maydonni katalogdan tanlash, jadval
ustunlarini belgilash, jami qatorlarini tanlash, shrift/qalin/tekislash; shablon yaratish,
nusxa olish, standart qilish, arxivlash, versiyalar tarixi va qaytarish.

Brauzer dialogi (`prompt`/`confirm`) ishlatilmaydi — ichki forma va ikki bosqichli tasdiq.

### Tekshiruv

- **API:** `document-templates.test.ts` (12) — versiyalash, qaytarish, arxivlash, standart
  yagonaligi, XSS/HTML tashlanishi, begona maydon, rang, rasm kaliti, tenant ajratilishi;
  `document-sanitize.test.ts` (5) — maxfiy ustun ruxsatsiz tushmasligi.
- **Frontend:** `template-renderer.test.ts` (10) — ustun tanlash, ustun nomi, shart bo'yicha
  ko'rsatish, imzo yorliqlari, 90 qatorli hujjatning ko'p sahifaga bo'linishi va
  MOLIYAVIY YAXLITLIK.
- **Brauzer (Playwright):** `document-designer.spec.ts` (2) — shablon yaratish → element
  qo'shish → saqlash → qayta ochilganda joyida; 2-versiyadan 1-versiyaga qaytish.
  Shu test HAQIQIY xatoni topdi: fonda ketgan qayta so'rov saqlanmagan tahrirni o'chirib
  yuborardi — tuzatildi.
- Frontend to'plami 40 fayl / 194 test; API `document*` 17, `catalog`/`products` 17,
  `security-hardening` 34; `tsc` (API va web), `eslint` va `vite build` toza.


### Production (2026-09-24)

Commit `5a4696b`. `bum-api`: `Migratsiyalar qo'llandi (47ms)`, bitta `Server listening`,
loglarda 500 YO'Q. `bum-web`: `build.json` → **14:46:41Z**.
Tekshirildi: `/api/documents/templates` → **401** (marshrut bor, sessiya kerak),
`/fonts/PTSans-Regular.ttf` → **200** (kirill shrifti tarqaldi).


---

## 5. 5–6-BOSQICH NATIJASI

### Yangi elementlar

| Element | Qanday ishlaydi |
|---|---|
| **Rasm** (logo, muhr) | Fayl tanlanadi, brauzer uni 384 px gacha kichraytirib **data URL** qiladi va shablon ichida saqlaydi. Fayl saqlash (S3) production'da sozlanmagani uchun chek logotipidagi yo'l tanlandi |
| **QR** | `qrcode` kutubxonasi bilan chiziladi |
| **Shtrix-kod** | `jsbarcode` (CODE128) |
| **Sahifa raqami** | "1 / 3" — hamma sahifa chizilgandan keyin qo'yiladi (jami soni faqat o'shanda ma'lum) |

**QR/shtrix-kod ichiga ixtiyoriy havola yozib bo'lmaydi.** Manba faqat uchta: hujjat raqami,
buyurtma raqami, mijoz telefoni. Shu sababli kod skanerlanganda begona manzilga olib bormaydi.

**Rasm xavfsizligi:** server faqat `data:image/(png|jpeg|webp);base64,...` ni qabul qiladi.
Tashqi URL, `data:text/html` va **SVG** rad etiladi (SVG ichida skript bo'lishi mumkin);
hajm chegarasi 300 KB.

### Jadval ustunlari

Tanlangan ustunlar endi **tartibi va kengligi** bilan boshqariladi: yuqoriga/pastga siljitish
va mm dagi kenglik. Qog'ozdagi tartib aynan shu ro'yxat bo'yicha.

### Nakladnoy shablon bilan chiqadi

`GET /api/documents/active/:type` endi `{ schema, custom }` qaytaradi. `custom` —
kompaniya O'ZI tuzgan shablonmi.

- **`custom: false`** → nakladnoy AVVALGI qat'iy ko'rinishda chiqadi. Ya'ni hech kimda hech
  narsa o'z-o'zidan o'zgarmaydi: shablon yaratilmaguncha hamma narsa eski holicha.
- **`custom: true`** → `renderWaybillsWithTemplate` ishlaydi: har yetkazma O'Z SAHIFASIDA,
  shablon bo'yicha.

Chop etish yetkazma holatini o'zgartirmaydi (avvalgidek).

### Tekshiruv

- **Renderer:** `template-renderer.test.ts` 10 → **14** (rasm qo'yiladi, buzuq rasm hujjatni
  yiqitmaydi, sahifa raqami har sahifada `1 / N`, kod manbasi bo'sh bo'lsa jim o'tkaziladi).
- **Xavfsizlik:** `document-sanitize.test.ts` 5 → **10** (tashqi URL, SVG, `data:text/html`
  va `javascript:` rad etiladi; katta rasm rad etiladi; QR manbasi faqat ro'yxatdan;
  ustun tartibi saqlanadi va kenglik chegaraga tushiriladi).
- **Brauzer:** yangi `document-template-print.spec.ts` (3) — shablonsiz `custom: false`,
  standart qilingach `custom: true`, va shablon bilan chizilgan **kirill nomli** nakladnoy
  haqiqiy ko'p sahifali PDF bo'lishi. `document-designer.spec.ts` (2) yashil.
- E2E endi o'zidan keyin tozalaydi (sinov shablonlarini arxivlaydi) — aks holda bir necha
  yurishdan keyin "20 tadan ortiq shablon" chegarasiga urilib, sababsiz qizil bo'lardi.
- Frontend 40 fayl / **198** test; API `document*` **22**; `tsc`, `eslint`, `vite build` toza.

### Production (2026-09-24, 5–6-bosqich)

Commit `d08063e`. `bum-api`: `Migratsiyalar qo'llandi (63ms)`, bitta `Server listening`,
500 YO'Q. `bum-web`: `build.json` → **16:03:37Z**.
`/api/documents/active/delivery_waybill` → **401** (marshrut bor, sessiya kerak).


---

## 6. HISOB-FAKTURA VA XARID SHABLONGA ULANDI (2026-09-25)

Yetkazma nakladnoyidagi naqsh ikkita hujjatga kengaytirildi. Yangi dvigatel qurilmadi —
o'sha `renderTemplate` va `pdf-utils`.

### Yangi ko'prik — `src/lib/pdf/document-template-bridge.ts`

| Funksiya | Vazifasi |
|---|---|
| `invoiceDocumentData` | Sotuv hisob-fakturasi → shablon ma'lumoti |
| `purchaseDocumentData` | Xarid buyurtmasi → shablon ma'lumoti |
| `activeTemplate` | Kompaniyaning shabloni bormi (`custom`), yo'qmi — `null` |
| `saveWithTemplate` | Shablon bilan chizib faylni saqlaydi |

Ko'prik qiymatlarni faqat KO'CHIRADI. Masalan hisob-fakturada qatorlar yig'indisi 168 000
bo'lsa ham, jami hujjatdagidek **164 400** bo'lib qoladi (chegirma hisobga olingan) — bu
test bilan qulflangan.

### Chaqiruv joylari

| Hujjat | Joy | Xulq |
|---|---|---|
| Sotuv hisob-fakturasi | `sales/_components/order-detail-drawer.tsx` → "Hisob-faktura" | shablon bo'lsa — u, aks holda `generateSalesInvoicePDF` |
| Xarid buyurtmasi | `purchase/_components/order-detail-drawer.tsx` → "PDF" | shablon bo'lsa — u, aks holda `generatePurchaseOrderPDF` |

Fayl nomlari: `hisob-faktura-SO-2026-0004.pdf`, `xarid-PO-2026-0001.pdf`.

### Farqlar (yetkazma nakladnoyiga nisbatan)

Yetkazmada jadval qatori — mijoz; bu ikkalasida — **mahsulot**. Shuning uchun `Mahsulot`,
`SKU`, `Birlik`, `Miqdor`, `Narx`, `Summa` ustunlari to'ladi.

| Maydon | Hisob-faktura | Xarid |
|---|---|---|
| Mijoz nomi / telefoni / manzili | ✅ | ❌ |
| Ta'minotchi / telefoni | ❌ | ✅ |
| Oraliq summa, Chegirma, Soliq | ✅ | ❌ |
| Jami, To'langan, Qarz | ✅ | ✅ |

### Tekshiruv

- Yangi `document-template-bridge.test.ts` (**11**) — maydonlar to'lishi, jadval qatori
  mahsulot ekani, MOLIYAVIY YAXLITLIK (summa qayta hisoblanmaydi), chegirmasiz qatorda
  ustun bo'sh qolishi, xaridda mijoz maydonlari umuman yo'qligi, QR manbalari.
- `document-template-print.spec.ts` ga 4-test qo'shildi — HAQIQIY brauzerda ikkala hujjat
  ham shablon bilan chizilib, yaroqli PDF bo'lishi (kirill nomlar bilan).
- Frontend to'plami **41 fayl / 209 test**; `tsc`, `eslint`, `vite build` toza.

Qolgan yagona hujjat — **maosh varaqasi** (hali ulanmagan).


---

## 7. NAKLADNOY "CHALA" EDI — TO'RTTA TUZATMA (2026-09-25)

Egasi shablon bilan chiqarilgan PDF'ni yubordi. Fayl dekodlab tekshirildi va to'rtta aniq
kamchilik topildi.

### 7.1 Mahsulotlar umuman yo'q edi (asosiy sabab)

`POST /api/delivery/waybills/bulk` javobida BUYURTMA QATORLARI yo'q edi — faqat yetkazma
sarlavhasi. Shuning uchun jadvalda bitta yarim bo'sh qator chiqardi, dostavshik esa do'konda
nimani solishtirishni bilmasdi.

Tuzatma: `deliveryWaybillsByIds` endi bitta qo'shimcha so'rovda hamma buyurtmaning qatorlarini
oladi (`productName`, `productSku`, `quantity`, `unitName`, `unitPrice`, `lineTotal`) va har
yetkazmaga `items` bo'lib biriktiradi.

Ko'prikda (`waybillDocumentData`) har mahsulot — bitta jadval qatori; mijoz ustunlari har
qatorda takrorlanadi, shuning uchun foydalanuvchi mijoz ustunini ham, mahsulot ustunini ham
tanlay oladi. Mahsulotsiz buyurtmada avvalgidek bitta yig'ma qator qoladi.

### 7.2 Ustun sarlavhalari XOM KALIT bo'lib chiqardi

Qog'ozda `index`, `name`, `quantity`, `total` yozilgan edi. Sabab: `waybillDocumentData`
`columnLabels` bermasdi va renderer kalitning o'ziga tushardi. Endi o'zbekcha nomlar
beriladi (№, Mahsulot, Birlik, Miqdor, Narx, Summa, Mijoz, Telefon, Manzil, Qarz).

### 7.3 Yangi jadval NOTO'G'RI ustunlar bilan ochilardi

Dizaynerda "+ Jadval" bosilganda katalogning birinchi to'rttasi olinardi
(`index`, `name`, `sku`, `barcode`) — yetkazmada bular bo'sh chiqar, foydalanuvchi nega
bo'shligini bilmasdi. Endi standart ustunlar HUJJAT TURIGA mos (`DEFAULT_TABLE_COLUMNS`).

### 7.4 Yorliq maydonga ergashmasdi

Qog'ozda `Kompaniya nomi: Test Market` chiqqan: element qo'shilganda yorliq katalogning
birinchi maydoni bo'yicha qo'yilar, foydalanuvchi maydonni almashtirsa yorliq eski holicha
qolardi. Endi yorliq — agar foydalanuvchi uni O'ZI yozmagan bo'lsa — yangi maydon nomiga
o'zgaradi.

### Tekshirilgan, lekin muammo EMAS

- **Kirill** — PDF ichidagi CMap tekshirildi: `<0159><0420>` ya'ni `Р` to'g'ri xaritalangan.
  Shrift joyida, matn buzilmagan.
- **Tezlik** — brauzerda o'lchandi: 1 nakladnoy 2.5 s (shrift yuklanishi bilan), keyin
  2 tasi 68 ms, 5 tasi 141 ms. Sekinlik yo'q.

### Tekshiruv

- Yangi `delivery-template.test.ts` (**9**) — mahsulot qatorlari, mijoz ustunlarining
  takrorlanishi, mahsulotsiz holat, eski javob (`items` yo'q), MOLIYAVIY YAXLITLIK,
  o'zbekcha ustun nomlari, foydalanuvchi yozgan nomning ustunligi, ko'p sahifa.
- `delivery-waybill.test.ts` (+1) — server javobida `items` borligi.
- `document-template-print.spec.ts` — nakladnoy mahsulot qatorlari bilan chiziladi
  (brauzerda); to'plam vaqti 240 s ga ko'tarildi (har test haqiqiy PDF chizadi).
- Frontend **42 fayl / 218 test**; `tsc`, `eslint` toza.


---

## 8. KO'P NAKLADNOY: GLIF BUZILISHI VA A4 GA AQLLI JOYLASHUV (2026-09-25)

### 8.1 Root cause — ma'lumot emas, GLIF aralashuvi

Egasi yuborgan PDF: 1-sahifada `Кроп Шоп` va 35 200 — TO'G'RI. 2-sahifada mahsulot nomlari
teshik (`EZ  сви  ит  л`), jami esa `42,200` o'rniga **`2,200`** (boshidagi `4` yo'qolgan).

Dastlabki taxmin — "ma'lumot aralashib ketgan" — NOTO'G'RI edi. Har sahifada o'z mijozi va
o'z mahsulotlari turgan; buzilgani faqat HARFLAR.

Sabab `renderWaybillsWithTemplate` da edi: har nakladnoy ALOHIDA jsPDF hujjati qilinib,
sahifasi birinchisiga nusxalanardi. jsPDF hujjatga faqat O'SHA hujjat ishlatgan gliflarni
joylaydi (subset). Nusxalangan sahifadagi glif raqamlari birinchi hujjatning boshqa
to'plamiga tegib, harflar yo'qolardi yoki almashardi.

**Dalil (test bilan):** 1-hujjat faqat lotin, 2-hujjat kirill ishlatganda yakuniy PDF
shriftida kirill glifi UMUMAN yo'q edi (`CMAP KIRILL: false`).

**Tuzatma:** sahifa nusxalash olib tashlandi. `renderDocuments` hamma hujjatni BITTA jsPDF
ichiga chizadi — shrift to'plami bitta, glif raqamlari mos.

### 8.2 A4 ga aqlli joylashuv

`renderDocuments(schema, list, mode)`:

| Qoida | Xulq |
|---|---|
| Hujjat o'rtasidan bo'linmaydi | Sig'masa butunlay keyingi varaqqa |
| Sig'sa — birga | Ajratgich (uzuq chiziq) bilan o'sha varaqda davom etadi |
| Uzun hujjat (50+ mahsulot) | O'z varag'idan boshlanadi |
| Tartib | Foydalanuvchi tanlagan tartib saqlanadi (birinchi-mos, qayta saralanmaydi) |
| Kichraytirish | YO'Q — o'qilishi muhimroq; sig'masa keyingi varaq |

**Balandlik qanday o'lchanadi:** taxmin yoki CSS `scale` emas — hujjat chetga tashlanadigan
nusxada HAQIQATAN chiziladi va tugash nuqtasi olinadi. Balandlik matn uzunligi, jadval
qatorlari va shriftga bog'liq, shuning uchun yagona ishonchli yo'l shu.

**Nega scale (95/90/85%) qilinmadi:** o'lchash asosidagi joylashtirish uni keraksiz qiladi —
sig'adigani sig'adi, sig'maydigani keyingi varaqqa o'tadi. jsPDF'da shriftni kichraytirish
qator uzilishlarini qayta hisoblaydi, ya'ni o'lchov yana o'zgaradi; foyda esa kam. Bu
ataylab qilingan qaror.

### 8.3 Foydalanuvchi tanlovi

Dostavka → Yetkazmalar, "Nakladnoy" tugmasi yonida:

- **Aqlli A4 (sig'gani birga)** — standart
- **Har biri alohida varaq** — eski xulq

Tanlov brauzerda eslab qolinadi.

### 8.4 Testlar

Yangi `bulk-print.test.ts` (**9**) — PDF ichidan MATN AJRATIB tekshiradi ("PDF yaratildi"
degan tekshiruv bu xatoni tutmasdi, chunki fayl yaratilgan edi):

- ikkita nakladnoy: har biri o'z mijozi va summasi bilan, `42 200` buzilmaydi;
- to'rtta turli mijoz (lotin va kirill aralash) — hammasi butun;
- kirill glifi shriftga kiradi (nusxalashda yo'qolardi);
- 2 va 3 qisqa nakladnoy — bitta A4;
- uzun nakladnoy o'z sahifasidan boshlanadi;
- `full` rejimi eski xulqni beradi;
- tartib saqlanadi;
- 20 ta nakladnoy — hammasi chiqadi, sahifa soni 20 dan kam.

Har testda `expect(text).not.toContain("?")` — xaritada yo'q glif qolmasligi.

Brauzerda: yangi `e2e/bulk-print.spec.ts` (**4**) — 2, 4 va 20 nakladnoy hamda `full` rejimi;
PDF matni brauzerda ajratib olinadi.

**Moliyaviy yaxlitlik:** chop etish avvalgidek READ-ONLY — holat, to'lov, qarz, zaxira va
jurnal o'zgarmaydi (server ham shuni kafolatlaydi; `delivery-waybill.test.ts` qulflagan).

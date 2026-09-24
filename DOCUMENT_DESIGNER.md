# Hujjat dizayneri — audit va arxitektura

> Maqsad: foydalanuvchi nakladnoy va boshqa hujjatlarni Word'ga o'xshab, kodchisiz tahrir
> qila olsin. Hujjat KO'RINISHINI boshqaradi — ERP'dagi moliyaviy haqiqatni EMAS.

| | |
|---|---|
| Boshlandi | 2026-09-24 |
| Holat | 1-bosqich (audit + shrift) ✅ · 2–6-bosqichlar rejada |
| Production deploy | topshiriq bo'yicha QILINMAYDI |

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
| 2 | Ma'lumot modeli, API, maydonlar katalogi, versiyalash | rejada |
| 3 | Renderer: shablon JSON → mavjud A4 dvigatel | rejada |
| 4 | Dizayner UI (A4 tuvali, elementlar, drag/drop, uslub paneli) | rejada |
| 5 | Shart bo'yicha ko'rsatish, mahsulot jadvali dizayneri, jami/to'lov bloklari | rejada |
| 6 | Bulk chop etish bilan birlashtirish, eksport/import, qabul testlari | rejada |

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

# BUM ERP — ommaviy sayt (bum-erp.uz)

`bum-erp.uz` uchun statik informatsion sayt. **ERP emas**: bu yerda kirish formasi, tenant login yoki
boshqaruv paneli YO'Q — faqat ma'lumot va `app.bum-erp.uz` ga havola.

## Nega alohida

| manzil | nima |
|---|---|
| `bum-erp.uz` | shu ommaviy sayt — mavjud apex hostingida (webspace.uz) |
| `www.bum-erp.uz` | ERP (Railway `bum-web`) — **tegilmaydi**, kassa qurilmalari shu manzil bilan ro'yxatdan o'tgan bo'lishi mumkin |
| `app.bum-erp.uz` | ERP (Railway `bum-web`) |

## Deploy

Build bosqichi **yo'q** — bu oddiy statik sayt. Shu papkaning ICHIDAGI fayllarni apex hostingining
hujjatlar ildiziga (`public_html` yoki shunga o'xshash) yuklang:

```
index.html
assets/bum-logo.png
assets/bum-mark.png
assets/favicon.png
```

Yuklashdan keyin tekshirish:

- `https://bum-erp.uz` → 200, sayt ochiladi
- sahifada kirish formasi YO'Q
- «Tizimga kirish» tugmasi `https://app.bum-erp.uz` ga olib boradi
- telefon va kompyuterda joylashuv buzilmaydi

## TLS

Apex hozir yaroqli sertifikatsiz (brauzer ogohlantiradi). Sertifikat webspace.uz panelidan
(Let's Encrypt yoki provayder beradigan boshqa mexanizm) yoqilishi kerak — repodan boshqarilmaydi.
HTTPS'ni o'chirish yoki sertifikat ogohlantirishini e'tiborsiz qoldirish **yaramaydi**.

## Kontent qoidasi

Sahifadagi barcha ma'lumot repodan olingan: modul nomlari va tavsiflari —
`packages/shared/src/modules.ts` (MODULE_REGISTRY), aloqa manzili — `src/components/erp-layout.tsx`,
brend aktivlari — `public/brand/`. Narx, mijozlar soni, integratsiya yoki kafolat kabi tasdiqlanmagan
da'volar qo'shilmaydi.

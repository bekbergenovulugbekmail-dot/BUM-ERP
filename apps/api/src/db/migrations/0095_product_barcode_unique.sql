-- SUP-001 (2026-09-26): shtrix-kod kompaniyada bitta mahsulotga tegishli — kassada skanerlanganda boshqa mahsulot sotilmasin.
-- Asosiy himoya — servisda (yaratish, tahrir, import). Bu indeks — ikkinchi qatlam va FAQAT mavjud ma'lumotda dublikat
-- bo'lmasa yaratiladi: eski dublikatlar bo'lsa migratsiya yiqilmaydi (ogohlantirish), ular qo'lda tuzatilgach keyingi
-- migratsiya/qo'lda yaratiladi. Hech qanday ma'lumot o'zgartirilmaydi va o'chirilmaydi.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "products"
    WHERE "barcode" IS NOT NULL AND btrim("barcode") <> ''
    GROUP BY "company_id", "barcode" HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "products_company_barcode_key" ON "products" ("company_id", "barcode") WHERE "barcode" IS NOT NULL AND btrim("barcode") <> '';
  ELSE
    RAISE WARNING 'products: takrorlangan shtrix-kodlar bor — unikal indeks yaratilmadi (servis tekshiruvi ishlaydi)';
  END IF;
END $$;

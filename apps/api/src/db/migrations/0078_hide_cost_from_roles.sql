-- Tannarxni faqat ega ko'radi: mavjud kompaniyalarning rollaridan `products.view_cost` olinadi.
--
-- Nega kerak: `DEFAULT_ROLES` — faqat YANGI kompaniya uchun shablon; rollar kompaniya yaratilganda
-- bazaga NUSXALANADI (`platform/company.service.ts`). Shuning uchun kodda ruxsatni olib tashlash
-- mavjud kompaniyalarga ta'sir qilmaydi — ular eski ro'yxat bilan ishlayveradi.
--
-- Nima qiladi: `roles.permissions` massividan FAQAT bitta qator — 'products.view_cost' — olib
-- tashlanadi. Boshqa ruxsatlar, rol nomi, a'zolari va hech qanday boshqa jadval TEGILMAYDI.
-- To'liq huquqli rollar (Superadmin, Business Owner) tegilmaydi — ular kodda ham bypass qilinadi,
-- lekin ro'yxati ham to'g'ri qolsin.
--
-- Qaytarish: ega rollar sozlamasidan istalgan rolga "Tannarx va xarid narxini ko'rish" belgisini
-- qaytarib beradi (bitta belgi) — ma'lumot yo'qolmaydi.
--
-- Idempotent: ruxsat allaqachon yo'q bo'lsa qator o'zgarmaydi.
update "roles"
set "permissions" = array_remove("permissions", 'products.view_cost')
where 'products.view_cost' = any("permissions")
  and "name" not in ('Superadmin', 'Business Owner');

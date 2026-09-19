-- Tannarx va xarid narxi endi alohida ruxsat: `products.view_cost`.
-- Ilgari uni `products.view` bo'lgan har kim (kassir, sotuv agenti ham) ko'rardi.
--
-- Bu migratsiya FAQAT QO'SHADI: mavjud ruxsatlar o'chirilmaydi, yozuvlar yo'qotilmaydi.
-- Ro'yxatga moliya, xarid, ombor, ishlab chiqarish, savdo boshqaruvi va auditor kiradi;
-- kassir, sotuv agenti, dostavka agenti, supervayzer va ko'ruvchiga ATAYLAB berilmaydi.
update "roles"
set "permissions" = array_append("permissions", 'products.view_cost'),
    "updated_at" = now()
where "is_system" = true
  and "name" in (
    'Direktor', 'Buxgalter', 'Moliya menejeri', 'Savdo menejeri', 'Xarid menejeri',
    'Ombor menejeri', 'Omborchi', 'Ishlab chiqarish menejeri', 'Auditor'
  )
  and not ('products.view_cost' = any("permissions"));

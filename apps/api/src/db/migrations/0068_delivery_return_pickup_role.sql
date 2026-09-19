-- Dostavka agenti mijozdan ilgari sotilgan tovarni qaytarib ola olsin; Direktor rolida ham
-- (katalogda u barcha operatsion ruxsatlarga ega). Faqat qo'shadi — mavjud ruxsatlar o'zgarmaydi.
update "roles"
set "permissions" = array_append("permissions", 'delivery.return_pickup'),
    "updated_at" = now()
where "is_system" = true
  and "name" in ('Dostavka agenti', 'Direktor')
  and not ('delivery.return_pickup' = any("permissions"));

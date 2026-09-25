-- Kassir o'ziga biriktirilgan kassani ko'radi va ishlatadi (cash.own). Faqat qo'shadi — kassa biriktirilmagan
-- kassir hech narsa ko'rmaydi; mavjud ruxsatlar o'zgarmaydi.
update "roles"
set "permissions" = array_append("permissions", 'cash.own'),
    "updated_at" = now()
where "is_system" = true
  and "name" = 'Kassir'
  and not ('cash.own' = any("permissions"));

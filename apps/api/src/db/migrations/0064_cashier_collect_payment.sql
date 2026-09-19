-- Kassir va Savdo menejeri mijozdan to'lov qabul qila olsin (ERP "To'lovlar" bo'limida ham,
-- nafaqat kassa oynasida). Faqat qo'shadi — mavjud ruxsatlar va boshqa rollar o'zgarmaydi.
update "roles"
set "permissions" = array_append("permissions", 'sales.collect_payment'),
    "updated_at" = now()
where "is_system" = true
  and "name" in ('Kassir', 'Savdo menejeri')
  and not ('sales.collect_payment' = any("permissions"));

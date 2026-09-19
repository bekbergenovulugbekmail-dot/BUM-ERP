-- Qurilmalarni tasdiqlash endi alohida ruxsat: rahbar yo'qda ham yangi telefon/noutbukni
-- mas'ul xodim (HR menejeri) ocha oladi. Faqat qo'shadi — mavjud ruxsatlar o'zgarmaydi.
update "roles"
set "permissions" = array_append("permissions", 'devices.manage'),
    "updated_at" = now()
where "is_system" = true
  and (
    "name" in ('HR menejeri', 'Business Owner', 'Superadmin', 'Direktor')
    or 'users.manage' = any("permissions")
  )
  and not ('devices.manage' = any("permissions"));

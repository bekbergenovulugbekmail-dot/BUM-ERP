-- Supervayzer ham zakaz oladi: mavjud kompaniyalarning "Supervayzer" roliga agent ish joyi ruxsati.
--
-- Nega kerak: `DEFAULT_ROLES` — faqat YANGI kompaniya uchun shablon; rollar kompaniya yaratilganda
-- bazaga nusxalanadi. Kodda ruxsat qo'shish mavjud kompaniyalarga ta'sir qilmaydi (0078 bilan bir xil sabab).
--
-- Nima qiladi: FAQAT "Supervayzer" roliga va FAQAT yetishmayotgan ruxsatlarni QO'SHADI. Mavjud
-- ruxsatlar, tartibi, boshqa rollar va jadvallar tegilmaydi; takror ishga tushsa hech narsa o'zgarmaydi.
--
-- Eslatma: ruxsatning o'zi yetmaydi — supervayzer hisobi faol savdo agentiga bog'langan bo'lishi kerak
-- ("Distribyutsiya → Sotuv agentlari" da bir marta: agent yozuvini supervayzer foydalanuvchisiga bog'lash).
update "roles"
set "permissions" = "permissions" || array(
  select value
  from unnest(array[
    'sales_agent.use',
    'sales_agent.customer.edit',
    'sales_agent.customer.location.edit',
    'sales_agent.customer.photo.create'
  ]) as value
  where value <> all("permissions")
)
where "name" = 'Supervayzer';

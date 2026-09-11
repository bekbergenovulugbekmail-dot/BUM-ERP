# PostgreSQL migratsiyasi — holat

> Convex → PostgreSQL (Fastify + Drizzle) migratsiyasi.
> **Har sessiya oxirida yangilanadi** (qoida `CLAUDE.md` da).

| | |
|---|---|
| Branch | `feat/postgres-migration` |
| Oxirgi yangilanish | 2026-09-11 |
| Umumiy holat | 4 / 16 PHASE tugallandi, PHASE 4 jarayonda, keyingi — PHASE 6 |
| Ishlab turgan ilova | Hali to'liq Convex'da — frontend yangi API'ga ulanmagan |

**Holat belgilari:** ✅ tugallandi · 🟡 jarayonda · ⬜ boshlanmagan

> Eslatma: 16 PHASE ro'yxati asl rejadan emas — asl reja boshqa qurilmadagi
> sessiyada qolgan. Ro'yxat commitlar va `convex/` modullari asosida qayta
> tuzilgan va tasdiqlangan. Asl reja topilsa, shu ro'yxat almashtiriladi.

## Umumiy ko'rinish

| # | PHASE | Holat |
|---|---|---|
| 1 | Monorepo skeleti | ✅ tugallandi |
| 2 | PostgreSQL sxemasi | ✅ tugallandi |
| 3 | API poydevori | ✅ tugallandi |
| 4 | Auth va sessiyalar | 🟡 jarayonda (SMS tiklash — Eskiz ulangach) |
| 5 | Platforma: kompaniya, filial, rol, admin | ✅ tugallandi |
| 6 | Katalog | ⬜ boshlanmagan |
| 7 | Ombor | ⬜ boshlanmagan |
| 8 | Moliya | ⬜ boshlanmagan |
| 9 | Xarid | ⬜ boshlanmagan |
| 10 | Savdo va POS | ⬜ boshlanmagan |
| 11 | CRM | ⬜ boshlanmagan |
| 12 | Ishlab chiqarish | ⬜ boshlanmagan |
| 13 | HR | ⬜ boshlanmagan |
| 14 | Dashboard, hisobot, AI, bildirishnoma, fayl | ⬜ boshlanmagan |
| 15 | Ma'lumotni Convex'dan ko'chirish | ⬜ boshlanmagan |
| 16 | Frontend'ni API'ga o'tkazish, deploy, Convex'ni o'chirish | ⬜ boshlanmagan |

## Yakuniy qarorlar (2026-09-11)

- **Ierarxiya:** bootstrap admin (`.env` dan seed, o'chirilmaydi) → platforma admini biznes egasi uchun login/parol ochadi → biznes egasi o'z kompaniyasidagi xodimlar uchun login/parol ochadi → xodim faqat o'z parolini (eski parol bilan) o'zgartiradi
- **Qo'shimcha platforma adminlari:** faqat bootstrap admin tayinlaydi va olib tashlaydi
- **O'zi ro'yxatdan o'tish:** standart holatda yopiq; platforma admini sozlamalardan yoqadi/o'chiradi
- **Takliflar (invitations):** kerak emas — SMS yo'q, parol to'g'ridan-to'g'ri beriladi. `invitations` jadvali sxemada qoladi, API yozilmaydi; Eskiz ulangach PHASE 14 da qaytiladi
- **Cheklovlar:** ega faqat o'z kompaniyasi xodimini ko'radi va boshqaradi; hech kim o'ziga rol ko'tara olmaydi; parol o'zgarsa barcha sessiyalar bekor; har amal audit jurnaliga

## Convex (ishlab turgan ilova) xavfsizlik teshiklari

Ko'chirish paytida topilgan. Yangi API'da hammasi yopilgan.

**Convex kodida yopildi** — `main` branch'da `3f958f1` (feat'da `8ab75e2`), `convex/rbac.test.ts` 10 ta test:

| Joy | Muammo (har qanday a'zo qila olardi) | Holat |
|---|---|---|
| `admin.updateRole` | Global rolni tahrirlab barcha kompaniyalarga ta'sir qilish | ✅ yopildi |
| `admin.updateUserRole` | O'ziga Superadmin berish | ✅ yopildi |
| `companies.updateMember` | O'zini Business Owner qilish | ✅ yopildi |
| `admin.createRole` / `deleteRole` | Ruxsatsiz rol yaratish/o'chirish, global rolni o'chirish | ✅ yopildi |
| `admin.toggleUserActive` | Egani bloklash | ✅ yopildi |
| `admin.createAuditLog` | Audit yozuvini qalbakilashtirish | ✅ internal qilindi |

> ⚠️ **Production'ga deploy qilinmagan.** Bu muhitda faqat dev deployment (`cheerful-toad-597`) kaliti bor.
> Yopish kuchga kirishi uchun `main` dan production kaliti bilan `npx convex deploy` qilish kerak.

**Convex'da hali ochiq** (frontend PHASE 16 da yangi API'ga ko'chganda yo'qoladi):

| Joy | Muammo |
|---|---|
| `admin.upsertCompany` | Kompaniyasi yo'q foydalanuvchi "default" kompaniyani o'zgartiradi; ruxsat tekshiruvi yo'q |
| `admin.upsertSetting` | Ruxsat tekshiruvi yo'q |
| `companies.updateCompany`, `createBranch`, `updateBranch` | Ruxsat tekshiruvi yo'q |
| `admin.listUsers`, `companies.platformListAllUsers` | Foydalanuvchi hujjati to'liq (PIN xeshi) brauzerga |
| `companies.platformGetSettings` | Autentifikatsiyasiz ochiq |

## Foydalanuvchi boshqaruvi ierarxiyasi (yangi API)

| Kim | Nima qila oladi | Himoya |
|---|---|---|
| **Bootstrap admin** | Hamma narsa; qo'shimcha platforma adminlarini tayinlaydi | `.env` dagi `BOOTSTRAP_ADMIN_PHONE` / `BOOTSTRAP_ADMIN_PASSWORD` dan `db:seed`. Parol faqat argon2id xeshi. API orqali o'zgartirilmaydi, bloklanmaydi, o'chirilmaydi. Bazada: CHECK, partial unique, trigger |
| **Platforma admini** | Kompaniya + egasini yaratadi; kompaniyani to'xtatadi; oddiy foydalanuvchilarning telefon/parolini o'zgartiradi, bloklaydi; statistika, audit, sozlamalar (ro'yxatdan o'tishni yoqish ham) | Bootstrap admin, boshqa platforma adminlari va o'z hisobiga tegolmaydi; admin tayinlay olmaydi |
| **Kompaniya egasi** | Faqat aktiv kompaniyasiga xodim qo'shadi, parolini tiklaydi, a'zoligini yangilaydi; rollar, sozlamalar, audit | Boshqa kompaniya xodimi → 404; egalik rollarini berolmaydi; boshqa kompaniyaga ham a'zo xodimning parolini tiklay olmaydi |
| **Xodim** | O'z parolini eski parol bilan o'zgartiradi; roliga qarab kompaniya amallari (RBAC) | Xato joriy parol: 5 ta / 15 daqiqa |

**RBAC** (`modules/company/tenant.ts`): ruxsat faol a'zolikning roli bo'yicha. `Superadmin` / `Business Owner` — barcha ruxsatlar (bu nomlarda maxsus rol yaratib bo'lmaydi). `requirePermission` faqat katalogdagi `Permission` tipini qabul qiladi. Rol tahrirlovchi faqat o'zida bor ruxsatni bera oladi. To'xtatilgan, tugatilgan yoki **sinov muddati o'tgan** kompaniyada yozish amallari 403, o'qish mumkin.

## Tayyor API endpointlar (jami)

| Metod | Yo'l | Kim | Convex'dagi muqobili |
|---|---|---|---|
| GET | `/health` | — | — |
| POST | `/api/auth/login` | — | `signIn("password")` |
| POST | `/api/auth/logout` | — | `signOut` |
| GET | `/api/auth/me` | sessiya | `users.getCurrentUser` |
| POST | `/api/auth/password` | sessiya (bootstrap admindan tashqari) | — (yangi) |
| GET | `/api/auth/security` | sessiya | `pin.getSecuritySettings` |
| POST | `/api/auth/pin` | sessiya | `pin.setPin` |
| POST | `/api/auth/pin/change` | sessiya | `pin.changePin` |
| POST | `/api/auth/pin/remove` | sessiya | `pin.removePin` |
| POST | `/api/auth/pin/verify` | sessiya | `pin.verifyPin` |
| PUT | `/api/auth/auto-lock` | sessiya | `pin.setAutoLockTimeout` |
| GET | `/api/registration` | — | `companies.isRegistrationEnabled` |
| POST | `/api/registration` | — (faqat yoqilgan bo'lsa) | `companies.registerCompany` |
| GET | `/api/public/companies/:slug` | — | `companies.getCompanyBySlug` |
| GET | `/api/public/companies/:slug/access` | sessiya | `companies.verifyTenantAccess` |
| GET | `/api/platform/companies` | platforma admini | `companies.platformListCompanies` (`?status=`) |
| POST | `/api/platform/companies` | platforma admini | `companies.platformCreateCompany` |
| GET | `/api/platform/companies/:companyId` | platforma admini | `companies.platformGetCompany` |
| POST | `/api/platform/companies/:companyId/status` | platforma admini | `companies.platformUpdateCompanyStatus` |
| GET | `/api/platform/stats` | platforma admini | `companies.platformGetStats` |
| GET | `/api/platform/audit-logs` | platforma admini | `companies.platformListAuditLogs` |
| GET | `/api/platform/users` | platforma admini | `companies.platformListAllUsers` |
| PATCH | `/api/platform/users/:userId` | platforma admini | — (telefon) |
| POST | `/api/platform/users/:userId/password` | platforma admini | `userAdmin.resetUserPassword` |
| POST | `/api/platform/users/:userId/status` | platforma admini | — (bloklash) |
| POST | `/api/platform/users/:userId/platform-admin` | **faqat bootstrap admin** | `companies.platformGrantAdmin` / `platformRevokeAdmin` |
| GET | `/api/platform/settings` | platforma admini | `companies.platformGetSettings` |
| PUT | `/api/platform/settings` | platforma admini | `companies.platformSaveSettings` |
| GET | `/api/company` | faol a'zo | `companies.getActiveCompany`, `admin.getCompany` |
| PATCH | `/api/company` | `company.manage` | `companies.updateCompany`, `admin.upsertCompany` |
| GET | `/api/company/mine` | sessiya | `companies.listMyCompanies` |
| POST | `/api/company/switch` | faol a'zo | `companies.switchCompany` |
| GET | `/api/company/branches` | faol a'zo | `companies.listBranches` |
| POST | `/api/company/branches` | `branches.manage` | `companies.createBranch` |
| PATCH | `/api/company/branches/:branchId` | `branches.manage` | `companies.updateBranch` |
| GET | `/api/company/employees` | `users.view` | `companies.listMembers`, `admin.listUsers` |
| POST | `/api/company/employees` | kompaniya egasi | `userAdmin.createUserAccount` |
| PATCH | `/api/company/employees/:userId` | kompaniya egasi | `companies.updateMember`, `admin.updateUserRole` |
| POST | `/api/company/employees/:userId/password` | kompaniya egasi | `userAdmin.resetUserPassword` |
| GET | `/api/company/roles` | faol a'zo | `admin.listRoles` |
| POST | `/api/company/roles` | `roles.manage` | `admin.createRole` |
| PATCH | `/api/company/roles/:roleId` | `roles.manage` | `admin.updateRole` |
| DELETE | `/api/company/roles/:roleId` | `roles.manage` | `admin.deleteRole` |
| GET | `/api/company/audit-logs` | `audit.view` | `admin.listAuditLogs` |
| GET | `/api/company/settings` | `settings.view` | `admin.getSettings` |
| PUT | `/api/company/settings/:key` | `settings.manage` (`modules` — `modules.manage`) | `admin.upsertSetting` |

Xatolar doim `{ code, message }` shaklida. PostgreSQL unique buzilishi 409. Yozish endpointlari noma'lum maydonlarni 400 bilan rad etadi.

## Lokal muhit

- **PostgreSQL 18** — `docker compose up -d` (`bum-pg`, `postgres`/`bumerp`, 5432).
  - `bumerp` — ishchi baza: 4 ta migratsiya, **ma'lumot yo'q**.
  - `bumerp_test` — testlar uchun, `pnpm test` o'zi yaratadi va har testda tozalaydi.
- **MinIO** — 9000 (S3), 9001 (konsol). `bum-erp` bucket va `.env` da `STORAGE_*` hali yo'q.
- **Migratsiya:** `pnpm --filter @bum/api db:migrate`
- **Bootstrap admin:** `.env` ga `BOOTSTRAP_ADMIN_PHONE`, `BOOTSTRAP_ADMIN_PASSWORD` (ixtiyoriy `BOOTSTRAP_ADMIN_NAME`) — `pnpm --filter @bum/api db:seed`. Idempotent.
- **API server:** `pnpm --filter @bum/api dev` → `http://localhost:3000`
- **Testlar:** `pnpm --filter @bum/api test` — 124 ta; Convex: `pnpm exec vitest run --project convex` — 10 ta

---

## PHASE 1 — Monorepo skeleti ✅

- **Ko'chirilgan:** pnpm workspace; `packages/shared`; `apps/api` skeleti; `docker-compose.yml`; `.env.example`.
- **Commitlar:** `c5c082a`, `070367f`

## PHASE 2 — PostgreSQL sxemasi ✅

- **Ko'chirilgan:** 61 jadval, 10 domen (platform 11, catalog 6, inventory 6, finance 6, purchase 6, sales 5, crm 8, manufacturing 6, hr 6, notifications 1).
- **Asosiy qarorlar:** pul/miqdor `numeric`; har tenant jadvalida `company_id NOT NULL`; `legacy_id` ko'chirish uchun (API javoblariga chiqmaydi); DB darajasidagi CHECK/unique himoyalar.
- **Migratsiyalar:** `0000` to'liq sxema; `0001` NULLS NOT DISTINCT (global rol/sozlama/konversiya dublikatlari); `0002` bootstrap admin himoyasi; `0003` bitta asosiy filial.
- **Commitlar:** `c5c082a`, `2bab68c`, `7ca1235`

## PHASE 3 — API poydevori ✅

- **Ko'chirilgan:** DB mijozi, tranzaksiya, xatolar (`{ code, message }`, unique → 409), logger, env, `.env` yuklash, migrate, Fastify (helmet, cors, cookie), dual-stack `HOST=::`.
- **Brauzerda sinash:** `http://localhost:3000/health`
- **Commitlar:** `3a9872d`, `045f6e1`, `fe7f664`, `43a3fcd`

## PHASE 4 — Auth va sessiyalar 🟡

- **Ko'chirilgan modullar:** `modules/auth/` — argon2id (+ Convex Auth lucia Scrypt xeshlari, birinchi kirishda argon2id ga), sessiya (httpOnly cookie, SHA-256, mutlaq 30 kun + faolsizlik 12 soat), login (bir xil javob/vaqt, rate limit, audit), PIN (5 xato → 5 daqiqa blok, Convex `reason` kodlari), guard'lar; `shared/rate-limit.ts`, `shared/audit.ts`.
- **Convex'dan farqlar:** PIN change/remove ham urinishlarni hisoblaydi; mavjud PIN ustiga yozilmaydi; ochiq signup yo'q (o'rniga boshqariladigan ro'yxatdan o'tish, PHASE 5).
- **Testlar:** `auth` (17), `pin` (14), `password` (4)
- **Qolgan ishlar:** SMS orqali parol tiklash (`password_reset_codes`) — Eskiz ulangach PHASE 14 da; eskirgan `rate_limits` / `sessions` qatorlarini tozalash

## PHASE 5 — Platforma: kompaniya, filial, rol, admin ✅

- **Ko'chirilgan modullar:**
  - `modules/platform/bootstrap.service.ts` + `cli/seed-bootstrap-admin.ts` (`db:seed`) — bootstrap admin
  - `modules/platform/company.service.ts` — kompaniya + ega (platforma admini yoki ro'yxatdan o'tish), ro'yxat, tafsilot, holat
  - `modules/platform/platform.service.ts` — statistika, foydalanuvchilar, platforma sozlamalari
  - `modules/users/user-admin.service.ts` — ierarxiya: platforma admini, ega, o'z paroli, platforma adminini tayinlash (faqat bootstrap)
  - `modules/registration/` — o'zi ro'yxatdan o'tish: faqat yoqilgan bo'lsa, IP ga soatiga 5, `defaultTrialDays` sinov muddati, ega darhol kiradi
  - `modules/public/routes.ts` — `/t/:slug` portal
  - `modules/audit/audit-log.service.ts` — audit jurnali (platforma va kompaniya)
  - `modules/company/` — tenant va RBAC, aktiv kompaniya, filiallar, a'zoni yangilash, rollar, sozlamalar
- **Ataylab ko'chirilmaganlar:** takliflar (`inviteMember`, `createInvitation`, `listInvitations`, `cancelInvitation`, `acceptInvitation`) — qaror bo'yicha PHASE 14 ga; `admin.createAuditLog` (audit faqat serverda); `admin.seedDefaultRoles` (rollar kompaniya yaratilganda); `platformSetAdminByEmail` (o'rniga `db:seed`); Convex'ning `migrateExistingDataToTenant` kabi bir martalik funksiyalari
- **Audit amallari:** `BOOTSTRAP_ADMIN_SEEDED`, `COMPANY_CREATED`, `COMPANY_REGISTERED`, `COMPANY_STATUS_CHANGED`, `COMPANY_UPDATED`, `COMPANY_SWITCHED`, `PLATFORM_SETTINGS_UPDATED`, `PLATFORM_ADMIN_GRANTED`, `PLATFORM_ADMIN_REVOKED`, `USER_CREATED`, `EMPLOYEE_CREATED`, `USER_PASSWORD_RESET`, `USER_PHONE_CHANGED`, `USER_BLOCKED`, `USER_ACTIVATED`, `PASSWORD_CHANGED`, `BRANCH_CREATED`, `BRANCH_UPDATED`, `MEMBER_UPDATED`, `ROLE_CREATED`, `ROLE_UPDATED`, `ROLE_DELETED`, `SETTING_UPDATED`
- **Testlar:** `bootstrap` (13), `platform-admin` (11), `platform-ops` (10), `platform-admins` (4), `registration` (6), `public` (2), `company-owner` (7), `company` (20), `roles` (10), `company-audit-settings` (6)
- **Brauzerda sinash:** frontend hali Convex'da; `curl` bilan: `db:seed` → login → `POST /api/platform/companies` → ega kirib `GET /api/company`, `POST /api/company/employees`

## PHASE 6 — Katalog ⬜

- **Convex manbasi:** `convex/products/` (products, categories, brands, units); sahifa `products`
- **Tayyor poydevor:** catalog jadvallari; `requireTenantForWrite` + `requirePermission("products.*")`

## PHASE 7 — Ombor ⬜

- **Convex manbasi:** `convex/warehouse/` (warehouses, stock, inventoryCounts); sahifa `warehouse`
- **Tayyor poydevor:** inventory jadvallari; "Asosiy ombor" (WH-001); a'zoning `allowedWarehouseIds` (bo'sh = hammasi) — ombor amallarida qo'llanadi

## PHASE 8 — Moliya ⬜

- **Convex manbasi:** `convex/finance/` (accounts, cashAccounts, expenses, journalHelper); sahifa `finance`

## PHASE 9 — Xarid ⬜

- **Convex manbasi:** `convex/purchase/` (suppliers, orders); sahifa `purchase`

## PHASE 10 — Savdo va POS ⬜

- **Convex manbasi:** `convex/sales/` (customers, orders, pos); sahifalar `sales`, `pos`
- **Tayyor poydevor:** kompaniya sozlamalari (`PUT /api/company/settings/:key`) — POS sozlamalari uchun

## PHASE 11 — CRM ⬜

- **Convex manbasi:** `convex/crm/` (leads, activities, salesReps, distribution); sahifa `crm`

## PHASE 12 — Ishlab chiqarish ⬜

- **Convex manbasi:** `convex/manufacturing/` (boms, orders); sahifa `manufacturing`

## PHASE 13 — HR ⬜

- **Convex manbasi:** `convex/hr/` (employees, attendance, salary); sahifa `hr`

## PHASE 14 — Dashboard, hisobot, AI, bildirishnoma, fayl ⬜

- **Convex manbasi:** `convex/dashboard.ts`, `convex/notifications.ts`, `convex/analytics/`; sahifalar `dashboard`, `analytics`
- **Shu yerga qoldirilgan:** takliflar (invitations) va SMS orqali parol tiklash — Eskiz ulangach
- **Tayyor poydevor:** `notifications`, `invitations`, `password_reset_codes` jadvallari; MinIO konteyneri

## PHASE 15 — Ma'lumotni Convex'dan ko'chirish ⬜

- **Tayyor poydevor:** `legacy_id` ustunlari; login Convex Auth parol xeshlarini qabul qiladi
- **E'tibor:** Convex'dagi `users.roleId` (global rol) yangi modelda yo'q — rol a'zolikda (`company_members.role_id`)

## PHASE 16 — Frontend'ni API'ga o'tkazish, deploy, Convex'ni o'chirish ⬜

- **Manba:** `src/` (barcha sahifalar Convex hook'larini ishlatadi); auth kirish nuqtasi `src/hooks/use-auth.ts`
- **E'tibor:** `admin/bootstrap.tsx` keraksiz (`db:seed`); `users-section.tsx` → `PATCH /api/company/employees/:userId`; `roles-section.tsx` `seedDefaultRoles` tugmasi keraksiz; `onboarding` → `/api/registration` (yoqilgan bo'lsa)

---

## Keyingi qadam

1. **PHASE 6 (Katalog)** — `convex/products/` ni ko'chirish: birliklar, konversiyalar, kategoriyalar, brendlar, mahsulotlar, import/export
2. **Production:** Convex tuzatishini (`main` `3f958f1`) production kaliti bilan deploy qilish
3. **Lokal:** `.env` ga `BOOTSTRAP_ADMIN_*` qo'shib `db:seed`
4. MinIO bucket va `STORAGE_*` (PHASE 14 dan oldin)

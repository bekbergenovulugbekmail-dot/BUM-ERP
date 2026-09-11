# PostgreSQL migratsiyasi — holat

> Convex → PostgreSQL (Fastify + Drizzle) migratsiyasi.
> **Har sessiya oxirida yangilanadi** (qoida `CLAUDE.md` da).

| | |
|---|---|
| Branch | `feat/postgres-migration` |
| Oxirgi yangilanish | 2026-09-11 |
| Umumiy holat | 3 / 16 PHASE tugallandi, PHASE 4 va 5 jarayonda |
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
| 4 | Auth va sessiyalar | 🟡 jarayonda |
| 5 | Platforma: kompaniya, filial, rol, admin | 🟡 jarayonda |
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

## Foydalanuvchi boshqaruvi ierarxiyasi

| Kim | Nima qila oladi | Himoya |
|---|---|---|
| **Bootstrap admin** | Hamma narsa (platforma admini) | `.env` dagi `BOOTSTRAP_ADMIN_PHONE` / `BOOTSTRAP_ADMIN_PASSWORD` dan `db:seed` bilan yaratiladi. Parol faqat argon2id xeshi. API orqali o'zgartirilmaydi, bloklanmaydi, o'chirilmaydi; parol faqat `.env` ni o'zgartirib qayta seed qilish orqali almashadi. Bazada: CHECK (doim faol platforma admini), partial unique (bitta), trigger (o'chirish va maqomni olish taqiqlangan) |
| **Platforma admini** | Kompaniya + egasini yaratadi; oddiy foydalanuvchilarning telefon/parolini o'zgartiradi, faollashtiradi/bloklaydi | Bootstrap admin, boshqa platforma adminlari va o'z hisobiga tegolmaydi |
| **Kompaniya egasi** | Faqat aktiv kompaniyasiga xodim qo'shadi, parolini tiklaydi, a'zoligini yangilaydi (rol, filial, ombor ruxsati, holat) | `companyId` so'rovda qabul qilinmaydi; boshqa kompaniya xodimi → 404; egalik rollarini (Superadmin, Business Owner) berolmaydi; boshqa kompaniyaga ham a'zo xodimning parolini tiklay olmaydi |
| **Xodim** | O'z parolini eski parol bilan o'zgartiradi; roliga qarab kompaniya amallari (RBAC) | Xato joriy parol: 5 ta / 15 daqiqa. SMS orqali tiklash — Eskiz ulangach |

Har amal `audit_logs` ga yoziladi. Parol almashsa (seed, admin, ega yoki o'zi) — o'sha foydalanuvchining **barcha** sessiyalari bekor qilinadi.

**RBAC** (`modules/company/tenant.ts`): ruxsat faol a'zolikning roli bo'yicha (`roleId`, bo'lmasa rol nomi — avval kompaniya roli, keyin global). `Superadmin` / `Business Owner` — barcha ruxsatlar. `requirePermission` faqat `packages/shared` katalogidagi `Permission` tipini qabul qiladi. To'xtatilgan yoki tugatilgan kompaniyada yozish amallari 403, o'qish mumkin.

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
| GET | `/api/platform/companies` | platforma admini | `companies.platformListCompanies` |
| POST | `/api/platform/companies` | platforma admini | `companies.platformCreateCompany` |
| PATCH | `/api/platform/users/:userId` | platforma admini | — (telefon o'zgartirish) |
| POST | `/api/platform/users/:userId/password` | platforma admini | `userAdmin.resetUserPassword` |
| POST | `/api/platform/users/:userId/status` | platforma admini | — (bloklash/faollashtirish) |
| GET | `/api/company` | faol a'zo | `companies.getActiveCompany` (+ a'zolik va ruxsatlar) |
| PATCH | `/api/company` | `company.manage` | `companies.updateCompany` |
| GET | `/api/company/mine` | sessiya | `companies.listMyCompanies` |
| POST | `/api/company/switch` | faol a'zo | `companies.switchCompany` |
| GET | `/api/company/branches` | faol a'zo | `companies.listBranches` |
| POST | `/api/company/branches` | `branches.manage` | `companies.createBranch` |
| PATCH | `/api/company/branches/:branchId` | `branches.manage` | `companies.updateBranch` |
| GET | `/api/company/employees` | `users.view` | `companies.listMembers` |
| POST | `/api/company/employees` | kompaniya egasi | `userAdmin.createUserAccount` |
| PATCH | `/api/company/employees/:userId` | kompaniya egasi | `companies.updateMember` |
| POST | `/api/company/employees/:userId/password` | kompaniya egasi | `userAdmin.resetUserPassword` |

Xatolar doim `{ code, message }` shaklida (Convex bilan bir xil). PostgreSQL unique buzilishi 409 `CONFLICT` qaytaradi. Yozish endpointlari noma'lum maydonlarni (`status`, `ownerId` …) 400 bilan rad etadi.

## Lokal muhit

- **PostgreSQL 18** — `docker compose up -d` (`bum-pg`, `postgres`/`bumerp`, 5432).
  - `bumerp` — ishchi baza: 4 ta migratsiya qo'llangan, **ma'lumot yo'q (foydalanuvchi ham yo'q)**.
  - `bumerp_test` — testlar uchun, `pnpm test` o'zi yaratadi, migratsiya qiladi va har testda tozalaydi.
- **MinIO** — 9000 (S3), 9001 (konsol). Ishlaydi, lekin `bum-erp` bucket yo'q
  va `.env` da `STORAGE_*` yo'q → `features.storage` o'chiq.
- **Migratsiya:** `pnpm --filter @bum/api db:migrate` (`.env` o'zi yuklanadi)
- **Bootstrap admin:** `.env` ga `BOOTSTRAP_ADMIN_PHONE`, `BOOTSTRAP_ADMIN_PASSWORD` (va ixtiyoriy `BOOTSTRAP_ADMIN_NAME`) qo'shib — `pnpm --filter @bum/api db:seed`. Idempotent; deployda `db:migrate` dan keyin ishga tushirish mumkin.
- **API server:** `pnpm --filter @bum/api dev` → `http://localhost:3000`
- **Testlar:** `pnpm --filter @bum/api test` — 86 ta test

---

## PHASE 1 — Monorepo skeleti ✅

- **Ko'chirilgan:** pnpm workspace; `packages/shared` (ruxsatlar katalogi `Permission` tipi bilan, xato tiplari); `apps/api` skeleti; `docker-compose.yml` (postgres + minio); `.env.example`.
- **API endpointlar:** —
- **Brauzerda sinash:** —
- **Commitlar:** `c5c082a`, `070367f` (compose PG18, `.env.example` git'ga qo'shildi)

## PHASE 2 — PostgreSQL sxemasi ✅

- **Ko'chirilgan:** Convex'dagi 58 biznes jadvali + o'z auth qatlami uchun 3 ta (sessions, password_reset_codes, rate_limits) — jami 61 jadval, 10 domen:

  | Domen | Jadvallar |
  |---|---|
  | platform (11) | users, sessions, password_reset_codes, rate_limits, companies, branches, roles, company_members, settings, audit_logs, invitations |
  | catalog (6) | units, unit_conversions, categories, brands, products, batches |
  | inventory (6) | warehouses, warehouse_zones, stock_levels, stock_movements, inventory_counts, inventory_count_items |
  | finance (6) | accounts, journal_entries, journal_lines, cash_accounts, cash_transactions, expenses |
  | purchase (6) | suppliers, purchase_orders, purchase_order_items, purchase_receipts, purchase_receipt_items, supplier_payments |
  | sales (5) | customers, pos_shifts, sales_orders, sales_order_items, customer_payments |
  | crm (8) | sales_reps, leads, activities, customer_segments, customer_segment_members, distribution_routes, route_customers, route_visits |
  | manufacturing (6) | boms, bom_items, work_centers, production_orders, production_materials, production_time_lines |
  | hr (6) | departments, positions, employees, attendances, leaves, salary_payments |
  | notifications (1) | notifications |

- **Asosiy qarorlar:** pul/miqdor `numeric` (float emas); har tenant jadvalida `company_id NOT NULL`; `legacy_id` ko'chirish uchun; DB darajasidagi CHECK/unique himoyalar (manfiy qoldiq, dublikat JE, ikkita ochiq smena va h.k.).
- **Migratsiyalar:**
  - `0000_fantastic_speed.sql` — to'liq sxema
  - `0001_nulls_not_distinct_uniques.sql` — tuzatish: `roles (company_id, name)`, `settings (company_id, key)`, `unit_conversions (…, product_id)` unikalligi `NULLS NOT DISTINCT`. Oddiy unikal indeksda NULL lar teng hisoblanmaydi, ya'ni global rollar, platforma sozlamalari va umumiy konversiyalar takrorlanib ketaverardi — aynan Convex'dagi dublikat rol muammosi
  - `0002_bootstrap_admin_guard.sql` — `users.is_bootstrap_admin`, CHECK, partial unique va himoya triggeri (PHASE 5)
  - `0003_one_default_branch.sql` — kompaniyada bitta asosiy filial (partial unique, PHASE 5)
- **API endpointlar:** —
- **Brauzerda sinash:** —
- **Commitlar:** `c5c082a`, `2bab68c`, `7ca1235`

## PHASE 3 — API poydevori ✅

- **Ko'chirilgan:** `db/client.ts` (pg havza + Drizzle, numeric/int8 string bo'lib qoladi); `db/transaction.ts` (`withTransaction`); `shared/errors.ts` (`{ code, message }` — Convex bilan bir xil shakl, unique buzilishi → 409); `shared/logger.ts` (pino, maxfiy maydonlar redact, testda jim); `env.ts` (zod tekshiruvi); `load-env.ts` (ildizdagi `.env`); `db/migrate.ts`; Fastify server (helmet, cors, cookie), dual-stack `HOST=::`.
- **API endpointlar:** `GET /health`
- **Brauzerda sinash:** `http://localhost:3000/health` → `{"status":"ok",...}`
- **Commitlar:** `3a9872d`, `045f6e1`, `fe7f664`, `43a3fcd`

## PHASE 4 — Auth va sessiyalar 🟡

- **Convex manbasi:** `convex/auth.ts`, `convex/pin.ts`, `users.getCurrentUser`; sahifalar `login`, `admin/login`, lock screen, sozlamalar → xavfsizlik
- **Ko'chirilgan modullar:**
  - `modules/auth/password.ts` — argon2id; Convex Auth'ning lucia Scrypt xeshlarini ham tekshiradi va birinchi kirishda argon2id ga o'tkazadi (haqiqiy lucia bilan ikki tomonlama tekshirilgan)
  - `modules/auth/session.ts` — 32 baytli token httpOnly cookie'da (`bum_session`), bazada SHA-256; mutlaq (30 kun) + faolsizlik (12 soat, sirpanuvchi) muddat; o'chirilgan hisob sessiyalari ishlamaydi
  - `modules/auth/auth.service.ts` — login: telefon normallashtirish (`packages/shared/phone.ts`), noma'lum raqam va xato parolga bir xil javob va bir xil vaqt, faol bo'lmagan hisob 403, audit (`login_success` / `login_failed`)
  - `modules/auth/pin.service.ts` — PIN argon2id; 5 xato → 5 daqiqa blok; `reason` kodlari Convex bilan bir xil (`WRONG_PIN:n`, `PIN_LOCKED:s`, `SESSION_MISMATCH`, …)
  - `modules/auth/guard.ts` — `requireAuth`, `requirePlatformAdmin`
  - `shared/rate-limit.ts` — PostgreSQL'da: login uchun raqamga 5, IP ga 30 xato; o'z parolini o'zgartirishda 5 xato / 15 daqiqa
  - `shared/audit.ts` — audit jurnali va `requestMeta`
- **Convex'dan ataylab farqlar:**
  - PIN tekshiruvi `change`/`remove` da ham urinishlarni hisoblaydi — Convex'da shu yo'l bilan bloklashni chetlab o'tib PIN tanlash mumkin edi
  - Mavjud PIN `setPin` bilan ustidan yozilmaydi (409) — frontend baribir faqat PIN yo'q bo'lganda chaqiradi
  - Ochiq ro'yxatdan o'tish endpointi yo'q — frontend'da `signUpWithPassword` hech qayerda ishlatilmaydi
  - `PLATFORM_BOOTSTRAP_KEY` HTTP oqimi (`platformSetAdminByEmail`) olib tashlandi — o'rniga `.env` dan seed (PHASE 5)
- **API endpointlar:** `/api/auth/*` (10 ta, jadvalda)
- **Testlar:** `test/auth.test.ts` (17), `test/pin.test.ts` (14), `test/password.test.ts` (4)
- **Brauzerda sinash:** frontend hali Convex'da. `curl` bilan: `db:seed` → `POST /api/auth/login` → `GET /api/auth/me`.
- **Qolgan ishlar:**
  - SMS orqali parol tiklash (`password_reset_codes`, Eskiz) — Eskiz ulangach
  - Eskirgan `rate_limits` va `sessions` qatorlarini davriy tozalash

## PHASE 5 — Platforma: kompaniya, filial, rol, admin 🟡

- **Convex manbasi:** `convex/companies.ts`, `convex/tenant.ts`, `userAdmin.ts`, `users.ts`, `admin.ts`; sahifalar `admin`, `onboarding`, `select-company`, `settings`, `tenant`
- **Ko'chirilgan modullar:**
  - **Foydalanuvchi ierarxiyasi** (yuqoridagi jadval):
    - `modules/platform/bootstrap.service.ts` + `cli/seed-bootstrap-admin.ts` (`db:seed`) — `.env` dan idempotent seed; parol almashsa sessiyalar bekor; 14 ta global standart rol; audit `BOOTSTRAP_ADMIN_SEEDED` (faqat o'zgargan maydon nomlari)
    - `modules/platform/company.service.ts` — `platformCreateCompany`: kompaniya, "Asosiy filial" (BR-001), 14 ta kompaniya roli, "Asosiy ombor" (WH-001), egasi va "Business Owner" a'zoligi — bitta tranzaksiyada; slug Convex qoidasi bilan
    - `modules/users/user-admin.service.ts` — platforma admini (telefon, parol, bloklash), kompaniya egasi (xodim qo'shish, parol tiklash), o'z paroli
  - **Tenant va RBAC:** `modules/company/tenant.ts` — `requireTenant`, `requireTenantForWrite`, `effectivePermissions`, `requirePermission` (`convex/tenant.ts` muqobili)
  - **Kompaniya konteksti va filiallar:** `modules/company/company.service.ts` — aktiv kompaniya, `mine`, `switch`, kompaniyani yangilash, filiallar
  - **A'zoni yangilash:** `modules/company/member.service.ts` — rol (`memberCount` bilan), filial va omborlar (faqat shu kompaniyaniki), a'zolik holati
  - Audit: `COMPANY_CREATED`, `USER_CREATED`, `EMPLOYEE_CREATED`, `USER_PASSWORD_RESET`, `USER_PHONE_CHANGED`, `USER_BLOCKED`, `USER_ACTIVATED`, `PASSWORD_CHANGED`, `COMPANY_SWITCHED`, `COMPANY_UPDATED`, `BRANCH_CREATED`, `BRANCH_UPDATED`, `MEMBER_UPDATED`
- **Convex'dan ataylab farqlar (xavfsizlik teshiklari yopildi):**
  - `updateMember` Convex'da har qanday a'zoga ochiq edi va rol nomini tekshirmasdi — Kassir o'zini "Business Owner" qila olardi. Endi faqat kompaniya egasi, egalik rollarini berib bo'lmaydi
  - `updateCompany`, `createBranch`, `updateBranch` Convex'da faqat a'zolikni tekshirardi — endi `company.manage` / `branches.manage`
  - `updateBranch` boshqa filiallarning `isDefault` ini tushirmasdi — endi doim bitta asosiy filial (bazada ham)
  - Convex'da "Direktor" ham foydalanuvchilarni boshqarardi — endi faqat kompaniya egasi (talab bo'yicha); Direktor `users.view` bilan ro'yxatni ko'radi
  - Bloklash yangi: `users.is_active = false` + barcha sessiyalar bekor
- **API endpointlar:** `/api/platform/*` (5 ta), `/api/company/*` (11 ta) — jadvalda
- **Testlar:** `test/bootstrap.test.ts` (13), `test/platform-admin.test.ts` (11), `test/company-owner.test.ts` (7), `test/company.test.ts` (20 — RBAC, almashtirish, to'xtatilgan kompaniya, filiallar, a'zoni yangilash). `db:seed` CLI qo'lda tekshirilgan.
- **Brauzerda sinash:** frontend hali Convex'da; `curl` bilan: admin → `POST /api/platform/companies` → egasi kirib `GET /api/company`, `POST /api/company/branches`, `POST /api/company/employees`.
- **Qolgan ishlar** (Convex funksiyalari bo'yicha):
  - Takliflar: `inviteMember`, `createInvitation`, `listInvitations`, `cancelInvitation`, `acceptInvitation`
  - Rollar: kompaniyaning o'z rollarini yaratish/tahrirlash (`roles.manage`) — Convex'da alohida modul, hali ko'rib chiqilmagan
  - Kompaniya audit jurnali (`audit.view`)
  - Platforma: `platformUpdateCompanyStatus`, `platformGetStats`, `platformListAuditLogs`, `platformGetCompany`, `platformListAllUsers`, `platformGetSettings` / `platformSaveSettings`, `isRegistrationEnabled`
  - Ommaviy: `getCompanyBySlug`, `verifyTenantAccess` (`/t/:slug` portal)
  - **Hal qilinmagan:** qo'shimcha platforma adminlarini kim tayinlaydi (`platformGrantAdmin` / `platformRevokeAdmin`); o'zi ro'yxatdan o'tish (`registerCompany`) qoladimi
  - `convex/admin.ts` hali batafsil ko'rib chiqilmagan

## PHASE 6 — Katalog ⬜

- **Convex manbasi:** `convex/products/` (products, categories, brands, units); sahifa `products`
- **Tayyor poydevor:** catalog jadvallari; `requireTenantForWrite` + `requirePermission("products.*")`
- **Ko'chirilgan modullar:** —
- **API endpointlar:** —
- **Brauzerda sinash:** —

## PHASE 7 — Ombor ⬜

- **Convex manbasi:** `convex/warehouse/` (warehouses, stock, inventoryCounts); sahifa `warehouse`
- **Tayyor poydevor:** inventory jadvallari; kompaniya yaratilganda "Asosiy ombor" (WH-001); a'zoning `allowedWarehouseIds` ruxsati (bo'sh = hammasi) — ombor amallarida hali qo'llanmagan
- **Ko'chirilgan modullar:** —
- **API endpointlar:** —
- **Brauzerda sinash:** —

## PHASE 8 — Moliya ⬜

- **Convex manbasi:** `convex/finance/` (accounts, cashAccounts, expenses, journalHelper); sahifa `finance`
- **Tayyor poydevor:** finance jadvallari
- **Ko'chirilgan modullar:** —
- **API endpointlar:** —
- **Brauzerda sinash:** —

## PHASE 9 — Xarid ⬜

- **Convex manbasi:** `convex/purchase/` (suppliers, orders); sahifa `purchase`
- **Tayyor poydevor:** purchase jadvallari
- **Ko'chirilgan modullar:** —
- **API endpointlar:** —
- **Brauzerda sinash:** —

## PHASE 10 — Savdo va POS ⬜

- **Convex manbasi:** `convex/sales/` (customers, orders, pos); sahifalar `sales`, `pos`
- **Tayyor poydevor:** sales jadvallari
- **Ko'chirilgan modullar:** —
- **API endpointlar:** —
- **Brauzerda sinash:** —

## PHASE 11 — CRM ⬜

- **Convex manbasi:** `convex/crm/` (leads, activities, salesReps, distribution); sahifa `crm`
- **Tayyor poydevor:** crm jadvallari
- **Ko'chirilgan modullar:** —
- **API endpointlar:** —
- **Brauzerda sinash:** —

## PHASE 12 — Ishlab chiqarish ⬜

- **Convex manbasi:** `convex/manufacturing/` (boms, orders); sahifa `manufacturing`
- **Tayyor poydevor:** manufacturing jadvallari
- **Ko'chirilgan modullar:** —
- **API endpointlar:** —
- **Brauzerda sinash:** —

## PHASE 13 — HR ⬜

- **Convex manbasi:** `convex/hr/` (employees, attendance, salary); sahifa `hr`
- **Tayyor poydevor:** hr jadvallari
- **Ko'chirilgan modullar:** —
- **API endpointlar:** —
- **Brauzerda sinash:** —

## PHASE 14 — Dashboard, hisobot, AI, bildirishnoma, fayl ⬜

- **Convex manbasi:** `convex/dashboard.ts`, `convex/notifications.ts`, `convex/analytics/` (reports, ai); sahifalar `dashboard`, `analytics`
- **Tayyor poydevor:** `notifications` jadvali; MinIO konteyneri (bucket va `STORAGE_*` sozlamalari hali yo'q)
- **Ko'chirilgan modullar:** —
- **API endpointlar:** —
- **Brauzerda sinash:** MinIO konsoli `http://localhost:9001` (faqat infratuzilma)

## PHASE 15 — Ma'lumotni Convex'dan ko'chirish ⬜

- **Tayyor poydevor:** har jadvalda `legacy_id` ustuni; login Convex Auth parol xeshlarini (lucia Scrypt) qabul qiladi — ko'chirilgan foydalanuvchilar parolini qayta o'rnatishi shart emas
- **Ko'chirilgan modullar:** —
- **API endpointlar:** —
- **Brauzerda sinash:** —

## PHASE 16 — Frontend'ni API'ga o'tkazish, deploy, Convex'ni o'chirish ⬜

- **Manba:** `src/` (barcha sahifalar hozir Convex hook'larini ishlatadi); auth uchun yagona kirish nuqtasi `src/hooks/use-auth.ts`
- **Tayyor poydevor:** `VITE_API_URL` `.env.example` da; server `WEB_ORIGIN` bilan CORS + cookie sozlangan; `/api/auth/*` javoblari Convex shakliga mos; `GET /api/company` frontend uchun ruxsatlar ro'yxatini qaytaradi (UX, backend baribir tekshiradi)
- **E'tibor:** `src/pages/admin/bootstrap.tsx` (kalit bilan bootstrap sahifasi) endi keraksiz — bootstrap admin `db:seed` orqali
- **Ko'chirilgan modullar:** —
- **API endpointlar:** —
- **Brauzerda sinash:** —

---

## Keyingi qadam

1. **Lokal:** `.env` ga `BOOTSTRAP_ADMIN_PHONE` / `BOOTSTRAP_ADMIN_PASSWORD` qo'shib `db:seed` — ishchi bazada birinchi kirish
2. **Hal qilinishi kerak:** qo'shimcha platforma adminlarini kim tayinlaydi; o'zi ro'yxatdan o'tish (`registerCompany`) qoladimi
3. **PHASE 5 davomi:** platforma admini uchun kompaniya holati (`platformUpdateCompanyStatus` — to'xtatish/faollashtirish), kompaniya tafsiloti, barcha foydalanuvchilar, audit jurnali; keyin takliflar va kompaniya rollari
4. **PHASE 4 qoldig'i:** eskirgan `rate_limits` / `sessions` ni tozalash; SMS tiklash — Eskiz ulangach

Kichik infratuzilma ishi: MinIO'da `bum-erp` bucket yaratish va `.env` ga `STORAGE_*` qo'shish (PHASE 14 dan oldin).

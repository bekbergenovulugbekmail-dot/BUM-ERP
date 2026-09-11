# PostgreSQL migratsiyasi — holat

> Convex → PostgreSQL (Fastify + Drizzle) migratsiyasi.
> **Har sessiya oxirida yangilanadi** (qoida `CLAUDE.md` da).

| | |
|---|---|
| Branch | `feat/postgres-migration` |
| Oxirgi yangilanish | 2026-09-11 |
| Umumiy holat | 3 / 16 PHASE tugallandi, PHASE 4 jarayonda |
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
| 5 | Platforma: kompaniya, filial, rol, admin | ⬜ boshlanmagan |
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

## Tayyor API endpointlar (jami)

| Metod | Yo'l | Auth | Convex'dagi muqobili |
|---|---|---|---|
| GET | `/health` | — | — |
| POST | `/api/auth/login` | — | `signIn("password")` |
| POST | `/api/auth/logout` | — | `signOut` |
| GET | `/api/auth/me` | sessiya | `users.getCurrentUser` |
| GET | `/api/auth/security` | sessiya | `pin.getSecuritySettings` |
| POST | `/api/auth/pin` | sessiya | `pin.setPin` |
| POST | `/api/auth/pin/change` | sessiya | `pin.changePin` |
| POST | `/api/auth/pin/remove` | sessiya | `pin.removePin` |
| POST | `/api/auth/pin/verify` | sessiya | `pin.verifyPin` |
| PUT | `/api/auth/auto-lock` | sessiya | `pin.setAutoLockTimeout` |

Xatolar doim `{ code, message }` shaklida (Convex bilan bir xil).

## Lokal muhit

- **PostgreSQL 18** — `docker compose up -d` (`bum-pg`, `postgres`/`bumerp`, 5432).
  - `bumerp` — ishchi baza: sxema qo'llangan, **ma'lumot yo'q (foydalanuvchi ham yo'q)**.
  - `bumerp_test` — testlar uchun, `pnpm test` o'zi yaratadi va har testda tozalaydi.
- **MinIO** — 9000 (S3), 9001 (konsol). Ishlaydi, lekin `bum-erp` bucket yo'q
  va `.env` da `STORAGE_*` yo'q → `features.storage` o'chiq.
- **Migratsiya:** `pnpm --filter @bum/api db:migrate` (`.env` o'zi yuklanadi)
- **API server:** `pnpm --filter @bum/api dev` → `http://localhost:3000`
- **Testlar:** `pnpm --filter @bum/api test` — 31 ta test

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
- **Migratsiya:** `0000_fantastic_speed.sql` — lokal PG18 ga qo'llangan va tekshirilgan.
- **API endpointlar:** —
- **Brauzerda sinash:** —
- **Commitlar:** `c5c082a`, `2bab68c`

## PHASE 3 — API poydevori ✅

- **Ko'chirilgan:** `db/client.ts` (pg havza + Drizzle, numeric/int8 string bo'lib qoladi); `db/transaction.ts` (`withTransaction`); `shared/errors.ts` (`{ code, message }` — Convex bilan bir xil shakl); `shared/logger.ts` (pino, maxfiy maydonlar redact, testda jim); `env.ts` (zod tekshiruvi); `load-env.ts` (ildizdagi `.env`); `db/migrate.ts`; Fastify server (helmet, cors, cookie), dual-stack `HOST=::`.
- **API endpointlar:** `GET /health`
- **Brauzerda sinash:** `http://localhost:3000/health` → `{"status":"ok",...}`
- **Commitlar:** `3a9872d`, `045f6e1`, `fe7f664`, `43a3fcd`

## PHASE 4 — Auth va sessiyalar 🟡

- **Convex manbasi:** `convex/auth.ts`, `convex/pin.ts`, `users.getCurrentUser`; sahifalar `login`, `admin/login`, lock screen, sozlamalar → xavfsizlik
- **Ko'chirilgan modullar** (`apps/api/src/modules/auth/`):
  - `password.ts` — argon2id; Convex Auth'ning lucia Scrypt xeshlarini ham tekshiradi va birinchi kirishda argon2id ga o'tkazadi (haqiqiy lucia bilan ikki tomonlama tekshirilgan)
  - `session.ts` — 32 baytli token httpOnly cookie'da (`bum_session`), bazada SHA-256; mutlaq (30 kun) + faolsizlik (12 soat, sirpanuvchi) muddat; o'chirilgan hisob sessiyalari ishlamaydi
  - `auth.service.ts` — login: telefon normallashtirish (`packages/shared/phone.ts`), noma'lum raqam va xato parolga bir xil javob va bir xil vaqt, faol bo'lmagan hisob 403, audit (`login_success` / `login_failed`)
  - `pin.service.ts` — PIN argon2id; 5 xato → 5 daqiqa blok; `reason` kodlari Convex bilan bir xil (`WRONG_PIN:n`, `PIN_LOCKED:s`, `SESSION_MISMATCH`, …)
  - `guard.ts` — `requireAuth` preHandler
  - `shared/rate-limit.ts` — PostgreSQL'da: raqamga 5, IP ga 30 xato / 15 daqiqa
  - `shared/audit.ts` — audit jurnali yozuvi
- **Convex'dan ataylab farqlar:**
  - PIN tekshiruvi `change`/`remove` da ham urinishlarni hisoblaydi — Convex'da shu yo'l bilan bloklashni chetlab o'tib PIN tanlash mumkin edi
  - Mavjud PIN `setPin` bilan ustidan yozilmaydi (409) — frontend baribir faqat PIN yo'q bo'lganda chaqiradi
  - Ochiq ro'yxatdan o'tish endpointi yo'q — frontend'da `signUpWithPassword` hech qayerda ishlatilmaydi, akkauntni admin yaratadi (PHASE 5)
- **API endpointlar:** yuqoridagi jadvaldagi 9 ta `/api/auth/*`
- **Testlar:** `test/auth.test.ts` (17), `test/pin.test.ts` (14) — alohida `bumerp_test` bazasida, hammasi o'tadi
- **Brauzerda sinash:** hali yo'q — frontend Convex'da, ishchi bazada foydalanuvchi yo'q. Hozircha test bazasiga seed qilib `curl` bilan sinaladi (login → me → PIN → logout → me=401 oqimi tekshirilgan).
- **Qolgan ishlar:**
  - SMS orqali parol tiklash (`password_reset_codes`, Eskiz) — Convex'da yo'q edi, yangi funksiya
  - Eskirgan `rate_limits` va `sessions` qatorlarini tozalash
  - Birinchi foydalanuvchini yaratish yo'li (seed/bootstrap buyrug'i) — busiz ishchi bazada kirib bo'lmaydi

## PHASE 5 — Platforma: kompaniya, filial, rol, admin ⬜

- **Convex manbasi:** `convex/companies.ts`, `tenant.ts`, `users.ts`, `userAdmin.ts`, `admin.ts`; sahifalar `admin`, `onboarding`, `select-company`, `settings`, `tenant`
- **Tayyor poydevor:** platform jadvallari; RBAC katalogi `packages/shared/src/permissions.ts`; `requireAuth` va `revokeUserSessions` (parolni admin tiklaganda kerak)
- **Ko'chirilgan modullar:** —
- **API endpointlar:** —
- **Brauzerda sinash:** —

## PHASE 6 — Katalog ⬜

- **Convex manbasi:** `convex/products/` (products, categories, brands, units); sahifa `products`
- **Tayyor poydevor:** catalog jadvallari
- **Ko'chirilgan modullar:** —
- **API endpointlar:** —
- **Brauzerda sinash:** —

## PHASE 7 — Ombor ⬜

- **Convex manbasi:** `convex/warehouse/` (warehouses, stock, inventoryCounts); sahifa `warehouse`
- **Tayyor poydevor:** inventory jadvallari
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
- **Tayyor poydevor:** `VITE_API_URL` `.env.example` da; server `WEB_ORIGIN` bilan CORS + cookie sozlangan; `/api/auth/*` javoblari Convex shakliga mos
- **Ko'chirilgan modullar:** —
- **API endpointlar:** —
- **Brauzerda sinash:** —

---

## Keyingi qadam

**PHASE 4 ni yakunlash:**
1. Birinchi foydalanuvchi / platforma adminini yaratish buyrug'i (`PLATFORM_BOOTSTRAP_KEY` yoki CLI seed) — ishchi bazada kirib sinash uchun shart
2. SMS orqali parol tiklash: `POST /api/auth/password-reset/request` va `/confirm` (Eskiz, OTP xeshlangan, rate limit)
3. Eskirgan `rate_limits` / `sessions` qatorlarini davriy tozalash

Keyin — **PHASE 5** (kompaniya, a'zolik, rollar, admin foydalanuvchi boshqaruvi).

Kichik infratuzilma ishi: MinIO'da `bum-erp` bucket yaratish va `.env` ga `STORAGE_*` qo'shish (PHASE 14 dan oldin).

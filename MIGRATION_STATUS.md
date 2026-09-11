# PostgreSQL migratsiyasi — holat

> Convex → PostgreSQL (Fastify + Drizzle) migratsiyasi.
> **Har sessiya oxirida yangilanadi** (qoida `CLAUDE.md` da).

| | |
|---|---|
| Branch | `feat/postgres-migration` |
| Oxirgi yangilanish | 2026-09-11 |
| Umumiy holat | 3 / 16 PHASE tugallandi |
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
| 4 | Auth va sessiyalar | ⬜ boshlanmagan |
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

| Metod | Yo'l | Vazifasi |
|---|---|---|
| GET | `/health` | Server va DB ulanishi (`select 1`), yoqilgan integratsiyalar |

Boshqa marshrut yo'q — `server.ts` da modul marshrutlari hali izohda.

## Lokal muhit

- **PostgreSQL 18** — `docker compose up -d` (`bum-pg`, `postgres`/`bumerp`, 5432).
  Sxema qo'llangan: 61 jadval, 32 enum, 166 FK, 36 CHECK, 151 indeks. Ma'lumot yo'q.
- **MinIO** — 9000 (S3), 9001 (konsol). Ishlaydi, lekin `bum-erp` bucket yo'q
  va `.env` da `STORAGE_*` yo'q → `features.storage` o'chiq.
- **Migratsiya:** `pnpm --filter @bum/api db:migrate` (`.env` o'zi yuklanadi)
- **API server:** `pnpm --filter @bum/api dev` → `http://localhost:3000`

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

- **Ko'chirilgan:** `db/client.ts` (pg havza + Drizzle, numeric/int8 string bo'lib qoladi); `db/transaction.ts` (`withTransaction`); `shared/errors.ts` (`{ code, message }` — Convex bilan bir xil shakl); `shared/logger.ts` (pino, maxfiy maydonlar redact); `env.ts` (zod tekshiruvi); `load-env.ts` (ildizdagi `.env`); `db/migrate.ts`; Fastify server (helmet, cors, cookie), dual-stack `HOST=::`.
- **API endpointlar:** `GET /health`
- **Brauzerda sinash:** `http://localhost:3000/health` → `{"status":"ok",...}`
- **Hali yo'q:** avtomatik testlar (vitest sozlangan, test fayllari yo'q).
- **Commitlar:** `3a9872d`, `045f6e1`, `fe7f664`, `43a3fcd`

## PHASE 4 — Auth va sessiyalar ⬜

- **Convex manbasi:** `convex/auth.ts`, `convex/auth.config.ts`, `convex/pin.ts`; sahifalar `login`, `admin/login`
- **Tayyor poydevor:** `sessions`, `password_reset_codes`, `rate_limits` jadvallari; `@node-rs/argon2`; cookie plugin; `SESSION_*` va `ESKIZ_*` sozlamalari
- **Ko'chirilgan modullar:** —
- **API endpointlar:** —
- **Brauzerda sinash:** —

## PHASE 5 — Platforma: kompaniya, filial, rol, admin ⬜

- **Convex manbasi:** `convex/companies.ts`, `tenant.ts`, `users.ts`, `userAdmin.ts`, `admin.ts`; sahifalar `admin`, `onboarding`, `select-company`, `settings`, `tenant`
- **Tayyor poydevor:** platform jadvallari; RBAC katalogi `packages/shared/src/permissions.ts`
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

- **Tayyor poydevor:** har jadvalda `legacy_id` ustuni
- **Ko'chirilgan modullar:** —
- **API endpointlar:** —
- **Brauzerda sinash:** —

## PHASE 16 — Frontend'ni API'ga o'tkazish, deploy, Convex'ni o'chirish ⬜

- **Manba:** `src/` (barcha sahifalar hozir Convex hook'larini ishlatadi)
- **Tayyor poydevor:** `VITE_API_URL` `.env.example` da; server `WEB_ORIGIN` bilan CORS + cookie sozlangan
- **Ko'chirilgan modullar:** —
- **API endpointlar:** —
- **Brauzerda sinash:** —

---

## Keyingi qadam

**PHASE 4 — Auth va sessiyalar:**
1. Parol xeshlash (argon2id) va sessiya servisi (`sessions.token_hash`, mutlaq + faolsizlik muddati)
2. `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
3. Login uchun rate limit (`rate_limits`)
4. Auth marshrutlari uchun birinchi vitest testlari

Kichik infratuzilma ishi: MinIO'da `bum-erp` bucket yaratish va `.env` ga `STORAGE_*` qo'shish (PHASE 14 dan oldin).

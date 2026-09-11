# BUM ERP

- **Backend:** `apps/api` — Fastify 5 + Drizzle + PostgreSQL 18 (migratsiyalar `apps/api/src/db/migrations`)
- **Umumiy kod:** `packages/shared` — ruxsatlar, telefon formati, xato kodlari. Production'da build'siz,
  Node type stripping bilan yuklanadi: faqat o'chiriladigan TS sintaksisi va `.ts` import kengaytmalari
- **Frontend:** `src/` — Vite + React; API'ga faqat `@/lib/api.ts` va `@/lib/query.ts` orqali,
  auth `@/hooks/use-auth.ts`, kompaniya va ruxsatlar `@/hooks/use-company.ts`
- **Deploy:** `apps/api/Dockerfile` (API), `Dockerfile.web` (SPA + nginx, `/api` proksi)

## PostgreSQL migratsiyasi

Convex → PostgreSQL migratsiyasi `feat/postgres-migration` branch'ida
(`apps/api`, `packages/shared`). Holati `MIGRATION_STATUS.md` da.

**Har sessiya oxirida `MIGRATION_STATUS.md` ni yangilab, commit qiling:**
PHASE holatlari, ko'chirilgan modullar, tayyor API endpointlar, brauzerda
nimani sinash mumkin va keyingi qadam. Holatni faqat tekshirilgan dalil
(git log, `apps/api/src` marshrutlari, baza holati) asosida o'zgartiring.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## PostgreSQL migratsiyasi

Convex → PostgreSQL migratsiyasi `feat/postgres-migration` branch'ida
(`apps/api`, `packages/shared`). Holati `MIGRATION_STATUS.md` da.

**Har sessiya oxirida `MIGRATION_STATUS.md` ni yangilab, commit qiling:**
PHASE holatlari, ko'chirilgan modullar, tayyor API endpointlar, brauzerda
nimani sinash mumkin va keyingi qadam. Holatni faqat tekshirilgan dalil
(git log, `apps/api/src` marshrutlari, baza holati) asosida o'zgartiring.

# BUM ERP API (Fastify + Drizzle).
#
#   docker build -f apps/api/Dockerfile -t bum-erp-api .      (kontekst — repo ildizi)
#   docker run --env-file .env -p 3000:3000 bum-erp-api
#   migratsiya (deploydan oldin):  docker run --env-file .env bum-erp-api node dist/db/migrate.js
#
# Workspace tuzilishi ataylab saqlanadi: @bum/shared TypeScript manba sifatida (build'siz)
# Node type stripping bilan yuklanadi — bu faqat fayl node_modules ICHIDA bo'lmasa ishlaydi
# (pnpm symlink orqali packages/shared ga). Shu sababli `pnpm deploy` ishlatilmaydi.

FROM node:22.23-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

FROM base AS build
RUN pnpm install --frozen-lockfile --filter @bum/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @bum/api build

FROM base AS runtime
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod --filter @bum/api... && pnpm store prune
COPY packages/shared/src packages/shared/src
COPY --from=build /app/apps/api/dist apps/api/dist
# migrate.js .sql fayllarni src dan o'qiydi
COPY apps/api/src/db/migrations apps/api/src/db/migrations
WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.js"]

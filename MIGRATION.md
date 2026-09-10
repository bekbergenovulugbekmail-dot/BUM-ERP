# Hercules'dan uzilish — bosqichma-bosqich

Backend deyarli toza: `convex/users.ts` standart `ctx.auth.getUserIdentity()`
va `tokenIdentifier` ishlatadi. Uzilish frontend auth qatlami + AI gateway'da.

**Jami 5 ta bog'liqlik nuqtasi:**

| # | Joy | Almashtiruvchi |
|---|---|---|
| 1 | `@usehercules/auth` (7 fayl) | `react-oidc-context` (allaqachon o'rnatilgan) |
| 2 | `@usehercules/vite` | olib tashlash |
| 3 | `@usehercules/eslint-plugin` | olib tashlash |
| 4 | `HERCULES_OIDC_*` env | `OIDC_*` |
| 5 | `ai-gateway.hercules.app` | Anthropic API |

---

## 0-bosqich — OIDC provayder tanlash

Kod sof OIDC'ga o'tgach, provayder shunchaki `.env` qiymati bo'lib qoladi.
Bir marta to'g'ri qilinsa, keyingi ko'chish soatlar emas, daqiqalar oladi.

| Variant | Mustaqillik | Mehnat | Narx |
|---|---|---|---|
| **Logto** (self-host, Docker) | To'liq | O'rta | Bepul |
| **Keycloak** (self-host) | To'liq | Yuqori | Bepul |
| **Logto Cloud** | O'rta | Past | ~$0–16/oy |
| **Auth0** | O'rta | Past | Bepul 25k MAU |
| **Clerk** | O'rta | Eng past | Bepul 10k MAU |

Sizning holatingiz uchun: **Logto self-hosted**. Sabab — OIDC standartiga
to'liq mos, multi-tenant organizations bor, Docker bilan bir buyruqda ko'tariladi,
va kod hech qanday vendor SDK ishlatmagani uchun keyin xohlagan paytda
Keycloak'ga o'tish mumkin.

Provayterda quyidagilarni sozlang:
- Application turi: **SPA / Public client**
- Redirect URI: `https://app.bum-erp.uz/auth/callback`, `http://localhost:5173/auth/callback`
- Post-logout URI: `https://app.bum-erp.uz`, `http://localhost:5173`
- Wildcard subdomain ishlatsangiz, har bir tenant subdomenini ham qo'shing

---

## 1-bosqich — Fayllarni almashtirish

Quyidagi 4 ta faylni ustiga yozing:

```
src/hooks/use-auth.ts
src/components/providers/auth.tsx
src/components/providers/convex.tsx
src/pages/auth/Callback.tsx
```

**Muhim:** `use-auth.ts` adapter vazifasini bajaradi. Kelajakda provayder
o'zgarsa, faqat shu fayl tahrirlanadi. Boshqa hech qayerda auth kutubxonasini
to'g'ridan-to'g'ri import qilmang.

---

## 2-bosqich — vite.config.ts

```diff
-import hercules from "@usehercules/vite";
-  plugins: [react(), tailwindcss(), hercules()],
+  plugins: [react(), tailwindcss()],
```

---

## 3-bosqich — eslint.config.mjs

```diff
-import herculesPlugin from "@usehercules/eslint-plugin";
       convexPlugin.configs.recommended,
-      herculesPlugin.configs.recommended,
```

---

## 4-bosqich — convex/auth.config.ts

```ts
import { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      domain: process.env.OIDC_ISSUER!,      // masalan https://auth.bum-erp.uz/oidc
      applicationID: process.env.OIDC_CLIENT_ID!,
    },
  ],
} satisfies AuthConfig;
```

`domain` — issuer URL, `/.well-known/openid-configuration` shu manzil ostida
bo'lishi kerak. `applicationID` — id_token ichidagi `aud` qiymati.

---

## 5-bosqich — AI moduli

`convex/analytics/ai.ts` ni almashtiring. Qo'shimcha:

```bash
pnpm add @anthropic-ai/sdk
pnpm remove openai
```

`convex.json`:
```diff
-  "externalPackages": ["openai", "jspdf", "jspdf-autotable", "bcryptjs"]
+  "externalPackages": ["@anthropic-ai/sdk", "jspdf", "jspdf-autotable", "bcryptjs"]
```

---

## 6-bosqich — Paketlarni olib tashlash

```bash
pnpm remove @usehercules/auth @usehercules/vite @usehercules/eslint-plugin
pnpm install
```

Tekshiruv — hech narsa chiqmasligi kerak:
```bash
grep -rn "hercules" src convex *.ts *.mjs *.json --include="*" -i
```

---

## 7-bosqich — Muhit o'zgaruvchilari

`.env.local` (frontend):
```
VITE_CONVEX_URL=https://<deployment>.convex.cloud
VITE_OIDC_AUTHORITY=https://auth.bum-erp.uz/oidc
VITE_OIDC_CLIENT_ID=<client_id>
```

Convex backend:
```bash
npx convex env set OIDC_ISSUER https://auth.bum-erp.uz/oidc
npx convex env set OIDC_CLIENT_ID <client_id>
npx convex env set ANTHROPIC_API_KEY sk-ant-...
```

---

## 8-bosqich — Kichik tuzatishlar

`src/components/erp-layout.tsx` da `user?.profile?.name` ishlatilgan
(312 va 192-qatorlar atrofida). Adapter endi tekis maydon beradi:

```diff
-{user?.profile?.name?.[0]?.toUpperCase() ?? "U"}
+{user?.name?.[0]?.toUpperCase() ?? "U"}
-{user?.profile?.name ?? t("auth.welcome")}
+{user?.name ?? t("auth.welcome")}
```

Shu naqshni boshqa joylarda ham qidiring:
```bash
grep -rn "profile\?\." src
```

---

## 9-bosqich — Sinov ro'yxati

- [ ] `pnpm lint` toza
- [ ] `pnpm build` xatosiz
- [ ] Login → callback → dashboard
- [ ] Sahifani yangilash (F5) — sessiya saqlanadi
- [ ] Logout → login sahifasi
- [ ] Token muddati tugagach avtomatik yangilanish
- [ ] `admin.bum-erp.uz` surface alohida ishlaydi
- [ ] Ikki xil tenant — ma'lumot aralashmayapti
- [ ] AI assistent Claude orqali javob beradi
- [ ] Tarjimalar (uz / ru / kk) buzilmagan

---

## Xavf

`updateCurrentUser` mantiqi: birinchi ro'yxatdan o'tgan foydalanuvchi
**Superadmin** bo'ladi. Migratsiyadan keyin `tokenIdentifier` formati
o'zgaradi — eski `users` yozuvlari yangi tokenlar bilan mos kelmaydi.

Ikki variant:
1. **Toza start** (demo ma'lumot bo'lgani uchun tavsiya etiladi) — `users`
   jadvalini tozalab, o'zingiz birinchi bo'lib kiring.
2. **Ko'chirish** — bir martalik migratsiya mutation yozib, eski
   `tokenIdentifier` larni email bo'yicha yangilariga moslashtirish.

/**
 * Modul guard — server zanjiri: Auth → Company → Subscription/License → Module → Role/Permission → amal.
 *
 * Har API marshruti prefiksi bo'yicha modul(lar)ga bog'lanadi: `onRoute` hook marshrut darajasidagi preHandler qo'shadi,
 * u plagin hook'lari (`requireAuth` / `requireDevice`) dan keyin, handler (tenant, obuna, ruxsat) dan oldin ishlaydi.
 * Modul o'chiq bo'lsa — 403 MODULE_DISABLED. Obuna tugagan yoki a'zolik yo'q bo'lsa — avval o'sha xato (obuna modul
 * holatidan ustun). Bir nechta modulga umumiy API (masalan, mijozlar) — kamida bittasi yoqilgan bo'lsa ochiq.
 *
 * Modulga bog'lanmagan (hech qachon yopilmaydi): kirish, ro'yxatdan o'tish, ommaviy, platforma, kompaniya, obuna,
 * bildirishnomalar, fayllar, valyuta kurslari (hamma bo'limda kerak), bosh sahifa ko'rsatkichlari, kassa qurilmasining
 * holat/yangilanish marshrutlari.
 */
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { ModuleKey } from "@bum/shared";
import { db } from "../../db/client.js";
import { assertDeviceSubscription } from "../pos-device/device-auth.js";
import { isAnyModuleEnabled, moduleDisabledError } from "./modules.service.js";
import { requireTenant } from "./tenant.js";

type Rule = { prefix: string; modules: readonly ModuleKey[] | null };

/** Birinchi mos kelgan qoida (aniqroq prefiks yuqorida). `null` — modulga bog'lanmagan. */
const RULES: readonly Rule[] = [
  { prefix: "/api/sales/pos", modules: ["pos"] },
  { prefix: "/api/sales/customers", modules: ["sales", "pos", "crm", "delivery", "distribution"] },
  { prefix: "/api/sales/cashback", modules: ["sales", "pos"] },
  // Buyurtmalar, to'lovlar va qaytarishlar — savdo va POS cheklari uchun umumiy
  { prefix: "/api/sales", modules: ["sales", "pos"] },
  { prefix: "/api/pos-device/setup", modules: null },
  { prefix: "/api/pos-device/session", modules: null },
  { prefix: "/api/pos-device/app-update", modules: null },
  { prefix: "/api/pos-device/unregister", modules: null },
  { prefix: "/api/pos-device/releases", modules: null },
  { prefix: "/api/pos-device", modules: ["pos"] },
  { prefix: "/api/pos/devices", modules: ["pos"] },
  { prefix: "/api/catalog", modules: ["products"] },
  // Omborlar ro'yxati tashkiliy ma'lumot (xodimga ombor biriktirish, kassa) — zaxira amallari ombor moduliga
  { prefix: "/api/inventory/warehouses", modules: null },
  { prefix: "/api/inventory", modules: ["warehouse"] },
  { prefix: "/api/purchase", modules: ["purchase"] },
  { prefix: "/api/manufacturing", modules: ["manufacturing"] },
  { prefix: "/api/crm", modules: ["crm"] },
  { prefix: "/api/distribution", modules: ["distribution"] },
  { prefix: "/api/sales-agent", modules: ["distribution"] },
  { prefix: "/api/delivery", modules: ["delivery"] },
  { prefix: "/api/finance/currencies", modules: null },
  { prefix: "/api/finance", modules: ["finance"] },
  { prefix: "/api/hr", modules: ["hr"] },
  { prefix: "/api/analytics/dashboard", modules: null },
  { prefix: "/api/analytics", modules: ["reports"] },
  { prefix: "/api/ai", modules: ["reports"] },
];

export function modulesForRoute(url: string): readonly ModuleKey[] | null {
  const rule = RULES.find((item) => url === item.prefix || url.startsWith(`${item.prefix}/`));
  return rule?.modules ?? null;
}

export function moduleGuard(modules: readonly ModuleKey[]): preHandlerHookHandler {
  return async function moduleGuardHandler(req: FastifyRequest) {
    const device = req.posDevice ?? null;
    const user = req.auth?.user ?? null;
    const companyId = device?.company.id ?? user?.activeCompanyId ?? null;
    // Kompaniya konteksti yo'q — handler o'z xatosini qaytaradi (tizimga kiring / kompaniya tanlanmagan)
    if (!companyId) return;
    if (await isAnyModuleEnabled(db, companyId, modules)) return;
    // A'zolik va obuna xatosi modul holatidan ustun
    if (device) assertDeviceSubscription(device);
    else if (user) await requireTenant(db, user);
    throw moduleDisabledError(modules);
  };
}

/** Modul marshrutlari ro'yxatdan o'tishidan OLDIN chaqiriladi (`onRoute` keyingi plaginlarga meros bo'ladi). */
export function registerModuleGuard(app: FastifyInstance): void {
  app.addHook("onRoute", (route) => {
    const modules = modulesForRoute(route.url);
    if (!modules) return;
    const existing = route.preHandler ? (Array.isArray(route.preHandler) ? route.preHandler : [route.preHandler]) : [];
    route.preHandler = [...existing, moduleGuard(modules)];
  });
}

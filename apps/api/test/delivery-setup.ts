/**
 * Dostavka testlari uchun umumiy tayyorgarlik: kompaniya (mahsulot, qoldiq, koordinatali mijoz), yetkazuvchi agent
 * (xodimdan yaratish API'si orqali), tasdiqlangan buyurtma (avtomatik yetkazma bilan), siyosat va GPS nuqtalari.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { DEFAULT_DELIVERY_POLICY, type DeliveryPolicy } from "@bum/shared";
import { db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { createCompany, login, uniquePhone } from "./helpers.js";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Server bilan bir xil Yer radiusi — meridian bo'ylab `meters` shimolga nuqta (haversine aynan shu masofani beradi). */
const EARTH_RADIUS_M = 6_371_008.8;
export const shop = { latitude: 41.311081, longitude: 69.240562 };
export const northOf = (meters: number) => ({ latitude: shop.latitude + (meters / EARTH_RADIUS_M) * (180 / Math.PI), longitude: shop.longitude });
export const iso = (secondsAgo = 0) => new Date(Date.now() - secondsAgo * 1000).toISOString();
/** Mijozdan `meters` masofadagi yangi, aniq GPS o'lchovi. */
export const near = (meters = 20, secondsAgo = 0) => ({ ...northOf(meters), accuracy: 10, recordedAt: iso(secondsAgo) });

/** Baytlari bo'yicha JPEG va PNG (server turini baytlardan aniqlaydi). */
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]).toString("base64");
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]).toString("base64");

export const localToday = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
export const localTomorrow = () => new Date(Date.now() + 29 * 3_600_000).toISOString().slice(0, 10);

export function caller(app: FastifyInstance) {
  return (cookie: string, method: Method, url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
}

export async function resetUnits() {
  await db.delete(units);
  await seedDefaultUnits(db);
}

export type DeliveryCompany = Awaited<ReturnType<typeof deliveryCompany>>;

export async function deliveryCompany(app: FastifyInstance, adminCookie: string, name: string) {
  const call = caller(app);
  const company = await createCompany(app, adminCookie, { name });
  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const productRes = await call(company.ownerCookie, "POST", "/api/catalog/products", {
    name: "Coca Cola 1L",
    sku: "COLA",
    baseUnitId: piece,
    salesPrice: "5000",
    taxRate: "0",
  });
  if (productRes.statusCode !== 201) throw new Error(`Mahsulot: ${productRes.body}`);
  const productId = productRes.json().product.id as string;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId, quantity: "100", costPrice: "3000" });
  const customerRes = await call(company.ownerCookie, "POST", "/api/sales/customers", { name: `${name} do'koni`, phone: uniquePhone("95"), ...shop });
  if (customerRes.statusCode !== 201) throw new Error(`Mijoz: ${customerRes.body}`);
  return { ...company, productId, warehouseId, customerId: customerRes.json().customer.id as string };
}

export async function deliveryAgent(app: FastifyInstance, company: { ownerCookie: string }, overrides: Record<string, unknown> = {}) {
  const call = caller(app);
  const phone = uniquePhone("97");
  const password = "kuryer-parol-123";
  const res = await call(company.ownerCookie, "POST", "/api/delivery/agents", { name: "Kuryer", phone, password, ...overrides });
  if (res.statusCode !== 201) throw new Error(`Agent yaratilmadi: ${res.statusCode} ${res.body}`);
  const { cookie } = await login(app, phone, password);
  if (!cookie) throw new Error("Agent kira olmadi");
  const agent = res.json().agent as { id: string; userId: string; employeeId: string; code: string };
  return { ...agent, phone, password, cookie };
}

export async function startShift(app: FastifyInstance, cookie: string, meters = 40) {
  const res = await caller(app)(cookie, "POST", "/api/delivery/agent/work-session/start", near(meters));
  if (res.statusCode !== 201 && res.statusCode !== 200) throw new Error(`Ish sessiyasi: ${res.statusCode} ${res.body}`);
  return res.json().session as { id: string };
}

/** Tasdiqlangan buyurtma ("yetkazish kerak" belgisi bilan) — yetkazma avtomatik yaratiladi. */
export async function confirmedOrder(app: FastifyInstance, company: DeliveryCompany, quantity = "10", extra: Record<string, unknown> = {}) {
  const call = caller(app);
  const created = await call(company.ownerCookie, "POST", "/api/sales/orders", {
    customerId: company.customerId,
    warehouseId: company.warehouseId,
    orderDate: new Date().toISOString().slice(0, 10),
    deliveryRequired: true,
    items: [{ productId: company.productId, quantity }],
    ...extra,
  });
  if (created.statusCode !== 201) throw new Error(`Buyurtma: ${created.statusCode} ${created.body}`);
  const orderId = created.json().order.id as string;
  const confirmed = await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/confirm`);
  if (confirmed.statusCode !== 200) throw new Error(`Tasdiqlash: ${confirmed.statusCode} ${confirmed.body}`);
  return orderId;
}

export async function taskForOrder(app: FastifyInstance, cookie: string, orderId: string) {
  const res = await caller(app)(cookie, "GET", "/api/delivery/tasks?limit=200");
  const task = (res.json().tasks as { id: string; orderId: string }[]).find((item) => item.orderId === orderId);
  if (!task) throw new Error(`Yetkazma topilmadi: ${res.body}`);
  return task;
}

export async function setPolicy(app: FastifyInstance, cookie: string, patch: Partial<DeliveryPolicy>) {
  const res = await caller(app)(cookie, "PUT", "/api/delivery/policy", { ...DEFAULT_DELIVERY_POLICY, ...patch });
  if (res.statusCode !== 200) throw new Error(`Siyosat: ${res.statusCode} ${res.body}`);
  return res.json().policy as DeliveryPolicy;
}

export const NO_PROOFS = { confirmation: { otp: false, signature: false, photo: false } } satisfies Partial<DeliveryPolicy>;

/** Agent amali (har chaqiruvda yangi so'rov kaliti, berilmasa). */
export function agentAction(app: FastifyInstance, cookie: string, taskId: string, action: string, body: Record<string, unknown> = {}) {
  return caller(app)(cookie, "POST", `/api/delivery/agent/tasks/${taskId}/${action}`, { clientRequestId: randomUUID(), ...body });
}

export async function assign(app: FastifyInstance, ownerCookie: string, taskId: string, deliveryAgentId: string) {
  const res = await caller(app)(ownerCookie, "POST", `/api/delivery/tasks/${taskId}/assign`, { deliveryAgentId });
  if (res.statusCode !== 200) throw new Error(`Biriktirish: ${res.statusCode} ${res.body}`);
  return res.json().task;
}

/** Biriktirish → qabul → yo'lga → yetib keldi (mijozdan `meters`). */
export async function arrivedTask(app: FastifyInstance, company: DeliveryCompany, agent: { id: string; cookie: string }, quantity = "10", meters = 30) {
  const orderId = await confirmedOrder(app, company, quantity);
  const { id: taskId } = await taskForOrder(app, company.ownerCookie, orderId);
  await assign(app, company.ownerCookie, taskId, agent.id);
  for (const [action, body] of [
    ["accept", {}],
    ["start", {}],
    ["arrive", near(meters)],
  ] as const) {
    const res = await agentAction(app, agent.cookie, taskId, action, body);
    if (res.statusCode !== 200) throw new Error(`${action}: ${res.statusCode} ${res.body}`);
  }
  return { orderId, taskId };
}

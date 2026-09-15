import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { cashAccounts } from "../src/db/schema/finance.js";
import { notifications } from "../src/db/schema/notifications.js";
import { buildServer } from "../src/server.js";
import { NO_PROOFS, agentAction, arrivedTask, caller, deliveryAgent, deliveryCompany, resetUnits, setPolicy, startShift, type DeliveryCompany } from "./delivery-setup.js";
import { addEmployee, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let adminCookie: string;
let company: DeliveryCompany;
let call: ReturnType<typeof caller>;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  call = caller(app);
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  await resetUnits();
  adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  company = await deliveryCompany(app, adminCookie, "Siyosat");
});

const owner = () => company.ownerCookie;

async function employeeWith(name: string, permissions: string[]) {
  const role = await call(owner(), "POST", "/api/company/roles", { name, permissions });
  expect(role.statusCode, role.body).toBe(201);
  return addEmployee(app, company, name);
}

async function savePolicy(policy: Record<string, unknown>) {
  const res = await call(owner(), "PUT", "/api/sales/policy", { maxDiscountPercent: null, cashierDepositLimit: null, shiftDifferenceTolerance: "0", ...policy });
  expect(res.statusCode, res.body).toBe(200);
}

const orderBody = (item: Record<string, unknown>) => ({
  customerId: company.customerId,
  warehouseId: company.warehouseId,
  orderDate: new Date().toISOString().slice(0, 10),
  items: [{ productId: company.productId, quantity: "1", ...item }],
});

describe("Kompaniya egasining qarorlari: savdo siyosati", () => {
  it("siyosat: faqat settings.manage, umumiy sozlamalar orqali yozilmaydi, noto'g'ri qiymat rad", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call(owner(), "GET", "/api/sales/policy")).json().policy).toMatchObject({ maxDiscountPercent: null, cashierDepositLimit: null });
    expect((await call(kassir.cookie, "PUT", "/api/sales/policy", { maxDiscountPercent: "90", cashierDepositLimit: null, shiftDifferenceTolerance: "0" })).statusCode).toBe(403);
    const generic = await call(owner(), "PUT", "/api/company/settings/sales.policy", { value: JSON.stringify({ maxDiscountPercent: "100" }), group: "sales" });
    expect(generic.statusCode).toBe(400);
    expect((await call(owner(), "PUT", "/api/sales/policy", { maxDiscountPercent: "150", cashierDepositLimit: null, shiftDifferenceTolerance: "0" })).statusCode).toBe(400);
    expect((await call(owner(), "PUT", "/api/sales/policy", { maxDiscountPercent: "10", cashierDepositLimit: "-1", shiftDifferenceTolerance: "0" })).statusCode).toBe(400);
    expect((await call(owner(), "PUT", "/api/sales/policy", { maxDiscountPercent: "10", cashierDepositLimit: null, shiftDifferenceTolerance: "0", extra: true })).statusCode).toBe(400);
    await savePolicy({ maxDiscountPercent: "10", cashierDepositLimit: "100000", shiftDifferenceTolerance: "1000" });
    expect((await call(owner(), "GET", "/api/sales/policy")).json().policy).toMatchObject({ cashierDepositLimit: expect.stringMatching(/^100000/) });
  });

  it("chegirma chegarasi: sales.edit bor, sales.approve yo'q xodim — chegaradan ortig'i 403; mijozning o'z chegirmasi va rahbar — ruxsat", async () => {
    await savePolicy({ maxDiscountPercent: "10" });
    const editor = await employeeWith("Chegirmachi", ["sales.view", "sales.create", "sales.edit"]);
    const over = await call(editor.cookie, "POST", "/api/sales/orders", orderBody({ discountPercent: "15" }));
    expect(over.statusCode, over.body).toBe(403);
    expect(over.json().details).toMatchObject({ reason: "discount_limit" });
    expect((await call(editor.cookie, "POST", "/api/sales/orders", orderBody({ discountPercent: "10" }))).statusCode).toBe(201);
    expect((await call(owner(), "POST", "/api/sales/orders", orderBody({ discountPercent: "15" }))).statusCode).toBe(201);

    // Mijozga admin bergan 20% chegirma — siyosat cheklamaydi
    expect((await call(owner(), "PATCH", `/api/sales/customers/${company.customerId}`, { discountPercent: "20" })).statusCode).toBe(200);
    const customerDiscount = await call(editor.cookie, "POST", "/api/sales/orders", orderBody({}));
    expect(customerDiscount.statusCode, customerDiscount.body).toBe(201);
  });

  it("kassada balansga katta summa (to'ldirish) — kassir 403, rahbar ruxsat; smena farqi chegaradan oshsa ko'rib chiqish, o'zini tasdiqlash taqiqi", async () => {
    await savePolicy({ cashierDepositLimit: "100000", shiftDifferenceTolerance: "1000" });
    const kassir = await addEmployee(app, company, "Kassir");
    const openShift = async (cookie: string) => {
      const res = await call(cookie, "POST", "/api/sales/pos/shifts", { warehouseId: company.warehouseId, openingCash: "20000" });
      expect(res.statusCode, res.body).toBe(201);
      return res.json().shift as { id: string };
    };
    const deposit = (cookie: string, shiftId: string, amount: string) =>
      call(cookie, "POST", `/api/sales/pos/customers/${company.customerId}/payments`, { shiftId, purpose: "deposit", amount, method: "cash" });
    const expectedCash = async (shiftId: string) => Number((await call(owner(), "GET", `/api/sales/pos/shifts/${shiftId}`)).json().shift.expectedCash);
    const close = (cookie: string, shiftId: string, closingCash: number) => call(cookie, "POST", `/api/sales/pos/shifts/${shiftId}/close`, { closingCash: String(closingCash) });

    const first = await openShift(kassir.cookie);
    // Takroriy yuborish: bir xil kalit — bitta depozit va smena tushumi; boshqa mijozga shu kalit — 409
    const clientRequestId = crypto.randomUUID();
    const once = () => call(kassir.cookie, "POST", `/api/sales/pos/customers/${company.customerId}/payments`, { shiftId: first.id, purpose: "deposit", amount: "5000", method: "cash", clientRequestId });
    expect((await once()).statusCode).toBeLessThan(300);
    const repeated = await once();
    expect(repeated.statusCode, repeated.body).toBeLessThan(300);
    expect(repeated.json().customer.balance).toBe("5000.00");
    expect(repeated.json().shift.totalCash).toBe("5000.00");
    const other = await call(owner(), "POST", "/api/sales/customers", { name: "Boshqa mijoz" });
    expect((await call(kassir.cookie, "POST", `/api/sales/pos/customers/${other.json().customer.id}/payments`, { shiftId: first.id, purpose: "deposit", amount: "5000", method: "cash", clientRequestId })).statusCode).toBe(409);
    const big = await deposit(kassir.cookie, first.id, "150000");
    expect(big.statusCode, big.body).toBe(403);
    expect(big.json().details).toMatchObject({ reason: "deposit_limit" });
    expect((await deposit(kassir.cookie, first.id, "100000")).statusCode).toBeLessThan(300);
    expect((await deposit(owner(), first.id, "150000")).statusCode).toBeLessThan(300);

    // Chegaradagi farq (−500) — ko'rib chiqilmaydi
    const small = await close(kassir.cookie, first.id, (await expectedCash(first.id)) - 500);
    expect(small.statusCode, small.body).toBe(200);
    expect(small.json()).toMatchObject({ difference: "-500.00", review: null });

    // Chegaradan oshgan kamomad (−5000) — rahbarga bildirishnoma, kassirga emas
    const second = await openShift(kassir.cookie);
    const short = await close(kassir.cookie, second.id, (await expectedCash(second.id)) - 5000);
    expect(short.json()).toMatchObject({ difference: "-5000.00", review: "pending" });
    const alerts = await db.select().from(notifications).where(and(eq(notifications.companyId, company.companyId), eq(notifications.relatedId, second.id)));
    expect(alerts.map((row) => row.userId)).toEqual([company.owner.id]);

    expect((await call(kassir.cookie, "GET", "/api/sales/pos/shift-reviews")).statusCode).toBe(403);
    expect((await call(kassir.cookie, "POST", `/api/sales/pos/shifts/${second.id}/review`, { decision: "approved" })).statusCode).toBe(403);
    const pending = (await call(owner(), "GET", "/api/sales/pos/shift-reviews")).json().shifts as { id: string }[];
    expect(pending.map((row) => row.id)).toEqual([second.id]);
    expect((await call(owner(), "POST", `/api/sales/pos/shifts/${second.id}/review`, { decision: "rejected" })).statusCode).toBe(400);
    const approved = await call(owner(), "POST", `/api/sales/pos/shifts/${second.id}/review`, { decision: "approved", note: "Kassir tushuntirdi" });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().shift).toMatchObject({ differenceReview: "approved", differenceReviewNote: "Kassir tushuntirdi", differenceReviewedBy: company.owner.id });
    expect((await call(owner(), "POST", `/api/sales/pos/shifts/${second.id}/review`, { decision: "approved" })).statusCode).toBe(409);

    // Rahbar o'z smenasidagi farqni o'zi tasdiqlay olmaydi
    const lead = await employeeWith("Smena rahbari", ["pos.use", "sales.view", "sales.approve"]);
    const own = await openShift(lead.cookie);
    expect((await close(lead.cookie, own.id, (await expectedCash(own.id)) + 7000)).json()).toMatchObject({ review: "pending" });
    const self = await call(lead.cookie, "POST", `/api/sales/pos/shifts/${own.id}/review`, { decision: "approved" });
    expect(self.statusCode).toBe(403);
    expect(self.json().details).toMatchObject({ reason: "self_review" });
    expect((await call(owner(), "POST", `/api/sales/pos/shifts/${own.id}/review`, { decision: "approved" })).statusCode).toBe(200);
  });
});

describe("Kompaniya egasining qarori: dostavka naqdi yetkazuvchida, kassaga topshirish", () => {
  it("naqd yetkazuvchi hisobiga tushadi (asosiy kassaga emas), topshirish ruxsatlari, summa chegarasi, boshqa kompaniya ko'rmaydi", async () => {
    await setPolicy(app, owner(), NO_PROOFS);
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);
    const { taskId } = await arrivedTask(app, company, agent);
    const accounts = () => db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
    const mainBefore = (await accounts()).find((row) => row.isDefault && row.type === "cash")!;

    const paid = await agentAction(app, agent.cookie, taskId, "payments", { method: "cash", amount: "50000" });
    expect(paid.statusCode, paid.body).toBe(201);
    const afterPayment = await accounts();
    const agentAccount = afterPayment.find((row) => row.deliveryAgentId === agent.id)!;
    expect(agentAccount).toMatchObject({ type: "cash", balance: "50000.00", isDefault: false, showInPos: false });
    expect(afterPayment.find((row) => row.id === mainBefore.id)!.balance).toBe(mainBefore.balance);
    expect((await call(owner(), "GET", `/api/delivery/agents/${agent.id}/cash`)).json().cash).toMatchObject({ balance: "50000.00", cashAccountId: agentAccount.id });

    const handover = (cookie: string, body: Record<string, unknown>) => call(cookie, "POST", `/api/delivery/agents/${agent.id}/cash-handover`, body);
    // Yetkazuvchi o'z pulini o'zi "topshirdim" deb yoza olmaydi
    expect((await handover(agent.cookie, { amount: "50000" })).statusCode).toBe(403);
    const tooMuch = await handover(owner(), { amount: "50000.01" });
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.json().details).toMatchObject({ reason: "exceeds_agent_cash" });
    expect((await handover(owner(), { amount: "10", toCashAccountId: agentAccount.id })).statusCode).toBe(400);

    const dispatcher = await employeeWith("Dostavka rahbari", ["delivery.view", "delivery.manage"]);
    const otherTarget = await handover(dispatcher.cookie, { amount: "1000", toCashAccountId: mainBefore.id });
    expect(otherTarget.statusCode).toBe(403);
    expect(otherTarget.json().details).toMatchObject({ reason: "target_requires_finance" });

    const done = await handover(dispatcher.cookie, { amount: "30000", notes: "Kechki topshirish" });
    expect(done.statusCode, done.body).toBe(201);
    expect(done.json().handover).toMatchObject({ amount: "30000.00", balance: "20000.00", toCashAccountId: mainBefore.id });
    const afterHandover = await accounts();
    expect(afterHandover.find((row) => row.id === agentAccount.id)!.balance).toBe("20000.00");
    expect(Number(afterHandover.find((row) => row.id === mainBefore.id)!.balance)).toBe(Number(mainBefore.balance) + 30000);
    expect((await call(owner(), "GET", `/api/delivery/agents/${agent.id}/cash`)).json().cash.handovers).toHaveLength(1);

    // Boshqa kompaniya: agent ID'si bilan ham ko'rmaydi va topshira olmaydi
    const other = await deliveryCompany(app, adminCookie, "Begona");
    expect((await call(other.ownerCookie, "GET", `/api/delivery/agents/${agent.id}/cash`)).statusCode).toBe(404);
    expect((await call(other.ownerCookie, "POST", `/api/delivery/agents/${agent.id}/cash-handover`, { amount: "1" })).statusCode).toBe(404);
  });
});

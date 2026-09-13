/**
 * Obuna va litsenziya tizimi (integratsiya): trial, litsenziya limiti, qo'shimcha litsenziya, to'lov tasdig'i,
 * uzaytirish, muddat tugashi, bepul xodim, PIN qulfi, xavfsizlik va tenant izolyatsiyasi, kassa qurilmasi, migratsiya.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addMonths } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { employees } from "../src/db/schema/hr.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { notifications } from "../src/db/schema/notifications.js";
import { auditLogs, companies, companyMembers, users } from "../src/db/schema/platform.js";
import { posSyncOperations } from "../src/db/schema/pos.js";
import {
  licenseHistory,
  licenses,
  subscriptionHistory,
  subscriptionPayments,
  subscriptionPlans,
  subscriptions,
} from "../src/db/schema/subscription.js";
import { buildServer } from "../src/server.js";
import { runSubscriptionExpiry } from "../src/shared/maintenance.js";
import { addEmployee, createCompany, login, me, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

let app: FastifyInstance;
let adminCookie: string;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
});

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });

const DAY = 86_400_000;
const near = (actual: Date | string | null | undefined, expected: Date, tolerance = 60_000) => {
  expect(actual).toBeTruthy();
  expect(Math.abs(new Date(actual!).getTime() - expected.getTime())).toBeLessThan(tolerance);
};
const reasonOf = (res: { json: () => { details?: { reason?: string } } }) => res.json().details?.reason;
const key = (prefix: string) => `${prefix}-${randomUUID()}`;

async function planId(code: string): Promise<string> {
  const [row] = await db.select({ id: subscriptionPlans.id }).from(subscriptionPlans).where(eq(subscriptionPlans.code, code));
  return row!.id;
}

/** Litsenziya limiti haqiqiy (3 ta included) kompaniya. */
const trialCompany = (name = "Trial") => createCompany(app, adminCookie, { name, includedLicenses: 3 });
type Company = Awaited<ReturnType<typeof trialCompany>>;

const subscriptionOf = async (companyId: string) =>
  (await db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)))[0]!;
const activeLicenses = (companyId: string) =>
  db.select().from(licenses).where(and(eq(licenses.companyId, companyId), eq(licenses.status, "active")));
const auditCount = async (action: string) => (await db.select().from(auditLogs).where(eq(auditLogs.action, action))).length;

async function newEmployee(company: Company, extra: object = {}) {
  const payload = { phone: uniquePhone(), password: "xodim-parol-123", name: "Xodim", role: "Kassir", ...extra };
  const res = await call(company.ownerCookie, "POST", "/api/company/employees", payload);
  return { res, payload };
}

const confirm = (paymentId: string, reference = "KV-1") =>
  call(adminCookie, "POST", `/api/platform/billing/payments/${paymentId}/confirm`, { reference });

const purchase = (company: Company, code: string, idempotencyKey = key("buy")) =>
  planId(code).then((id) => call(company.ownerCookie, "POST", "/api/subscription/purchase", { planId: id, idempotencyKey }));

const expireSubscription = (companyId: string, ms = 1000) =>
  db.update(subscriptions).set({ expiresAt: new Date(Date.now() - ms) }).where(eq(subscriptions.companyId, companyId));

const hrEmployee = (extra: object = {}) => ({ name: "Ali Valiyev", hireDate: "2026-01-01", baseSalary: "0", salaryType: "monthly", ...extra });

describe("Trial", () => {
  it("yangi kompaniya: 25 kun, 3 included litsenziya, egasi — birinchisi; tarix va audit", async () => {
    const company = await trialCompany();
    const subscription = await subscriptionOf(company.companyId);
    expect(subscription).toMatchObject({ status: "trial", includedLicenses: 3, planId: null });
    near(subscription.expiresAt, new Date(Date.now() + 25 * DAY));

    const owned = await db.select().from(licenses).where(eq(licenses.companyId, company.companyId));
    expect(owned).toHaveLength(1);
    expect(owned[0]).toMatchObject({ userId: company.owner.id, licenseType: "included", status: "active" });
    expect(
      await db
        .select()
        .from(subscriptionHistory)
        .where(and(eq(subscriptionHistory.companyId, company.companyId), eq(subscriptionHistory.event, "trial_started"))),
    ).toHaveLength(1);
    expect(await auditCount("TRIAL_CREATED")).toBe(1);

    const overview = (await call(company.ownerCookie, "GET", "/api/subscription")).json();
    expect(overview.subscription).toMatchObject({ status: "trial", daysLeft: 25, includedLicenses: 3, trialWarning: null });
    expect(overview.licenses).toMatchObject({ includedTotal: 3, includedUsed: 1, includedAvailable: 2, additionalActive: 0 });

    const profile = (await me(app, company.ownerCookie)).json().user;
    expect(profile).toMatchObject({ isCompanyOwner: true, licenseDenial: null, sessionLocked: false });
    expect(profile.subscription).toMatchObject({ status: "trial", isTrial: true, daysLeft: 25 });
  });

  it("tariflar bazadan: asosiy (1/3/6+1/12+3) va qo'shimcha litsenziya (1/3/6+1/12+2)", async () => {
    const company = await trialCompany();
    const plans = (await call(company.ownerCookie, "GET", "/api/subscription/plans")).json() as {
      main: { code: string; price: string; effectiveMonths: number; includedLicenses: number }[];
      additional: { code: string; price: string; effectiveMonths: number }[];
    };
    expect(plans.main.map((plan) => [plan.code, plan.price, plan.effectiveMonths, plan.includedLicenses])).toEqual([
      ["main-1m", "360000.00", 1, 3],
      ["main-3m", "900000.00", 3, 3],
      ["main-6m", "1800000.00", 7, 3],
      ["main-12m", "3600000.00", 15, 3],
    ]);
    expect(plans.additional.map((plan) => [plan.code, plan.price, plan.effectiveMonths])).toEqual([
      ["license-1m", "100000.00", 1],
      ["license-3m", "300000.00", 3],
      ["license-6m", "600000.00", 7],
      ["license-12m", "1200000.00", 14],
    ]);
  });
});

describe("Litsenziya limiti va qo'shimcha litsenziya", () => {
  it("egasi + 2 xodim — included; 4-foydalanuvchi to'lovsiz rad etiladi va hech narsa yaratilmaydi", async () => {
    const company = await trialCompany();
    for (let i = 0; i < 2; i++) {
      const { res } = await newEmployee(company);
      expect(res.statusCode).toBe(201);
      expect(res.json().license).toMatchObject({ type: "included", status: "active" });
    }
    const fourth = await newEmployee(company);
    expect(fourth.res.statusCode).toBe(403);
    expect(reasonOf(fourth.res)).toBe("license_limit_reached");
    expect(fourth.res.json().details.counts).toMatchObject({ includedTotal: 3, includedUsed: 3, includedAvailable: 0 });
    expect(await db.select().from(users).where(eq(users.phone, fourth.payload.phone))).toHaveLength(0);
  });

  it("parallel so'rovlar oxirgi bo'sh litsenziyadan oshib keta olmaydi", async () => {
    const company = await trialCompany();
    expect((await newEmployee(company)).res.statusCode).toBe(201);
    const results = await Promise.all([newEmployee(company), newEmployee(company), newEmployee(company)]);
    expect(results.map((result) => result.res.statusCode).sort()).toEqual([201, 403, 403]);
    expect(await activeLicenses(company.companyId)).toHaveLength(3);
  });

  it("qo'shimcha litsenziya: to'lov tasdiqlanguncha kirish yopiq; tasdiqdan keyin 6+1 oy; takroriy tasdiq o'zgartirmaydi", async () => {
    const company = await trialCompany();
    await newEmployee(company);
    await newEmployee(company);
    const { res, payload } = await newEmployee(company, { additionalLicensePlanId: await planId("license-6m") });
    expect(res.statusCode).toBe(201);
    expect(res.json().license).toMatchObject({ type: "additional", status: "pending_payment" });
    expect(res.json().payment).toMatchObject({ amount: "600000.00", status: "pending" });

    const { cookie } = await login(app, payload.phone, payload.password);
    const denied = await call(cookie!, "GET", "/api/company/branches");
    expect(denied.statusCode).toBe(403);
    expect(reasonOf(denied)).toBe("license_pending_payment");
    expect((await call(cookie!, "GET", "/api/company")).statusCode).toBe(200);
    expect((await me(app, cookie!)).json().user.licenseDenial).toBe("license_pending_payment");

    const confirmed = await confirm(res.json().payment.id);
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ duplicate: false, payment: { status: "paid", reference: "KV-1" } });
    const [license] = await db.select().from(licenses).where(eq(licenses.id, res.json().license.id));
    expect(license).toMatchObject({ status: "active", price: "600000.00" });
    near(license!.expiresAt, addMonths(new Date(), 7));
    expect((await call(cookie!, "GET", "/api/company/branches")).statusCode).toBe(200);

    const again = await confirm(res.json().payment.id, "KV-2");
    expect(again.json()).toMatchObject({ duplicate: true, payment: { reference: "KV-1" } });
    const [unchanged] = await db.select().from(licenses).where(eq(licenses.id, license!.id));
    expect(unchanged!.expiresAt!.getTime()).toBe(license!.expiresAt!.getTime());
    expect(
      await db.select().from(licenseHistory).where(and(eq(licenseHistory.licenseId, license!.id), eq(licenseHistory.event, "activated"))),
    ).toHaveLength(1);
    expect(await auditCount("ADDITIONAL_LICENSE_PURCHASED")).toBe(1);

    const overview = (await call(company.ownerCookie, "GET", "/api/subscription")).json();
    expect(overview.licenses).toMatchObject({ includedUsed: 3, additionalActive: 1, totalActive: 4, includedAvailable: 0 });
  });

  it("amaldagi qo'shimcha litsenziyani uzaytirish — tugash sanasidan +14 oy (12+2)", async () => {
    const company = await trialCompany();
    await newEmployee(company);
    await newEmployee(company);
    const { res } = await newEmployee(company, { additionalLicensePlanId: await planId("license-1m") });
    await confirm(res.json().payment.id);
    const licenseId = res.json().license.id as string;
    const [before] = await db.select().from(licenses).where(eq(licenses.id, licenseId));

    const renewal = await call(company.ownerCookie, "POST", `/api/subscription/licenses/${licenseId}/purchase`, {
      planId: await planId("license-12m"),
      idempotencyKey: key("renew"),
    });
    expect(renewal.statusCode).toBe(201);
    expect(renewal.json().payment).toMatchObject({ kind: "license", amount: "1200000.00" });
    await confirm(renewal.json().payment.id);
    const [after] = await db.select().from(licenses).where(eq(licenses.id, licenseId));
    expect(after!.expiresAt!.getTime()).toBe(addMonths(before!.expiresAt!, 14).getTime());
    expect(await auditCount("LICENSE_RENEWED")).toBe(1);
  });

  it("egasi a'zolikni o'chirsa included bo'shaydi; qayta yoqish bo'sh litsenziya yoki qo'shimcha tarif bilan", async () => {
    const company = await trialCompany();
    const first = await addEmployee(app, company);
    await addEmployee(app, company);
    expect((await call(company.ownerCookie, "PATCH", `/api/company/employees/${first.id}`, { isActive: false })).statusCode).toBe(200);
    expect(await activeLicenses(company.companyId)).toHaveLength(2);
    expect((await newEmployee(company)).res.statusCode).toBe(201);

    const reactivate = await call(company.ownerCookie, "PATCH", `/api/company/employees/${first.id}`, { isActive: true });
    expect(reactivate.statusCode).toBe(403);
    expect(reasonOf(reactivate)).toBe("license_limit_reached");
    const withPlan = await call(company.ownerCookie, "PATCH", `/api/company/employees/${first.id}`, {
      isActive: true,
      additionalLicensePlanId: await planId("license-1m"),
    });
    expect(withPlan.statusCode).toBe(200);
    const [license] = await db
      .select()
      .from(licenses)
      .where(and(eq(licenses.userId, first.id), eq(licenses.status, "pending_payment")));
    expect(license).toMatchObject({ licenseType: "additional" });
  });
});

describe("Asosiy tarif: sotib olish, faollashtirish, uzaytirish", () => {
  it("trial → to'langan ACTIVE (6+1 oy hozirdan); idempotent so'rov; uzaytirish — tugash sanasidan +15 oy", async () => {
    const company = await trialCompany();
    const idempotencyKey = key("buy");
    const plan6 = await planId("main-6m");
    const first = await call(company.ownerCookie, "POST", "/api/subscription/purchase", { planId: plan6, idempotencyKey });
    expect(first.statusCode).toBe(201);
    expect(first.json().payment).toMatchObject({ kind: "subscription", amount: "1800000.00", status: "pending" });

    const repeat = await call(company.ownerCookie, "POST", "/api/subscription/purchase", { planId: plan6, idempotencyKey });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json()).toMatchObject({ duplicate: true, payment: { id: first.json().payment.id } });
    const reused = await call(company.ownerCookie, "POST", "/api/subscription/purchase", { planId: await planId("main-1m"), idempotencyKey });
    expect(reused.statusCode).toBe(409);
    // To'lov tasdiqlanmaguncha — trial
    expect((await subscriptionOf(company.companyId)).status).toBe("trial");

    expect((await confirm(first.json().payment.id)).statusCode).toBe(200);
    const active = await subscriptionOf(company.companyId);
    expect(active).toMatchObject({ status: "active", planId: plan6, baseDurationMonths: 6, bonusMonths: 1 });
    near(active.expiresAt, addMonths(new Date(), 7));
    expect((await me(app, company.ownerCookie)).json().user.subscription).toMatchObject({ status: "active", isTrial: false });
    expect(await auditCount("SUBSCRIPTION_CREATED")).toBe(1);
    const [activated] = await db
      .select()
      .from(subscriptionHistory)
      .where(and(eq(subscriptionHistory.companyId, company.companyId), eq(subscriptionHistory.event, "activated")));
    expect(activated).toMatchObject({ price: "1800000.00", durationMonths: 6, bonusMonths: 1, effectiveMonths: 7, paymentReference: "KV-1" });

    const renewal = await purchase(company, "main-12m");
    await confirm(renewal.json().payment.id);
    const renewed = await subscriptionOf(company.companyId);
    expect(renewed.expiresAt!.getTime()).toBe(addMonths(active.expiresAt!, 15).getTime());
    expect(await auditCount("SUBSCRIPTION_RENEWED")).toBe(1);
  });

  it("yangi so'rov eskisini bekor qiladi; bekor qilingan to'lov tasdiqlanmaydi; tugagan obuna — hozirdan uzaytiriladi", async () => {
    const company = await trialCompany();
    const older = (await purchase(company, "main-3m")).json().payment;
    const newer = (await purchase(company, "main-1m")).json().payment;
    const [cancelled] = await db.select().from(subscriptionPayments).where(eq(subscriptionPayments.id, older.id));
    expect(cancelled!.status).toBe("cancelled");
    expect((await confirm(older.id)).statusCode).toBe(409);
    await confirm(newer.id);

    await expireSubscription(company.companyId, 5 * DAY);
    const renewal = await purchase(company, "main-3m");
    await confirm(renewal.json().payment.id);
    near((await subscriptionOf(company.companyId)).expiresAt, addMonths(new Date(), 3));
  });

  it("egasi o'z kutilayotgan so'rovini bekor qiladi; tasdiqlanganini bekor qilib bo'lmaydi", async () => {
    const company = await trialCompany();
    const pending = (await purchase(company, "main-1m")).json().payment;
    const cancel = await call(company.ownerCookie, "POST", `/api/subscription/payments/${pending.id}/cancel`);
    expect(cancel.json().payment.status).toBe("cancelled");
    const paid = (await purchase(company, "main-1m")).json().payment;
    await confirm(paid.id);
    expect((await call(company.ownerCookie, "POST", `/api/subscription/payments/${paid.id}/cancel`)).statusCode).toBe(409);
  });
});

describe("Muddat tugashi", () => {
  it("tugagan trial: ish bo'limlari yopiq, Bosh sahifa va Obuna ochiq, ma'lumot o'chmaydi; to'lovdan keyin qayta ochiladi", async () => {
    const company = await trialCompany();
    const kassir = await addEmployee(app, company, "Kassir");
    await expireSubscription(company.companyId);

    const branches = await call(company.ownerCookie, "GET", "/api/company/branches");
    expect(branches.statusCode).toBe(403);
    expect(reasonOf(branches)).toBe("subscription_expired");
    expect(branches.json().message).toContain("Sinov muddati");
    expect((await call(company.ownerCookie, "GET", "/api/hr/employees")).statusCode).toBe(403);
    expect((await call(company.ownerCookie, "PATCH", "/api/company", { city: "Buxoro" })).statusCode).toBe(403);
    expect((await newEmployee(company)).res.statusCode).toBe(403);
    expect((await call(kassir.cookie, "GET", "/api/company/branches")).statusCode).toBe(403);

    expect((await call(company.ownerCookie, "GET", "/api/analytics/dashboard")).statusCode).toBe(200);
    expect((await call(company.ownerCookie, "GET", "/api/subscription")).json().subscription.status).toBe("expired");
    expect((await call(company.ownerCookie, "GET", "/api/company")).statusCode).toBe(200);
    expect((await me(app, company.ownerCookie)).json().user.subscription.status).toBe("expired");

    // Ma'lumot saqlanadi
    expect(await db.select().from(companyMembers).where(eq(companyMembers.companyId, company.companyId))).toHaveLength(2);
    expect(await activeLicenses(company.companyId)).toHaveLength(2);

    const renewal = await purchase(company, "main-1m");
    expect(renewal.statusCode).toBe(201);
    await confirm(renewal.json().payment.id);
    expect((await call(company.ownerCookie, "GET", "/api/company/branches")).statusCode).toBe(200);
    expect((await call(kassir.cookie, "GET", "/api/company/branches")).statusCode).toBe(200);
  });

  it("to'langan obuna tugaganda ham shunday (matni boshqa)", async () => {
    const company = await trialCompany();
    await confirm((await purchase(company, "main-1m")).json().payment.id);
    await expireSubscription(company.companyId);
    const res = await call(company.ownerCookie, "GET", "/api/company/branches");
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain("obunangiz muddati tugagan");
  });

  it("davriy ish: holat expired, tarix va audit; takror ishlasa o'zgarmaydi", async () => {
    const company = await trialCompany();
    await expireSubscription(company.companyId);
    expect(await runSubscriptionExpiry()).toMatchObject({ subscriptionsExpired: 1 });
    expect((await subscriptionOf(company.companyId)).status).toBe("expired");
    expect(
      await db.select().from(subscriptionHistory).where(and(eq(subscriptionHistory.companyId, company.companyId), eq(subscriptionHistory.event, "expired"))),
    ).toHaveLength(1);
    expect(await auditCount("SUBSCRIPTION_EXPIRED")).toBe(1);
    expect(await runSubscriptionExpiry()).toMatchObject({ subscriptionsExpired: 0 });
  });

  it("qo'shimcha litsenziya tugasa faqat o'sha xodim bloklanadi", async () => {
    const company = await trialCompany();
    const regular = await addEmployee(app, company);
    await addEmployee(app, company);
    const { res, payload } = await newEmployee(company, { additionalLicensePlanId: await planId("license-1m") });
    await confirm(res.json().payment.id);
    const extra = await login(app, payload.phone, payload.password);
    await db.update(licenses).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(licenses.id, res.json().license.id));

    const denied = await call(extra.cookie!, "GET", "/api/company/branches");
    expect(denied.statusCode).toBe(403);
    expect(reasonOf(denied)).toBe("license_expired");
    expect((await call(regular.cookie, "GET", "/api/company/branches")).statusCode).toBe(200);
    expect((await call(company.ownerCookie, "GET", "/api/company/branches")).statusCode).toBe(200);

    expect(await runSubscriptionExpiry()).toMatchObject({ licensesExpired: 1 });
    const [license] = await db.select().from(licenses).where(eq(licenses.id, res.json().license.id));
    expect(license!.status).toBe("expired");
    expect(await auditCount("LICENSE_EXPIRED")).toBe(1);
  });

  it("trial ogohlantirishi: 5 kun chegarasi egasiga bir marta", async () => {
    const company = await trialCompany();
    await db
      .update(subscriptions)
      .set({ expiresAt: new Date(Date.now() + 4.5 * DAY) })
      .where(eq(subscriptions.companyId, company.companyId));
    expect(await runSubscriptionExpiry()).toMatchObject({ trialWarnings: 1 });
    expect(await runSubscriptionExpiry()).toMatchObject({ trialWarnings: 0 });
    const rows = await db.select().from(notifications).where(eq(notifications.companyId, company.companyId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: company.owner.id, severity: "info" });
    expect(rows[0]!.title).toContain("5 kun");
    expect((await me(app, company.ownerCookie)).json().user.subscription.trialWarning).toBe(5);
  });
});

describe("Bepul xodim va dastur kirishi (HR)", () => {
  it("bepul xodimlar cheklanmaydi, litsenziya va login olmaydi", async () => {
    const company = await trialCompany();
    await addEmployee(app, company);
    await addEmployee(app, company);
    const phones: string[] = [];
    for (let i = 0; i < 5; i++) {
      const phone = uniquePhone();
      phones.push(phone);
      const res = await call(company.ownerCookie, "POST", "/api/hr/employees", hrEmployee({ name: `Bepul ${i}`, phone }));
      expect(res.statusCode).toBe(201);
      expect(res.json().employee).toMatchObject({ userId: null, softwareAccess: null });
    }
    expect(await activeLicenses(company.companyId)).toHaveLength(3);
    const list = (await call(company.ownerCookie, "GET", "/api/hr/employees")).json().employees as { userId: string | null; licenseType: string | null }[];
    expect(list.filter((row) => row.userId === null && row.licenseType === null)).toHaveLength(5);
    expect((await login(app, phones[0]!, "istalgan-parol-1")).res.statusCode).toBe(401);
  });

  it("dasturdan foydalanuvchi: login + parol + PIN + rol + litsenziya; bepulga va qaytadan", async () => {
    const company = await trialCompany();
    const access = { phone: uniquePhone(), password: "hr-parol-1234", pin: "2580", role: "Kassir" };
    const created = await call(company.ownerCookie, "POST", "/api/hr/employees", hrEmployee({ softwareAccess: access }));
    expect(created.statusCode).toBe(201);
    const employee = created.json().employee;
    expect(employee.softwareAccess).toMatchObject({
      usesSoftware: true,
      hasPin: true,
      companyRole: "Kassir",
      license: { type: "included", status: "active" },
    });
    const [user] = await db.select().from(users).where(eq(users.id, employee.userId));
    expect(user!.passwordHash).not.toContain(access.password);
    expect(user!.pinHash).toMatch(/^\$argon2id\$/);
    // Parol va PIN auditga yozilmaydi
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.companyId, company.companyId));
    expect(JSON.stringify(audits)).not.toContain(access.password);
    for (const audit of audits) expect(Object.keys((audit.details as object | null) ?? {})).not.toContain("pin");

    const session = await login(app, access.phone, access.password);
    expect(session.res.statusCode).toBe(200);

    const freed = await call(company.ownerCookie, "DELETE", `/api/hr/employees/${employee.id}/software-access`);
    expect(freed.statusCode).toBe(200);
    expect(freed.json().employee.softwareAccess).toMatchObject({ usesSoftware: false, memberActive: false, license: null });
    expect((await call(session.cookie!, "GET", "/api/company")).statusCode).toBe(401);
    expect((await login(app, access.phone, access.password)).res.statusCode).toBe(403);
    expect(await activeLicenses(company.companyId)).toHaveLength(1);
    expect(await db.select().from(employees).where(eq(employees.id, employee.id))).toHaveLength(1);
    expect(await auditCount("EMPLOYEE_CONVERTED")).toBe(1);
    expect(await auditCount("SOFTWARE_ACCESS_DISABLED")).toBe(1);

    const restored = await call(company.ownerCookie, "POST", `/api/hr/employees/${employee.id}/software-access`, {});
    expect(restored.statusCode).toBe(200);
    expect(restored.json().employee.softwareAccess).toMatchObject({ usesSoftware: true, license: { type: "included", status: "active" } });
    expect((await login(app, access.phone, access.password)).res.statusCode).toBe(200);
  });

  it("bepuldan dasturga: litsenziya bo'lmasa rad (rollback); qo'shimcha tarif bilan — to'lov kutadi", async () => {
    const company = await trialCompany();
    await addEmployee(app, company);
    await addEmployee(app, company);
    const free = (await call(company.ownerCookie, "POST", "/api/hr/employees", hrEmployee())).json().employee;
    const access = { phone: uniquePhone(), password: "hr-parol-1234", pin: "1357", role: "Kassir" };

    const denied = await call(company.ownerCookie, "POST", `/api/hr/employees/${free.id}/software-access`, access);
    expect(denied.statusCode).toBe(403);
    expect(reasonOf(denied)).toBe("license_limit_reached");
    expect(await db.select().from(users).where(eq(users.phone, access.phone))).toHaveLength(0);

    const pending = await call(company.ownerCookie, "POST", `/api/hr/employees/${free.id}/software-access`, {
      ...access,
      additionalLicensePlanId: await planId("license-3m"),
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().employee.softwareAccess.license).toMatchObject({ type: "additional", status: "pending_payment" });
    expect(pending.json().employee.softwareAccess.license.pendingPaymentId).toBeTruthy();
  });

  it("egasini bepul qilib bo'lmaydi; Direktor login bera olmaydi, lekin bepul xodim qo'sha oladi", async () => {
    const company = await trialCompany();
    const ownerRecord = await call(company.ownerCookie, "POST", "/api/hr/employees", hrEmployee({ userId: company.owner.id }));
    expect(ownerRecord.statusCode).toBe(201);
    expect((await call(company.ownerCookie, "DELETE", `/api/hr/employees/${ownerRecord.json().employee.id}/software-access`)).statusCode).toBe(403);
    expect(await activeLicenses(company.companyId)).toHaveLength(1);

    const direktor = await addEmployee(app, company, "Direktor");
    const attempt = await call(
      direktor.cookie,
      "POST",
      "/api/hr/employees",
      hrEmployee({ softwareAccess: { phone: uniquePhone(), password: "parol-12345", pin: "1234", role: "Kassir" } }),
    );
    expect(attempt.statusCode).toBe(403);
    expect((await call(direktor.cookie, "POST", "/api/hr/employees", hrEmployee())).statusCode).toBe(201);
  });
});

describe("PIN va ekran qulfi", () => {
  it("LOCK sessiyani saqlaydi va faqat PIN bilan ochiladi; boshqa qurilma — alohida; LOGOUT dan keyin PIN ishlamaydi", async () => {
    const company = await trialCompany();
    const owner = company.ownerCookie;
    expect((await call(owner, "POST", "/api/auth/lock")).statusCode).toBe(400);
    expect((await call(owner, "POST", "/api/auth/pin", { pin: "2468" })).statusCode).toBe(200);
    expect((await call(owner, "POST", "/api/auth/lock")).statusCode).toBe(200);

    const locked = await call(owner, "GET", "/api/company");
    expect(locked.statusCode).toBe(423);
    expect(locked.json().code).toBe("LOCKED");
    expect((await me(app, owner)).json().user.sessionLocked).toBe(true);

    const wrong = (await call(owner, "POST", "/api/auth/unlock", { pin: "0000" })).json();
    expect(wrong.success).toBe(false);
    expect(wrong.reason).toMatch(/^WRONG_PIN:/);
    expect((await call(owner, "POST", "/api/auth/unlock", { pin: "2468" })).json()).toEqual({ success: true });
    expect((await call(owner, "GET", "/api/company")).statusCode).toBe(200);

    // Boshqa qurilma — o'z sessiyasi; PIN yangi sessiya ochmaydi
    const other = await login(app, company.owner.phone, company.owner.password);
    await call(owner, "POST", "/api/auth/lock");
    expect((await call(other.cookie!, "GET", "/api/company")).statusCode).toBe(200);
    const noSession = await app.inject({ method: "POST", url: "/api/auth/unlock", payload: { pin: "2468" } });
    expect(noSession.statusCode).toBe(401);
    expect(noSession.cookies.find((cookie) => cookie.name === "bum_session")?.value ?? "").toBe("");

    // LOGOUT — sessiya tugaydi, PIN endi ochmaydi, parol kerak
    await call(owner, "POST", "/api/auth/logout");
    expect((await call(owner, "POST", "/api/auth/unlock", { pin: "2468" })).statusCode).toBe(401);
    expect((await call(owner, "GET", "/api/company")).statusCode).toBe(401);
    expect(await auditCount("session_locked")).toBe(2);
    expect(await auditCount("session_unlocked")).toBe(1);
  });

  it("5 ta noto'g'ri PIN — vaqtincha bloklanadi, to'g'ri PIN ham ochmaydi", async () => {
    const company = await trialCompany();
    const owner = company.ownerCookie;
    await call(owner, "POST", "/api/auth/pin", { pin: "9753" });
    await call(owner, "POST", "/api/auth/lock");
    for (let i = 0; i < 4; i++) {
      expect((await call(owner, "POST", "/api/auth/unlock", { pin: "1111" })).json().reason).toMatch(/^WRONG_PIN:/);
    }
    expect((await call(owner, "POST", "/api/auth/unlock", { pin: "1111" })).json().reason).toMatch(/^PIN_LOCKED:/);
    expect((await call(owner, "POST", "/api/auth/unlock", { pin: "9753" })).json()).toMatchObject({ success: false });
    expect((await call(owner, "GET", "/api/company")).statusCode).toBe(423);
  });
});

describe("Xavfsizlik va tenant izolyatsiyasi", () => {
  it("so'rovdagi soxta obuna, litsenziya va kompaniya maydonlari limitni chetlab o'tolmaydi", async () => {
    const a = await trialCompany("A");
    const b = await trialCompany("B");
    await addEmployee(app, a);
    await addEmployee(app, a);

    const fake = await call(a.ownerCookie, "POST", "/api/company/employees", {
      phone: uniquePhone(),
      password: "xodim-parol-123",
      subscriptionActive: true,
      licenseType: "included",
      companyId: b.companyId,
      includedLicenses: 100,
    });
    expect(fake.statusCode).toBe(403);
    expect(reasonOf(fake)).toBe("license_limit_reached");
    expect(
      (await call(a.ownerCookie, "POST", "/api/subscription/purchase", { planId: await planId("main-1m"), idempotencyKey: key("x"), companyId: b.companyId })).statusCode,
    ).toBe(400);
    expect(
      (
        await call(
          a.ownerCookie,
          "POST",
          "/api/hr/employees",
          hrEmployee({ softwareAccess: { phone: uniquePhone(), password: "parol-12345", pin: "1234", role: "Kassir", licenseType: "included" } }),
        )
      ).statusCode,
    ).toBe(400);
    expect((await subscriptionOf(b.companyId)).includedLicenses).toBe(3);
    expect(await activeLicenses(b.companyId)).toHaveLength(1);

    await expireSubscription(a.companyId);
    const spoofed = await app.inject({
      method: "GET",
      url: "/api/company/branches?subscriptionActive=true",
      headers: { cookie: a.ownerCookie, "x-subscription-status": "active" },
    });
    expect(spoofed.statusCode).toBe(403);
  });

  it("boshqa kompaniya litsenziyasi va to'lovi — 404; Kassir ko'rmaydi; Direktor ko'radi, sotib ololmaydi; tasdiq faqat admin", async () => {
    const a = await trialCompany("A");
    const b = await trialCompany("B");
    const [aOwnerLicense] = await db.select().from(licenses).where(eq(licenses.companyId, a.companyId));
    const aPayment = (await purchase(a, "main-1m")).json().payment;

    expect(
      (await call(b.ownerCookie, "POST", `/api/subscription/licenses/${aOwnerLicense!.id}/purchase`, { planId: await planId("license-1m"), idempotencyKey: key("b") }))
        .statusCode,
    ).toBe(404);
    expect((await call(b.ownerCookie, "POST", `/api/subscription/payments/${aPayment.id}/cancel`)).statusCode).toBe(404);
    expect((await call(b.ownerCookie, "GET", "/api/subscription/payments")).json().payments).toHaveLength(0);

    const kassir = await addEmployee(app, a, "Kassir");
    expect((await call(kassir.cookie, "GET", "/api/subscription")).statusCode).toBe(403);
    expect((await call(kassir.cookie, "POST", "/api/subscription/purchase", { planId: await planId("main-1m"), idempotencyKey: key("k") })).statusCode).toBe(403);
    const direktor = await addEmployee(app, a, "Direktor");
    expect((await call(direktor.cookie, "GET", "/api/subscription")).statusCode).toBe(200);
    expect((await call(direktor.cookie, "GET", "/api/subscription/licenses")).statusCode).toBe(200);
    expect((await call(direktor.cookie, "POST", "/api/subscription/purchase", { planId: await planId("main-1m"), idempotencyKey: key("d") })).statusCode).toBe(403);

    expect((await call(a.ownerCookie, "POST", `/api/platform/billing/payments/${aPayment.id}/confirm`, {})).statusCode).toBe(403);
    const pending = (await call(adminCookie, "GET", "/api/platform/billing/payments?status=pending")).json().payments as { id: string; companyName: string }[];
    expect(pending.map((payment) => [payment.id, payment.companyName])).toEqual([[aPayment.id, "A"]]);
  });

  it("platforma admini included litsenziyalar sonini o'zgartiradi (ishlatilganidan kam emas)", async () => {
    const company = await trialCompany();
    await addEmployee(app, company);
    await addEmployee(app, company);
    const url = `/api/platform/companies/${company.companyId}/subscription`;
    expect((await call(adminCookie, "PUT", url, { includedLicenses: 2 })).statusCode).toBe(400);
    expect((await call(adminCookie, "PUT", url, { includedLicenses: 5 })).statusCode).toBe(200);
    expect((await call(company.ownerCookie, "PUT", url, { includedLicenses: 50 })).statusCode).toBe(403);
    expect((await newEmployee(company)).res.statusCode).toBe(201);

    const details = (await call(adminCookie, "GET", url)).json();
    expect(details.licenses).toMatchObject({ includedTotal: 5, includedUsed: 4 });
    expect(details.licenseList).toHaveLength(4);
    expect((details.history.subscriptions as { event: string }[]).map((row) => row.event)).toContain("licenses_changed");
    const listed = (await call(adminCookie, "GET", "/api/platform/companies")).json().companies[0];
    expect(listed.subscription).toMatchObject({ status: "trial", includedLicenses: 5, usedLicenses: 4 });
  });
});

describe("Kassa qurilmasi", () => {
  it("obuna tugasa sinxron va kassir kirishi 403 (amallar rad etilgan deb saqlanmaydi), qurilma holati ochiq", async () => {
    const company = await trialCompany();
    const [warehouse] = await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId));
    const registered = await app.inject({
      method: "POST",
      url: "/api/pos-device/setup/register",
      payload: { phone: company.owner.phone, password: company.owner.password, warehouseId: warehouse!.id, name: "Kassa 1" },
    });
    expect(registered.statusCode).toBe(201);
    const token = (registered.json() as { token: string }).token;
    const device = (method: Method, url: string, payload?: object) =>
      app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
    expect((await device("POST", "/api/pos-device/pull", {})).statusCode).toBe(200);

    await expireSubscription(company.companyId);
    const session = await device("GET", "/api/pos-device/session");
    expect(session.statusCode).toBe(200);
    expect(session.json().company.subscription).toMatchObject({ status: "expired" });
    const pull = await device("POST", "/api/pos-device/pull", {});
    expect(pull.statusCode).toBe(403);
    expect(reasonOf(pull)).toBe("subscription_expired");
    expect((await device("POST", "/api/pos-device/push", { ops: [{ opId: randomUUID(), type: "stock.count" }] })).statusCode).toBe(403);
    expect(await db.select().from(posSyncOperations)).toHaveLength(0);
    expect((await device("POST", "/api/pos-device/cashiers/login", { phone: company.owner.phone, password: company.owner.password })).statusCode).toBe(403);
  });
});

describe("Migratsiya: tizimdan oldingi kompaniyalar", () => {
  it("trial — o'z sanasi bilan, qolganlari muddatsiz active; litsenziya har faol a'zoga (kamida 3); takror ishlasa o'zgarmaydi", async () => {
    const trial = await createCompany(app, adminCookie, { name: "Eski trial" });
    const legacy = await createCompany(app, adminCookie, { name: "Eski faol" });
    const staff: Awaited<ReturnType<typeof addEmployee>>[] = [];
    for (let i = 0; i < 4; i++) staff.push(await addEmployee(app, legacy));
    await db.update(companyMembers).set({ isActive: false }).where(eq(companyMembers.userId, staff[3]!.id));

    // Tizimdan oldingi holat: obuna yozuvlari yo'q
    await db.delete(licenseHistory);
    await db.delete(subscriptionHistory);
    await db.delete(subscriptionPayments);
    await db.delete(licenses);
    await db.delete(subscriptions);
    const trialEndsAt = new Date(Date.now() + 3 * DAY);
    await db.update(companies).set({ status: "trial", trialEndsAt }).where(eq(companies.id, trial.companyId));
    await db.update(companies).set({ status: "active", trialEndsAt: null }).where(eq(companies.id, legacy.companyId));

    const file = readFileSync(new URL("../src/db/migrations/0043_subscriptions.sql", import.meta.url), "utf8");
    const statements = file
      .slice(file.indexOf("-- Boshlang'ich tariflar"))
      .split("--> statement-breakpoint")
      .filter((statement) => statement.trim());
    for (let run = 0; run < 2; run++) {
      for (const statement of statements) await db.execute(sql.raw(statement));
    }

    const trialSubscription = await subscriptionOf(trial.companyId);
    expect(trialSubscription).toMatchObject({ status: "trial", includedLicenses: 3 });
    expect(trialSubscription.expiresAt!.getTime()).toBe(trialEndsAt.getTime());
    expect(await subscriptionOf(legacy.companyId)).toMatchObject({ status: "active", expiresAt: null, includedLicenses: 4 });
    expect(await activeLicenses(legacy.companyId)).toHaveLength(4);
    expect(await activeLicenses(trial.companyId)).toHaveLength(1);
    expect(await db.select().from(subscriptionHistory).where(eq(subscriptionHistory.event, "legacy_migrated"))).toHaveLength(2);
    expect(await db.select().from(subscriptionPlans)).toHaveLength(8);

    // Hech kim uzilib qolmadi
    expect((await call(staff[0]!.cookie, "GET", "/api/company/branches")).statusCode).toBe(200);
    expect((await call(legacy.ownerCookie, "GET", "/api/company/branches")).statusCode).toBe(200);
    expect((await call(trial.ownerCookie, "GET", "/api/company/branches")).statusCode).toBe(200);
  });
});

import { readFile } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ROLES,
  DELIVERY_FAILURE_REASONS,
  DELIVERY_PAYMENT_TYPES,
  DELIVERY_PRIORITIES,
  DELIVERY_STATUSES,
  DELIVERY_VEHICLE_TYPES,
  PERMISSIONS,
} from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import {
  deliveryAgents,
  deliveryFailureReason,
  deliveryPaymentType,
  deliveryPriority,
  deliveryTaskStatus,
  deliveryVehicleType,
} from "../src/db/schema/delivery.js";
import { departments, employees } from "../src/db/schema/hr.js";
import { auditLogs, companyMembers, roles, users } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import { caller, deliveryAgent } from "./delivery-setup.js";
import { createCompany, login, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
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
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Yetkazish xizmati" });
});

const role = (name: string) => DEFAULT_ROLES.find((r) => r.name === name)!.permissions as string[];
const DELIVERY_PERMISSIONS = Object.keys(PERMISSIONS).filter((p) => p.startsWith("delivery."));

/** 0042 migratsiyasidan keyin katalogga qo'shilgan dostavka ruxsatlari (alohida migratsiya bilan tarqaladi). */
const AFTER_0042: string[] = ["delivery.return_pickup"];

describe("Dostavka agenti: rol, xodimdan yaratish, kirish", () => {
  it("DELIVERY_AGENT roli faqat agent amallari; lokatsiya faqat nazorat rollarida; sxema enumlari shared bilan bir xil", () => {
    expect(role("Dostavka agenti")).toEqual([
      "delivery.accept",
      "delivery.start",
      "delivery.arrive",
      "delivery.confirm",
      "delivery.fail",
      "delivery.collect_payment",
      "delivery.view_debt",
      "delivery.return_pickup",
    ]);
    expect(DELIVERY_PERMISSIONS).toHaveLength(16);
    expect(role("Direktor")).toEqual(expect.arrayContaining(DELIVERY_PERMISSIONS));
    expect(role("Supervayzer")).toEqual(
      expect.arrayContaining([
        "delivery.view",
        "delivery.manage",
        "delivery.assign",
        "delivery.reassign",
        "delivery.return",
        "delivery.view_location",
        "delivery.manage_routes",
        "delivery.view_reports",
      ]),
    );
    for (const name of ["Ko'ruvchi", "Auditor", "Savdo menejeri", "Ombor menejeri", "Kassir", "Dostavka agenti"]) {
      expect(role(name), name).not.toContain("delivery.view_location");
    }
    expect(role("Ko'ruvchi").filter((p) => p.startsWith("delivery."))).toEqual(["delivery.view"]);

    expect(deliveryTaskStatus.enumValues).toEqual([...DELIVERY_STATUSES]);
    expect(deliveryFailureReason.enumValues).toEqual([...DELIVERY_FAILURE_REASONS]);
    expect(deliveryPriority.enumValues).toEqual([...DELIVERY_PRIORITIES]);
    expect(deliveryVehicleType.enumValues).toEqual([...DELIVERY_VEHICLE_TYPES]);
    expect(deliveryPaymentType.enumValues).toEqual([...DELIVERY_PAYMENT_TYPES]);
  });

  it("agent yaratish: login + a'zolik + rol + HR xodimi + profil bitta tranzaksiyada; parol hash; telefon bilan kirish; takror telefon — 409", async () => {
    const owner = company.ownerCookie;
    const phone = uniquePhone("97");
    const res = await call(owner, "POST", "/api/delivery/agents", {
      name: "Jasur Kuryer",
      phone,
      password: "kuryer-parol-123",
      territory: "Chilonzor",
      deliveryZone: "Chilonzor 1–9 kvartallar",
      vehicleType: "van",
      vehicleNumber: "01A123BC",
      maxLoadKg: "800",
      workingSchedule: { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" },
    });
    expect(res.statusCode, res.body).toBe(201);
    const agent = res.json().agent;
    expect(agent).toMatchObject({
      code: "DA-001",
      name: "Jasur Kuryer",
      phone,
      territory: "Chilonzor",
      vehicleType: "van",
      vehicleNumber: "01A123BC",
      maxLoadKg: "800.00",
      workingSchedule: { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" },
      isActive: true,
      loginActive: true,
      employeeStatus: "active",
    });

    const [user] = await db.select().from(users).where(eq(users.id, agent.userId));
    expect(user!.passwordHash!.startsWith("$argon2id$")).toBe(true);
    expect(user!.passwordHash).not.toContain("kuryer-parol-123");
    const [member] = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.userId, agent.userId), eq(companyMembers.companyId, company.companyId)));
    expect(member).toMatchObject({ companyRole: "Dostavka agenti", isActive: true });
    const [employee] = await db
      .select({ userId: employees.userId, department: departments.code })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(employees.id, agent.employeeId));
    expect(employee).toEqual({ userId: agent.userId, department: "LOGISTIKA" });

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.companyId, company.companyId));
    expect(logs.some((log) => log.action === "DELIVERY_AGENT_CREATED")).toBe(true);
    expect(JSON.stringify(logs)).not.toContain("kuryer-parol-123");

    const { cookie } = await login(app, phone, "kuryer-parol-123");
    const me = await call(cookie!, "GET", "/api/delivery/agent/me");
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ agent: { code: "DA-001", name: "Jasur Kuryer" }, company: { id: company.companyId } });
    expect(me.json().permissions).toEqual(role("Dostavka agenti"));

    const duplicate = await call(owner, "POST", "/api/delivery/agents", { name: "Boshqa", phone, password: "boshqa-parol-123" });
    expect(duplicate.statusCode).toBe(409);
    expect((await call(owner, "GET", "/api/delivery/agents")).json().agents).toHaveLength(1);
    // Parol siyosati — qisqa parol rad etiladi, hech narsa yaratilmaydi
    expect((await call(owner, "POST", "/api/delivery/agents", { name: "Qisqa", phone: uniquePhone("97"), password: "123" })).statusCode).toBe(400);
    expect((await call(owner, "GET", "/api/delivery/agents")).json().agents).toHaveLength(1);
  });

  it("agent faqat o'z ish joyi: ERP va boshqaruv API'lari 403; faolsizlantirish va HR'da ishdan bo'shatish kirishni bloklaydi", async () => {
    const owner = company.ownerCookie;
    const agent = await deliveryAgent(app, company);
    for (const url of [
      "/api/sales/orders",
      "/api/catalog/products",
      "/api/hr/employees",
      "/api/finance/accounts",
      "/api/company/employees",
      "/api/delivery/tasks",
      "/api/delivery/agents",
      "/api/delivery/agents/live",
      "/api/delivery/dashboard",
      "/api/delivery/reports",
      "/api/delivery/ready-orders",
      "/api/sales-agent/me",
      "/api/distribution/routes",
    ]) {
      expect((await call(agent.cookie, "GET", url)).statusCode, url).toBe(403);
    }
    // Boshqa rol xodimi — agent ish joyi yo'q
    const other = await call(owner, "GET", "/api/delivery/agent/me");
    expect(other.statusCode).toBe(403);

    const off = await call(owner, "PATCH", `/api/delivery/agents/${agent.id}`, { isActive: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json().agent).toMatchObject({ isActive: false, employeeStatus: "terminated", loginActive: false });
    expect((await call(agent.cookie, "GET", "/api/delivery/agent/me")).statusCode).toBe(401);
    expect((await login(app, agent.phone, agent.password)).res.statusCode).toBe(403);

    const on = await call(owner, "PATCH", `/api/delivery/agents/${agent.id}`, { isActive: true, territory: "Yunusobod" });
    expect(on.json().agent).toMatchObject({ isActive: true, employeeStatus: "active", loginActive: true, territory: "Yunusobod" });
    const again = await login(app, agent.phone, agent.password);
    expect((await call(again.cookie!, "GET", "/api/delivery/agent/me")).statusCode).toBe(200);

    // HR: ishdan bo'shatish — yetkazuvchi profili ham faolsizlanadi
    expect((await call(owner, "PATCH", `/api/hr/employees/${agent.employeeId}`, { status: "terminated" })).statusCode).toBe(200);
    const [row] = await db.select({ isActive: deliveryAgents.isActive }).from(deliveryAgents).where(eq(deliveryAgents.id, agent.id));
    expect(row!.isActive).toBe(false);
    expect((await call(again.cookie!, "GET", "/api/delivery/agent/me")).statusCode).toBe(401);
  });

  it("0042 migratsiyasi mavjud kompaniyaga Dostavka agenti rolini qo'shadi va rollarga dostavka ruxsatlarini beradi (takror — o'zgarmaydi)", async () => {
    const touched = ["Direktor", "Supervayzer", "Savdo menejeri", "Ombor menejeri", "Auditor", "Ko'ruvchi"];
    await db.delete(roles).where(and(eq(roles.companyId, company.companyId), eq(roles.name, "Dostavka agenti")));
    for (const name of touched) {
      await db
        .update(roles)
        .set({ permissions: role(name).filter((p) => !p.startsWith("delivery.")) })
        .where(and(eq(roles.companyId, company.companyId), eq(roles.name, name)));
    }
    const text = await readFile(new URL("../src/db/migrations/0042_delivery.sql", import.meta.url), "utf8");
    const statements = text.split("--> statement-breakpoint").filter((statement) => !/ALTER TABLE|CREATE (UNIQUE )?(TABLE|INDEX|TYPE)/i.test(statement));
    for (let round = 0; round < 2; round++) {
      for (const statement of statements) await db.execute(sql.raw(statement));
    }
    const rows = await db.select().from(roles).where(eq(roles.companyId, company.companyId));
    const byName = new Map(rows.map((r) => [r.name, r]));
    for (const name of [...touched, "Dostavka agenti"]) {
      // 0042 dan KEYIN qo'shilgan ruxsatlar o'z migratsiyasi bilan keladi (0068 — qaytarib olish)
      const expected = role(name).filter((permission) => !AFTER_0042.includes(permission));
      expect([...byName.get(name)!.permissions].sort(), name).toEqual([...expected].sort());
    }
    expect(byName.get("Dostavka agenti")).toMatchObject({ isSystem: true });
  });
});

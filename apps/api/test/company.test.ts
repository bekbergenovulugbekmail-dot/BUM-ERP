import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, DEFAULT_ROLES } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { auditLogs, branches, companies, companyMembers, roles } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import { createCompany, login, me, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let companyA: Company;
let companyB: Company;

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
  const admin = await signedIn(app, { isPlatformAdmin: true });
  companyA = await createCompany(app, admin.cookie, { name: "A kompaniya" });
  companyB = await createCompany(app, admin.cookie, { name: "B kompaniya" });
});

const api = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url: `/api/company${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

/** Kompaniyaga berilgan roldagi xodim qo'shadi va uni tizimga kiritadi. */
async function employeeOf(company: Company, role = "Kassir") {
  const payload = { phone: uniquePhone(), password: "xodim-parol-123", name: `${role} xodim`, role };
  const res = await api(company.ownerCookie, "POST", "/employees", payload);
  if (res.statusCode !== 201) throw new Error(`Xodim qo'shilmadi: ${res.body}`);
  const { cookie } = await login(app, payload.phone, payload.password);
  return { id: res.json().employee.id as string, phone: payload.phone, cookie: cookie! };
}

const rolePermissions = (name: string) =>
  [...DEFAULT_ROLES.find((r) => r.name === name)!.permissions].sort();

const audits = (action: string) => db.select().from(auditLogs).where(eq(auditLogs.action, action));

async function defaultBranchOf(companyId: string) {
  const [branch] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.companyId, companyId), eq(branches.isDefault, true)));
  return branch!;
}

describe("GET /api/company", () => {
  it("egasiga kompaniya, rol va barcha ruxsatlar", async () => {
    const res = await api(companyA.ownerCookie, "GET", "");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.company).toMatchObject({ id: companyA.companyId, name: "A kompaniya", slug: companyA.slug });
    expect(body.membership.companyRole).toBe("Business Owner");
    expect([...body.permissions].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it("Kassirga faqat o'z roli ruxsatlari", async () => {
    const kassir = await employeeOf(companyA, "Kassir");
    const body = (await api(kassir.cookie, "GET", "")).json();
    expect([...body.permissions].sort()).toEqual(rolePermissions("Kassir"));
  });

  it("a'zoligi o'chirilgan xodimga 403", async () => {
    const kassir = await employeeOf(companyA);
    await db.update(companyMembers).set({ isActive: false }).where(eq(companyMembers.userId, kassir.id));
    expect((await api(kassir.cookie, "GET", "")).statusCode).toBe(403);
  });
});

describe("GET /mine va POST /switch", () => {
  it("a'zo bo'lgan kompaniyalarni ko'rsatadi va almashtiradi", async () => {
    const xodim = await employeeOf(companyA);
    await db.insert(companyMembers).values({
      companyId: companyB.companyId,
      userId: xodim.id,
      companyRole: "Kassir",
      joinedAt: new Date(),
    });

    const mine = (await api(xodim.cookie, "GET", "/mine")).json().companies as { id: string; isCurrent: boolean }[];
    expect(mine).toHaveLength(2);
    expect(mine.find((c) => c.isCurrent)?.id).toBe(companyA.companyId);

    const res = await api(xodim.cookie, "POST", "/switch", { companyId: companyB.companyId });
    expect(res.statusCode).toBe(200);
    expect((await me(app, xodim.cookie)).json().user.companyName).toBe("B kompaniya");

    // B dagi rol nomi bo'yicha (roleId yo'q) ruxsatlar topiladi
    const permissions = (await api(xodim.cookie, "GET", "")).json().permissions as string[];
    expect([...permissions].sort()).toEqual(rolePermissions("Kassir"));
    expect(await audits("COMPANY_SWITCHED")).toHaveLength(1);
  });

  it("a'zo bo'lmagan, a'zoligi o'chirilgan yoki mavjud bo'lmagan kompaniyaga o'tmaydi", async () => {
    const xodim = await employeeOf(companyA);
    expect((await api(xodim.cookie, "POST", "/switch", { companyId: companyB.companyId })).statusCode).toBe(403);

    await db.insert(companyMembers).values({
      companyId: companyB.companyId,
      userId: xodim.id,
      companyRole: "Kassir",
      isActive: false,
      joinedAt: new Date(),
    });
    expect((await api(xodim.cookie, "POST", "/switch", { companyId: companyB.companyId })).statusCode).toBe(403);
    expect((await api(xodim.cookie, "POST", "/switch", { companyId: randomUUID() })).statusCode).toBe(403);
    expect((await me(app, xodim.cookie)).json().user.companyName).toBe("A kompaniya");
  });
});

describe("PATCH /api/company", () => {
  it("egasi ma'lumotlarni yangilaydi, audit faqat o'zgargan maydonlar bilan", async () => {
    const res = await api(companyA.ownerCookie, "PATCH", "", { name: "A Plus", city: "Toshkent", legalName: "" });
    expect(res.statusCode).toBe(200);
    expect(res.json().company).toMatchObject({ name: "A Plus", city: "Toshkent", legalName: null });

    const [audit] = await audits("COMPANY_UPDATED");
    expect([...(audit!.details as { changes: string[] }).changes].sort()).toEqual(["city", "name"]);
  });

  it("company.manage ruxsati yo'q — 403 (Kassir ham, Direktor ham)", async () => {
    const kassir = await employeeOf(companyA, "Kassir");
    const direktor = await employeeOf(companyA, "Direktor");
    expect((await api(kassir.cookie, "PATCH", "", { name: "Egallandi" })).statusCode).toBe(403);
    expect((await api(direktor.cookie, "PATCH", "", { name: "Egallandi" })).statusCode).toBe(403);

    const [company] = await db.select().from(companies).where(eq(companies.id, companyA.companyId));
    expect(company!.name).toBe("A kompaniya");
  });

  it("status, ownerId kabi ruxsat etilmagan maydonlar — 400", async () => {
    expect((await api(companyA.ownerCookie, "PATCH", "", { status: "active" })).statusCode).toBe(400);
    expect((await api(companyA.ownerCookie, "PATCH", "", { ownerId: randomUUID() })).statusCode).toBe(400);
  });

  it("to'xtatilgan kompaniyada yozish 403, o'qish mumkin", async () => {
    await db.update(companies).set({ status: "suspended" }).where(eq(companies.id, companyA.companyId));
    expect((await api(companyA.ownerCookie, "PATCH", "", { name: "X" })).statusCode).toBe(403);
    expect((await api(companyA.ownerCookie, "POST", "/branches", { name: "X", code: "BR-X" })).statusCode).toBe(403);
    expect((await api(companyA.ownerCookie, "GET", "")).statusCode).toBe(200);
  });
});

describe("Filiallar", () => {
  it("yangi asosiy filial eskisini asosiylikdan tushiradi", async () => {
    const list = (await api(companyA.ownerCookie, "GET", "/branches")).json().branches as { code: string; isDefault: boolean }[];
    expect(list).toEqual([expect.objectContaining({ code: "BR-001", isDefault: true })]);

    const res = await api(companyA.ownerCookie, "POST", "/branches", { name: "Chilonzor", code: "BR-002", isDefault: true });
    expect(res.statusCode).toBe(201);

    const rows = await db.select().from(branches).where(eq(branches.companyId, companyA.companyId));
    expect(rows.filter((b) => b.isDefault).map((b) => b.code)).toEqual(["BR-002"]);
    expect(await audits("BRANCH_CREATED")).toHaveLength(1);
  });

  it("bir xil kod — 409", async () => {
    expect((await api(companyA.ownerCookie, "POST", "/branches", { name: "Takror", code: "BR-001" })).statusCode).toBe(409);
  });

  it("branches.manage: Kassirga 403, Direktorga ruxsat", async () => {
    const kassir = await employeeOf(companyA, "Kassir");
    const direktor = await employeeOf(companyA, "Direktor");
    expect((await api(kassir.cookie, "POST", "/branches", { name: "K", code: "BR-K" })).statusCode).toBe(403);
    expect((await api(direktor.cookie, "POST", "/branches", { name: "D", code: "BR-D" })).statusCode).toBe(201);
  });

  it("asosiy filialni tushirib yoki o'chirib bo'lmaydi; boshqasini asosiy qilish almashtiradi", async () => {
    const main = await defaultBranchOf(companyA.companyId);
    expect((await api(companyA.ownerCookie, "PATCH", `/branches/${main.id}`, { isDefault: false })).statusCode).toBe(400);
    expect((await api(companyA.ownerCookie, "PATCH", `/branches/${main.id}`, { isActive: false })).statusCode).toBe(400);

    const created = await api(companyA.ownerCookie, "POST", "/branches", { name: "Yunusobod", code: "BR-002" });
    const second = created.json().branch.id as string;
    expect((await api(companyA.ownerCookie, "PATCH", `/branches/${second}`, { isDefault: true })).statusCode).toBe(200);

    expect((await defaultBranchOf(companyA.companyId)).id).toBe(second);
    expect(await audits("BRANCH_UPDATED")).toHaveLength(1);
  });

  it("boshqa kompaniya filiali — 404", async () => {
    const other = await defaultBranchOf(companyB.companyId);
    expect((await api(companyA.ownerCookie, "PATCH", `/branches/${other.id}`, { name: "Egallandi" })).statusCode).toBe(404);
  });

  it("bazada bitta kompaniyada ikkinchi asosiy filial imkonsiz", async () => {
    await expect(
      db.insert(branches).values({ companyId: companyA.companyId, name: "Ikkinchi", code: "BR-009", isDefault: true }),
    ).rejects.toThrow();
  });
});

describe("A'zoni yangilash", () => {
  it("egasi rol, filial va omborni o'zgartiradi; ruxsatlar yangi rolga mos", async () => {
    const xodim = await employeeOf(companyA, "Kassir");
    const branch = (await api(companyA.ownerCookie, "POST", "/branches", { name: "Sklad", code: "BR-002" })).json().branch;
    const [warehouse] = await db.select().from(warehouses).where(eq(warehouses.companyId, companyA.companyId));

    const res = await api(companyA.ownerCookie, "PATCH", `/employees/${xodim.id}`, {
      role: "Omborchi",
      branchId: branch.id,
      allowedWarehouseIds: [warehouse!.id],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().member).toMatchObject({
      companyRole: "Omborchi",
      branchId: branch.id,
      allowedWarehouseIds: [warehouse!.id],
    });

    const companyRoles = await db.select().from(roles).where(eq(roles.companyId, companyA.companyId));
    expect(companyRoles.find((r) => r.name === "Kassir")!.memberCount).toBe(0);
    expect(companyRoles.find((r) => r.name === "Omborchi")!.memberCount).toBe(1);

    const permissions = (await api(xodim.cookie, "GET", "")).json().permissions as string[];
    expect([...permissions].sort()).toEqual(rolePermissions("Omborchi"));

    const [audit] = await audits("MEMBER_UPDATED");
    expect(audit!.details).toMatchObject({ changes: ["role", "branch", "warehouses"], role: "Omborchi" });
  });

  it("boshqa kompaniya filiali/ombori — 400, egalik roli — 403", async () => {
    const xodim = await employeeOf(companyA);
    const otherBranch = await defaultBranchOf(companyB.companyId);
    const [otherWarehouse] = await db.select().from(warehouses).where(eq(warehouses.companyId, companyB.companyId));

    const patch = (body: object) => api(companyA.ownerCookie, "PATCH", `/employees/${xodim.id}`, body);
    expect((await patch({ branchId: otherBranch.id })).statusCode).toBe(400);
    expect((await patch({ allowedWarehouseIds: [otherWarehouse!.id] })).statusCode).toBe(400);
    expect((await patch({ role: "Business Owner" })).statusCode).toBe(403);
    expect((await patch({ role: "Superadmin" })).statusCode).toBe(403);
  });

  it("a'zolikni o'chirish kompaniyaga kirishni yopadi, yoqish ochadi", async () => {
    const xodim = await employeeOf(companyA);
    expect((await api(companyA.ownerCookie, "PATCH", `/employees/${xodim.id}`, { isActive: false })).statusCode).toBe(200);
    expect((await api(xodim.cookie, "GET", "")).statusCode).toBe(403);
    expect((await api(companyA.ownerCookie, "PATCH", `/employees/${xodim.id}`, { isActive: true })).statusCode).toBe(200);
    expect((await api(xodim.cookie, "GET", "")).statusCode).toBe(200);
  });

  it("o'zini, boshqa kompaniya xodimini o'zgartirmaydi; ega bo'lmagan Direktor ham", async () => {
    expect((await api(companyA.ownerCookie, "PATCH", `/employees/${companyA.owner.id}`, { role: "Kassir" })).statusCode).toBe(403);

    const other = await employeeOf(companyB);
    expect((await api(companyA.ownerCookie, "PATCH", `/employees/${other.id}`, { role: "Omborchi" })).statusCode).toBe(404);

    const direktor = await employeeOf(companyA, "Direktor");
    const xodim = await employeeOf(companyA);
    expect((await api(direktor.cookie, "PATCH", `/employees/${xodim.id}`, { role: "Omborchi" })).statusCode).toBe(403);
  });

  it("xodimlar ro'yxati users.view talab qiladi", async () => {
    const kassir = await employeeOf(companyA, "Kassir");
    const direktor = await employeeOf(companyA, "Direktor");
    expect((await api(kassir.cookie, "GET", "/employees")).statusCode).toBe(403);
    expect((await api(direktor.cookie, "GET", "/employees")).statusCode).toBe(200);
  });
});

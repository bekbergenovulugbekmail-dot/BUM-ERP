/**
 * Xodim qo'shish BITTA joydan: `POST /api/company/employees`.
 *
 * Rol qaysi bo'lsa, shunga mos profil ham shu yerda yaratiladi (savdo agenti — savdo profili,
 * yetkazuvchi — dostavka profili), dasturga kirmaydigan xodim esa faqat HR kartochkasi bo'lib
 * ochiladi. "Qurilma tasdig'i" belgisi shu xodimga kirish qoidasini belgilaydi. Shu sabab
 * distribyutsiya, dostavka va HR bo'limlarida alohida "qo'shish" formasi kerak emas.
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/db/client.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;

const PASSWORD = "Xodim-parol-9911";

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
  company = await createCompany(app, admin.cookie, { name: "Yagona qo'shish" });
});

const addEmployee = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/company/employees", headers: { cookie: company.ownerCookie }, payload });

const get = (url: string) => app.inject({ method: "GET", url, headers: { cookie: company.ownerCookie } });

const login = (phone: string, device?: string) =>
  app.inject({
    method: "POST",
    url: "/api/auth/login",
    ...(device ? { headers: { "x-device-id": device } } : {}),
    payload: { phone, password: PASSWORD },
  });

describe("Bitta joydan qo'shish", () => {
  it("oddiy xodim: login va a'zolik", async () => {
    const created = await addEmployee({ phone: "+998901110001", password: PASSWORD, name: "Kassir Ali", role: "Kassir" });
    expect(created.statusCode, created.body).toBe(201);

    const members = (await get("/api/company/employees")).json().employees as { phone: string; companyRole: string }[];
    expect(members.some((row) => row.phone === "+998901110001" && row.companyRole === "Kassir")).toBe(true);
  });

  it("oddiy xodim Kadrlar ro'yxatida ham ko'rinadi (bo'lim va lavozim bilan)", async () => {
    const created = await addEmployee({ phone: "+998901110011", password: PASSWORD, name: "Kassir Vali", role: "Kassir", hireDate: "2026-03-02" });
    expect(created.statusCode, created.body).toBe(201);

    const employees = (await get("/api/hr/employees")).json().employees as {
      name: string;
      phone: string | null;
      departmentName: string | null;
      positionName: string | null;
      hireDate: string;
      userId: string | null;
    }[];
    const card = employees.find((row) => row.phone === "+998901110011");
    expect(card, "yangi xodim Kadrlar ro'yxatida").toBeTruthy();
    expect(card).toMatchObject({ name: "Kassir Vali", departmentName: "Asosiy", positionName: "Kassir", hireDate: "2026-03-02" });
    expect(card!.userId, "kartochka loginga bog'langan").toBeTruthy();
  });

  it("tanlangan bo'lim va lavozim bilan qo'shiladi", async () => {
    const department = await app.inject({
      method: "POST",
      url: "/api/hr/departments",
      headers: { cookie: company.ownerCookie },
      payload: { name: "Savdo bo'limi", code: "SAVDO" },
    });
    expect(department.statusCode, department.body).toBe(201);
    const departmentId = department.json().department.id as string;

    const position = await app.inject({
      method: "POST",
      url: "/api/hr/positions",
      headers: { cookie: company.ownerCookie },
      payload: { name: "Katta sotuvchi", departmentId },
    });
    expect(position.statusCode, position.body).toBe(201);
    const positionId = position.json().position.id as string;

    const created = await addEmployee({
      phone: "+998901110012",
      password: PASSWORD,
      name: "Sotuvchi Guli",
      role: "Kassir",
      departmentId,
      positionId,
    });
    expect(created.statusCode, created.body).toBe(201);

    const employees = (await get("/api/hr/employees")).json().employees as {
      phone: string | null;
      departmentName: string | null;
      positionName: string | null;
    }[];
    const card = employees.find((row) => row.phone === "+998901110012");
    expect(card).toMatchObject({ departmentName: "Savdo bo'limi", positionName: "Katta sotuvchi" });
  });

  it("dasturga kirmaydigan xodim ham tanlangan lavozim bilan tushadi", async () => {
    const department = await app.inject({
      method: "POST",
      url: "/api/hr/departments",
      headers: { cookie: company.ownerCookie },
      payload: { name: "Ombor bo'limi", code: "OMB" },
    });
    const departmentId = department.json().department.id as string;
    const position = await app.inject({
      method: "POST",
      url: "/api/hr/positions",
      headers: { cookie: company.ownerCookie },
      payload: { name: "Yuk tashuvchi", departmentId },
    });
    const positionId = position.json().position.id as string;

    const created = await addEmployee({
      phone: "+998901110013",
      softwareAccess: false,
      name: "Yuk tashuvchi Aziz",
      role: "Xodim",
      positionId,
    });
    expect(created.statusCode, created.body).toBe(201);
    const employees = (await get("/api/hr/employees")).json().employees as { phone: string | null; positionName: string | null; departmentName: string | null }[];
    expect(employees.find((row) => row.phone === "+998901110013")).toMatchObject({
      positionName: "Yuk tashuvchi",
      departmentName: "Ombor bo'limi",
    });
  });

  it("\"Sotuv agenti\" roli savdo agenti profilini ham yaratadi", async () => {
    const created = await addEmployee({
      phone: "+998901110002",
      password: PASSWORD,
      name: "Agent Bekzod",
      role: "Sotuv agenti",
      region: "Urganch",
    });
    expect(created.statusCode, created.body).toBe(201);

    const reps = (await get("/api/distribution/sales-reps")).json().salesReps as { name: string; region: string | null; userId: string | null }[];
    const rep = reps.find((row) => row.name === "Agent Bekzod");
    expect(rep).toBeDefined();
    expect(rep!.region).toBe("Urganch");
    expect(rep!.userId).not.toBeNull();
  });

  it("\"Dostavka agenti\" roli yetkazuvchi profilini ham yaratadi", async () => {
    const created = await addEmployee({
      phone: "+998901110003",
      password: PASSWORD,
      name: "Dostavchi Jasur",
      role: "Dostavka agenti",
      vehicleType: "motorcycle",
      vehicleNumber: "01A123BC",
    });
    expect(created.statusCode, created.body).toBe(201);

    const agents = (await get("/api/delivery/agents")).json().agents as { name: string | null; vehicleType: string | null }[];
    const agent = agents.find((row) => row.name === "Dostavchi Jasur");
    expect(agent).toBeDefined();
    expect(agent!.vehicleType).toBe("motorcycle");
  });

  it("agent roli uchun ism-familiya majburiy", async () => {
    const created = await addEmployee({ phone: "+998901110004", password: PASSWORD, role: "Sotuv agenti" });
    expect(created.statusCode).toBe(400);
  });

  it("dasturga kirmaydigan xodim: login ham, litsenziya ham berilmaydi", async () => {
    const created = await addEmployee({ phone: "+998901110005", name: "Yuk tashuvchi Olim", softwareAccess: false, role: "Yuk tashuvchi" });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().license).toBeNull();

    const hr = (await get("/api/hr/employees")).json().employees as { name: string; memberActive?: boolean }[];
    expect(hr.some((row) => row.name === "Yuk tashuvchi Olim")).toBe(true);

    // Login yo'q — a'zolar ro'yxatiga tushmaydi
    const members = (await get("/api/company/employees")).json().employees as { phone: string }[];
    expect(members.some((row) => row.phone === "+998901110005")).toBe(false);
  });

  it("dasturga kiradigan xodimga parol majburiy", async () => {
    const created = await addEmployee({ phone: "+998901110006", name: "Parolsiz", role: "Kassir" });
    expect(created.statusCode).toBe(400);
  });
});

describe("Qurilma tasdig'i belgisi", () => {
  it("yoqilgan bo'lsa ikkinchi qurilma tasdiq kutadi", async () => {
    const phone = "+998901110007";
    await addEmployee({ phone, password: PASSWORD, name: "Tasdiqli", role: "Kassir", deviceCheck: true });

    expect((await login(phone, "device-a")).statusCode).toBe(200);
    const second = await login(phone, "device-b");
    expect(second.statusCode).toBe(403);
    expect(second.json().error?.details?.reason ?? second.json().details?.reason).toBe("device_not_approved");
  });

  it("o'chirilgan bo'lsa istalgan qurilmadan kiradi, lekin qurilma ro'yxatga olinadi", async () => {
    const phone = "+998901110008";
    const created = await addEmployee({ phone, password: PASSWORD, name: "Tasdiqsiz", role: "Kassir", deviceCheck: false });
    expect(created.statusCode, created.body).toBe(201);

    expect((await login(phone, "device-a")).statusCode).toBe(200);
    expect((await login(phone, "device-b")).statusCode).toBe(200);

    const userId = ((await get("/api/company/employees")).json().employees as { id: string; phone: string }[]).find((row) => row.phone === phone)!.id;
    const devices = (await get(`/api/company/employees/${userId}/devices`)).json().devices as { status: string }[];
    expect(devices.length).toBe(2);
    expect(devices.some((row) => row.status === "pending")).toBe(true);
  });

  it("egasi keyin belgini o'zgartira oladi", async () => {
    const phone = "+998901110009";
    await addEmployee({ phone, password: PASSWORD, name: "O'zgaruvchi", role: "Kassir", deviceCheck: true });
    const userId = ((await get("/api/company/employees")).json().employees as { id: string; phone: string }[]).find((row) => row.phone === phone)!.id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/company/employees/${userId}`,
      headers: { cookie: company.ownerCookie },
      payload: { deviceCheck: false },
    });
    expect(patched.statusCode, patched.body).toBe(200);

    expect((await login(phone, "device-a")).statusCode).toBe(200);
    expect((await login(phone, "device-b")).statusCode).toBe(200);

    const members = (await get("/api/company/employees")).json().employees as { id: string; deviceCheck: boolean }[];
    expect(members.find((row) => row.id === userId)!.deviceCheck).toBe(false);
  });
});

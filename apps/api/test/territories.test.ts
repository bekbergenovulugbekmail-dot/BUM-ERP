/**
 * Hududlar: marshrutlar hudud tarkibida bo'ladi ("Urganch" hududida "Luchevoy", "Nadmes bozor").
 *
 * Tekshiriladi: hudud CRUD, marshrutni hududga biriktirish, marshruti bor hududni o'chirib bo'lmasligi,
 * CSV importda hudud majburiyligi va yo'q hudud ochilishi, begona kompaniya hududi yopiqligi.
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/db/client.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let adminCookie: string;
let company: Awaited<ReturnType<typeof createCompany>>;

const call = (cookie: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const owner = () => company.ownerCookie;

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
  company = await createCompany(app, adminCookie, { name: "Hududlar" });
});

const addTerritory = (name: string) => call(owner(), "POST", "/api/distribution/territories", { name });

describe("Hududlar va marshrutlar", () => {
  it("hudud ochiladi, marshrut shu hudud tarkibida bo'ladi", async () => {
    const created = await addTerritory("Urganch");
    expect(created.statusCode, created.body).toBe(201);
    const territoryId = created.json().territory.id as string;

    for (const name of ["Luchevoy", "Nadmes bozor"]) {
      const route = await call(owner(), "POST", "/api/distribution/routes", { name, territoryId, days: [1, 3] });
      expect(route.statusCode, route.body).toBe(201);
      expect(route.json().route.territoryId).toBe(territoryId);
    }

    const routes = (await call(owner(), "GET", "/api/distribution/routes")).json().routes as {
      name: string;
      territoryName: string | null;
    }[];
    expect(routes.map((row) => row.name).sort()).toEqual(["Luchevoy", "Nadmes bozor"]);
    expect(routes.every((row) => row.territoryName === "Urganch")).toBe(true);

    const territories = (await call(owner(), "GET", "/api/distribution/territories")).json().territories as {
      name: string;
      routeCount: number;
    }[];
    expect(territories).toMatchObject([{ name: "Urganch", routeCount: 2 }]);
  });

  it("nom takrorlanmaydi, o'zgartiriladi va marshruti bor hudud o'chirilmaydi", async () => {
    const territoryId = (await addTerritory("Xiva")).json().territory.id as string;
    expect((await addTerritory("xiva")).statusCode, "registrga befarq").toBe(409);

    const renamed = await call(owner(), "PATCH", `/api/distribution/territories/${territoryId}`, { name: "Xiva tumani" });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json().territory.name).toBe("Xiva tumani");

    const route = await call(owner(), "POST", "/api/distribution/routes", { name: "Ichan qal'a", territoryId, days: [2] });
    expect(route.statusCode, route.body).toBe(201);

    const blocked = await call(owner(), "DELETE", `/api/distribution/territories/${territoryId}`);
    expect(blocked.statusCode, "marshruti bor hudud o'chirilmaydi").toBe(409);

    // Marshrut boshqa hududga o'tkazilsa — o'chadi
    const other = (await addTerritory("Shovot")).json().territory.id as string;
    expect((await call(owner(), "PATCH", `/api/distribution/routes/${route.json().route.id}`, { territoryId: other })).statusCode).toBe(200);
    expect((await call(owner(), "DELETE", `/api/distribution/territories/${territoryId}`)).statusCode).toBe(204);
  });

  it("CSV import: hudud majburiy, yo'q hudud ochiladi", async () => {
    const preview = await call(owner(), "POST", "/api/distribution/routes/import", {
      dryRun: true,
      rows: [
        { name: "Luchevoy", territory: "Urganch", days: "1 3" },
        { name: "Hududsiz marshrut", days: "2" },
      ],
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().errors).toHaveLength(1);
    expect(preview.json().errors[0].message).toContain("Hudud majburiy");
    expect((preview.json().warnings as { message: string }[]).some((row) => row.message.includes("Yangi hudud ochiladi"))).toBe(true);
    expect((await call(owner(), "GET", "/api/distribution/territories")).json().territories).toHaveLength(0);

    const imported = await call(owner(), "POST", "/api/distribution/routes/import", {
      rows: [
        { name: "Luchevoy", territory: "Urganch", days: "1 3" },
        { name: "Nadmes bozor", territory: "Urganch", days: "2" },
      ],
    });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json()).toMatchObject({ created: 2 });

    const territories = (await call(owner(), "GET", "/api/distribution/territories")).json().territories as {
      name: string;
      routeCount: number;
    }[];
    expect(territories, "bitta hudud ochiladi, ikkala marshrut unga tushadi").toMatchObject([{ name: "Urganch", routeCount: 2 }]);
  });

  it("eksportda hudud ustuni bor", async () => {
    const territoryId = (await addTerritory("Urganch")).json().territory.id as string;
    await call(owner(), "POST", "/api/distribution/routes", { name: "Luchevoy", territoryId, days: [1] });
    const csv = await call(owner(), "GET", "/api/distribution/routes/export");
    expect(csv.statusCode).toBe(200);
    expect(csv.body.split("\n")[0]).toContain("Hudud");
    expect(csv.body).toContain("Urganch");
  });

  it("begona kompaniya hududi ko'rinmaydi va biriktirilmaydi", async () => {
    const stranger = await createCompany(app, adminCookie, { name: "Begona" });
    const foreign = (await call(stranger.ownerCookie, "POST", "/api/distribution/territories", { name: "Toshkent" })).json()
      .territory.id as string;

    expect((await call(owner(), "GET", "/api/distribution/territories")).json().territories).toHaveLength(0);
    const route = await call(owner(), "POST", "/api/distribution/routes", { name: "Begona marshrut", territoryId: foreign, days: [1] });
    expect(route.statusCode).toBe(404);
    expect((await call(owner(), "PATCH", `/api/distribution/territories/${foreign}`, { name: "Yangi" })).statusCode).toBe(404);
  });

  it("ruxsatsiz xodim hudud qo'sha olmaydi", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call(kassir.cookie, "POST", "/api/distribution/territories", { name: "Urganch" })).statusCode).toBe(403);
  });
});

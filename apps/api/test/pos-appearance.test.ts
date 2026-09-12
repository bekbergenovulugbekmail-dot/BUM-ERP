import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CUSTOM_THEME, contrastRatio, parsePosAppearance, readableTextColor, validateCustomTheme } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let company: Awaited<ReturnType<typeof createCompany>>;
let token: string;

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
  company = await createCompany(app, admin.cookie, { name: "Do'kon" });
  const warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const res = await app.inject({
    method: "POST",
    url: "/api/pos-device/setup/register",
    payload: { phone: company.owner.phone, password: company.owner.password, warehouseId, name: "Kassa 1" },
  });
  token = (res.json() as { token: string }).token;
});

type Appearance = { locked: boolean; theme: string; custom: Record<string, unknown> | null };

const pull = async (configHash?: string) =>
  (await app.inject({ method: "POST", url: "/api/pos-device/pull", headers: { authorization: `Bearer ${token}` }, payload: configHash ? { configHash } : {} })).json() as {
    config: { hash: string; appearance: Appearance } | null;
  };

const path = "/api/pos/devices/appearance";
const put = (cookie: string, payload: object) => app.inject({ method: "PUT", url: path, headers: { cookie }, payload });

describe("Kassa ko'rinishi: kompaniya standart mavzusi, qulf va maxsus mavzu", () => {
  it("standart — Windows System, qulfsiz; rahbar o'zgartiradi (pos.devices.manage), kassir yo'q; qurilmaga config bilan; eski nomlar", async () => {
    const owner = company.ownerCookie;
    expect((await app.inject({ method: "GET", url: path, headers: { cookie: owner } })).json()).toEqual({ appearance: { locked: false, theme: "system", custom: null } });

    const before = await pull();
    expect(before.config!.appearance).toEqual({ locked: false, theme: "system", custom: null });

    const kassir = await addEmployee(app, company, "Kassir");
    expect((await put(kassir.cookie, { locked: true, theme: "midnight" })).statusCode).toBe(403);
    expect((await put(owner, { locked: true, theme: "rainbow" })).statusCode).toBe(400);
    // API faqat yangi nomlarni qabul qiladi (eski nomlar faqat saqlangan qiymatda o'giriladi)
    expect((await put(owner, { locked: true, theme: "dark" })).statusCode).toBe(400);

    for (const theme of ["midnight", "snow", "ocean", "emerald", "royal", "sunset", "graphite", "glass", "neon", "classic", "high-contrast", "system"]) {
      expect((await put(owner, { locked: false, theme })).json()).toEqual({ appearance: { locked: false, theme, custom: null } });
    }
    const saved = await put(owner, { locked: true, theme: "high-contrast" });
    expect(saved.json()).toEqual({ appearance: { locked: true, theme: "high-contrast", custom: null } });

    const after = await pull(before.config!.hash);
    expect(after.config).toMatchObject({ appearance: { locked: true, theme: "high-contrast" } });
    expect(after.config!.hash).not.toBe(before.config!.hash);
    expect((await pull(after.config!.hash)).config).toBeNull();

    // K4 da saqlangan qiymatlar yangi nomlarga o'giriladi
    expect(parsePosAppearance('{"locked":true,"theme":"dark"}')).toEqual({ locked: true, theme: "midnight", custom: null });
    expect(parsePosAppearance('{"locked":false,"theme":"green"}')).toEqual({ locked: false, theme: "emerald", custom: null });
    expect(parsePosAppearance("buzilgan")).toEqual({ locked: false, theme: "system", custom: null });
  });

  it("maxsus mavzu: kontrast tekshiruvi (400 va sabablar), saqlash, kompaniya mavzusi sifatida qulf, qurilmaga config", async () => {
    const owner = company.ownerCookie;
    expect((await put(owner, { locked: false, theme: "custom" })).json().message).toContain("yaratilmagan");

    const lowContrast = { ...DEFAULT_CUSTOM_THEME, primary: "#e5e7eb", button: "#fafafa", sidebar: "#777777" };
    const rejected = await put(owner, { locked: false, theme: "ocean", custom: lowContrast });
    expect(rejected.statusCode).toBe(400);
    const issues = rejected.json().details.issues as { field: string }[];
    expect(issues.map((issue) => issue.field)).toEqual(expect.arrayContaining(["sidebar", "primary", "button"]));
    expect((await put(owner, { locked: false, theme: "ocean", custom: { ...DEFAULT_CUSTOM_THEME, primary: "blue" } })).statusCode).toBe(400);

    const good = { ...DEFAULT_CUSTOM_THEME, name: "Bonnu", primary: "#1D4ED8" };
    const saved = await put(owner, { locked: true, theme: "custom", custom: good });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().appearance).toMatchObject({ locked: true, theme: "custom", custom: { name: "Bonnu", primary: "#1d4ed8", radius: 10 } });

    // `custom` berilmasa saqlanadi; `null` — o'chiriladi (custom tanlangan bo'lsa — rad)
    expect((await put(owner, { locked: false, theme: "ocean" })).json().appearance).toMatchObject({ theme: "ocean", custom: { name: "Bonnu" } });
    const pulled = await pull();
    expect(pulled.config!.appearance).toMatchObject({ theme: "ocean", custom: { name: "Bonnu", button: "#15803d" } });
    expect((await put(owner, { locked: false, theme: "custom", custom: null })).statusCode).toBe(400);
    expect((await put(owner, { locked: false, theme: "ocean", custom: null })).json().appearance.custom).toBeNull();

    expect(validateCustomTheme(DEFAULT_CUSTOM_THEME)).toEqual([]);
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(readableTextColor("#1d4ed8")).toBe("#ffffff");
    expect(readableTextColor("#fde68a")).toBe("#111827");
  });
});

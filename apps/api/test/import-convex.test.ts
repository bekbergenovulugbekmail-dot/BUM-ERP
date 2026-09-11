import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { products, units } from "../src/db/schema/catalog.js";
import { distributionRoutes } from "../src/db/schema/crm.js";
import { accounts, journalEntries } from "../src/db/schema/finance.js";
import { stockLevels } from "../src/db/schema/inventory.js";
import { notifications } from "../src/db/schema/notifications.js";
import { branches, companyMembers, users } from "../src/db/schema/platform.js";
import { salesOrderItems } from "../src/db/schema/sales.js";
import { importConvexExport } from "../src/migration/convex-import.js";
import { buildServer } from "../src/server.js";
import { login, resetDatabase } from "./helpers.js";

let app: FastifyInstance;
let dir: string;
const unitName = `Import-quti-${randomBytes(3).toString("hex")}`;

/** Convex Auth (lucia) Scrypt xeshi — salt sifatida hex satrning o'zi. */
function luciaHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(password.normalize("NFKC"), salt, 64, { N: 16384, r: 16, p: 1, maxmem: 64 * 1024 * 1024 });
  return `${salt}:${key.toString("hex")}`;
}

function writeTable(name: string, docs: object[]) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "documents.jsonl"), docs.map((doc) => JSON.stringify(doc)).join("\n") + "\n");
}

const created = Date.parse("2026-03-01T08:00:00Z");
const doc = (id: string, fields: object) => ({ _id: id, _creationTime: created, ...fields });

beforeAll(async () => {
  app = await buildServer();
  await app.ready();

  dir = mkdtempSync(join(tmpdir(), "convex-export-"));
  writeTable("users", [
    doc("u_owner", { name: "Ega", phone: "+998 90 111 22 33", email: "+998901112233", isActive: true, activeCompanyId: "c_main" }),
    doc("u_cashier", { name: "Kassir", phone: "901112244", isActive: true, pinHash: "abc", pinSalt: "def" }),
    doc("u_nophone", { name: "Telefonsiz" }),
  ]);
  writeTable("authAccounts", [
    doc("a_owner", { userId: "u_owner", provider: "password", providerAccountId: "+998901112233", secret: luciaHash("convex-parol-1") }),
  ]);
  writeTable("companies", [
    doc("c_main", { name: "Import MChJ", country: "UZ", currency: "UZS", isDefault: false, isActive: true, ownerId: "u_owner", slug: "import-mchj", status: "active", logoUrl: "https://evil.example/logo.png" }),
  ]);
  writeTable("branches", [
    doc("b_1", { companyId: "c_main", name: "Markaz", code: "BR-001", isDefault: true, isActive: true }),
    doc("b_2", { companyId: "c_main", name: "Chilonzor", code: "BR-001", isDefault: true, isActive: true }),
  ]);
  writeTable("companyMembers", [
    doc("m_owner", { companyId: "c_main", userId: "u_owner", companyRole: "owner", isActive: true, joinedAt: "2026-03-01T08:00:00Z", allowedWarehouseIds: ["w_main", "w_unknown"] }),
    doc("m_cashier", { companyId: "c_main", userId: "u_cashier", companyRole: "Kassir", isActive: true, joinedAt: "2026-03-02T08:00:00Z" }),
  ]);
  writeTable("units", [doc("unit_box", { name: unitName, shortName: "q", isBase: true })]);
  writeTable("products", [
    doc("p_1", { companyId: "c_main", name: "Olma", sku: "A1", baseUnitId: "unit_box", purchasePrice: 1000.125, salesPrice: 1500.5, taxRate: 12, taxIncluded: true, minStock: 2, trackBatch: false, trackExpiry: false, costingMethod: "fifo", isActive: true, isSaleable: true, isPurchaseable: true, isManufactured: false, imageUrl: "https://evil.example/x.png" }),
    doc("p_2", { companyId: "c_main", name: "Nok", sku: "A1", baseUnitId: "unit_box", purchasePrice: 800, salesPrice: 1200, taxRate: 0, taxIncluded: true, minStock: 0, trackBatch: false, trackExpiry: false, costingMethod: "average", isActive: true, isSaleable: true, isPurchaseable: true, isManufactured: false }),
    doc("p_orphan", { name: "Yetim", sku: "Z9", baseUnitId: "unit_box", purchasePrice: 1, salesPrice: 1, taxRate: 0, taxIncluded: true, minStock: 0, trackBatch: false, trackExpiry: false, costingMethod: "average", isActive: true, isSaleable: true, isPurchaseable: true, isManufactured: false }),
  ]);
  writeTable("warehouses", [doc("w_main", { companyId: "c_main", name: "Asosiy", code: "WH-001", isDefault: true, isActive: true })]);
  writeTable("stockLevels", [
    doc("s_1", { companyId: "c_main", productId: "p_1", warehouseId: "w_main", quantity: 5.5, reservedQty: 0, avgCostPrice: 1000.123456 }),
    doc("s_2", { companyId: "c_main", productId: "p_2", warehouseId: "w_main", quantity: -3, reservedQty: 0, avgCostPrice: 800 }),
  ]);
  writeTable("customers", [doc("cust_1", { companyId: "c_main", name: "Anvar", code: "C-0001", discountPercent: 0, creditLimit: 0, paymentTermDays: 0, currency: "UZS", isActive: true, totalDebt: 0.1 + 0.2, totalPurchased: 3001 })]);
  writeTable("salesOrders", [doc("so_1", { companyId: "c_main", number: "SO-2026-0001", customerId: "cust_1", warehouseId: "w_main", status: "delivered", orderDate: "2026-03-05", currency: "UZS", exchangeRate: 1, subtotal: 3001, taxAmount: 0, discountAmount: 0, totalAmount: 3001, paidAmount: 3001, isPOS: false })]);
  writeTable("salesOrderItems", [doc("soi_1", { companyId: "c_main", orderId: "so_1", productId: "p_1", unitId: "unit_box", qty: 2, unitPrice: 1500.5, taxRate: 0, discountPercent: 0, lineTotal: 3001, costPrice: 1000.12 })]);
  writeTable("accounts", [
    doc("acc_cash", { companyId: "c_main", code: "1010", name: "Naqd kassa", type: "asset", subtype: "cash", currency: "UZS", isActive: true, balance: 3001 }),
    doc("acc_sales", { companyId: "c_main", code: "4000", name: "Sotuv daromadi", type: "income", subtype: "sales", currency: "UZS", isActive: true, balance: 3000.5 }),
    doc("acc_orphan", { code: "9999", name: "Yetim hisob", type: "asset", currency: "UZS", isActive: true, balance: 0 }),
  ]);
  writeTable("journalEntries", [
    doc("je_ok", { companyId: "c_main", number: "JE-2026-00001", date: "2026-03-05", description: "Sotuv", referenceType: "sale_ship", referenceId: "so_1", status: "posted", totalDebit: 3001, totalCredit: 3000.5 }),
    doc("je_bad", { companyId: "c_main", number: "JE-2026-00002", date: "2026-03-06", description: "Buzuq", status: "posted", totalDebit: 100, totalCredit: 95 }),
  ]);
  writeTable("journalLines", [
    doc("jl_1", { entryId: "je_ok", accountId: "acc_cash", debit: 3001, credit: 0 }),
    doc("jl_2", { entryId: "je_ok", accountId: "acc_sales", debit: 0, credit: 3000.5 }),
    doc("jl_3", { entryId: "je_bad", accountId: "acc_cash", debit: 100, credit: 0 }),
    doc("jl_4", { entryId: "je_bad", accountId: "acc_sales", debit: 0, credit: 95 }),
  ]);
  // Convex: 0 = dushanba, 4 = juma, 6 = yakshanba
  writeTable("distributionRoutes", [doc("route_1", { companyId: "c_main", name: "Chilonzor", days: [0, 4, 6], isActive: true })]);
  writeTable("notifications", [doc("n_1", { companyId: "c_main", type: "system", title: "Salom", message: "Test", severity: "info", isRead: false, isGlobal: true, link: "https://evil.example", createdAt: "2026-03-07T10:00:00Z" })]);
  writeTable("auditLogs", [doc("log_1", { companyId: "c_main", userId: "u_owner", action: "login", resource: "users", details: '{"ok":true}', severity: "info", timestamp: "2026-03-07T10:00:00Z" })]);
});

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
});

const legacyCount = async (table: string) =>
  (await db.execute<{ count: number }>(sql`select count(*)::int as count from ${sql.identifier(table)} where legacy_id is not null`)).rows[0]!.count;

describe("Convex eksportidan import", () => {
  it("parol bilan kirish, havolalar, yaxlitlash, tozalashlar va hisobot", async () => {
    const report = await importConvexExport(dir);

    expect(report.tables.users).toMatchObject({ read: 3, imported: 2, skipped: 1 });
    expect(report.tables.users!.warnings).toMatchObject({ "PIN ko'chirilmadi — qayta o'rnatiladi": 1 });
    expect(report.tables.products).toMatchObject({ read: 3, imported: 2, skipped: 1 });
    expect(report.tables.products!.reasons).toEqual({ "kompaniya topilmadi (kompaniyasiz yozuv)": 1 });
    expect(report.tables.accounts!.skipped).toBe(1);

    // Convex paroli bilan kirish — birinchi kirishda argon2id ga o'tadi
    const owner = await login(app, "+998901112233", "convex-parol-1");
    expect(owner.res.statusCode).toBe(200);
    expect(owner.res.json().user).toMatchObject({ companyName: "Import MChJ", companyRole: "Business Owner" });
    const [ownerRow] = await db.select().from(users).where(eq(users.phone, "+998901112233"));
    expect(ownerRow!.passwordAlgo).toBe("argon2id");
    expect((await login(app, "+998901112244", "istalgan-parol")).res.statusCode).toBe(401);

    const branchRows = await db.select().from(branches).where(isNotNull(branches.legacyId));
    expect(branchRows.filter((b) => b.isDefault)).toHaveLength(1);
    expect(branchRows.map((b) => b.code).sort()).toEqual(["BR-001", "BR-001-2"]);

    const [member] = await db.select().from(companyMembers).where(eq(companyMembers.legacyId, "m_owner"));
    expect(member!.allowedWarehouseIds).toHaveLength(1);

    const productRows = await db.select().from(products).where(isNotNull(products.legacyId));
    expect(productRows.map((p) => p.sku).sort()).toEqual(["A1", "A1-2"]);
    expect(productRows.find((p) => p.legacyId === "p_1")).toMatchObject({ purchasePrice: "1000.1250", costingMethod: "average", imageKey: null });

    const levels = await db.select().from(stockLevels).where(isNotNull(stockLevels.legacyId));
    expect(levels.find((l) => l.legacyId === "s_1")).toMatchObject({ quantity: "5.5000", avgCostPrice: "1000.1235" });
    expect(levels.find((l) => l.legacyId === "s_2")!.quantity).toBe("0.0000");

    const [item] = await db.select().from(salesOrderItems).where(eq(salesOrderItems.legacyId, "soi_1"));
    expect(item).toMatchObject({ quantity: "2.0000", unitPrice: "1500.5000", lineTotal: "3001.00" });

    const entries = await db.select().from(journalEntries).where(isNotNull(journalEntries.legacyId));
    expect(entries.find((e) => e.legacyId === "je_ok")).toMatchObject({ status: "posted", totalDebit: "3001.00", totalCredit: "3000.50", referenceType: "sale_ship" });
    expect(entries.find((e) => e.legacyId === "je_bad")).toMatchObject({ status: "draft", totalDebit: "100.00", totalCredit: "100.00" });
    expect(entries.find((e) => e.legacyId === "je_bad")!.notes).toContain("debet 100.00, kredit 95.00");

    // API: 0 = yakshanba, 1 = dushanba, 5 = juma
    const [route] = await db.select().from(distributionRoutes).where(eq(distributionRoutes.legacyId, "route_1"));
    expect(route!.days).toEqual([0, 1, 5]);

    const [notification] = await db.select().from(notifications).where(eq(notifications.legacyId, "n_1"));
    expect(notification!.link).toBeNull();

    // Hisoblar rejasi to'ldirildi: Convex'dagi 1010 va 4000 + qolgan standart hisoblar
    const companyAccounts = await db.select().from(accounts).where(eq(accounts.companyId, ownerRow!.activeCompanyId!));
    expect(companyAccounts.length).toBe(21);

    expect(report.reconciliation).toMatchObject({ companies: 1, users: 2, customer_debt: "0.30", journal_imbalance: "0.50" });
    const [box] = await db.select().from(units).where(eq(units.name, unitName));
    expect(box!.legacyId).toBe("unit_box");
  });

  it("qayta import dublikat yaratmaydi va yangi tizimda o'zgargan parolni saqlaydi; quruq ishga tushirish hech narsa yozmaydi", async () => {
    const dry = await importConvexExport(dir, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.tables.products!.imported).toBe(2);
    expect(await legacyCount("products")).toBe(0);
    expect(await legacyCount("companies")).toBe(0);

    await importConvexExport(dir);
    const counts = { products: await legacyCount("products"), branches: await legacyCount("branches"), journal_lines: await legacyCount("journal_lines") };

    const owner = await login(app, "+998901112233", "convex-parol-1");
    const changed = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie: owner.cookie! },
      payload: { currentPassword: "convex-parol-1", newPassword: "yangi-tizim-parol" },
    });
    expect(changed.statusCode).toBe(200);

    const second = await importConvexExport(dir);
    expect(second.tables.products!.imported).toBe(2);
    expect({ products: await legacyCount("products"), branches: await legacyCount("branches"), journal_lines: await legacyCount("journal_lines") }).toEqual(counts);
    expect((await login(app, "+998901112233", "yangi-tizim-parol")).res.statusCode).toBe(200);
    expect((await login(app, "+998901112233", "convex-parol-1")).res.statusCode).toBe(401);

    const defaults = await db.select().from(branches).where(and(isNotNull(branches.legacyId), eq(branches.isDefault, true)));
    expect(defaults).toHaveLength(1);
  });
});

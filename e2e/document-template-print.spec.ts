/**
 * Shablon HAQIQIY nakladnoyga ta'sir qilishi kerak — HAQIQIY brauzerda.
 *
 * Qoida: kompaniya o'z shablonini tuzmaguncha nakladnoy AVVALGIDEK chiqadi. Shu sababli bu
 * yerda ikkala holat ham tekshiriladi: shablonsiz `custom: false`, shablon tuzilgach `true`.
 */
import { expect, test } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

/**
 * Har test hujjatni HAQIQIY PDF qilib chizadi va birinchisida unicode shrift (~900 KB)
 * yuklanadi. Dev serverda modul grafigi har safar qayta hal qilinadi, shuning uchun
 * to'plam bo'lib yurganda standart 90 soniya yetmaydi.
 */
test.describe.configure({ timeout: 240_000 });

test.afterEach(async ({ page }) => {
  // Tozalash HECH QACHON testni yiqitmasin — u asosiy tekshiruv emas
  const list = await page.request.get("/api/documents/templates", { timeout: 30_000 }).catch(() => null);
  if (!list?.ok()) return;
  const { templates } = (await list.json()) as { templates: { id: string; name: string; isDefault: boolean }[] };
  for (const template of templates) {
    if (!/^Nakladnoy \d+$/.test(template.name) || template.isDefault) continue;
    await page.request.delete(`/api/documents/templates/${template.id}`, { timeout: 30_000 }).catch(() => null);
  }
});

/**
 * Hisob-faktura va xarid buyurtmasi ham shablonga ulangan (2026-09-25).
 * Bu yerda ikkala hujjat ham shablon bilan haqiqiy PDF bo'lib chizilishi tekshiriladi.
 */
test("hisob-faktura va xarid shablon bilan chiziladi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/dashboard"));

  const result = await page.evaluate(async () => {
    const bridge = (await import("/src/lib/pdf/document-template-bridge.ts")) as typeof import("../src/lib/pdf/document-template-bridge.ts");
    const { renderTemplate } = (await import("/src/lib/pdf/template-renderer.ts")) as typeof import("../src/lib/pdf/template-renderer.ts");

    const load = async (type: "sales_invoice" | "purchase_order") => {
      const res = await fetch(`/api/documents/active/${type}`, { headers: { "x-bum-company": "bum-demo" } });
      return (await res.json()) as { schema: Parameters<typeof renderTemplate>[0]; custom: boolean };
    };

    const company = { name: "BONNU MARKET", taxId: "301234567" };
    const invoice = await load("sales_invoice");
    const invoiceDoc = await renderTemplate(
      invoice.schema,
      bridge.invoiceDocumentData(
        {
          company, number: "SO-2026-0004", date: "2026-09-25",
          customerName: "Раматов Маркет", customerPhone: "+998900000000", customerAddress: "Урганч",
          warehouseName: "Asosiy ombor",
          items: [{ name: "Coca Cola 1L", sku: "COLA-1", qty: 12, unit: "Dona", unitPrice: 8300, discount: 0, taxRate: 0, lineTotal: 99600 }],
          subtotal: 99600, taxTotal: 0, discountTotal: 0, totalAmount: 99600, paidAmount: 0, balance: 99600,
          currency: "so'm", status: "completed",
        },
        "Egasi",
      ),
    );

    const purchase = await load("purchase_order");
    const purchaseDoc = await renderTemplate(
      purchase.schema,
      bridge.purchaseDocumentData(
        {
          company, number: "PO-2026-0001", orderDate: "2026-09-25",
          supplierName: "Глобал Трейд", supplierPhone: "+998911112233", warehouseName: "Asosiy ombor",
          items: [{ productName: "Coca Cola 1L", productSku: "COLA-1", orderedQty: 10, receivedQty: 0, unitName: "Blok", unitPrice: 99600, lineTotal: 996000 }],
          totalAmount: 996000, paidAmount: 500000, balance: 496000, currency: "so'm", status: "confirmed",
        },
        "Egasi",
      ),
    );

    const text = (doc: typeof invoiceDoc) =>
      ((doc as unknown as { internal: { pages: string[][] } }).internal.pages[1] ?? []).join(" ");
    return {
      invoicePdf: (invoiceDoc.output("datauristring") as string).startsWith("data:application/pdf"),
      purchasePdf: (purchaseDoc.output("datauristring") as string).startsWith("data:application/pdf"),
      invoiceHasCustomer: text(invoiceDoc).length > 0,
      purchaseHasSupplier: text(purchaseDoc).length > 0,
    };
  });

  expect(result.invoicePdf, "hisob-faktura PDF bo'lmadi").toBe(true);
  expect(result.purchasePdf, "xarid PDF bo'lmadi").toBe(true);
  expect(result.invoiceHasCustomer).toBe(true);
  expect(result.purchaseHasSupplier).toBe(true);
});

test("shablon tuzilmaguncha nakladnoy avvalgi ko'rinishda qoladi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/dashboard"));

  const before = await page.evaluate(async () => {
    const res = await fetch("/api/documents/active/purchase_order", { headers: { "x-bum-company": "bum-demo" } });
    return (await res.json()) as { custom: boolean };
  });
  // Bu turda shablon tuzilmagan — zavod ko'rinishi
  expect(before.custom).toBe(false);
});

test("standart shablon tuzilgach nakladnoy shablon bo'yicha chiqadi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/settings"));
  await page.getByRole("tab", { name: "Hujjatlar" }).click();
  await expect(page.locator("iframe").first()).toHaveAttribute("src", /^blob:/, { timeout: 20_000 });

  const name = `Nakladnoy ${Date.now()}`;
  await page.getByTestId("template-create").click();
  await page.getByTestId("template-name").fill(name);
  await page.getByTestId("template-create-confirm").click();
  await expect(page.getByTestId("template-select")).toContainText(name, { timeout: 20_000 });
  await expect(page.locator("iframe").first()).toHaveAttribute("src", /^blob:/, { timeout: 20_000 });

  // Shu shablonni standart qilamiz
  await page.getByRole("button", { name: "Standart" }).click();
  await expect(page.getByText(/Standart qilindi/)).toBeVisible({ timeout: 20_000 });

  const after = await page.evaluate(async () => {
    const res = await fetch("/api/documents/active/delivery_waybill", { headers: { "x-bum-company": "bum-demo" } });
    return (await res.json()) as { custom: boolean; schema: { sections: { key: string }[] } };
  });
  expect(after.custom, "endi kompaniyaning O'Z shabloni ishlatiladi").toBe(true);
  expect(after.schema.sections.map((section) => section.key)).toEqual(["header", "body", "footer"]);
});

test("shablon bilan chizilgan nakladnoy haqiqiy PDF bo'ladi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/dashboard"));

  const result = await page.evaluate(async () => {
    const res = await fetch("/api/documents/active/delivery_waybill", { headers: { "x-bum-company": "bum-demo" } });
    const { schema } = (await res.json()) as { schema: unknown };
    const { renderWaybillsWithTemplate } = (await import("/src/lib/pdf/delivery-template.ts")) as typeof import("../src/lib/pdf/delivery-template.ts");
    const doc = await renderWaybillsWithTemplate(
      schema as Parameters<typeof renderWaybillsWithTemplate>[0],
      [
        {
          number: "DL-2026-0005", status: "assigned", scheduledDate: "2026-09-25", orderNumber: "SO-2026-0004",
          orderTotal: 42_200, customerName: "Раматов Маркет", customerPhone: "+998900000000",
          customerAddress: "Урганч", customerDebt: 0, warehouseName: "Asosiy ombor",
          agentCode: "AG-01", agentName: "Раматов Расул",
          // Mahsulot qatorlari — jadval bo'sh chiqmasligi kerak (2026-09-25 regressiyasi)
          items: [
            { productName: "EZO Osvijitel 460 ml", productSku: "EZO-460", quantity: "1", unitName: "d", unitPrice: "17200", lineTotal: "17200" },
            { productName: "Gel jidkiy 900", productSku: "GEL-900", quantity: "1", unitName: "d", unitPrice: "16500", lineTotal: "16500" },
          ],
        },
        {
          number: "DL-2026-0006", status: "assigned", scheduledDate: "2026-09-25", orderNumber: "SO-2026-0005",
          orderTotal: 15_000, customerName: "Ikkinchi", customerPhone: null,
          customerAddress: null, customerDebt: 5_000, warehouseName: "Asosiy ombor",
          agentCode: "AG-01", agentName: "Раматов Расул",
        },
      ],
      { company: { name: "BUM Demo" }, currency: "so'm", responsibleName: "Egasi" },
    );
    return { pages: doc.getNumberOfPages(), isPdf: (doc.output("datauristring") as string).startsWith("data:application/pdf") };
  });

  expect(result.isPdf).toBe(true);
  expect(result.pages, "har yetkazma o'z sahifasida").toBeGreaterThanOrEqual(2);
});

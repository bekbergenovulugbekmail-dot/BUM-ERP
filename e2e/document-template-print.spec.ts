/**
 * Shablon HAQIQIY nakladnoyga ta'sir qilishi kerak — HAQIQIY brauzerda.
 *
 * Qoida: kompaniya o'z shablonini tuzmaguncha nakladnoy AVVALGIDEK chiqadi. Shu sababli bu
 * yerda ikkala holat ham tekshiriladi: shablonsiz `custom: false`, shablon tuzilgach `true`.
 */
import { expect, test } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

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

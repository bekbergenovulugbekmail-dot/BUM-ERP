/**
 * KO'P NAKLADNOY — HAQIQIY BRAUZERDA.
 *
 * Regressiya (2026-09-25): ikkita nakladnoy chiqarilganda ikkinchisining nomlari teshik va
 * jami noto'g'ri chiqqan edi (har nakladnoy alohida PDF qilinib sahifasi nusxalanardi).
 * Bu yerda PDF ichidan MATN AJRATIB olinadi — "PDF yaratildi" tekshiruvi yetarli emas.
 */
import { expect, test } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

test.describe.configure({ timeout: 240_000 });

test.beforeEach(async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/dashboard"));
});

/** Brauzerda chizib, PDF matnini va sahifa sonini qaytaradi. */
async function renderBulk(page: import("@playwright/test").Page, count: number, mode: "smart" | "full") {
  return page.evaluate(
    async ({ count, mode }) => {
      const { waybillDocumentData, renderWaybillsWithTemplate } = (await import(
        "/src/lib/pdf/delivery-template.ts"
      )) as typeof import("../src/lib/pdf/delivery-template.ts");
      /**
       * Shablon TESTDA belgilanadi (jonli shablon emas): tekshirilayotgan narsa — renderer,
       * shuning uchun natija kompaniyaning shabloni o'zgarishiga bog'liq bo'lmasligi kerak.
       */
      const schema = {
        schemaVersion: 1,
        page: { size: "a4", orientation: "portrait", margins: { top: 14, right: 14, bottom: 14, left: 14 }, footerOnEveryPage: true, signaturesOnLastPage: true },
        sections: [
          { key: "header", elements: [{ id: "h", type: "text", label: "YETKAZMA NAKLADNOYI" }, { id: "h2", type: "field", field: "document.number", label: "Hujjat" }] },
          {
            key: "body",
            elements: [
              { id: "b1", type: "field", field: "customer.name", label: "Mijoz" },
              { id: "b2", type: "itemsTable", columns: [{ key: "index" }, { key: "name" }, { key: "total" }] },
              { id: "b3", type: "totals", rows: ["total"] },
            ],
          },
          { key: "footer", elements: [] },
        ],
      } as unknown as Parameters<typeof renderWaybillsWithTemplate>[0];

      const list = Array.from({ length: count }, (_, i) => ({
        number: `DL-2026-${String(i + 1).padStart(4, "0")}`,
        status: "assigned", scheduledDate: `2026-09-${String(10 + i).padStart(2, "0")}`,
        orderNumber: `SO-${i + 1}`, orderTotal: (i + 1) * 1000,
        customerName: i % 2 === 0 ? `Mijoz ${i + 1}` : `Кроп Шоп ${i + 1}`,
        customerPhone: null, customerAddress: null, customerDebt: 0,
        warehouseName: "Asosiy ombor", agentCode: "DA-002", agentName: "Раматов Расул",
        items: [{ productName: i % 2 === 0 ? `Mahsulot ${i + 1}` : `Товар ${i + 1}`, productSku: "S", quantity: "1", unitName: "d", unitPrice: String((i + 1) * 1000), lineTotal: String((i + 1) * 1000) }],
      })) as Parameters<typeof waybillDocumentData>[0][];

      const doc = await renderWaybillsWithTemplate(schema, list, {
        company: { name: "BONNU MARKET" }, currency: "UZS", responsibleName: "Egasi", mode,
      });

      // PDF ichidan matn: glif kodlari hujjatning o'z CMap'i orqali o'giriladi
      const raw = doc.output("datauristring") as string;
      const bin = atob(raw.slice(raw.indexOf(",") + 1));
      const cmap = new Map<number, string>();
      for (const m of bin.matchAll(/<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]{4,})>/g)) {
        cmap.set(Number.parseInt(m[1]!, 16), String.fromCodePoint(Number.parseInt(m[2]!.slice(0, 4), 16)));
      }
      let text = "";
      for (const m of bin.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
        const hex = m[1]!;
        for (let i = 0; i + 4 <= hex.length; i += 4) text += cmap.get(Number.parseInt(hex.slice(i, i + 4), 16)) ?? "?";
        text += " ";
      }
      return { pages: doc.getNumberOfPages(), text };
    },
    { count, mode },
  );
}

test("ikkita nakladnoy: bitta A4, ma'lumot aralashmaydi", async ({ page }) => {
  const { pages, text } = await renderBulk(page, 2, "smart");
  expect(pages, "ikkitasi bir varaqqa sig'adi").toBe(1);
  expect(text).toContain("DL-2026-0001");
  expect(text).toContain("DL-2026-0002");
  expect(text).toContain("Mijoz 1");
  expect(text).toContain("Кроп Шоп 2");
  expect(text, "buzilgan glif qolmasin").not.toContain("?");
});

test("to'rtta nakladnoy: har biri o'z mijozi va mahsuloti bilan", async ({ page }) => {
  const { text } = await renderBulk(page, 4, "smart");
  for (const value of ["Mijoz 1", "Кроп Шоп 2", "Mijoz 3", "Кроп Шоп 4", "Mahsulot 1", "Товар 2", "Mahsulot 3", "Товар 4"]) {
    expect(text, `${value} yo'q yoki buzilgan`).toContain(value);
  }
  expect(text).not.toContain("?");
});

test("yigirmata nakladnoy: hammasi chiqadi, sahifa soni tejaladi", async ({ page }) => {
  const { pages, text } = await renderBulk(page, 20, "smart");
  for (let i = 1; i <= 20; i += 1) {
    expect(text, `${i}-nakladnoy yo'q`).toContain(`DL-2026-${String(i).padStart(4, "0")}`);
  }
  expect(text).not.toContain("?");
  expect(pages, "aqlli joylashuv sahifani tejaydi").toBeLessThan(20);
});

test("`Har biri alohida varaq` rejimi eski xulqni beradi", async ({ page }) => {
  const { pages } = await renderBulk(page, 3, "full");
  expect(pages).toBe(3);
});

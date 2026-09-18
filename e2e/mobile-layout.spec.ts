/**
 * Mobil ekranda (360×740 — eng kichik telefon) ERP sahifalari gorizontal aylanmasligi kerak.
 *
 * Qoida: sahifa o'zi yon tomonga surilmaydi. Keng jadval, xarita yoki diagramma bo'lsa —
 * u O'Z idishida (`overflow-x: auto`) suriladi, sahifa emas. Aks holda telefonda kartochkalarning
 * o'ng cheti ko'rinmay qoladi va menyular kompyuterdagidek siqilib chiqadi.
 */
import { expect, test } from "@playwright/test";
import { ACCOUNTS, appPath, login } from "./_lib/accounts.ts";

const PHONE = { width: 360, height: 740 };

/** Har bir sahifa: manzil va ochilganini bildiradigan matn. */
const PAGES = [
  { path: "dashboard", ready: /Boshqaruv|Dashboard|Умное/i },
  { path: "sales", ready: /Sotuv|Savdo/i },
  { path: "products", ready: /Mahsulot/i },
  { path: "warehouse", ready: /Ombor/i },
  { path: "purchase", ready: /Xarid/i },
  { path: "crm", ready: /CRM|Mijoz/i },
  { path: "distribution", ready: /Distribut/i },
  { path: "delivery", ready: /Yetkaz|Dostavka/i },
  { path: "finance", ready: /Moliya/i },
  { path: "hr", ready: /Xodim|Hodim|HR/i },
  { path: "settings", ready: /Sozlama/i },
];

/** Sahifadan kengroq chiqib ketgan elementlar (xatoni tushunarli qilish uchun). */
async function overflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const width = doc.clientWidth;
    const guilty: { tag: string; cls: string; width: number; right: number }[] = [];
    for (const element of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right <= width + 1) continue;
      // Faqat o'zi surilmaydigan (ya'ni sahifani cho'zayotgan) elementlar aybdor
      const style = getComputedStyle(element);
      const scrolls = style.overflowX === "auto" || style.overflowX === "scroll";
      if (scrolls) continue;
      guilty.push({
        tag: element.tagName.toLowerCase(),
        cls: (element.className || "").toString().slice(0, 120),
        width: Math.round(box.width),
        right: Math.round(box.right),
      });
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: width, guilty: guilty.slice(0, 6) };
  });
}

test.describe("Mobil ko'rinish", () => {
  test.use({ viewport: PHONE });

  test("ERP sahifalari telefonda yon tomonga surilmaydi", async ({ page }) => {
    await login(page, "owner" as keyof typeof ACCOUNTS);

    const broken: string[] = [];
    for (const item of PAGES) {
      await page.goto(appPath(item.path));
      await page.waitForLoadState("networkidle");
      const result = await overflow(page);
      if (result.scrollWidth > result.clientWidth + 1) {
        broken.push(
          `${item.path}: ${result.scrollWidth} > ${result.clientWidth} — ${result.guilty
            .map((g) => `${g.tag}.${g.cls.split(" ").slice(0, 3).join(".")} (w=${g.width})`)
            .join(", ")}`,
        );
      }
    }
    expect(broken, broken.join("\n")).toEqual([]);
  });
});

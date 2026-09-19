/**
 * Demo hisoblar (`db:seed-demo` yaratadi). Parol faqat `.env` dagi DEMO_PASSWORD —
 * kodda saqlanmaydi va git'ga tushmaydi.
 */
import { expect, type Page } from "@playwright/test";

export const PASSWORD = process.env.DEMO_PASSWORD ?? "";

export const ACCOUNTS = {
  owner: { phone: "+998900000101", label: "Egasi" },
  direktor: { phone: "+998900000102", label: "Direktor" },
  buxgalter: { phone: "+998900000103", label: "Buxgalter" },
  kassir: { phone: "+998900000104", label: "Kassir" },
  ombor: { phone: "+998900000105", label: "Ombor menejeri" },
  agent: { phone: "+998900000106", label: "Sotuv agenti" },
  dostavchi: { phone: "+998900000107", label: "Dostavka agenti" },
} as const;

export type AccountKey = keyof typeof ACCOUNTS;

/** Ilova manzillari kompaniya slug'i bilan: /bum-demo/pos */
export const SLUG = process.env.DEMO_SLUG ?? "bum-demo";
export const appPath = (path: string) => `/${SLUG}/${path.replace(/^\//, "")}`;

/** Tizimga kirish; kirish sahifasidan chiqqanini tasdiqlaydi. */
export async function login(page: Page, who: AccountKey) {
  if (!PASSWORD) throw new Error("DEMO_PASSWORD .env da yo'q — `pnpm --filter @bum/api db:seed-demo` va .env ni tekshiring");
  // Har safar toza sessiya: eski cookie qolsa ilova /login dan o'zi chetga burib yuboradi
  // va SPA yo'nalishi `/login/login` ga aylanib qolishi mumkin (testlar orasidagi flake).
  await page.context().clearCookies();
  // Har test yangi brauzer ochadi — qurilma identifikatori bo'lmasa har kirish "yangi qurilma"
  // bo'lib tasdiq so'rardi. Haqiqiy foydalanuvchida bu identifikator brauzerda saqlanadi,
  // shuning uchun testda ham hisob bo'yicha BARQAROR qiymat qo'yamiz.
  await page.context().addInitScript(
    (value) => {
      try {
        localStorage.setItem("bum:device-id", value);
      } catch {
        // xususiy rejim — saqlanmaydi
      }
    },
    `e2e${who}device0001`.replace(/[^A-Za-z0-9_-]/g, ""),
  );
  await page.goto("about:blank");
  // Kirish faqat biznes manzilidan (`app.bum-erp.uz/<biznes>`) — universal kirish sahifasi yo'q
  await page.goto(`/${SLUG}`);
  await expect(page.locator("#phone")).toBeVisible({ timeout: 30_000 });
  await page.locator("#phone").fill(ACCOUNTS[who].phone);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: /kirish/i }).click();
  await expect(page.locator("#password"), "kirish formasi yopilishi kerak").toBeHidden({ timeout: 30_000 });
}

/** Tizimdan chiqish (menyu joylashuvi o'zgarishi mumkin — sessiyani tozalash ishonchli yo'l). */
export async function logout(page: Page) {
  await page.context().clearCookies();
  await page.goto(`/${SLUG}`);
  await expect(page.locator("#password"), "biznes kirish sahifasi").toBeVisible({ timeout: 30_000 });
}

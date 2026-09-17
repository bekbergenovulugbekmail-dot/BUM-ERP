/**
 * 3-BOSQICH YAKUNIY QABUL — haqiqiy Chrome.
 * §1 faol sessiya paneli · §2 uch usulli to'lov · §3 to'lov validatsiyasi ·
 * §5 landshaft · §6 kategoriya · §13 skrinshotlar.
 */
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { addToCart, clearCart, closeReceipt, ensureShift, openCart, openPos, savePart } from "./_lib/pos.ts";

const FINAL = "e2e/.screenshots/final";

/** Bazadagi oxirgi POS chekini o'qiydi (faqat SELECT) — UI da ko'ringan narsa haqiqatan yozilganini tekshirish uchun. */
function lastPosSaleFromDb() {
  const out = execFileSync("pnpm", ["--filter", "@bum/api", "verify:last-pos-sale"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as {
    total: string;
    paid: string;
    status: string;
    source: string;
    fulfillmentMethod: string;
    shiftId: string;
    deliveryTasks: number;
    payments: { method: string; amount: string; terminal: string | null; network: string | null; account: string | null; shiftId: string }[];
  };
}

test.describe("§1 Faol sessiya paneli", () => {
  test("yuqori panelda ixcham xulosa, bosilganda terminal kesimi ochiladi", async ({ page }) => {
    await openPos(page);
    await ensureShift(page, "500000");

    // Panel bo'sh smenada emas, haqiqiy savdodan keyin tekshirilsin
    await clearCart(page);
    await addToCart(page, "Nestle suv 0.5L", 10); // 40 000
    await savePart(page, /naqd/i, "20000");
    await savePart(page, /uzcard/i, "20000");
    await page.getByTestId("finalize-sale").click();
    await closeReceipt(page);

    const summary = page.getByTestId("session-summary");
    await expect(summary).toBeVisible();
    // Ixcham ko'rinishda naqd, karta va jami — mahsulot maydonini siqmaydi
    await expect(summary).toContainText("Naqd");
    await expect(summary).toContainText("Jami");

    await summary.click();
    const detail = page.getByTestId("session-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("Kassa smenasi");
    await expect(detail.getByTestId("session-cash")).toBeVisible();
    // Terminal kesimi: qaysi terminal, qaysi bank hisobi va nechta tranzaksiya
    const terminals = detail.getByTestId("session-terminals");
    await expect(terminals).toBeVisible();
    await expect(terminals).toContainText("UZCARD terminal #01");
    await expect(terminals).toContainText("Asosiy bank hisobi");
    await expect(terminals).toContainText("tranzaksiya");
    await page.screenshot({ path: `${FINAL}/pos-session-active-final.png` });
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
  });
});

test.describe("§2 Uch usulli to'lov", () => {
  test("100 000 = naqd 40 000 + UZCARD 30 000 + HUMO 30 000", async ({ page }) => {
    await openPos(page);
    await ensureShift(page, "0");
    await clearCart(page);

    await addToCart(page, "Nestle suv 0.5L", 25); // 4 000 × 25 = 100 000
    await savePart(page, /naqd/i, "40000");
    await savePart(page, /uzcard/i, "30000");
    await savePart(page, /humo/i, "30000");

    const finalize = page.getByTestId("finalize-sale");
    await expect(finalize).toBeEnabled();
    await page.screenshot({ path: `${FINAL}/pos-payment-final.png` });
    await finalize.click();
    await closeReceipt(page);

    // ── Bazada ham shunday yozilganini tekshiramiz (DOM yetarli emas) ──────
    const sale = lastPosSaleFromDb();
    expect(sale.total).toBe("100000.00");
    expect(sale.paid).toBe("100000.00");
    expect(sale.status).toBe("completed");
    // §12: POS cheki — manba pos, berish usuli counter, hech qachon yetkazib berilgan emas
    expect(sale.source).toBe("pos");
    expect(sale.fulfillmentMethod).toBe("counter");
    expect(sale.deliveryTasks).toBe(0);

    const cash = sale.payments.find((p) => p.method === "cash");
    const uzcard = sale.payments.find((p) => p.network === "uzcard");
    const humo = sale.payments.find((p) => p.network === "humo");
    expect(cash?.amount).toBe("40000.00");
    expect(cash?.account).toBe("Asosiy kassa");
    expect(uzcard?.amount).toBe("30000.00");
    expect(uzcard?.account).toBe("Asosiy bank hisobi");
    expect(humo?.amount).toBe("30000.00");
    // HUMO puli UZCARD bankiga tushib qolmasin
    expect(humo?.account).toBe("Hamkorbank hisobi");

    // Uchala qism ham AYNAN shu smenaga bog'langan
    expect(sale.shiftId).toBeTruthy();
    for (const part of sale.payments) expect(part.shiftId).toBe(sale.shiftId);
  });

  test("uch qism ro'yxatda turganda ham 'Yakunlash' ekran ichida qoladi", async ({ page }) => {
    await openPos(page);
    await ensureShift(page, "0");
    await clearCart(page);
    await addToCart(page, "Nestle suv 0.5L", 25);
    await savePart(page, /naqd/i, "40000");
    await savePart(page, /uzcard/i, "30000");
    await savePart(page, /humo/i, "30000");

    // Ilgari sahifa `h-screen` ishlatgani uchun (u ilova sarlavhasi ostida) tugma pastdan kesilardi
    const box = await page.getByTestId("finalize-sale").boundingBox();
    const height = page.viewportSize()!.height;
    expect(box).not.toBeNull();
    expect(box!.y + box!.height, "yakunlash tugmasi ko'rinib tursin").toBeLessThanOrEqual(height);

    await clearCart(page);
  });
});

test.describe("§3 To'lov validatsiyasi", () => {
  test("A) kam to'lov — yakunlash o'chirilgan; B) to'liq — yoqilgan", async ({ page }) => {
    await openPos(page);
    await ensureShift(page, "0");
    await clearCart(page);
    await addToCart(page, "Nestle suv 0.5L", 25);

    // A) faqat 50 000 naqd — qoldiq 50 000, mijoz yo'q → qarzga yozib bo'lmaydi
    await savePart(page, /naqd/i, "50000");
    await expect(page.getByTestId("finalize-sale")).toBeDisabled();

    // B) qolgani UZCARD bilan — qoldiq 0
    await savePart(page, /uzcard/i, "50000");
    await expect(page.getByTestId("finalize-sale")).toBeEnabled();

    await clearCart(page);
  });

  test("C) naqdsiz ortiqcha to'lov — yakunlash o'chirilgan (server ham rad etadi)", async ({ page }) => {
    await openPos(page);
    await ensureShift(page, "0");
    await clearCart(page);
    await addToCart(page, "Nestle suv 0.5L", 25); // 100 000

    // Karta chek summasidan ko'p — summa oynasining o'zi saqlashga ruxsat bermaydi
    await page.locator(`[aria-label="To'lov usuli"] button`).filter({ hasText: /uzcard/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/summasi$/).fill("110000");
    await expect(dialog).toContainText("Ko'pi bilan");
    await expect(dialog.getByRole("button", { name: /^saqlash$/i })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: /yakunlash/i })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await clearCart(page);
  });
});

test.describe("§6 Kategoriya", () => {
  test("kategoriya bo'yicha filtr ishlaydi va savat saqlanadi", async ({ page }) => {
    await openPos(page);
    await ensureShift(page, "0");
    await clearCart(page);

    const bar = page.getByTestId("category-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("Barchasi");

    // Savatga mahsulot qo'shamiz — kategoriya almashtirilganda yo'qolmasligi kerak
    await addToCart(page, "Nestle suv 0.5L", 1);
    await page.getByPlaceholder(/Mahsulot nomi, SKU yoki barkod/).fill("");

    await bar.getByRole("button", { name: "Shirinlik" }).click();
    await expect(page.getByRole("button", { name: /Shokolad — savatga qo'shish/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /Nestle suv 0\.5L — savatga qo'shish/ })).toBeHidden();

    // Savat saqlanib qoldi
    await expect(page.getByText("Savatcha bo'sh")).toBeHidden();

    await bar.getByRole("button", { name: "Barchasi" }).click();
    await expect(page.getByRole("button", { name: /Nestle suv 0\.5L — savatga qo'shish/ })).toBeVisible({ timeout: 15_000 });
    await clearCart(page);
  });
});

test.describe("§5 Landshaft va §4 tor balandlik", () => {
  for (const size of [
    { name: "800x360", width: 800, height: 360 },
    { name: "844x390", width: 844, height: 390 },
    { name: "915x412", width: 915, height: 412 },
  ]) {
    test(`landshaft ${size.name}: gorizontal scroll yo'q, mahsulot va savat ishlaydi`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openPos(page);
      await ensureShift(page, "0");

      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      );
      expect(noOverflow, "gorizontal scroll bo'lmasin").toBe(true);
      await expect(page.getByRole("button", { name: /savatga qo'shish/ }).first()).toBeVisible();
      // Yon holatdagi telefon "desktop" deb hisoblanmasin: mobil savat paneli ishlaydi,
      // ya'ni siqilgan desktop layout emas, mahsulot maydoni to'liq kenglikda
      await expect(page.getByTestId("cart-bar")).toBeVisible();
      if (size.name === "844x390") await page.screenshot({ path: `${FINAL}/pos-landscape-final.png` });
    });
  }

  test("klaviatura ochilganini taqlid qilish (balandlik kichrayadi): qidiruv va savat paneli yo'qolmaydi", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPos(page);
    await ensureShift(page, "0");

    const search = page.getByPlaceholder(/Mahsulot nomi, SKU yoki barkod/);
    await search.click();
    // Android klaviaturasi ekran balandligini ~45% ga kamaytiradi — shuni taqlid qilamiz
    await page.setViewportSize({ width: 390, height: 460 });
    await expect(search).toBeVisible();
    await expect(page.getByTestId("cart-bar")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    expect(overflow).toBe(true);
  });
});

test.describe("§13 Yakuniy skrinshotlar", () => {
  for (const phone of [
    { name: "360", width: 360, height: 800 },
    { name: "390", width: 390, height: 844 },
    { name: "412", width: 412, height: 915 },
  ]) {
    test(`skrinshot: POS ${phone.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: phone.width, height: phone.height });
      await openPos(page);
      await ensureShift(page, "0");
      await page.screenshot({ path: `${FINAL}/pos-${phone.name}-final.png` });
    });
  }

  test("skrinshot: telefonda savat", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPos(page);
    await ensureShift(page, "0");
    await addToCart(page, "Nestle suv 0.5L", 3);
    await openCart(page);
    await page.screenshot({ path: `${FINAL}/pos-cart-final.png` });
    await clearCart(page);
    await page.getByTestId("cart-close").click();
    await expect(page.getByTestId("cart-bar")).toBeVisible();
  });
});

test.describe("§7 Mahsulot kartochkasi", () => {
  test("nomi va narxi kesilmaydi, bitta bosish aynan +1 qo'shadi", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openPos(page);
    await ensureShift(page, "0");
    await clearCart(page);

    // Kartochka ichidagi hech bir element kartochka chegarasidan chiqmaydi
    const clipped = await page.evaluate(() => {
      const bad: string[] = [];
      for (const card of Array.from(document.querySelectorAll("[aria-label$=\"savatga qo'shish\"]"))) {
        const box = card.getBoundingClientRect();
        for (const el of Array.from(card.querySelectorAll("span"))) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1)) bad.push(el.textContent ?? "");
        }
      }
      return bad;
    });
    expect(clipped, "kartochka ichidagi matn chegaradan chiqmasin").toEqual([]);

    // Bitta bosish — aynan bitta dona (4 000 so'm)
    await addToCart(page, "Nestle suv 0.5L", 1);
    const bar = page.getByTestId("cart-bar");
    await expect(bar).toContainText("Savat: 1 ta"); // "ta" = savatdagi nomlar soni
    await expect(bar).toContainText("4,000");
    // Yana bitta bosish: dublikat qator emas, o'sha qatorda 2 dona bo'ladi
    await addToCart(page, "Nestle suv 0.5L", 1);
    await expect(bar).toContainText("Savat: 1 ta");
    await expect(bar).toContainText("8,000");

    await bar.click();
    const cart = page.getByTestId("pos-cart-panel");
    await expect(cart).toBeVisible();
    // Bitta mahsulot — bitta qator, miqdori 2
    await expect(cart.getByRole("button", { name: /olib tashlash/i })).toHaveCount(1);
    await clearCart(page);
    await page.getByTestId("cart-close").click();
  });
});

test.describe("§8 Telefondagi savat", () => {
  test("miqdorni oshirish/kamaytirish, o'chirish va jami yangilanadi", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPos(page);
    await ensureShift(page, "0");
    await clearCart(page);

    await addToCart(page, "Nestle suv 0.5L", 2); // 8 000
    const cart = await openCart(page);

    await expect(cart).toContainText("8,000"); // 2 × 4 000
    await cart.getByRole("button", { name: /ko'paytirish/i }).click();
    await expect(cart).toContainText("12,000"); // 3 × 4 000
    await cart.getByRole("button", { name: /kamaytirish/i }).click();
    await expect(cart).toContainText("8,000");

    await cart.getByRole("button", { name: /olib tashlash/i }).click();
    await expect(page.getByText("Savatcha bo'sh")).toBeVisible();

    await page.getByTestId("cart-close").click();
    await expect(page.getByTestId("cart-bar")).toContainText("Savat: 0 ta");
  });
});

test.describe("§14 Qulaylik (accessibility)", () => {
  test("maydonlarning nomi bor, klaviatura bilan yurish mumkin", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPos(page);
    await ensureShift(page, "0");

    // Mahsulot kartochkasi va savat tugmalarining o'qiladigan nomi bor
    await expect(page.getByRole("button", { name: /Nestle suv 0\.5L — savatga qo'shish/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Savatni ochish" })).toBeVisible();
    await expect(page.locator(`[aria-label="To'lov usuli"]`)).toHaveCount(1);

    // Savatdagi ikonali tugmalar ham nomlangan (skrin-rider uchun)
    await addToCart(page, "Nestle suv 0.5L", 1);
    const cart = await openCart(page);
    await expect(cart.getByRole("button", { name: /Nestle suv 0\.5L — ko'paytirish/ })).toBeVisible();
    await expect(cart.getByRole("button", { name: /Nestle suv 0\.5L — kamaytirish/ })).toBeVisible();
    await expect(cart.getByRole("button", { name: /Nestle suv 0\.5L — olib tashlash/ })).toBeVisible();
    await clearCart(page);
    await page.getByTestId("cart-close").click();

    // Qidiruv maydoniga klaviatura bilan fokus tushadi va yozish mumkin
    const search = page.getByPlaceholder(/Mahsulot nomi, SKU yoki barkod/);
    await search.fill("");
    await search.focus();
    await expect(search).toBeFocused();
    await page.keyboard.type("Nestle");
    await expect(search).toHaveValue("Nestle");
    await search.fill("");

    // Smena yopish oynasidagi maydon yorliq (label) bilan bog'langan
    await page.getByRole("button", { name: "Smena yopish" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Kassadagi naqd pul (so'm)")).toBeVisible();
    // Oyna Escape bilan yopiladi (fokus qulflanmaydi)
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

test.describe("§9 Smenani yopish va §10 yopilgandan keyin", () => {
  test("yopishda solishtirish ko'rsatiladi, yopilgandan keyin kassada sotib bo'lmaydi", async ({ page }) => {
    await openPos(page);
    await ensureShift(page, "0");

    await page.getByRole("button", { name: "Smena yopish" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Naqd solishtirish va terminal kesimi — karta naqdga qo'shilmaydi
    await expect(dialog.getByTestId("cash-reconciliation")).toBeVisible();
    const expected = (await dialog.getByTestId("expected-cash").innerText()).replace(/\D/g, "");
    await dialog.getByTestId("actual-cash").fill(expected || "0");
    await page.screenshot({ path: `${FINAL}/pos-session-close-final.png` });
    await dialog.getByTestId("close-session-confirm").click();
    await dialog.getByRole("button", { name: "Yopish" }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    // Smena yopiq: kassa ish maydoni yo'q, faqat "Smena ochish"
    await expect(page.getByText("Smena ochilmagan")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Smena ochish" }).first()).toBeVisible();
    await expect(page.getByPlaceholder(/Mahsulot nomi, SKU yoki barkod/)).toBeHidden();
  });
});

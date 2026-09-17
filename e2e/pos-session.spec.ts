/**
 * §H — kassa sessiyasi real brauzerda: ochish → sotuv → yopish (solishtirish) → yopilgandan keyin rad.
 * Skrinshotlar: session-open.png, session-close.png
 */
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

/** Ochiq smena bo'lsa — kutilayotgan summani kiritib yopadi (test toza holatdan boshlansin). */
async function closeOpenSession(page: Page) {
  // Avval sahifa smena holatini ko'rsatishini kutamiz (aks holda tugma hali yo'q bo'ladi)
  await expect(page.getByRole("button", { name: /Smena (ochish|yopish)/ }).first()).toBeVisible({ timeout: 30_000 });
  const closeButton = page.getByRole("button", { name: "Smena yopish" });
  if (!(await closeButton.isVisible().catch(() => false))) return;
  await closeButton.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const expected = (await dialog.getByTestId("expected-cash").innerText()).replace(/\D/g, "");
  await dialog.getByTestId("actual-cash").fill(expected || "0");
  await dialog.getByTestId("close-session-confirm").click();
  await dialog.getByRole("button", { name: "Yopish" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

test("sessiya: ochish → naqd+UZCARD sotuv → yopishda solishtirish → yopilgandan keyin sotib bo'lmaydi", async ({ page }) => {
  await login(page, "kassir");
  await page.goto(appPath("pos"));
  await closeOpenSession(page);

  // ── Ochish: faqat boshlang'ich naqd so'raladi ───────────────────────────
  await page.getByRole("button", { name: "Smena ochish" }).first().click();
  const openDialog = page.getByRole("dialog");
  await expect(openDialog).toBeVisible();
  await openDialog.getByTestId("opening-cash").fill("500000");
  // Karta uchun "boshlang'ich qoldiq" so'ralmaydi
  await expect(openDialog).not.toContainText("UZCARD boshlang'ich");
  await expect(openDialog).not.toContainText("HUMO boshlang'ich");
  await page.screenshot({ path: "e2e/.screenshots/session-open.png" });
  await openDialog.getByTestId("open-session-confirm").click();
  await expect(openDialog).toBeHidden({ timeout: 20_000 });

  const search = page.getByPlaceholder(/Mahsulot nomi, SKU yoki barkod/);
  await expect(search).toBeVisible({ timeout: 20_000 });

  // ── 100 000 so'mlik sotuv: naqd 50 000 + UZCARD 50 000 ──────────────────
  await search.fill("Nestle suv 0.5L");
  const card = page.getByRole("button", { name: /Nestle suv 0\.5L — savatga qo'shish/ });
  await expect(card).toBeVisible({ timeout: 15_000 });
  for (let i = 0; i < 25; i += 1) await card.click();

  const pay = async (method: RegExp, amount: string, finish: boolean) => {
    await page.locator(`[aria-label="To'lov usuli"] button`).filter({ hasText: method }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/summasi$/).fill(amount);
    await dialog.getByRole("button", { name: finish ? /yakunlash/i : /^saqlash$/i }).click();
  };
  await pay(/naqd/i, "50000", false);
  await pay(/uzcard/i, "50000", true);

  // Chek oynasi ochiladi — "Yangi" bilan yopamiz (aks holda u keyingi bosishlarni to'sadi)
  const newReceipt = page.getByRole("button", { name: "Yangi" });
  await expect(newReceipt).toBeVisible({ timeout: 20_000 });
  await newReceipt.click();
  await expect(page.getByText("Savatcha bo'sh")).toBeVisible({ timeout: 20_000 });

  // ── Yopish: naqd qatorma-qator, karta alohida ───────────────────────────
  await page.getByRole("button", { name: "Smena yopish" }).click();
  const closeDialog = page.getByRole("dialog");
  await expect(closeDialog).toBeVisible();

  // Kutilayotgan naqd = 500 000 + 50 000 (KARTA QO'SHILMAYDI)
  const expectedText = await closeDialog.getByTestId("expected-cash").innerText();
  expect(expectedText.replace(/\D/g, "")).toBe("550000");

  // Terminal kesimi: UZCARD 50 000, 1 ta tranzaksiya
  const terminals = closeDialog.getByTestId("terminal-reconciliation");
  await expect(terminals).toBeVisible();
  await expect(terminals).toContainText("UZCARD terminal #01");
  // Pul AYNAN terminalga bog'langan bank hisobiga tushgani ko'rinadi
  await expect(terminals).toContainText("Asosiy bank hisobi");
  await expect(terminals).toContainText("1 ta tranzaksiya");

  await closeDialog.getByTestId("actual-cash").fill("550000");
  await page.screenshot({ path: "e2e/.screenshots/session-close.png" });
  await closeDialog.getByTestId("close-session-confirm").click();
  await expect(closeDialog).toContainText("Kassa mos keldi", { timeout: 20_000 });
  await closeDialog.getByRole("button", { name: "Yopish" }).click();

  // ── Yopilgandan keyin kassa yopiq ───────────────────────────────────────
  await expect(page.getByText("Smena ochilmagan")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Smena ochish" }).first()).toBeVisible();
});

/**
 * KO'P KASSA + TO'LOV USULLARI — HAQIQIY BRAUZERDA (2026-09-27):
 *   Rahbar alohida omborda 2 POS kassa va 2 to'lov usuli (Naqd, karta — faqat 2-kassada) sozlaydi → POS: ombor tanlash →
 *   "Smena ochish" oynasida kassa kartalari → 2-kassa → sarlavhada kassa nomi → to'lov tugmalari usullardan → aralash
 *   to'lov (naqd + karta) → chek → BAZADA: naqd aynan 2-kassa balansida, to'lov qatorlarida usul ID'si → Kassalar paneli.
 *   Oxirida: smena yopiladi, usullar faolsizlantiriladi (umumiy E2E kompaniyasi boshqa testlar uchun avvalgidek qoladi).
 */
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";
import { closeReceipt } from "./_lib/pos.ts";

test.describe.configure({ timeout: 300_000 });

async function api<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    { method, path, body },
  ) as Promise<{ status: number; json: T }>;
}

test("rahbar: 2 kassa → kassa tanlab smena → usul tugmalari → aralash to'lov → naqd shu kassada, usul ID'si bazada → panel", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("dashboard"));
  const stamp = String(Date.now()).slice(-6);
  const methodIds: string[] = [];
  let shiftId: string | null = null;
  try {
    const wh = await api<{ warehouse: { id: string } }>(page, "POST", "/api/inventory/warehouses", { name: `E2E Kassa ombori ${stamp}` });
    expect(wh.status, JSON.stringify(wh.json)).toBe(201);
    const warehouseId = wh.json.warehouse.id;
    const mk = async (name: string, code: string) => {
      const res = await api<{ cashAccount: { id: string } }>(page, "POST", "/api/finance/cash-accounts", { name, type: "cash", code, warehouseId });
      expect(res.status, JSON.stringify(res.json)).toBe(201);
      return res.json.cashAccount.id;
    };
    const kA = await mk(`Kassa A ${stamp}`, `A${stamp}`);
    const kB = await mk(`Kassa B ${stamp}`, `B${stamp}`);
    const bank = (await api<{ cashAccounts: { id: string; type: string; isActive: boolean }[] }>(page, "GET", "/api/finance/cash-accounts")).json.cashAccounts.find((a) => a.type === "bank" && a.isActive)!.id;
    const naqd = await api<{ paymentMethod: { id: string } }>(page, "POST", "/api/finance/payment-methods", { name: `Naqd ${stamp}`, kind: "cash", sortOrder: 0 });
    expect(naqd.status, JSON.stringify(naqd.json)).toBe(201);
    methodIds.push(naqd.json.paymentMethod.id);
    const card = await api<{ paymentMethod: { id: string } }>(page, "POST", "/api/finance/payment-methods", { name: `Payme ${stamp}`, kind: "bank", cashAccountId: bank, kassaIds: [kB], sortOrder: 1 });
    expect(card.status, JSON.stringify(card.json)).toBe(201);
    methodIds.push(card.json.paymentMethod.id);

    const units = (await api<{ units: { id: string; shortName: string }[] }>(page, "GET", "/api/catalog/units")).json.units;
    const piece = units.find((unit) => unit.shortName === "d")!.id;
    const product = await api<{ product: { id: string } }>(page, "POST", "/api/catalog/products", { name: `Kassa tovari ${stamp}`, sku: `KT-${stamp}`, baseUnitId: piece, salesPrice: "10000", taxRate: "0" });
    expect(product.status).toBe(201);
    expect((await api(page, "POST", "/api/inventory/stock/movements", { type: "receive", productId: product.json.product.id, warehouseId, quantity: "20", costPrice: "6000" })).status).toBe(201);

    // POS: agar rahbarda ochiq smena bo'lsa (boshqa test) — kassa ombori tanlanmaydi, shuning uchun avval yopiladi
    await page.goto(appPath("pos"));
    await expect(page.getByRole("button", { name: /Smena (ochish|yopish)/ }).first()).toBeVisible({ timeout: 30_000 });
    const whTrigger = page.getByRole("combobox").filter({ hasText: /./ }).first();
    await expect(whTrigger, "smenasiz ekranda ombor tanlash").toBeVisible({ timeout: 15_000 });
    await whTrigger.click();
    await page.getByRole("option", { name: `E2E Kassa ombori ${stamp}` }).click();
    await page.getByRole("button", { name: "Smena ochish" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("kassa-picker")).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByTestId("open-session-confirm"), "2 bo'sh kassa — tanlamasdan ochib bo'lmaydi").toBeDisabled();
    await dialog.getByTestId(`kassa-B${stamp}`).click();
    await page.screenshot({ path: "e2e/.screenshots/multi-kassa-picker.png" });
    await dialog.getByTestId("open-session-confirm").click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(page.getByTestId("pos-kassa-name")).toContainText(`B${stamp}`, { timeout: 20_000 });

    // Savat: 3 × 10 000
    await page.getByPlaceholder(/Mahsulot nomi, SKU yoki barkod/).fill(`Kassa tovari ${stamp}`);
    const cardBtn = page.getByRole("button", { name: new RegExp(`Kassa tovari ${stamp} — savatga qo'shish`) });
    await expect(cardBtn).toBeVisible({ timeout: 15_000 });
    for (let i = 0; i < 3; i += 1) await cardBtn.click();
    await expect(cardBtn).toHaveAttribute("data-in-cart", "3", { timeout: 15_000 });

    // To'lov tugmalari — faqat sozlangan usullar (Karta/Bank emas)
    const payPanel = page.locator(`[aria-label="To'lov usuli"]`);
    await expect(payPanel.getByRole("button", { name: new RegExp(`Naqd ${stamp}`) })).toBeVisible();
    await expect(payPanel.getByRole("button", { name: new RegExp(`Payme ${stamp}`) })).toBeVisible();
    const pay = async (label: string, amount: string) => {
      await payPanel.getByRole("button", { name: new RegExp(label) }).first().click();
      const d = page.getByRole("dialog");
      await expect(d).toBeVisible();
      await d.getByLabel(/summasi$/).fill(amount);
      await d.getByRole("button", { name: /^saqlash$/i }).click();
      await expect(d).toBeHidden({ timeout: 10_000 });
    };
    await pay(`Payme ${stamp}`, "12000");
    await pay(`Naqd ${stamp}`, "18000");
    await page.screenshot({ path: "e2e/.screenshots/multi-kassa-methods.png" });
    await page.getByTestId("finalize-sale").click();
    await expect(page.getByRole("button", { name: "Yangi" })).toBeVisible({ timeout: 20_000 });
    await closeReceipt(page);

    // Bazada: naqd — Kassa B, Kassa A tegilmagan; to'lovlarda usul ID'si
    const accounts = (await api<{ cashAccounts: { id: string; balance: string }[] }>(page, "GET", "/api/finance/cash-accounts")).json.cashAccounts;
    expect(Number(accounts.find((a) => a.id === kB)!.balance), "naqd Kassa B da").toBe(18000);
    expect(Number(accounts.find((a) => a.id === kA)!.balance), "Kassa A tegilmagan").toBe(0);
    const open = (await api<{ shift: { id: string; cashAccountId: string; expectedCash: string; kassaName: string } }>(page, "GET", `/api/sales/pos/shifts/open?warehouseId=${warehouseId}`)).json.shift;
    shiftId = open.id;
    expect(open.cashAccountId).toBe(kB);
    expect(Number(open.expectedCash), "kutilgan = kassa balansi").toBe(18000);
    const payments = (await api<{ payments: { paymentMethodId?: string | null; method: string; amount: string; posShiftId?: string | null }[] }>(page, "GET", `/api/sales/payments?limit=20`)).json;
    const rows = (payments?.payments ?? []).filter((p) => p.posShiftId === shiftId);
    if (rows.length > 0) {
      expect(rows.map((p) => p.paymentMethodId).sort()).toEqual([...methodIds].sort());
    }

    // Kassalar paneli (rahbar)
    await page.goto(appPath("cash"));
    const board = page.getByTestId("pos-kassa-board");
    await expect(board).toBeVisible({ timeout: 20_000 });
    await expect(board.getByTestId(`board-kassa-B${stamp}`)).toContainText("Ochiq");
    await expect(board.getByTestId(`board-kassa-A${stamp}`)).toContainText("Yopiq");
    await page.screenshot({ path: "e2e/.screenshots/multi-kassa-board.png" });
  } finally {
    if (shiftId) await api(page, "POST", `/api/sales/pos/shifts/${shiftId}/close`, { closingCash: "18000" });
    for (const id of methodIds) await api(page, "PATCH", `/api/finance/payment-methods/${id}`, { isActive: false });
  }
});

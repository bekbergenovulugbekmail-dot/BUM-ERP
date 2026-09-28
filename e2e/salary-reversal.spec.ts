/**
 * TO'LANGAN MAOSHNI BEKOR QILISH — HAQIQIY BRAUZERDA (2026-09-28): xodim → maosh hisoblash → tasdiq → to'lov (API) →
 * HR → Maosh: "Bekor qilish" → sabab → tasdiq. Brauzerda tekshiriladi: holat `reversed`, sabab saqlangan, pul kassaga
 * qaytgan, kompensatsion jurnal yozuvi (debet = kredit, summa asl to'lovga teng), audit yozuvi, maosh ro'yxati/jamisi,
 * qayta bekor qilish yo'q (tugma yo'qoladi, API 409), sahifa yangilangandan keyin ham holat o'sha.
 * Hisoblash (accrual) modeli O'ZGARMAGAN — naqd asos: xarajat to'lov kuni tan olinadi.
 */
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

// Kam xotirali mashinada vite dev sahifa modullarini birinchi ochilishda uzoq tayyorlaydi (sovuq start)
test.describe.configure({ timeout: 420_000 });

/**
 * Ilova sessiyasi bilan so'rov (brauzer ichidan). Lokal `vite` proksisi band mashinada ba'zida ulanishni uzadi —
 * TARMOQ xatosi bir marta qayta urinadi; javob kelgan bo'lsa (status qanday bo'lsa ham) qaytariladi.
 */
async function api<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const once = () =>
    page.evaluate(
      async ({ method, path, body }) => {
        const res = await fetch(path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
        return { status: res.status, json: await res.json().catch(() => null) };
      },
      { method, path, body },
    ) as Promise<{ status: number; json: T }>;
  try {
    return await once();
  } catch (error) {
    if (!String(error).includes("Failed to fetch")) throw error;
    await page.waitForTimeout(1_000);
    return once();
  }
}

type JournalEntry = { id: string; referenceType: string | null; referenceId: string | null; status: string; totalDebit: string; totalCredit: string };
type JournalLine = { accountCode: string; debit: string; credit: string };

const monthNow = () => {
  const at = new Date();
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
};

/** Maosh fondi bor asosiy kassa; xodim → oylik → tasdiq (to'lov chaqiruvchida). Hammasi ilova API'si orqali, brauzer sessiyasida. */
async function approvedSalary(page: Page, stamp: string) {
  const month = monthNow();
  const cashAccounts = (await api<{ cashAccounts: { id: string; isDefault: boolean; type: string; balance: string }[] }>(page, "GET", "/api/finance/cash-accounts")).json.cashAccounts;
  const mainCash = cashAccounts.find((row) => row.isDefault && row.type === "cash")!;
  const accounts = (await api<{ accounts: { id: string; code: string }[] }>(page, "GET", "/api/finance/accounts")).json.accounts;
  const capital = accounts.find((row) => row.code === "3000")!.id;
  expect((await api(page, "POST", "/api/finance/cash-transactions", { cashAccountId: mainCash.id, type: "in", amount: "3000000", description: `E2E maosh fondi ${stamp}`, counterAccountId: capital })).status).toBe(201);

  const employee = await api<{ employee: { id: string } }>(page, "POST", "/api/hr/employees", { name: `Maosh E2E ${stamp}`, hireDate: "2020-01-01", baseSalary: "1000000", salaryType: "monthly" });
  expect(employee.status, JSON.stringify(employee.json)).toBe(201);
  const employeeId = employee.json.employee.id;
  expect((await api(page, "POST", "/api/hr/salaries/generate", { month })).status).toBeLessThan(300);
  const salary = (await api<{ salaries: { id: string; netSalary: string; tax: string }[] }>(page, "GET", `/api/hr/salaries?month=${month}&employeeId=${employeeId}`)).json.salaries[0]!;
  expect((await api(page, "POST", `/api/hr/salaries/${salary.id}/approve`)).status).toBe(200);
  return { month, employeeId, salary, mainCash };
}

const cashBalance = async (page: Page, cashAccountId: string) =>
  Number((await api<{ cashAccounts: { id: string; balance: string }[] }>(page, "GET", "/api/finance/cash-accounts")).json.cashAccounts.find((row) => row.id === cashAccountId)!.balance);

test("to'langan maosh sabab bilan bekor qilinadi: pul kassaga qaytadi, jurnal teskari yoziladi, audit va holat saqlanadi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("hr"), { waitUntil: "domcontentloaded" });
  const stamp = String(Date.now()).slice(-7);
  const { month, employeeId, salary, mainCash } = await approvedSalary(page, stamp);

  const balance = () => cashBalance(page, mainCash.id);
  const journal = async (referenceType: string) =>
    (await api<{ entries: JournalEntry[] }>(page, "GET", `/api/finance/journal?referenceType=${encodeURIComponent(referenceType)}&limit=200`)).json.entries.filter((entry) => entry.referenceId === salary.id);
  const lines = async (entryId: string) => (await api<{ entry: { lines: JournalLine[] } }>(page, "GET", `/api/finance/journal/${entryId}`)).json.entry.lines;
  const sum = (rows: JournalLine[], side: "debit" | "credit") => rows.reduce((total, row) => total + Number(row[side]), 0);

  // ── TO'LOVDAN OLDIN / KEYIN: naqd asos — kassa kamayadi, xarajat to'lov kuni yoziladi ──
  const beforePay = await balance();
  const paid = await api(page, "POST", `/api/hr/salaries/${salary.id}/pay`, { method: "cash", cashAccountId: mainCash.id });
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  const afterPay = await balance();
  expect(afterPay, "to'lovda kassa sof maosh miqdorida kamayadi").toBe(beforePay - Number(salary.netSalary));
  const [payEntry] = await journal("salary_payment");
  expect(payEntry, "to'lov jurnal yozuvi").toBeTruthy();
  expect(payEntry!.status).toBe("posted");
  const payLines = await lines(payEntry!.id);
  expect(sum(payLines, "debit"), "to'lov: debet = kredit").toBe(sum(payLines, "credit"));
  expect(Number(payLines.find((row) => row.accountCode === "1010")!.credit), "kassa kreditlanadi").toBe(Number(salary.netSalary));

  // ── BRAUZERDA BEKOR QILISH: tugma → sabab → tasdiq ──
  await page.reload();
  await page.getByRole("tab", { name: "Maosh" }).click();
  await page.getByTestId(`salary-reverse-${salary.id}`).click();
  await page.getByLabel(/Sabab/).fill("E2E: noto'g'ri summa");
  await page.screenshot({ path: "e2e/.screenshots/salary-reversal.png" });
  await page.getByTestId("salary-reverse-confirm").click();
  await expect(page.getByText("Maosh bekor qilindi").first()).toBeVisible({ timeout: 20_000 });

  // ── HOLAT, SABAB, KASSA ──
  const rowOf = async () =>
    (await api<{ salaries: { id: string; status: string; reversalReason: string | null; reversedAt: string | null }[] }>(page, "GET", `/api/hr/salaries?month=${month}&employeeId=${employeeId}`)).json.salaries.find((item) => item.id === salary.id)!;
  expect(await rowOf()).toMatchObject({ status: "reversed", reversalReason: "E2E: noto'g'ri summa" });
  expect((await rowOf()).reversedAt, "qachon bekor qilingani saqlanadi").toBeTruthy();
  const afterReversal = await balance();
  expect(afterReversal, "pul kassaga qaytdi").toBe(afterPay + Number(salary.netSalary));
  expect(afterReversal, "kassa to'lovdan oldingi holatga qaytdi").toBe(beforePay);
  await expect(page.getByText("Bekor qilingan").first()).toBeVisible();

  // ── KOMPENSATSION JURNAL: asl yozuv joyida, teskari yozuv debet = kredit, summa asl to'lovga teng ──
  expect((await journal("salary_payment"))[0], "asl yozuv o'chirilmaydi").toMatchObject({ id: payEntry!.id, status: "posted" });
  const reversalEntries = await journal("salary_reversal:salary_payment");
  expect(reversalEntries, "bitta kompensatsion yozuv").toHaveLength(1);
  const reversalLines = await lines(reversalEntries[0]!.id);
  expect(sum(reversalLines, "debit"), "teskari yozuv: debet = kredit").toBe(sum(reversalLines, "credit"));
  expect(sum(reversalLines, "debit"), "teskari summa = asl to'lov summasi").toBe(sum(payLines, "debit"));
  expect(Number(reversalLines.find((row) => row.accountCode === "1010")!.debit), "kassa debetlanadi (pul qaytdi)").toBe(Number(salary.netSalary));

  // ── AUDIT ──
  const logs = (await api<{ logs: { action: string; resourceId: string | null; userId: string | null; details: unknown }[] }>(page, "GET", "/api/company/audit-logs?resource=salary_payments&limit=200")).json.logs;
  const reversalLog = logs.find((log) => log.action === "SALARY_REVERSED" && log.resourceId === salary.id);
  expect(reversalLog, "auditda SALARY_REVERSED").toBeTruthy();
  expect(reversalLog!.userId).toBeTruthy();
  expect(reversalLog!.details).toMatchObject({ reason: "E2E: noto'g'ri summa", netSalary: salary.netSalary, originalReference: { type: "salary_payment", id: salary.id } });

  // ── MAOSH TARIXI / JAMI: bekor qilingan alohida sanaladi ──
  const summary = (await api<{ summary?: Record<string, unknown> } & Record<string, unknown>>(page, "GET", `/api/hr/salaries/summary?month=${month}`)).json;
  const totals = (summary.summary ?? summary) as { reversed: number };
  expect(Number(totals.reversed), "jamida bekor qilinganlar soni").toBeGreaterThanOrEqual(1);

  // ── QAYTA BEKOR QILISH YO'Q: tugma yo'q, API 409, pul ikkinchi marta qaytmaydi ──
  await expect(page.getByTestId(`salary-reverse-${salary.id}`)).toHaveCount(0);
  expect((await api(page, "POST", `/api/hr/salaries/${salary.id}/reverse`, { reason: "Yana bir marta" })).status).toBe(409);
  expect(await balance(), "ikkinchi urinishda pul qaytmaydi").toBe(afterReversal);

  // ── SAHIFA YANGILANGANDAN KEYIN: holat o'sha, tugma yo'q ──
  await page.reload();
  await page.getByRole("tab", { name: "Maosh" }).click();
  await expect(page.getByText("Bekor qilingan").first()).toBeVisible();
  await expect(page.getByTestId(`salary-reverse-${salary.id}`)).toHaveCount(0);
  expect(await rowOf()).toMatchObject({ status: "reversed" });
});

test("ruxsatsiz foydalanuvchi maoshni bekor qilmaydi: HR bo'limi yopiq, API 403, holat o'zgarmaydi", async ({ page, browser }) => {
  await login(page, "owner");
  await page.goto(appPath("hr"), { waitUntil: "domcontentloaded" });
  const stamp = String(Date.now()).slice(-7);
  const { month, employeeId, salary, mainCash } = await approvedSalary(page, stamp);
  expect((await api(page, "POST", `/api/hr/salaries/${salary.id}/pay`, { method: "cash", cashAccountId: mainCash.id })).status).toBe(200);
  const cashAfterPay = await cashBalance(page, mainCash.id);

  // Kassirda `hr.*` ruxsatlari yo'q — bo'lim ham, amal ham yopiq. Alohida brauzer konteksti:
  // egasining sessiyasi ochiq qoladi, keyin holat o'sha sessiyada tekshiriladi.
  const kassirContext = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173" });
  const kassirPage = await kassirContext.newPage();
  try {
    await login(kassirPage, "kassir");
    await kassirPage.goto(appPath("hr"), { waitUntil: "domcontentloaded" });
    // Marshrut darajasidagi qo'riqchi HR sahifasining o'z xabaridan oldin ishlaydi
    await expect(kassirPage.getByRole("heading", { name: "Bu bo'limga kirish ruxsati yo'q" })).toBeVisible({ timeout: 30_000 });
    await expect(kassirPage.getByTestId(`salary-reverse-${salary.id}`)).toHaveCount(0);
    expect((await api(kassirPage, "POST", `/api/hr/salaries/${salary.id}/reverse`, { reason: "Ruxsatsiz urinish" })).status).toBe(403);
  } finally {
    await kassirContext.close();
  }

  // Egasida holat va kassa o'zgarmagan
  const row = (await api<{ salaries: { id: string; status: string }[] }>(page, "GET", `/api/hr/salaries?month=${month}&employeeId=${employeeId}`)).json.salaries.find((item) => item.id === salary.id)!;
  expect(row.status, "ruxsatsiz urinish holatni o'zgartirmadi").toBe("paid");
  expect(await cashBalance(page, mainCash.id), "kassa o'zgarmadi").toBe(cashAfterPay);
});

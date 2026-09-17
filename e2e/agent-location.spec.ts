/**
 * Savdo agenti "ISHNI BOSHLASH" bosganidan keyin uning joyi supervayzer xaritasiga
 * qancha vaqtda tushishini HAQIQIY Chrome'da o'lchaydi.
 * Ikki alohida brauzer konteksti: agent (GPS ruxsati bilan) va supervayzer.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { ACCOUNTS, PASSWORD, appPath } from "./_lib/accounts.ts";

// Toshkent markazi — demo mijozlar shu atrofda
const POINT = { latitude: 41.311081, longitude: 69.240562, accuracy: 12 };

async function signIn(page: Page, phone: string) {
  await page.goto("/login");
  await expect(page.locator("#phone")).toBeVisible({ timeout: 30_000 });
  await page.locator("#phone").fill(phone);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: /kirish/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

test("agent ishni boshlagach joyi supervayzer xaritasiga qancha vaqtda tushadi", async ({ browser }) => {
  test.setTimeout(240_000);

  // ── Supervayzer: Monitoring bo'limini ochib turadi ──────────────────────
  const bossCtx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const boss = await bossCtx.newPage();
  await signIn(boss, ACCOUNTS.owner.phone);

  // Supervayzer brauzeriga kelayotgan jonli lokatsiyalar. MUHIM: xaritada oldingi sessiyadan
  // qolgan nuqta turishi mumkin — shuning uchun faqat "ishni boshlash"dan KEYIN yozilgan
  // (`receivedAt > t0`) nuqta hisobga olinadi.
  let liveAt: number | null = null;
  let livePolls = 0;
  let startedAt = 0;
  boss.on("response", async (res) => {
    if (!res.url().includes("/api/sales-agent/supervisor/live")) return;
    livePolls += 1;
    if (liveAt !== null || startedAt === 0) return;
    const body = (await res.json().catch(() => null)) as { locations?: { receivedAt: string }[] } | null;
    const fresh = body?.locations?.some((row) => new Date(row.receivedAt).getTime() > startedAt);
    if (fresh) liveAt = Date.now();
  });
  await boss.goto(appPath("distribution"), { waitUntil: "domcontentloaded" });
  await boss.getByRole("button", { name: "Monitoring" }).click();
  await expect(boss.getByRole("button", { name: "Monitoring" })).toBeVisible();
  await boss.waitForTimeout(3000); // birinchi so'rovlar ketsin

  // ── Agent: GPS ruxsati bilan kiradi va ishni boshlaydi ──────────────────
  const agentCtx: BrowserContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["geolocation"],
    geolocation: POINT,
  });
  const agent = await agentCtx.newPage();

  let startRespAt: number | null = null;
  let firstLocAt: number | null = null;
  let locPosts = 0;
  agent.on("response", async (res) => {
    const url = res.url();
    if (url.endsWith("/api/sales-agent/work-session/start")) startRespAt ??= Date.now();
    if (url.endsWith("/api/sales-agent/location") && res.request().method() === "POST") {
      if (startedAt === 0) return; // bosishdan oldingi yuborishlar hisobga olinmaydi
      locPosts += 1;
      const body = await res.json().catch(() => null);
      if (body?.accepted && firstLocAt === null) firstLocAt = Date.now();
    }
  });

  await signIn(agent, ACCOUNTS.agent.phone);
  await agent.goto(appPath("sales-agent/dashboard"), { waitUntil: "domcontentloaded" });
  // Avval kartochka chizilishini kutamiz — aks holda "ochiq sessiya bormi" tekshiruvi bo'sh ketadi
  await expect(agent.getByRole("button", { name: /ISHNI (BOSHLASH|YAKUNLASH)/i })).toBeVisible({ timeout: 30_000 });
  const endButton = agent.getByRole("button", { name: /ISHNI YAKUNLASH/i });
  if (await endButton.isVisible().catch(() => false)) {
    await endButton.click();
    await agent.getByRole("button", { name: /Ha, yakunlash/i }).click();
  }
  const startButton = agent.getByRole("button", { name: /ISHNI BOSHLASH/i });
  await expect(startButton).toBeVisible({ timeout: 30_000 });

  const t0 = Date.now();
  startedAt = t0;
  await startButton.click();
  await expect(agent.getByRole("button", { name: /ISHNI YAKUNLASH/i })).toBeVisible({ timeout: 30_000 });

  // ── Supervayzer xaritasida belgi paydo bo'lishini kutamiz ──────────────
  await expect.poll(() => liveAt !== null, { timeout: 150_000, intervals: [500] }).toBe(true);
  const tooltip = boss.locator(".leaflet-tooltip", { hasText: "Demo Sotuv agenti" });
  await expect.poll(async () => tooltip.count(), { timeout: 30_000, intervals: [500] }).toBeGreaterThan(0);
  const markerAt = Date.now();
  // Ro'yxatda ham "Onlayn" deb turadi
  await expect(boss.getByText("Onlayn").first()).toBeVisible();

  const sec = (at: number | null) => (at === null ? null : Math.round(((at - t0) / 1000) * 10) / 10);
  console.log(
    "O'LCHOV " +
      JSON.stringify({
        sessiyaOchildi: sec(startRespAt),
        birinchiLokatsiyaQabul: sec(firstLocAt),
        supervayzergaYetdi: sec(liveAt),
        xaritadaBelgi: sec(markerAt),
        lokatsiyaSorovlari: locPosts,
        liveSorovlari: livePolls,
      }),
  );

  await boss.screenshot({ path: "e2e/.screenshots/agent-monitoring.png" });

  // Agentni ish holatidan chiqaramiz (keyingi testlarga holat qolmasin)
  await agent.getByRole("button", { name: /ISHNI YAKUNLASH/i }).click();
  await agent.getByRole("button", { name: /Ha, yakunlash/i }).click().catch(() => undefined);

  await agentCtx.close();
  await bossCtx.close();
});

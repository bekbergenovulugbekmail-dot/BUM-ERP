/**
 * KPI: bosqichli hisob, lavozim va xodim qoidalarining ustunligi, oylikka qo'shilishi.
 *
 * Bosqich matematikasi alohida (sof funksiya), qolgani HTTP orqali — haqiqiy ruxsat va tranzaksiya bilan.
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { salaryKpiLines, salaryPayments } from "../src/db/schema/hr.js";
import { achievementOf, targetBonus, tierAmount, type Tier } from "../src/modules/hr/kpi.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;

const month = new Date().toISOString().slice(0, 7);

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "KPI kompaniyasi" });
  departmentId = null;
});

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
const hr = (method: Method, url: string, payload?: object, cookie = company.ownerCookie) =>
  app.inject({ method, url: `/api/hr${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

/** Lavozim bo'limsiz yaratilmaydi — har chaqiruvda bitta bo'lim ishlatiladi. */
let departmentId: string | null = null;
async function department(cookie = company.ownerCookie) {
  if (departmentId) return departmentId;
  const res = await hr("POST", "/departments", { name: "Asosiy", code: "MAIN" }, cookie);
  expect(res.statusCode, res.body).toBe(201);
  departmentId = res.json().department.id as string;
  return departmentId;
}

async function position(name: string, cookie = company.ownerCookie) {
  const res = await hr("POST", "/positions", { name, departmentId: await department(cookie) }, cookie);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().position.id as string;
}

async function employee(name: string, baseSalary: string, positionId?: string) {
  const res = await hr("POST", "/employees", {
    name,
    hireDate: "2020-01-01",
    baseSalary,
    salaryType: "monthly",
    ...(positionId ? { positionId } : {}),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().employee.id as string;
}

/** 0–100 → 4 000, 100–200 → 6 000, 200+ → 9 000. */
const THREE_TIERS: Tier[] = [
  { fromValue: "0", toValue: "100", rate: "4000" },
  { fromValue: "100", toValue: "200", rate: "6000" },
  { fromValue: "200", toValue: null, rate: "9000" },
];

describe("Bosqichli hisob (sof funksiya)", () => {
  const value = (n: number) => BigInt(Math.round(n * 10_000));

  it("progressiv: har bosqich faqat o'z qismiga qo'llanadi", () => {
    // 214 ta: 100×4 000 + 100×6 000 + 14×9 000 = 1 126 000
    expect(tierAmount(value(214), THREE_TIERS, "per_unit")).toBe(112_600_000n);
    // 50 ta: butunlay birinchi bosqichda
    expect(tierAmount(value(50), THREE_TIERS, "per_unit")).toBe(20_000_000n);
    // Aynan chegarada: 100 ta
    expect(tierAmount(value(100), THREE_TIERS, "per_unit")).toBe(40_000_000n);
  });

  it("nol va manfiy — nol", () => {
    expect(tierAmount(0n, THREE_TIERS, "per_unit")).toBe(0n);
    expect(tierAmount(value(-5), THREE_TIERS, "per_unit")).toBe(0n);
  });

  it("foizli bosqich: summadan foiz olinadi", () => {
    const tiers: Tier[] = [
      { fromValue: "0", toValue: "10000000", rate: "1" },
      { fromValue: "10000000", toValue: null, rate: "3" },
    ];
    // 15 000 000: 10 000 000 ning 1% = 100 000; qolgan 5 000 000 ning 3% = 150 000
    expect(tierAmount(value(15_000_000), tiers, "percent")).toBe(25_000_000n);
  });

  it("bosqichsiz qoida — nol", () => {
    expect(tierAmount(value(100), [], "per_unit")).toBe(0n);
  });
});

describe("KPI qoidalari", () => {
  it("bosqichlar 0 dan boshlanishi va uzluksiz bo'lishi kerak", async () => {
    const positionId = await position("Dostavchi");

    const gap = await hr("PUT", "/kpi/rules", {
      positionId,
      metric: "delivery_count",
      tiers: [{ fromValue: "10", toValue: null, rate: "5000" }],
    });
    expect(gap.statusCode, gap.body).toBe(400);
    expect(gap.json().message).toContain("0 dan boshlanishi");

    const overlap = await hr("PUT", "/kpi/rules", {
      positionId,
      metric: "delivery_count",
      tiers: [
        { fromValue: "0", toValue: "100", rate: "4000" },
        { fromValue: "50", toValue: null, rate: "6000" },
      ],
    });
    expect(overlap.statusCode, overlap.body).toBe(400);
    expect(overlap.json().message).toContain("bo'shliq yoki kesishuv");
  });

  it("qoida yo lavozimga, yo xodimga biriktiriladi — ikkalasi birga bo'lmaydi", async () => {
    const positionId = await position("Dostavchi");
    const employeeId = await employee("Akmal", "3000000", positionId);

    const both = await hr("PUT", "/kpi/rules", {
      positionId,
      employeeId,
      metric: "delivery_count",
      tiers: [{ fromValue: "0", toValue: null, rate: "5000" }],
    });
    expect(both.statusCode, both.body).toBe(400);

    const neither = await hr("PUT", "/kpi/rules", {
      metric: "delivery_count",
      tiers: [{ fromValue: "0", toValue: null, rate: "5000" }],
    });
    expect(neither.statusCode).toBe(400);
  });

  it("saqlash idempotent: bir maqsad + bir ko'rsatkichga bitta qoida, bosqichlar almashadi", async () => {
    const positionId = await position("Dostavchi");
    const first = await hr("PUT", "/kpi/rules", { positionId, metric: "delivery_count", tiers: THREE_TIERS });
    expect(first.statusCode, first.body).toBe(200);

    const second = await hr("PUT", "/kpi/rules", {
      positionId,
      metric: "delivery_count",
      tiers: [{ fromValue: "0", toValue: null, rate: "7000" }],
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().ruleId).toBe(first.json().ruleId);

    const list = await hr("GET", "/kpi/rules");
    expect(list.statusCode).toBe(200);
    expect(list.json().rules).toHaveLength(1);
    expect(list.json().rules[0].tiers).toHaveLength(1);
    expect(list.json().rules[0].rateType).toBe("per_unit");
  });

  it("pul ko'rsatkichida stavka foiz, dona ko'rsatkichida — birlik uchun summa", async () => {
    const positionId = await position("Savdo agenti");
    await hr("PUT", "/kpi/rules", {
      positionId,
      metric: "agent_sales_amount",
      tiers: [{ fromValue: "0", toValue: null, rate: "2" }],
    });
    await hr("PUT", "/kpi/rules", {
      positionId,
      metric: "agent_visit_count",
      tiers: [{ fromValue: "0", toValue: null, rate: "10000" }],
    });
    const list = await hr("GET", "/kpi/rules");
    const byMetric = new Map(list.json().rules.map((rule: { metric: string; rateType: string }) => [rule.metric, rule.rateType]));
    expect(byMetric.get("agent_sales_amount")).toBe("percent");
    expect(byMetric.get("agent_visit_count")).toBe("per_unit");
  });

  it("boshqa kompaniyaning lavozimiga qoida yozib bo'lmaydi", async () => {
    const admin = await signedIn(app, { isPlatformAdmin: true });
    const stranger = await createCompany(app, admin.cookie, { name: "Begona" });
    const foreignDept = await hr("POST", "/departments", { name: "Asosiy", code: "MAIN" }, stranger.ownerCookie);
    expect(foreignDept.statusCode, foreignDept.body).toBe(201);
    const foreignPosition = await hr(
      "POST",
      "/positions",
      { name: "Dostavchi", departmentId: foreignDept.json().department.id },
      stranger.ownerCookie,
    );
    expect(foreignPosition.statusCode, foreignPosition.body).toBe(201);

    const res = await hr("PUT", "/kpi/rules", {
      positionId: foreignPosition.json().position.id,
      metric: "delivery_count",
      tiers: [{ fromValue: "0", toValue: null, rate: "5000" }],
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().message).toContain("Lavozim topilmadi");
  });

  it("o'chirilgan qoida ro'yxatdan ketadi", async () => {
    const positionId = await position("Dostavchi");
    const created = await hr("PUT", "/kpi/rules", { positionId, metric: "delivery_count", tiers: THREE_TIERS });
    const removed = await hr("DELETE", `/kpi/rules/${created.json().ruleId}`);
    expect(removed.statusCode).toBe(204);
    expect((await hr("GET", "/kpi/rules")).json().rules).toHaveLength(0);
  });
});

describe("KPI oylikka qo'shiladi", () => {
  it("qoida yo'q xodimda mukofot nol va oylik o'zgarmaydi", async () => {
    await employee("Qoidasiz", "3000000");
    const generated = await hr("POST", "/salaries/generate", { month, workDays: "26" });
    expect(generated.statusCode, generated.body).toBe(200);

    const [row] = await db
      .select()
      .from(salaryPayments)
      .where(and(eq(salaryPayments.companyId, company.companyId), eq(salaryPayments.month, month)));
    expect(row!.bonus).toBe("0.00");
    const lines = await db.select().from(salaryKpiLines).where(eq(salaryKpiLines.companyId, company.companyId));
    expect(lines).toHaveLength(0);
  });

  it("yetkazuvchi profili yo'q xodimda dostavka ko'rsatkichi 0 — qoida bor bo'lsa ham mukofot yo'q", async () => {
    const positionId = await position("Dostavchi");
    await employee("Yetkazuvchi emas", "3000000", positionId);
    await hr("PUT", "/kpi/rules", { positionId, metric: "delivery_count", tiers: THREE_TIERS });

    const preview = await hr("GET", `/kpi/preview?month=${month}`);
    expect(preview.statusCode, preview.body).toBe(200);
    // Ko'rsatkich 0 bo'lgani uchun qator ham, summa ham yo'q
    const person = preview.json().employees.find((row: { name: string }) => row.name === "Yetkazuvchi emas");
    expect(person?.total ?? "0.00").toBe("0.00");
  });

  it("xodim qoidasi lavozim qoidasining o'rniga ishlaydi", async () => {
    const positionId = await position("Dostavchi");
    const employeeId = await employee("Akmal", "3000000", positionId);

    await hr("PUT", "/kpi/rules", { positionId, metric: "delivery_count", tiers: THREE_TIERS });
    await hr("PUT", "/kpi/rules", {
      employeeId,
      metric: "delivery_count",
      tiers: [{ fromValue: "0", toValue: null, rate: "12000" }],
    });

    const list = await hr("GET", "/kpi/rules");
    expect(list.json().rules).toHaveLength(2);
    // Ikkalasi ham saqlanadi, lekin hisobda xodimniki ustun — buni preview ko'rsatadi
    const preview = await hr("GET", `/kpi/preview?month=${month}&employeeId=${employeeId}`);
    expect(preview.statusCode, preview.body).toBe(200);
  });

  it("maosh ruxsatisiz hisob-kitobni ko'rib bo'lmaydi", async () => {
    const viewer = await signedIn(app);
    const res = await hr("GET", `/kpi/preview?month=${month}`, undefined, viewer.cookie);
    expect([401, 403]).toContain(res.statusCode);
  });
});

/**
 * PLAN CHEGARASI — "plan bajarilmasa foiz berilmaydi".
 *
 * Bosqichli (progressiv) hisob bilan bu qoidani ifodalab bo'lmaydi: bosqich faqat plandan ORTIQCHA
 * qismga foiz beradi. Shuning uchun qoidaga `minValue` (plan) qo'shildi — u `null` bo'lsa
 * hisob-kitob avvalgidek qoladi, ya'ni mavjud bizneslarning oyligi o'zgarmaydi.
 */
describe("KPI plani (minValue)", () => {
  const PERCENT_TIER = [{ fromValue: "0", toValue: null, rate: "3" }];

  async function ruleWithPlan(positionId: string, minValue: string | null) {
    const res = await hr("PUT", "/kpi/rules", {
      positionId,
      metric: "agent_sales_amount",
      ...(minValue === null ? {} : { minValue }),
      tiers: PERCENT_TIER,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res;
  }

  it("plan saqlanadi va ro'yxatda qaytadi; bo'sh bo'lsa null", async () => {
    const withPlan = await position("Agent plan bilan");
    await ruleWithPlan(withPlan, "50000000");
    const noPlan = await position("Agent plansiz");
    await ruleWithPlan(noPlan, null);

    const rules = (await hr("GET", "/kpi/rules")).json().rules as { positionId: string | null; minValue: string | null }[];
    expect(Number(rules.find((rule) => rule.positionId === withPlan)!.minValue)).toBe(50_000_000);
    expect(rules.find((rule) => rule.positionId === noPlan)!.minValue, "plansiz qoida").toBeNull();
  });

  it("plan manfiy bo'lolmaydi", async () => {
    const positionId = await position("Agent manfiy plan");
    const res = await hr("PUT", "/kpi/rules", {
      positionId,
      metric: "agent_sales_amount",
      minValue: "-1",
      tiers: PERCENT_TIER,
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("planni o'chirib tashlash mumkin (null yuborilsa chegara yo'qoladi)", async () => {
    const positionId = await position("Agent planni oladi");
    await ruleWithPlan(positionId, "10000000");
    const cleared = await hr("PUT", "/kpi/rules", {
      positionId,
      metric: "agent_sales_amount",
      minValue: null,
      tiers: PERCENT_TIER,
    });
    expect(cleared.statusCode, cleared.body).toBe(200);

    const rules = (await hr("GET", "/kpi/rules")).json().rules as { positionId: string | null; minValue: string | null }[];
    expect(rules.find((rule) => rule.positionId === positionId)!.minValue).toBeNull();
  });
});

/**
 * 1-VAZIFA: fiksatsiyalangan oylik ALOHIDA, KPI mukofoti ALOHIDA.
 * Oylik keyin o'zgarsa tugagan oyning hisob-kitobi buzilmasligi kerak — shuning uchun
 * o'zgarish "qaysi oydan amal qiladi" bilan yoziladi va tarixda qoladi.
 */
describe("Fiksatsiyalangan oylik tarixi", () => {
  const prevMonth = (() => {
    const [y, m] = month.split("-").map(Number) as [number, number];
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  })();

  it("o'zgarish tarixga yoziladi: eski, yangi, qaysi oydan, kim va nega", async () => {
    const employeeId = await employee("Oyligi oshadi", "5000000");
    const res = await hr("POST", `/employees/${employeeId}/salary-history`, {
      newSalary: "6000000",
      effectiveMonth: month,
      reason: "Ish hajmi oshdi",
    });
    expect(res.statusCode, res.body).toBe(201);

    const history = (await hr("GET", `/employees/${employeeId}/salary-history`)).json().history as {
      oldSalary: string; newSalary: string; effectiveMonth: string; reason: string | null; changedBy: string | null;
    }[];
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      oldSalary: "5000000.00",
      newSalary: "6000000.00",
      effectiveMonth: month,
      reason: "Ish hajmi oshdi",
    });
    expect(history[0]!.changedBy, "kim o'zgartirgani yozilgan").not.toBeNull();
  });

  it("oylik oshsa ham TUGAGAN oy eski stavka bilan hisoblanadi", async () => {
    const employeeId = await employee("Eski oy", "5000000");
    // Avvalgi oyga 5 000 000, joriy oydan 9 000 000
    expect((await hr("POST", `/employees/${employeeId}/salary-history`, {
      newSalary: "5000000", effectiveMonth: prevMonth,
    })).statusCode).toBe(201);
    expect((await hr("POST", `/employees/${employeeId}/salary-history`, {
      newSalary: "9000000", effectiveMonth: month,
    })).statusCode).toBe(201);

    expect((await hr("POST", "/salaries/generate", { month: prevMonth, workDays: "26" })).statusCode).toBe(200);
    expect((await hr("POST", "/salaries/generate", { month, workDays: "26" })).statusCode).toBe(200);

    const rows = await db
      .select({ month: salaryPayments.month, baseSalary: salaryPayments.baseSalary })
      .from(salaryPayments)
      .where(and(eq(salaryPayments.companyId, company.companyId), eq(salaryPayments.employeeId, employeeId)));
    const byMonth = new Map(rows.map((row) => [row.month, row.baseSalary]));
    expect(byMonth.get(prevMonth), "tugagan oy eski stavkada qoladi").toBe("5000000.00");
    expect(byMonth.get(month), "joriy oy yangi stavkada").toBe("9000000.00");
  });

  it("tarixi yo'q xodim avvalgidek `baseSalary` bilan hisoblanadi", async () => {
    const employeeId = await employee("Tarixsiz", "4000000");
    expect((await hr("POST", "/salaries/generate", { month, workDays: "26" })).statusCode).toBe(200);
    const [row] = await db
      .select({ baseSalary: salaryPayments.baseSalary })
      .from(salaryPayments)
      .where(and(eq(salaryPayments.companyId, company.companyId), eq(salaryPayments.employeeId, employeeId)));
    expect(row!.baseSalary).toBe("4000000.00");
  });

  it("oylik summasi maxfiy: `hr.salary` ruxsatisiz tarix ko'rinmaydi", async () => {
    const employeeId = await employee("Maxfiy", "5000000");
    const warehouse = await addEmployee(app, company, "Ombor menejeri");
    const res = await hr("GET", `/employees/${employeeId}/salary-history`, undefined, warehouse.cookie);
    expect(res.statusCode, res.body).toBe(403);
  });
});

/**
 * 3-VAZIFA: KPI qoidasini admin o'zi tuzadi — maqsad (plan), bonus turi, ulush va shift.
 * `tiered` — eski xatti-harakat, shuning uchun mavjud qoidalar o'zgarmaydi.
 */
describe("Maqsadga asoslangan KPI qoidalari", () => {
  const targetRule = (positionId: string, extra: Record<string, unknown>) =>
    hr("PUT", "/kpi/rules", {
      positionId,
      metric: "delivery_count",
      bonusType: "achievement",
      target: "100",
      bonusAmount: "1000000",
      ...extra,
    });

  it("maqsadli qoidada bosqich shart emas, lekin maqsad majburiy", async () => {
    const positionId = await position("Dostavchi maqsad");
    const ok = await targetRule(positionId, {});
    expect(ok.statusCode, ok.body).toBe(200);

    const noTarget = await hr("PUT", "/kpi/rules", {
      positionId,
      metric: "delivery_amount",
      bonusType: "fixed",
      bonusAmount: "500000",
    });
    expect(noTarget.statusCode, "maqsadsiz qoida rad etiladi").toBe(400);
  });

  it("bosqichli qoidada bosqich hamon majburiy (eski xatti-harakat saqlanadi)", async () => {
    const positionId = await position("Dostavchi bosqich");
    const res = await hr("PUT", "/kpi/rules", { positionId, metric: "delivery_count", tiers: [] });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("ulush 100 dan oshmasin, shift manfiy bo'lmasin", async () => {
    const positionId = await position("Dostavchi chegara");
    expect((await targetRule(positionId, { weight: "150" })).statusCode).toBe(400);
    expect((await targetRule(positionId, { maxAchievement: "-5" })).statusCode).toBe(400);
  });

  it("qoida maydonlari saqlanadi va qaytadi", async () => {
    const positionId = await position("Dostavchi saqlansin");
    expect((await targetRule(positionId, {
      name: "Yetkazmalar soni",
      description: "Oyiga 100 ta",
      weight: "30",
      maxAchievement: "120",
      effectiveMonth: month,
    })).statusCode).toBe(200);

    const rules = (await hr("GET", "/kpi/rules")).json().rules as Record<string, unknown>[];
    const saved = rules.find((rule) => rule.positionId === positionId)!;
    expect(saved).toMatchObject({
      bonusType: "achievement",
      name: "Yetkazmalar soni",
      target: "100.0000",
      bonusAmount: "1000000.00",
      weight: "30.00",
      maxAchievement: "120.00",
      effectiveMonth: month,
    });
  });
});

/**
 * Maqsadli mukofot matematikasi (sof funksiya) — 3.2 va 3.3 bandlari.
 * Ko'rsatkich 4 xonali bigint (100 → 1 000 000n), foiz 2 xonali (100% → 10 000n), pul 2 xonali.
 */
describe("Bajarilish va mukofot (sof funksiya)", () => {
  const value = (n: number) => BigInt(Math.round(n * 10_000));

  it("bajarilish = haqiqiy / maqsad", () => {
    expect(achievementOf(value(95), "100", null), "95/100 = 95%").toBe(9500n);
    expect(achievementOf(value(100), "100", null)).toBe(10000n);
    expect(achievementOf(value(120), "100", null)).toBe(12000n);
    expect(achievementOf(value(0), "100", null)).toBe(0n);
  });

  it("shift ortiqcha bajarishni cheklaydi", () => {
    expect(achievementOf(value(200), "100", "120"), "200% → 120% ga tushadi").toBe(12000n);
    expect(achievementOf(value(110), "100", "120"), "shiftdan past — o'zgarmaydi").toBe(11000n);
  });

  it("maqsad yo'q yoki nol — bajarilish aniqlanmaydi", () => {
    expect(achievementOf(value(50), null, null)).toBeNull();
    expect(achievementOf(value(50), "0", null)).toBeNull();
  });

  it("achievement: summa × bajarilish foizi", () => {
    const rule = { bonusType: "achievement" as const, bonusAmount: "1000000", weight: null };
    expect(targetBonus(rule, 9500n), "1 000 000 × 95% = 950 000").toBe(95_000_000n);
    expect(targetBonus(rule, 10000n)).toBe(100_000_000n);
    expect(targetBonus(rule, 0n)).toBe(0n);
  });

  it("fixed: maqsad bajarilsa to'liq summa, bajarilmasa 0", () => {
    const rule = { bonusType: "fixed" as const, bonusAmount: "1000000", weight: null };
    expect(targetBonus(rule, 10000n), "100% — to'liq").toBe(100_000_000n);
    expect(targetBonus(rule, 12000n), "ortiqcha bajarish ham to'liq summa").toBe(100_000_000n);
    expect(targetBonus(rule, 9999n), "99.99% — pul yo'q").toBe(0n);
  });

  it("ulush: bir nechta KPI bitta fondni bo'lishadi (30+30+20+20 = 100%)", () => {
    const pot = "1000000";
    const share = (weight: string, achievement: bigint) =>
      targetBonus({ bonusType: "achievement", bonusAmount: pot, weight }, achievement);

    // Hammasi 100% bajarilsa — jami aynan fondning o'zi
    const full = share("30", 10000n) + share("30", 10000n) + share("20", 10000n) + share("20", 10000n);
    expect(full, "to'liq bajarilishda fond to'liq beriladi").toBe(100_000_000n);

    // Yetkazma 100%, o'z vaqtida 50%, undirish 100%, qaytarish 0%
    const mixed = share("30", 10000n) + share("30", 5000n) + share("20", 10000n) + share("20", 0n);
    // 300 000 + 150 000 + 200 000 + 0 = 650 000
    expect(mixed).toBe(65_000_000n);
  });

  it("bajarilish aniqlanmagan bo'lsa mukofot yo'q", () => {
    expect(targetBonus({ bonusType: "achievement", bonusAmount: "1000000", weight: null }, null)).toBe(0n);
  });
});

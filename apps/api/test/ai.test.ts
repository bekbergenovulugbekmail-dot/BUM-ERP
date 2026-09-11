import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { rateLimits } from "../src/db/schema/platform.js";
import {
  AssistantUnavailableError,
  assistantProvider,
  type AssistantRequest,
} from "../src/modules/ai/assistant.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let other: Company;
let captured: AssistantRequest[];
const originalClient = assistantProvider.client;

const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  assistantProvider.client = originalClient;
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Tahlil MChJ" });
  other = await createCompany(app, admin.cookie, { name: "Raqobatchi" });
  captured = [];
  assistantProvider.client = async (request) => {
    captured.push(request);
    return "Tushum barqaror.";
  };
});

const call = (method: "GET" | "POST", url: string, cookie: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const ask = (payload: object, cookie = company.ownerCookie) => call("POST", "/api/ai/assistant", cookie, payload);

describe("AI yordamchi", () => {
  it("prompt faqat shu kompaniya ko'rsatkichlaridan; ruxsat, validatsiya, cheklov, xizmat xatosi va o'chiq holat", async () => {
    const expense = await call("POST", "/api/finance/expenses", company.ownerCookie, {
      category: "ijara",
      description: "Ijara",
      amount: "2000",
      expenseDate: today,
    });
    await call("POST", `/api/finance/expenses/${expense.json().expense.id}/status`, company.ownerCookie, { status: "approved" });
    await call("POST", "/api/hr/employees", company.ownerCookie, { name: "Xodim", hireDate: "2020-01-01", baseSalary: "3000000", salaryType: "monthly" });
    await call("POST", "/api/hr/employees", other.ownerCookie, { name: "Begona", hireDate: "2020-01-01", baseSalary: "9999999", salaryType: "monthly" });

    const res = await ask({
      question: "Holat qanday?",
      history: [
        { role: "user", content: "Salom" },
        { role: "assistant", content: "Salom! Qanday yordam beray?" },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ answer: "Tushum barqaror." });

    const [request] = captured;
    expect(request!.system).toContain("Kompaniya: Tahlil MChJ");
    expect(request!.system).toContain("Xarajatlar: 2000.00");
    expect(request!.system).toContain("oylik fondi: 3000000.00");
    expect(request!.system).not.toContain("9999999");
    expect(request!.system).not.toContain("Raqobatchi");
    expect(request!.messages).toHaveLength(3);
    expect(request!.messages.at(-1)).toEqual({ role: "user", content: "Holat qanday?" });

    const kassir = await addEmployee(app, company, "Kassir");
    expect((await ask({ question: "Foyda?" }, kassir.cookie)).statusCode).toBe(403);
    const longHistory = Array.from({ length: 21 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x" }));
    expect((await ask({ question: "X", history: longHistory })).statusCode).toBe(400);
    expect((await ask({ question: "X", history: [{ role: "assistant", content: "x" }] })).statusCode).toBe(400);
    expect((await ask({ question: "" })).statusCode).toBe(400);

    const windowStart = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    await db
      .insert(rateLimits)
      .values({ bucket: `ai-assistant:${company.owner.id}`, windowStart, count: 20 })
      .onConflictDoUpdate({ target: [rateLimits.bucket, rateLimits.windowStart], set: { count: 20 } });
    expect((await ask({ question: "Yana?" })).statusCode).toBe(429);

    assistantProvider.client = async () => {
      throw new AssistantUnavailableError("AI xatoligi (500). Qayta urinib ko'ring.");
    };
    const failed = await ask({ question: "Holat?" }, other.ownerCookie);
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toMatchObject({ code: "AI_ERROR" });

    assistantProvider.client = null;
    expect((await call("GET", "/api/ai/status", company.ownerCookie)).json()).toEqual({ enabled: false });
    expect((await ask({ question: "Holat?" }, other.ownerCookie)).statusCode).toBe(503);
  });
});

import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { passwordResetCodes } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import { eskizClient, smsProvider } from "../src/shared/sms.js";
import { createUser, login, me, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let sent: { phone: string; message: string }[];
const originalClient = smsProvider.client;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  smsProvider.client = originalClient;
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  sent = [];
  smsProvider.client = async (phone, message) => {
    sent.push({ phone, message });
  };
});

const request = (phone: string) => app.inject({ method: "POST", url: "/api/auth/password-reset/request", payload: { phone } });
const confirm = (payload: object) => app.inject({ method: "POST", url: "/api/auth/password-reset/confirm", payload });
const lastCode = () => sent.at(-1)!.message.match(/\b(\d{6})\b/)![1]!;
const wrong = (code: string) => (code === "000000" ? "111111" : "000000");

describe("SMS orqali parol tiklash", () => {
  it("kod SMS da; kuchsiz parol va xato kod kodni yoqmaydi; to'g'ri kod parolni almashtiradi, sessiyalarni bekor qiladi; bir martalik", async () => {
    const account = await signedIn(app, { password: "eski-parol-123" });

    const requested = await request(account.phone);
    expect(requested.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.phone).toBe(account.phone);
    const code = lastCode();

    const [stored] = await db.select().from(passwordResetCodes).where(eq(passwordResetCodes.userId, account.user.id));
    expect(stored!.codeHash).toHaveLength(64);
    expect(stored!.codeHash).not.toContain(code);

    expect((await confirm({ phone: account.phone, code, newPassword: "qisqa" })).statusCode).toBe(400);
    const badCode = await confirm({ phone: account.phone, code: wrong(code), newPassword: "yangi-parol-456" });
    expect(badCode.statusCode).toBe(400);
    expect(badCode.json().message).toBe("Kod noto'g'ri yoki muddati o'tgan");
    const [afterWrong] = await db.select().from(passwordResetCodes).where(eq(passwordResetCodes.userId, account.user.id));
    expect(afterWrong).toMatchObject({ attempts: 1, consumedAt: null });

    expect((await confirm({ phone: account.phone, code, newPassword: "yangi-parol-456" })).statusCode).toBe(200);
    expect((await me(app, account.cookie)).statusCode).toBe(401);
    expect((await login(app, account.phone, "eski-parol-123")).res.statusCode).toBe(401);
    expect((await login(app, account.phone, "yangi-parol-456")).res.statusCode).toBe(200);
    expect((await confirm({ phone: account.phone, code, newPassword: "boshqa-parol-789" })).statusCode).toBe(400);
  });

  it("raqam oshkor bo'lmaydi; bloklangan va bootstrap admin; 5 xatodan keyin kod yonadi; muddat; cheklov; SMS xatosi; o'chiq holat", async () => {
    const unknown = await request("+998901112233");
    expect(unknown.statusCode).toBe(200);
    const blocked = await createUser({ isActive: false });
    const bootstrap = await createUser({ isPlatformAdmin: true, isBootstrapAdmin: true });
    const blockedResponse = await request(blocked.phone);
    expect((await request(bootstrap.phone)).statusCode).toBe(200);
    expect(blockedResponse.json()).toEqual(unknown.json());
    expect(sent).toHaveLength(0);

    const victim = await createUser({ password: "eski-parol-123" });
    await request(victim.phone);
    const firstCode = lastCode();
    for (let i = 0; i < 5; i++) {
      expect((await confirm({ phone: victim.phone, code: wrong(firstCode), newPassword: "yangi-parol-456" })).statusCode).toBe(400);
    }
    expect((await confirm({ phone: victim.phone, code: firstCode, newPassword: "yangi-parol-456" })).statusCode).toBe(400);

    await request(victim.phone);
    const secondCode = lastCode();
    await db.update(passwordResetCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordResetCodes.userId, victim.user.id));
    expect((await confirm({ phone: victim.phone, code: secondCode, newPassword: "yangi-parol-456" })).statusCode).toBe(400);

    smsProvider.client = async () => {
      throw new Error("Eskiz ishlamayapti");
    };
    expect((await request(victim.phone)).statusCode).toBe(200);
    expect((await request(victim.phone)).statusCode).toBe(429);

    smsProvider.client = null;
    expect((await request(victim.phone)).statusCode).toBe(503);
    expect((await confirm({ phone: victim.phone, code: "123456", newPassword: "yangi-parol-456" })).statusCode).toBe(503);
    expect((await login(app, victim.phone, "eski-parol-123")).res.statusCode).toBe(200);
  });

  it("Eskiz mijozi: kirish, yuborish, token eskirsa bir marta qayta kirish", async () => {
    const calls: { path: string; authorization?: string; phone?: string }[] = [];
    let logins = 0;
    let sends = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const path = url.replace("https://notify.test/api", "");
        const headers = (init.headers ?? {}) as Record<string, string>;
        const form = init.body as FormData;
        calls.push({ path, authorization: headers.authorization, phone: form.get("mobile_phone")?.toString() });
        if (path === "/auth/login") {
          logins += 1;
          return new Response(JSON.stringify({ data: { token: `token-${logins}` } }), { status: 200 });
        }
        sends += 1;
        if (sends === 2) return new Response("{}", { status: 401 });
        return new Response(JSON.stringify({ status: "waiting" }), { status: 200 });
      }),
    );
    try {
      const client = eskizClient({ baseUrl: "https://notify.test/api", email: "e", password: "p", sender: "4546" });
      await client("+998901234567", "Birinchi");
      await client("+998901234567", "Ikkinchi");
      expect(calls.map((c) => c.path)).toEqual(["/auth/login", "/message/sms/send", "/message/sms/send", "/auth/login", "/message/sms/send"]);
      expect(calls[1]).toMatchObject({ authorization: "Bearer token-1", phone: "998901234567" });
      expect(calls[4]).toMatchObject({ authorization: "Bearer token-2" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

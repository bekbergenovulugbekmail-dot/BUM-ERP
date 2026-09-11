import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../src/db/client.js";
import { users } from "../src/db/schema/platform.js";
import { hashPassword } from "../src/modules/auth/password.js";
import { SESSION_COOKIE } from "../src/modules/auth/session.js";

export async function resetDatabase(): Promise<void> {
  const result = await db.execute<{ name: string }>(sql`select current_database() as name`);
  const name = result.rows[0]?.name ?? "";
  // Himoya: hech qachon ishchi bazani tozalamaslik
  if (!name.endsWith("_test")) throw new Error(`Bu test bazasi emas: ${name}`);
  await db.execute(sql`truncate table users, companies, rate_limits, audit_logs cascade`);
}

let seq = 0;

type NewUser = Partial<typeof users.$inferInsert> & { password?: string };

export async function createUser(overrides: NewUser = {}) {
  seq += 1;
  const { password = "maxfiy-parol-123", ...fields } = overrides;
  const phone = fields.phone ?? `+99890${String(seq).padStart(7, "0")}`;

  const [user] = await db
    .insert(users)
    .values({
      name: `Sinov ${seq}`,
      passwordHash: await hashPassword(password),
      ...fields,
      phone,
    })
    .returning();

  return { user: user!, phone, password };
}

export async function login(app: FastifyInstance, phone: string, password: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { phone, password },
  });
  const token = res.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
  return { res, token, cookie: token ? `${SESSION_COOKIE}=${token}` : undefined };
}

/** Kirgan foydalanuvchi + tayyor cookie. */
export async function signedIn(app: FastifyInstance, overrides: NewUser = {}) {
  const created = await createUser(overrides);
  const { cookie } = await login(app, created.phone, created.password);
  if (!cookie) throw new Error("Test foydalanuvchisi kira olmadi");
  return { ...created, cookie };
}

export function me(app: FastifyInstance, cookie: string) {
  return app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
}

/** Platforma admini API orqali kompaniya va egasini yaratadi, egasi tizimga kiradi. */
export async function createCompany(
  app: FastifyInstance,
  adminCookie: string,
  input: { name?: string; ownerPhone?: string; ownerPassword?: string } = {},
) {
  seq += 1;
  const owner = {
    phone: input.ownerPhone ?? `+99891${String(seq).padStart(7, "0")}`,
    password: input.ownerPassword ?? "egasi-parol-123",
    name: `Ega ${seq}`,
  };

  const res = await app.inject({
    method: "POST",
    url: "/api/platform/companies",
    headers: { cookie: adminCookie },
    payload: { name: input.name ?? `Kompaniya ${seq}`, owner },
  });
  if (res.statusCode !== 201) throw new Error(`Kompaniya yaratilmadi: ${res.statusCode} ${res.body}`);
  const body = res.json() as { company: { id: string; slug: string }; owner: { id: string } };

  const { cookie } = await login(app, owner.phone, owner.password);
  if (!cookie) throw new Error("Kompaniya egasi kira olmadi");

  return {
    companyId: body.company.id,
    slug: body.company.slug,
    owner: { ...owner, id: body.owner.id },
    ownerCookie: cookie,
  };
}

/** Kompaniya egasi API orqali berilgan roldagi xodim qo'shadi; xodim tizimga kiradi. */
export async function addEmployee(
  app: FastifyInstance,
  company: { ownerCookie: string },
  role = "Kassir",
) {
  const payload = { phone: uniquePhone(), password: "xodim-parol-123", name: `${role} xodim`, role };
  const res = await app.inject({
    method: "POST",
    url: "/api/company/employees",
    headers: { cookie: company.ownerCookie },
    payload,
  });
  if (res.statusCode !== 201) throw new Error(`Xodim qo'shilmadi: ${res.statusCode} ${res.body}`);

  const { cookie } = await login(app, payload.phone, payload.password);
  if (!cookie) throw new Error("Xodim kira olmadi");
  return { id: res.json().employee.id as string, phone: payload.phone, cookie };
}

let phoneSeq = 0;

/** Testlar orasida takrorlanmaydigan telefon raqam. */
export function uniquePhone(prefix = "93"): string {
  phoneSeq += 1;
  return `+998${prefix}${String(phoneSeq).padStart(7, "0")}`;
}

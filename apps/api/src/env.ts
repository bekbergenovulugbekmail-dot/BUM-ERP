/**
 * Muhit o'zgaruvchilari — ishga tushishda bir marta tekshiriladi.
 * Yetishmayotgan sozlama serverni darhol to'xtatadi, ish vaqtida emas.
 */
import "./load-env.js";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  /**
   * "::" — IPv6 va IPv4 ikkalasini tinglaydi (dual-stack). "0.0.0.0" faqat
   * IPv4 bo'lib, `localhost` avval ::1 ga urinadigan mijozlarda rad etiladi
   * yoki kechikadi. IPv6 o'chirilgan muhitda "0.0.0.0" qo'ying.
   */
  HOST: z.string().min(1).default("::"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL majburiy"),

  /** Cookie imzolash uchun; kamida 32 belgi. */
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET kamida 32 belgi bo'lishi kerak"),
  /** Sessiya mutlaq muddati (kun). */
  SESSION_ABSOLUTE_DAYS: z.coerce.number().int().positive().default(30),
  /** Faolsizlik muddati (soat). */
  SESSION_IDLE_HOURS: z.coerce.number().int().positive().default(12),

  /** Frontend manzili — CORS va cookie domeni uchun. */
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),

  /** Ixtiyoriy integratsiyalar — yo'q bo'lsa tegishli funksiya o'chiq turadi. */
  ESKIZ_EMAIL: z.string().optional(),
  ESKIZ_PASSWORD: z.string().optional(),
  ESKIZ_BASE_URL: z.string().url().default("https://notify.eskiz.uz/api"),
  ESKIZ_SENDER: z.string().default("4546"),

  ANTHROPIC_API_KEY: z.string().optional(),
  /** AI yordamchi modeli — standart: eng so'nggi Sonnet. */
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5"),

  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),

  /**
   * Bootstrap (ildiz) platforma admini — `db:seed` shu qiymatlardan yaratadi
   * yoki yangilaydi. Server ishlashi uchun shart emas.
   */
  BOOTSTRAP_ADMIN_PHONE: z.string().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  console.error("Muhit o'zgaruvchilari noto'g'ri:\n" + issues);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";

/** Integratsiya yoqilganmi — kod shu bayroqlarga qaraydi, env'ga emas. */
export const features = {
  sms: Boolean(env.ESKIZ_EMAIL && env.ESKIZ_PASSWORD),
  ai: Boolean(env.ANTHROPIC_API_KEY),
  storage: Boolean(env.STORAGE_ENDPOINT && env.STORAGE_BUCKET),
} as const;

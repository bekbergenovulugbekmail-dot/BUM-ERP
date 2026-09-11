/**
 * Fastify xato ishlovchisi — barcha xatolar bir xil shaklda chiqadi:
 *   { code, message }
 * Bu Convexdagi ConvexError({code, message}) bilan bir xil, shuning uchun
 * frontend xato ishlovi migratsiyada o'zgarmaydi.
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError } from "@bum/shared";
import { isProd } from "../env.js";
import { logger } from "./logger.js";

function hasStatusCode(e: unknown): e is { statusCode: number } {
  return (
    typeof e === "object" &&
    e !== null &&
    "statusCode" in e &&
    typeof (e as { statusCode: unknown }).statusCode === "number"
  );
}

/** PostgreSQL xato kodi — Drizzle uni `cause` ichiga o'rab beradi. */
function pgErrorCode(e: unknown): string | undefined {
  const codeOf = (x: unknown) =>
    typeof x === "object" && x !== null && "code" in x && typeof x.code === "string"
      ? x.code
      : undefined;
  return codeOf(e) ?? (typeof e === "object" && e !== null && "cause" in e ? codeOf(e.cause) : undefined);
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send(err.toJSON());
    }

    if (err instanceof ZodError) {
      return reply.status(400).send({
        code: "BAD_REQUEST",
        message: "Kiritilgan ma'lumot noto'g'ri",
        details: err.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
    }

    // unique_violation — servis tekshiruvidan keyingi poyga (masalan, bir xil telefon)
    const pgCode = pgErrorCode(err);
    if (pgCode === "23505") {
      return reply.status(409).send({
        code: "CONFLICT",
        message: "Bunday yozuv allaqachon mavjud",
      });
    }
    // foreign_key_violation — bog'liq yozuv yo'q yoki yozuv hali ishlatilmoqda
    if (pgCode === "23503") {
      return reply.status(409).send({
        code: "CONFLICT",
        message: "Yozuv boshqa ma'lumotlar bilan bog'langan",
      });
    }
    // check_violation — bazadagi cheklov (manfiy qoldiq va h.k.); servis odatda oldinroq ushlaydi
    if (pgCode === "23514") {
      return reply.status(400).send({
        code: "BAD_REQUEST",
        message: "Qiymat ruxsat etilgan chegaradan tashqarida",
      });
    }

    // Fastify'ning o'z validatsiya xatosi
    const status = hasStatusCode(err) ? err.statusCode : undefined;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.status(status).send({
        code: "BAD_REQUEST",
        message: err instanceof Error ? err.message : "So'rov noto'g'ri",
      });
    }

    logger.error({ err, url: req.url, method: req.method }, "Kutilmagan xato");
    return reply.status(500).send({
      code: "INTERNAL",
      message: "Serverda xatolik yuz berdi",
      ...(isProd || !(err instanceof Error) ? {} : { debug: err.message }),
    });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({
      code: "NOT_FOUND",
      message: `Marshrut topilmadi: ${req.method} ${req.url}`,
    }),
  );
}

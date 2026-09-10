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

import pino from "pino";
import { env, isProd } from "../env.js";

const isTest = env.NODE_ENV === "test";

export const logger = pino({
  // Testda jim; tushunarsiz 500'ni ko'rish uchun TEST_LOG_LEVEL=error
  level: isTest ? (process.env.TEST_LOG_LEVEL ?? "silent") : isProd ? "info" : "debug",
  /** Parol, token, PIN hech qachon logga tushmasin. */
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      "*.password",
      "*.newPassword",
      "*.passwordHash",
      "*.pin",
      "*.pinHash",
      "*.token",
      "*.tokenHash",
      "*.code",
      "*.codeHash",
      "*.otp",
      "*.otpHash",
      "*.secret",
      "*.currentPassword",
      // Ichma-ich obyektlar (masalan, `details.input.password`) — bir daraja chuqurroq ham
      "*.*.password",
      "*.*.newPassword",
      "*.*.pin",
      "*.*.token",
      "*.*.otp",
      "*.*.secret",
    ],
    censor: "[yashirildi]",
  },
  serializers: {
    /** DB so'rov xatosi xabari parametrlarni o'z ichiga oladi (xesh, token, telefon) — logga faqat SQL va sabab tushadi. */
    err(error: Error) {
      const serialized = pino.stdSerializers.err(error) as unknown as Record<string, unknown>;
      delete serialized.params;
      if (typeof serialized.message === "string") serialized.message = serialized.message.replace(/\nparams:[\s\S]*$/, "\nparams: [yashirildi]");
      if (typeof serialized.stack === "string") serialized.stack = serialized.stack.replace(/\nparams:[^\n]*/g, "\nparams: [yashirildi]");
      return serialized;
    },
  },
  ...(isProd ? {} : { transport: { target: "pino/file", options: { destination: 1 } } }),
});

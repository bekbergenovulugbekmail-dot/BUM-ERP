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
    ],
    censor: "[yashirildi]",
  },
  ...(isProd ? {} : { transport: { target: "pino/file", options: { destination: 1 } } }),
});

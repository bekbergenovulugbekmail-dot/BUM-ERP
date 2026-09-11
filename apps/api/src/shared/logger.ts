import pino from "pino";
import { env, isProd } from "../env.js";

const isTest = env.NODE_ENV === "test";

export const logger = pino({
  level: isTest ? "silent" : isProd ? "info" : "debug",
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

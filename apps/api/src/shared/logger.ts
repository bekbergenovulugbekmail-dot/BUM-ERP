import pino from "pino";
import { env, isProd } from "../env.js";

export const logger = pino({
  level: isProd ? "info" : "debug",
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

/**
 * Xato kodlari — Convexdagi ConvexError({code, message}) naqshi bilan
 * bir xil, shuning uchun frontend xato ishlovi o'zgarmaydi.
 */
export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "BAD_REQUEST",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }

  toJSON() {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}

export const unauthenticated = (m = "Tizimga kiring") => new AppError("UNAUTHENTICATED", m);
export const forbidden = (m = "Ruxsat yo'q") => new AppError("FORBIDDEN", m);
export const notFound = (m = "Topilmadi") => new AppError("NOT_FOUND", m);
export const badRequest = (m: string, d?: unknown) => new AppError("BAD_REQUEST", m, d);
export const conflict = (m: string) => new AppError("CONFLICT", m);
export const rateLimited = (m = "Juda ko'p urinish. Biroz kuting.") => new AppError("RATE_LIMITED", m);

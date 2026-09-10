/**
 * PIN Quick Unlock — backend (Convex V8 runtime)
 *
 * Hashing: SHA-256 with a per-user salt (stored separately) using Web Crypto API.
 * This is available in Convex V8 runtime (no bcrypt needed).
 *
 * Security design:
 *  - PIN stored as SHA-256(salt + ":" + pin) — salt is random 32 hex chars
 *  - PIN salt stored in pinSalt field (added to schema)
 *  - PIN cannot unlock a different user's session
 *  - PIN cannot cross tenant boundary
 *  - 5 wrong attempts → 5 minute lockout
 *
 * IMPORTANT: PIN is a UI-only session unlock mechanism.
 * It cannot create a new Hercules Auth session or change userId/companyId.
 */
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { writeAuditLog } from "./tenant.ts";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 5;

// ─── Crypto helpers (Web Crypto API — available in Convex V8) ─────────────────

function generateSalt(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Helper: get current authenticated user ───────────────────────────────────

async function requireCurrentUser(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "UNAUTHENTICATED", message: "Tizimga kiring" });
  }
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Foydalanuvchi topilmadi" });
  }
  return user;
}

// ─── Set PIN ──────────────────────────────────────────────────────────────────

export const setPin = mutation({
  args: { pin: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const user = await requireCurrentUser(ctx);

    if (!/^\d{4,8}$/.test(args.pin)) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "PIN 4-8 ta raqamdan iborat bo'lishi kerak" });
    }

    const salt = generateSalt();
    const pinHash = await hashPin(args.pin, salt);

    await ctx.db.patch(user._id, {
      pinHash,
      pinSalt: salt,
      pinFailedAttempts: 0,
      pinLockedUntil: undefined,
    });

    await writeAuditLog(ctx, {
      userId: user._id,
      userName: user.name,
      action: "pin_created",
      resource: "users",
      resourceId: user._id,
      details: JSON.stringify({ action: "pin_set" }),
      severity: "info",
      companyId: user.activeCompanyId,
    });
  },
});

// ─── Change PIN ───────────────────────────────────────────────────────────────

export const changePin = mutation({
  args: { oldPin: v.string(), newPin: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const user = await requireCurrentUser(ctx);

    if (!user.pinHash || !user.pinSalt) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "PIN hali o'rnatilmagan" });
    }
    if (!/^\d{4,8}$/.test(args.newPin)) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Yangi PIN 4-8 ta raqamdan iborat bo'lishi kerak" });
    }

    const oldHash = await hashPin(args.oldPin, user.pinSalt);
    if (oldHash !== user.pinHash) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Eski PIN noto'g'ri" });
    }

    const salt = generateSalt();
    const pinHash = await hashPin(args.newPin, salt);

    await ctx.db.patch(user._id, {
      pinHash, pinSalt: salt,
      pinFailedAttempts: 0, pinLockedUntil: undefined,
    });

    await writeAuditLog(ctx, {
      userId: user._id, userName: user.name,
      action: "pin_changed", resource: "users", resourceId: user._id,
      details: JSON.stringify({ action: "pin_changed" }),
      severity: "info", companyId: user.activeCompanyId,
    });
  },
});

// ─── Remove PIN ───────────────────────────────────────────────────────────────

export const removePin = mutation({
  args: { currentPin: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const user = await requireCurrentUser(ctx);

    if (!user.pinHash || !user.pinSalt) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "PIN o'rnatilmagan" });
    }

    const hash = await hashPin(args.currentPin, user.pinSalt);
    if (hash !== user.pinHash) {
      throw new ConvexError({ code: "FORBIDDEN", message: "PIN noto'g'ri" });
    }

    await ctx.db.patch(user._id, {
      pinHash: undefined, pinSalt: undefined,
      pinFailedAttempts: 0, pinLockedUntil: undefined,
    });
  },
});

// ─── Verify PIN (session unlock) ──────────────────────────────────────────────

export const verifyPin = mutation({
  args: {
    pin: v.string(),
    expectedUserId: v.id("users"),
    expectedCompanyId: v.optional(v.id("companies")),
  },
  handler: async (ctx, args): Promise<{ success: boolean; reason?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { success: false, reason: "UNAUTHENTICATED" };

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user) return { success: false, reason: "USER_NOT_FOUND" };

    // CRITICAL: block cross-user PIN usage
    if (user._id !== args.expectedUserId) {
      await writeAuditLog(ctx, {
        userId: user._id, userName: user.name,
        action: "pin_unlock_failed", resource: "users", resourceId: user._id,
        details: JSON.stringify({ reason: "USER_MISMATCH" }),
        severity: "error", companyId: user.activeCompanyId,
      });
      return { success: false, reason: "SESSION_MISMATCH" };
    }

    // CRITICAL: block cross-tenant PIN usage
    if (args.expectedCompanyId && user.activeCompanyId !== args.expectedCompanyId) {
      await writeAuditLog(ctx, {
        userId: user._id, userName: user.name,
        action: "pin_unlock_failed", resource: "users", resourceId: user._id,
        details: JSON.stringify({ reason: "COMPANY_MISMATCH" }),
        severity: "error", companyId: user.activeCompanyId,
      });
      return { success: false, reason: "COMPANY_MISMATCH" };
    }

    if (!user.pinHash || !user.pinSalt) {
      return { success: false, reason: "PIN_NOT_SET" };
    }

    // Rate-limit check
    if (user.pinLockedUntil) {
      const lockedUntil = new Date(user.pinLockedUntil);
      if (lockedUntil > new Date()) {
        const remaining = Math.ceil((lockedUntil.getTime() - Date.now()) / 1000);
        await writeAuditLog(ctx, {
          userId: user._id, userName: user.name,
          action: "pin_locked", resource: "users", resourceId: user._id,
          details: JSON.stringify({ remainingSeconds: remaining }),
          severity: "warning", companyId: user.activeCompanyId,
        });
        return { success: false, reason: `PIN_LOCKED:${remaining}` };
      }
      await ctx.db.patch(user._id, { pinLockedUntil: undefined, pinFailedAttempts: 0 });
    }

    const inputHash = await hashPin(args.pin, user.pinSalt);
    const valid = inputHash === user.pinHash;

    if (!valid) {
      const attempts = (user.pinFailedAttempts ?? 0) + 1;
      const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
      const lockedUntil = shouldLock
        ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000).toISOString()
        : undefined;

      await ctx.db.patch(user._id, {
        pinFailedAttempts: shouldLock ? 0 : attempts,
        pinLockedUntil: lockedUntil,
      });

      await writeAuditLog(ctx, {
        userId: user._id, userName: user.name,
        action: shouldLock ? "pin_locked" : "pin_unlock_failed",
        resource: "users", resourceId: user._id,
        details: JSON.stringify({ attempts, locked: shouldLock }),
        severity: shouldLock ? "warning" : "info",
        companyId: user.activeCompanyId,
      });

      if (shouldLock) return { success: false, reason: `PIN_LOCKED:${LOCK_DURATION_MINUTES * 60}` };
      return { success: false, reason: `WRONG_PIN:${MAX_FAILED_ATTEMPTS - attempts}` };
    }

    // SUCCESS
    await ctx.db.patch(user._id, { pinFailedAttempts: 0, pinLockedUntil: undefined });
    await writeAuditLog(ctx, {
      userId: user._id, userName: user.name,
      action: "pin_unlock_success", resource: "users", resourceId: user._id,
      details: JSON.stringify({ companyId: user.activeCompanyId }),
      severity: "info", companyId: user.activeCompanyId,
    });

    return { success: true };
  },
});

// ─── Update auto-lock timeout ─────────────────────────────────────────────────

export const setAutoLockTimeout = mutation({
  args: { seconds: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const user = await requireCurrentUser(ctx);
    if (args.seconds < 0 || args.seconds > 3600) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Timeout 0-3600 soniya oralig'ida bo'lishi kerak" });
    }
    await ctx.db.patch(user._id, { autoLockTimeoutSeconds: args.seconds });
  },
});

// ─── Get security settings ────────────────────────────────────────────────────

export const getSecuritySettings = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user) return null;

    const isPinLocked = user.pinLockedUntil
      ? new Date(user.pinLockedUntil) > new Date()
      : false;

    return {
      hasPIN: !!user.pinHash,
      autoLockTimeoutSeconds: user.autoLockTimeoutSeconds ?? 30,
      isPinLocked,
      pinLockedUntil: user.pinLockedUntil,
      pinFailedAttempts: user.pinFailedAttempts ?? 0,
    };
  },
});

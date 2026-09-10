/**
 * Admin tomonidan foydalanuvchi boshqaruvi.
 *
 * OIDC provayder olib tashlangach, akkaunt yaratish va parol tiklash
 * uchun tashqi konsol qolmadi — bu ishlar endi shu yerda bajariladi.
 *
 * createAccount / modifyAccountCredentials faqat action kontekstida
 * ishlaydi, shuning uchun bular action; huquq tekshiruvi internal
 * query orqali qilinadi.
 */
import { ConvexError, v } from "convex/values";
import { action, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  createAccount,
  modifyAccountCredentials,
  invalidateSessions,
  getAuthUserId,
} from "@convex-dev/auth/server";
import { normalizePhone } from "./auth";
import type { Id } from "./_generated/dataModel";

const PROVIDER = "password";
const MIN_PASSWORD = 8;

function assertPassword(password: string) {
  if (password.length < MIN_PASSWORD) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `Parol kamida ${MIN_PASSWORD} ta belgidan iborat bo'lishi kerak`,
    });
  }
}

// ─── Huquq tekshiruvi ────────────────────────────────────────────────────────

/** Chaqiruvchi platforma admini yoki kompaniyada users.manage huquqiga egami? */
export const assertCanManageUsers = internalQuery({
  args: {},
  handler: async (ctx) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) {
      throw new ConvexError({ code: "UNAUTHENTICATED", message: "Tizimga kiring" });
    }
    const me = await ctx.db.get("users", authUserId);
    if (!me) {
      throw new ConvexError({ code: "UNAUTHENTICATED", message: "Foydalanuvchi topilmadi" });
    }
    if (me.isPlatformAdmin) return { userId: me._id, companyId: me.activeCompanyId ?? null };

    // Kompaniya darajasida: faqat egasi/direktori
    if (!me.activeCompanyId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Kompaniya tanlanmagan" });
    }
    const membership = await ctx.db
      .query("companyMembers")
      .withIndex("by_company_user", (q) =>
        q.eq("companyId", me.activeCompanyId!).eq("userId", me._id),
      )
      .first();
    const role = membership?.companyRole;
    if (!membership?.isActive || (role !== "Business Owner" && role !== "Superadmin" && role !== "Direktor")) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Foydalanuvchilarni boshqarish huquqi yo'q",
      });
    }
    return { userId: me._id, companyId: me.activeCompanyId };
  },
});

/** Telefon bo'yicha foydalanuvchini topadi (login identifikatori `email` maydonida). */
export const findByPhone = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const byEmail = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.phone))
      .first();
    if (byEmail) return byEmail;
    return ctx.db
      .query("users")
      .withIndex("phone", (q) => q.eq("phone", args.phone))
      .first();
  },
});

/** Yangi yaratilgan foydalanuvchini kompaniyaga a'zo qilib qo'shadi. */
export const attachToCompany = internalMutation({
  args: {
    userId: v.id("users"),
    companyId: v.id("companies"),
    companyRole: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("companyMembers")
      .withIndex("by_company_user", (q) =>
        q.eq("companyId", args.companyId).eq("userId", args.userId),
      )
      .first();
    if (existing) {
      await ctx.db.patch("companyMembers", existing._id, { isActive: true });
      return existing._id;
    }
    await ctx.db.patch("users", args.userId, {
      activeCompanyId: args.companyId,
      isActive: true,
    });
    return ctx.db.insert("companyMembers", {
      companyId: args.companyId,
      userId: args.userId,
      companyRole: args.companyRole,
      isActive: true,
      joinedAt: new Date().toISOString(),
    });
  },
});

// ─── Amallar ─────────────────────────────────────────────────────────────────

/**
 * Yangi kirish akkaunti yaratadi. Telefon raqam — login identifikatori.
 * Ixtiyoriy ravishda joriy kompaniyaga a'zo qilib qo'shadi.
 */
export const createUserAccount = action({
  args: {
    phone: v.string(),
    password: v.string(),
    name: v.optional(v.string()),
    companyRole: v.optional(v.string()),
    attachToActiveCompany: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ userId: Id<"users">; phone: string }> => {
    const caller = await ctx.runQuery(internal.userAdmin.assertCanManageUsers, {});
    assertPassword(args.password);
    const phone = normalizePhone(args.phone);

    const existing = await ctx.runQuery(internal.userAdmin.findByPhone, { phone });
    if (existing) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "Bu telefon raqam bilan foydalanuvchi allaqachon mavjud",
      });
    }

    const { user } = await createAccount(ctx, {
      provider: PROVIDER,
      account: { id: phone, secret: args.password },
      profile: {
        email: phone,
        phone,
        name: args.name?.trim() || phone,
        isActive: true,
      },
      shouldLinkViaEmail: false,
      shouldLinkViaPhone: false,
    });

    if (args.attachToActiveCompany !== false && caller.companyId) {
      await ctx.runMutation(internal.userAdmin.attachToCompany, {
        userId: user._id,
        companyId: caller.companyId,
        companyRole: args.companyRole ?? "Kassir",
      });
    }

    return { userId: user._id, phone };
  },
});

/**
 * Foydalanuvchining parolini almashtiradi va uning barcha sessiyalarini
 * bekor qiladi (eski parol bilan kirilgan qurilmalar chiqib ketadi).
 */
export const resetUserPassword = action({
  args: { phone: v.string(), newPassword: v.string() },
  handler: async (ctx, args): Promise<{ phone: string }> => {
    await ctx.runQuery(internal.userAdmin.assertCanManageUsers, {});
    assertPassword(args.newPassword);
    const phone = normalizePhone(args.phone);

    const target = await ctx.runQuery(internal.userAdmin.findByPhone, { phone });
    if (!target) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Foydalanuvchi topilmadi" });
    }

    await modifyAccountCredentials(ctx, {
      provider: PROVIDER,
      account: { id: phone, secret: args.newPassword },
    });
    await invalidateSessions(ctx, { userId: target._id });

    return { phone };
  },
});

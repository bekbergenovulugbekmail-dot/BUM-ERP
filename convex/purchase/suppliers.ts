import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server.js";
import { getTenantId, requireTenantAccess, requirePermission } from "../tenant.ts";

export const list = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    // STRICT: no orphan fallback — suppliers must belong to this company
    const active = await ctx.db.query("suppliers")
      .withIndex("by_company_active", (q) => q.eq("companyId", tenantId).eq("isActive", true))
      .collect();

    if (!args.includeInactive) return active;

    const inactive = await ctx.db.query("suppliers")
      .withIndex("by_company_active", (q) => q.eq("companyId", tenantId).eq("isActive", false))
      .collect();

    return [...active, ...inactive];
  },
});

export const getById = query({
  args: { id: v.id("suppliers") },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return null;
    const supplier = await ctx.db.get(args.id);
    // STRICT: ownership check
    if (!supplier || supplier.companyId !== tenantId) return null;
    return supplier;
  },
});

export const create = mutation({
  args: {
    name: v.string(), code: v.string(), contactPerson: v.optional(v.string()),
    phone: v.optional(v.string()), email: v.optional(v.string()),
    address: v.optional(v.string()), taxId: v.optional(v.string()),
    bankAccount: v.optional(v.string()), paymentTermDays: v.number(),
    currency: v.string(), notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "purchase.create");
    const tenantId = await requireTenantAccess(ctx);

    // Check uniqueness within this company
    const existing = await ctx.db.query("suppliers")
      .withIndex("by_code", (q) => q.eq("code", args.code)).first();
    if (existing && existing.companyId === tenantId) {
      throw new ConvexError({ code: "CONFLICT", message: "Bu kod allaqachon mavjud" });
    }
    return ctx.db.insert("suppliers", {
      ...args, isActive: true, totalDebt: 0, totalPurchased: 0, companyId: tenantId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("suppliers"), name: v.optional(v.string()),
    contactPerson: v.optional(v.string()), phone: v.optional(v.string()),
    email: v.optional(v.string()), address: v.optional(v.string()),
    taxId: v.optional(v.string()), bankAccount: v.optional(v.string()),
    paymentTermDays: v.optional(v.number()), currency: v.optional(v.string()),
    isActive: v.optional(v.boolean()), notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "purchase.create");
    const tenantId = await requireTenantAccess(ctx);

    // STRICT: verify ownership before patching
    const supplier = await ctx.db.get(args.id);
    if (!supplier || supplier.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Ta'minotchi topilmadi" });
    }

    const { id, ...rest } = args;
    await ctx.db.patch(id, rest);
  },
});

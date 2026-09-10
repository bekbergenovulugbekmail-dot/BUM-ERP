import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server.js";
import { getTenantId, requireTenantAccess, requireTenantAccessForWrite, requirePermission } from "../tenant.ts";

export const list = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    // SECURITY: strict tenant filter — no orphan fallback
    const all = await ctx.db.query("warehouses")
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .collect();
    return args.includeInactive ? all : all.filter((w) => w.isActive);
  },
});

export const getById = query({
  args: { id: v.id("warehouses") },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    const warehouse = await ctx.db.get(args.id);
    if (!warehouse) return null;
    // SECURITY: verify ownership — never return another company's warehouse
    if (warehouse.companyId !== tenantId) return null;
    return warehouse;
  },
});

export const create = mutation({
  args: {
    name: v.string(), code: v.string(), address: v.optional(v.string()),
    city: v.optional(v.string()), phone: v.optional(v.string()),
    isDefault: v.boolean(), notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "warehouse.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const existing = await ctx.db.query("warehouses")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .first();
    if (existing) {
      throw new ConvexError({ code: "CONFLICT", message: "Bu kod allaqachon mavjud" });
    }
    if (args.isDefault) {
      // Only unset default for THIS company's warehouses
      const others = await ctx.db.query("warehouses")
        .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
        .collect();
      for (const w of others.filter((w) => w.isDefault)) {
        await ctx.db.patch(w._id, { isDefault: false });
      }
    }
    return ctx.db.insert("warehouses", { ...args, isActive: true, companyId: tenantId });
  },
});

export const update = mutation({
  args: {
    id: v.id("warehouses"), name: v.optional(v.string()), address: v.optional(v.string()),
    city: v.optional(v.string()), phone: v.optional(v.string()),
    isActive: v.optional(v.boolean()), isDefault: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "warehouse.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const { id, ...rest } = args;
    // SECURITY: verify warehouse belongs to this tenant
    const warehouse = await ctx.db.get(id);
    if (!warehouse || warehouse.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Ombor topilmadi" });
    }
    if (rest.isDefault) {
      const others = await ctx.db.query("warehouses")
        .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
        .collect();
      for (const w of others) {
        if (w._id !== id && w.isDefault) {
          await ctx.db.patch(w._id, { isDefault: false });
        }
      }
    }
    await ctx.db.patch(id, rest);
  },
});

export const seedDefault = mutation({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenantAccess(ctx);
    const existing = await ctx.db.query("warehouses")
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .first();
    if (existing) return;
    await ctx.db.insert("warehouses", {
      name: "Asosiy ombor", code: "WH-01",
      address: "Toshkent, O'zbekiston",
      isActive: true, isDefault: true, companyId: tenantId,
    });
  },
});

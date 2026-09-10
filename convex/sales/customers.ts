/**
 * Customers — fully tenant-scoped.
 */
import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server.js";
import type { QueryCtx } from "../_generated/server.d.ts";
import type { Id } from "../_generated/dataModel.d.ts";
import { getTenantId, requireTenantAccess, requireTenantAccessForWrite, requirePermission } from "../tenant.ts";

// Generate customer code scoped to this tenant
async function nextCode(ctx: QueryCtx, tenantId: Id<"companies">) {
  const last = await ctx.db
    .query("customers")
    .withIndex("by_company", (q) => q.eq("companyId", tenantId))
    .order("desc")
    .first();
  if (!last) return "C-0001";
  const n = parseInt(last.code.replace("C-", "")) + 1;
  return `C-${String(n).padStart(4, "0")}`;
}

export const list = query({
  args: {
    search: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    if (args.search) {
      return ctx.db.query("customers")
        .withSearchIndex("search_name", (q) =>
          q.search("name", args.search!).eq("companyId", tenantId)
        )
        .take(50);
    }
    // Use by_company index — strict filter, never expose orphaned records
    return ctx.db.query("customers")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .filter((fq) => fq.eq(fq.field("isActive"), args.isActive ?? true))
      .order("asc")
      .take(args.limit ?? 200);
  },
});

export const getById = query({
  args: { id: v.id("customers") },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return null;
    const customer = await ctx.db.get(args.id);
    if (!customer) return null;
    // SECURITY: verify this customer belongs to the current tenant
    if (customer.companyId !== tenantId) return null;
    // Only return orders/payments from this same tenant
    const orders = await ctx.db.query("salesOrders")
      .withIndex("by_customer", (q) => q.eq("customerId", args.id))
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .order("desc").take(20);
    const payments = await ctx.db.query("customerPayments")
      .withIndex("by_customer", (q) => q.eq("customerId", args.id))
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .order("desc").take(20);
    return { ...customer, orders, payments };
  },
});

export const create = mutation({
  args: {
    name: v.string(), phone: v.optional(v.string()), email: v.optional(v.string()),
    address: v.optional(v.string()), taxId: v.optional(v.string()),
    discountPercent: v.optional(v.number()), creditLimit: v.optional(v.number()),
    paymentTermDays: v.optional(v.number()), currency: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const code = await nextCode(ctx, tenantId);
    const company = await ctx.db.get(tenantId);
    return ctx.db.insert("customers", {
      name: args.name, code, phone: args.phone, email: args.email,
      address: args.address, taxId: args.taxId,
      discountPercent: args.discountPercent ?? 0,
      creditLimit: args.creditLimit ?? 0,
      paymentTermDays: args.paymentTermDays ?? 0,
      currency: args.currency ?? company?.currency ?? "UZS",
      isActive: true, notes: args.notes, totalDebt: 0, totalPurchased: 0,
      companyId: tenantId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("customers"), name: v.optional(v.string()), phone: v.optional(v.string()),
    email: v.optional(v.string()), address: v.optional(v.string()),
    discountPercent: v.optional(v.number()), creditLimit: v.optional(v.number()),
    isActive: v.optional(v.boolean()), notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccess(ctx);
    const customer = await ctx.db.get(args.id);
    if (!customer || customer.companyId !== tenantId) {
      throw new ConvexError({ message: "Mijoz topilmadi", code: "NOT_FOUND" });
    }
    const { id, ...rest } = args;
    const updates = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    await ctx.db.patch(id, updates);
  },
});

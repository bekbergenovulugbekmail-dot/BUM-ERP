/**
 * Distribution Routes — fully tenant-scoped with ownership checks.
 */
import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server.js";
import { getTenantId, requireTenantAccess, requireTenantAccessForWrite, requirePermission } from "../tenant.ts";

// ─── Routes ──────────────────────────────────────────────────────────────────

export const listRoutes = query({
  args: { onlyActive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    const routes = await ctx.db.query("distributionRoutes")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .filter(args.onlyActive ? (fq) => fq.eq(fq.field("isActive"), true) : () => true)
      .collect();
    return Promise.all(routes.map(async (r) => {
      const repName = r.salesRepId ? (await ctx.db.get(r.salesRepId))?.name : undefined;
      const customerCount = await ctx.db
        .query("routeCustomers")
        .withIndex("by_route", (q) => q.eq("routeId", r._id))
        .collect()
        .then((c) => c.length);
      return { ...r, repName, customerCount };
    }));
  },
});

export const getRoute = query({
  args: { id: v.id("distributionRoutes") },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return null;
    const route = await ctx.db.get(args.id);
    if (!route) return null;
    // SECURITY: verify route belongs to this tenant
    if (route.companyId !== tenantId) return null;
    const repName = route.salesRepId ? (await ctx.db.get(route.salesRepId))?.name : undefined;
    const routeCustomersList = await ctx.db
      .query("routeCustomers")
      .withIndex("by_route", (q) => q.eq("routeId", args.id))
      .collect();
    const customers = await Promise.all(
      routeCustomersList.map(async (rc) => {
        const customer = await ctx.db.get(rc.customerId);
        // Only expose customer data that belongs to this tenant
        if (!customer || customer.companyId !== tenantId) return null;
        return { ...rc, customerName: customer.name, phone: customer.phone, address: customer.address };
      })
    );
    const filteredCustomers = customers.filter(Boolean);
    filteredCustomers.sort((a, b) => (a?.sortOrder ?? 0) - (b?.sortOrder ?? 0));
    return { ...route, repName, customers: filteredCustomers };
  },
});

export const createRoute = mutation({
  args: {
    name: v.string(),
    salesRepId: v.optional(v.id("salesReps")),
    description: v.optional(v.string()),
    days: v.array(v.number()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    if (args.salesRepId) {
      const rep = await ctx.db.get(args.salesRepId);
      if (!rep || rep.companyId !== tenantId) {
        throw new ConvexError({ message: "Sotuvchi topilmadi", code: "NOT_FOUND" });
      }
    }
    return ctx.db.insert("distributionRoutes", { ...args, isActive: true, companyId: tenantId });
  },
});

export const updateRoute = mutation({
  args: {
    id: v.id("distributionRoutes"),
    name: v.optional(v.string()),
    salesRepId: v.optional(v.id("salesReps")),
    description: v.optional(v.string()),
    days: v.optional(v.array(v.number())),
    color: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccess(ctx);
    const route = await ctx.db.get(args.id);
    if (!route || route.companyId !== tenantId) {
      throw new ConvexError({ message: "Marshrut topilmadi", code: "NOT_FOUND" });
    }
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const deleteRoute = mutation({
  args: { id: v.id("distributionRoutes") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccess(ctx);
    const route = await ctx.db.get(args.id);
    if (!route || route.companyId !== tenantId) {
      throw new ConvexError({ message: "Marshrut topilmadi", code: "NOT_FOUND" });
    }
    const rcs = await ctx.db
      .query("routeCustomers")
      .withIndex("by_route", (q) => q.eq("routeId", args.id))
      .collect();
    for (const rc of rcs) await ctx.db.delete(rc._id);
    await ctx.db.delete(args.id);
  },
});

// ─── Route Customers ─────────────────────────────────────────────────────────

export const addCustomerToRoute = mutation({
  args: {
    routeId: v.id("distributionRoutes"),
    customerId: v.id("customers"),
    visitNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccess(ctx);
    // Verify both route and customer belong to this tenant
    const route = await ctx.db.get(args.routeId);
    if (!route || route.companyId !== tenantId) {
      throw new ConvexError({ message: "Marshrut topilmadi", code: "NOT_FOUND" });
    }
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.companyId !== tenantId) {
      throw new ConvexError({ message: "Mijoz topilmadi", code: "NOT_FOUND" });
    }
    const existing = await ctx.db
      .query("routeCustomers")
      .withIndex("by_route", (q) => q.eq("routeId", args.routeId))
      .collect();
    if (existing.some((rc) => rc.customerId === args.customerId)) {
      throw new ConvexError({ message: "Ushbu mijoz allaqachon marshrutda mavjud", code: "CONFLICT" });
    }
    const sortOrder = existing.length + 1;
    return ctx.db.insert("routeCustomers", { ...args, sortOrder, companyId: tenantId });
  },
});

export const removeCustomerFromRoute = mutation({
  args: { id: v.id("routeCustomers") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccess(ctx);
    const rc = await ctx.db.get(args.id);
    if (!rc || rc.companyId !== tenantId) {
      throw new ConvexError({ message: "Topilmadi", code: "NOT_FOUND" });
    }
    await ctx.db.delete(args.id);
  },
});

// ─── Route Visits ─────────────────────────────────────────────────────────────

export const listVisits = query({
  args: { routeId: v.optional(v.id("distributionRoutes")), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    let visits;
    if (args.routeId) {
      // First verify the route belongs to this tenant
      const route = await ctx.db.get(args.routeId);
      if (!route || route.companyId !== tenantId) return [];
      visits = await ctx.db.query("routeVisits")
        .withIndex("by_route", (q) => q.eq("routeId", args.routeId!))
        .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
        .order("desc").take(args.limit ?? 50);
    } else {
      visits = await ctx.db.query("routeVisits")
        .withIndex("by_company", (q) => q.eq("companyId", tenantId))
        .order("desc").take(args.limit ?? 50);
    }
    return Promise.all(visits.map(async (v) => {
      const route = await ctx.db.get(v.routeId);
      const rep = v.salesRepId ? await ctx.db.get(v.salesRepId) : undefined;
      return { ...v, routeName: route?.name, repName: rep?.name };
    }));
  },
});

export const createVisit = mutation({
  args: {
    routeId: v.id("distributionRoutes"),
    salesRepId: v.optional(v.id("salesReps")),
    date: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    // Verify route belongs to this tenant
    const route = await ctx.db.get(args.routeId);
    if (!route || route.companyId !== tenantId) {
      throw new ConvexError({ message: "Marshrut topilmadi", code: "NOT_FOUND" });
    }
    return ctx.db.insert("routeVisits", {
      ...args, status: "planned", customersVisited: 0,
      ordersCreated: 0, totalAmount: 0, companyId: tenantId,
    });
  },
});

export const updateVisit = mutation({
  args: {
    id: v.id("routeVisits"),
    status: v.optional(v.union(
      v.literal("planned"), v.literal("in_progress"),
      v.literal("completed"), v.literal("cancelled"),
    )),
    customersVisited: v.optional(v.number()),
    ordersCreated: v.optional(v.number()),
    totalAmount: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccess(ctx);
    const visit = await ctx.db.get(args.id);
    if (!visit || visit.companyId !== tenantId) {
      throw new ConvexError({ message: "Tashrif topilmadi", code: "NOT_FOUND" });
    }
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

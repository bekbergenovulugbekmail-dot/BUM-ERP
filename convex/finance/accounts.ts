/**
 * Finance / Chart of Accounts — fully tenant-scoped.
 *
 * SECURITY:
 *   - Every query filters strictly by companyId === tenantId
 *   - Every mutation verifies ownership before patching/deleting
 *   - seedDefaultAccounts creates accounts scoped to the caller's company
 *   - Orphaned legacy accounts (no companyId) are NEVER returned to tenants
 */
import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server.js";
import { getTenantId, requireTenantAccess, requireTenantAccessForWrite, requirePermission } from "../tenant.ts";

const DEFAULT_ACCOUNTS = [
  { code: "1010", name: "Naqd kassa",           type: "asset"     as const, subtype: "cash",       balance: 0 },
  { code: "1020", name: "Bank hisobi",           type: "asset"     as const, subtype: "bank",       balance: 0 },
  { code: "1100", name: "Debitorlar",            type: "asset"     as const, subtype: "receivable", balance: 0 },
  { code: "1200", name: "Tovar zaxirasi",        type: "asset"     as const, subtype: "inventory",  balance: 0 },
  { code: "2000", name: "Kreditorlar",           type: "liability" as const, subtype: "payable",    balance: 0 },
  { code: "2100", name: "Qisqa muddatli qarzlar",type: "liability" as const, subtype: "short_debt", balance: 0 },
  { code: "3000", name: "Ustav kapitali",        type: "equity"    as const, subtype: "capital",    balance: 0 },
  { code: "4000", name: "Sotuv daromadi",        type: "income"    as const, subtype: "sales",      balance: 0 },
  { code: "4100", name: "Boshqa daromadlar",     type: "income"    as const, subtype: "other",      balance: 0 },
  { code: "5000", name: "Tovar tannarxi",        type: "expense"   as const, subtype: "cogs",       balance: 0 },
  { code: "5100", name: "Ish haqi xarajatlari",  type: "expense"   as const, subtype: "salary",     balance: 0 },
  { code: "5200", name: "Ijara xarajatlari",     type: "expense"   as const, subtype: "rent",       balance: 0 },
  { code: "5300", name: "Kommunal to'lovlar",    type: "expense"   as const, subtype: "utilities",  balance: 0 },
  { code: "5400", name: "Transport xarajatlari", type: "expense"   as const, subtype: "transport",  balance: 0 },
  { code: "5500", name: "Boshqa xarajatlar",     type: "expense"   as const, subtype: "other",      balance: 0 },
];

// ── Queries ──────────────────────────────────────────────────────────────────

export const list = query({
  args: { type: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    // SECURITY: strict tenant filter — orphaned accounts never returned
    if (args.type) {
      return ctx.db
        .query("accounts")
        .withIndex("by_type", (q) =>
          q.eq("type", args.type as "asset" | "liability" | "equity" | "income" | "expense")
        )
        .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
        .collect();
    }
    return ctx.db
      .query("accounts")
      .withIndex("by_code")
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .collect();
  },
});

// ── Mutations ────────────────────────────────────────────────────────────────

/**
 * Seeds the default chart of accounts for the caller's company.
 * Idempotent — skips if accounts already exist for this company.
 * Also seeds default cash accounts.
 */
export const seedDefaultAccounts = mutation({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenantAccess(ctx);

    // Check for existing accounts for THIS company only
    const existing = await ctx.db
      .query("accounts")
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .first();
    if (existing) return { message: "Already seeded" };

    const company = await ctx.db.get(tenantId);
    const currency = company?.currency ?? "UZS";

    for (const acct of DEFAULT_ACCOUNTS) {
      await ctx.db.insert("accounts", {
        ...acct,
        currency,
        isActive: true,
        companyId: tenantId,
      });
    }

    // Also seed default cash accounts for this company
    const cashExists = await ctx.db
      .query("cashAccounts")
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .first();
    if (!cashExists) {
      await ctx.db.insert("cashAccounts", {
        name: "Asosiy kassa",
        type: "cash",
        currency,
        balance: 0,
        isDefault: true,
        isActive: true,
        companyId: tenantId,
      });
      await ctx.db.insert("cashAccounts", {
        name: "Asosiy bank hisobi",
        type: "bank",
        currency,
        bankName: "Xalq banki",
        balance: 0,
        isDefault: false,
        isActive: true,
        companyId: tenantId,
      });
    }

    return { message: "Seeded" };
  },
});

export const create = mutation({
  args: {
    code: v.string(),
    name: v.string(),
    type: v.union(
      v.literal("asset"), v.literal("liability"), v.literal("equity"),
      v.literal("income"), v.literal("expense"),
    ),
    subtype: v.optional(v.string()),
    currency: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "finance.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);

    // Check uniqueness within this company only
    const exists = await ctx.db
      .query("accounts")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .first();
    if (exists) {
      throw new ConvexError({ message: "Bu kod allaqachon mavjud", code: "CONFLICT" });
    }

    const company = await ctx.db.get(tenantId);
    return ctx.db.insert("accounts", {
      code: args.code,
      name: args.name,
      type: args.type,
      subtype: args.subtype,
      currency: args.currency ?? company?.currency ?? "UZS",
      isActive: true,
      balance: 0,
      description: args.description,
      companyId: tenantId,
    });
  },
});

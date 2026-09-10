import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("units").collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    shortName: v.string(),
    isBase: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("units", args);
  },
});

export const listConversions = query({
  args: { productId: v.optional(v.id("products")) },
  handler: async (ctx, args) => {
    if (args.productId) {
      return await ctx.db
        .query("unitConversions")
        .withIndex("by_product", (q) => q.eq("productId", args.productId))
        .collect();
    }
    return await ctx.db.query("unitConversions").collect();
  },
});

export const addConversion = mutation({
  args: {
    fromUnitId: v.id("units"),
    toUnitId: v.id("units"),
    factor: v.number(),
    productId: v.optional(v.id("products")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("unitConversions", args);
  },
});

export const seedDefaultUnits = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("units").first();
    if (existing) return "already seeded";
    const defaults = [
      { name: "Dona", shortName: "d", isBase: true },
      { name: "Kilogramm", shortName: "kg", isBase: true },
      { name: "Litr", shortName: "l", isBase: true },
      { name: "Metr", shortName: "m", isBase: true },
      { name: "Quti", shortName: "qt", isBase: false },
      { name: "Blok", shortName: "bl", isBase: false },
      { name: "Pallet", shortName: "pal", isBase: false },
      { name: "Gramm", shortName: "g", isBase: false },
      { name: "Millilitr", shortName: "ml", isBase: false },
    ];
    for (const u of defaults) {
      await ctx.db.insert("units", u);
    }
    return "seeded";
  },
});

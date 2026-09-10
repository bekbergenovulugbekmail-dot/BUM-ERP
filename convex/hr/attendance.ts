import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel.d.ts";
import { getTenantId, requireTenantAccessForWrite, requirePermission } from "../tenant.ts";

export const listAttendance = query({
  args: {
    employeeId: v.optional(v.id("employees")),
    month: v.optional(v.string()), // YYYY-MM
    date: v.optional(v.string()),  // YYYY-MM-DD
  },
  handler: async (ctx, args): Promise<(Doc<"attendances"> & { employeeName?: string; departmentName?: string })[]> => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    let records: Doc<"attendances">[];

    if (args.employeeId) {
      // Verify the employee belongs to this company
      const emp = await ctx.db.get(args.employeeId);
      if (!emp || emp.companyId !== tenantId) return [];

      records = await ctx.db
        .query("attendances")
        .withIndex("by_employee", (q) => q.eq("employeeId", args.employeeId!))
        .order("desc")
        .take(100);
      // Strict tenant filter
      records = records.filter((r) => r.companyId === tenantId);
    } else if (args.date) {
      records = await ctx.db
        .query("attendances")
        .withIndex("by_date", (q) => q.eq("date", args.date!))
        .collect();
      records = records.filter((r) => r.companyId === tenantId);
    } else {
      // Use company index for tenant-scoped list
      records = await ctx.db
        .query("attendances")
        .withIndex("by_company", (q) => q.eq("companyId", tenantId))
        .order("desc")
        .take(200);
    }

    // Filter by month if provided
    if (args.month) {
      records = records.filter((r) => r.date.startsWith(args.month!));
    }

    return Promise.all(
      records.map(async (r) => {
        const emp = await ctx.db.get(r.employeeId);
        const dept = emp?.departmentId ? await ctx.db.get(emp.departmentId) : null;
        return { ...r, employeeName: emp?.name, departmentName: dept?.name };
      })
    );
  },
});

export const getMonthlyStats = query({
  args: { month: v.string() }, // YYYY-MM
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return { total: 0, present: 0, absent: 0, late: 0, onLeave: 0, totalHours: 0, totalOvertime: 0 };

    // Scope to tenant by company index, then filter by month
    const allCompanyRecords = await ctx.db
      .query("attendances")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
    const monthRecords = allCompanyRecords.filter((r) => r.date.startsWith(args.month));

    return {
      total: monthRecords.length,
      present: monthRecords.filter((r) => r.status === "present").length,
      absent: monthRecords.filter((r) => r.status === "absent").length,
      late: monthRecords.filter((r) => r.status === "late").length,
      onLeave: monthRecords.filter((r) => r.status === "on_leave").length,
      totalHours: monthRecords.reduce((s, r) => s + r.workHours, 0),
      totalOvertime: monthRecords.reduce((s, r) => s + r.overtime, 0),
    };
  },
});

export const recordAttendance = mutation({
  args: {
    employeeId: v.id("employees"),
    date: v.string(),
    checkIn: v.optional(v.string()),
    checkOut: v.optional(v.string()),
    workHours: v.number(),
    overtime: v.optional(v.number()),
    status: v.union(
      v.literal("present"), v.literal("absent"), v.literal("late"),
      v.literal("half_day"), v.literal("holiday"), v.literal("on_leave"),
    ),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"attendances">> => {
    await requirePermission(ctx, "hr.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);

    // SECURITY: verify the employee belongs to this company
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Xodim topilmadi" });
    }

    // Upsert — check existing
    const existing = await ctx.db
      .query("attendances")
      .withIndex("by_employee_date", (q) => q.eq("employeeId", args.employeeId).eq("date", args.date))
      .first();

    if (existing) {
      // Verify ownership before patching
      if (existing.companyId !== tenantId) {
        throw new ConvexError({ code: "FORBIDDEN", message: "Ruxsat etilmagan" });
      }
      await ctx.db.patch(existing._id, {
        checkIn: args.checkIn,
        checkOut: args.checkOut,
        workHours: args.workHours,
        overtime: args.overtime ?? 0,
        status: args.status,
        notes: args.notes,
      });
      return existing._id;
    }

    return ctx.db.insert("attendances", {
      ...args,
      overtime: args.overtime ?? 0,
      companyId: tenantId,
    });
  },
});

export const bulkRecordAttendance = mutation({
  args: {
    date: v.string(),
    records: v.array(v.object({
      employeeId: v.id("employees"),
      status: v.union(
        v.literal("present"), v.literal("absent"), v.literal("late"),
        v.literal("half_day"), v.literal("holiday"), v.literal("on_leave"),
      ),
      checkIn: v.optional(v.string()),
      checkOut: v.optional(v.string()),
      workHours: v.optional(v.number()),
      overtime: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args): Promise<number> => {
    await requirePermission(ctx, "hr.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);

    let processed = 0;
    for (const rec of args.records) {
      // SECURITY: verify each employee belongs to this company
      const employee = await ctx.db.get(rec.employeeId);
      if (!employee || employee.companyId !== tenantId) continue; // skip cross-tenant employees silently

      const existing = await ctx.db
        .query("attendances")
        .withIndex("by_employee_date", (q) => q.eq("employeeId", rec.employeeId).eq("date", args.date))
        .first();

      const workHours = rec.workHours ?? (rec.status === "present" ? 8 : rec.status === "half_day" ? 4 : 0);

      if (existing) {
        // Only patch if owned by this company
        if (existing.companyId !== tenantId) continue;
        await ctx.db.patch(existing._id, {
          status: rec.status,
          checkIn: rec.checkIn,
          checkOut: rec.checkOut,
          workHours,
          overtime: rec.overtime ?? 0,
        });
      } else {
        await ctx.db.insert("attendances", {
          employeeId: rec.employeeId,
          date: args.date,
          checkIn: rec.checkIn,
          checkOut: rec.checkOut,
          workHours,
          overtime: rec.overtime ?? 0,
          status: rec.status,
          companyId: tenantId,
        });
      }
      processed++;
    }
    return processed;
  },
});

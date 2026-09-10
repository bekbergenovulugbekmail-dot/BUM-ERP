import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel.d.ts";
import { getTenantId, requireTenantAccessForWrite, requirePermission } from "../tenant.ts";

export const listSalaryPayments = query({
  args: {
    month: v.optional(v.string()),
    employeeId: v.optional(v.id("employees")),
    status: v.optional(v.union(v.literal("draft"), v.literal("approved"), v.literal("paid"))),
  },
  handler: async (ctx, args): Promise<(Doc<"salaryPayments"> & { employeeName?: string; departmentName?: string; positionName?: string })[]> => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    let payments: Doc<"salaryPayments">[];

    if (args.employeeId) {
      // Verify employee belongs to this company
      const emp = await ctx.db.get(args.employeeId);
      if (!emp || emp.companyId !== tenantId) return [];

      payments = await ctx.db
        .query("salaryPayments")
        .withIndex("by_employee", (q) => q.eq("employeeId", args.employeeId!))
        .order("desc")
        .take(50);
      payments = payments.filter((p) => p.companyId === tenantId);
    } else if (args.month) {
      // Use company+month scope
      payments = await ctx.db
        .query("salaryPayments")
        .withIndex("by_company_month", (q) => q.eq("companyId", tenantId).eq("month", args.month!))
        .collect();
    } else {
      payments = await ctx.db
        .query("salaryPayments")
        .withIndex("by_company", (q) => q.eq("companyId", tenantId))
        .order("desc")
        .take(100);
    }

    if (args.status) {
      payments = payments.filter((p) => p.status === args.status);
    }

    return Promise.all(
      payments.map(async (p) => {
        const emp = await ctx.db.get(p.employeeId);
        const dept = emp?.departmentId ? await ctx.db.get(emp.departmentId) : null;
        const pos = emp?.positionId ? await ctx.db.get(emp.positionId) : null;
        return { ...p, employeeName: emp?.name, departmentName: dept?.name, positionName: pos?.name };
      })
    );
  },
});

export const getMonthSummary = query({
  args: { month: v.string() },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return { total: 0, paid: 0, totalGross: 0, totalNet: 0, totalTax: 0, totalBonus: 0 };

    const payments = await ctx.db
      .query("salaryPayments")
      .withIndex("by_company_month", (q) => q.eq("companyId", tenantId).eq("month", args.month))
      .collect();

    return {
      total: payments.length,
      paid: payments.filter((p) => p.status === "paid").length,
      totalGross: payments.reduce((s, p) => s + p.baseSalary + p.bonus, 0),
      totalNet: payments.reduce((s, p) => s + p.netSalary, 0),
      totalTax: payments.reduce((s, p) => s + p.tax, 0),
      totalBonus: payments.reduce((s, p) => s + p.bonus, 0),
    };
  },
});

export const generateMonthlySalary = mutation({
  args: {
    month: v.string(), // YYYY-MM
    taxRate: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<number> => {
    await requirePermission(ctx, "hr.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);

    const taxRate = args.taxRate ?? 0.12;

    // SECURITY: only get active employees for THIS company
    const employees = await ctx.db
      .query("employees")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
    const activeEmployees = employees.filter((e) => e.status === "active");

    // Only fetch attendance for this company
    const allAttendance = await ctx.db
      .query("attendances")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
    const monthAttendance = allAttendance.filter((a) => a.date.startsWith(args.month));

    let created = 0;
    for (const emp of activeEmployees) {
      // Skip if already generated for this company+employee+month
      const existing = await ctx.db
        .query("salaryPayments")
        .withIndex("by_employee_month", (q) => q.eq("employeeId", emp._id).eq("month", args.month))
        .first();
      if (existing && existing.companyId === tenantId) continue;

      const empAttendance = monthAttendance.filter((a) => a.employeeId === emp._id);
      const workDays = 26;
      const actualDays = empAttendance.filter((a) => ["present", "late"].includes(a.status)).length;
      const totalOvertime = empAttendance.reduce((s, a) => s + a.overtime, 0);

      const dailyRate = emp.baseSalary / workDays;
      const earnedSalary = dailyRate * actualDays;
      const overtimePay = (emp.baseSalary / workDays / 8) * 1.5 * totalOvertime;
      const gross = earnedSalary + overtimePay;
      const tax = gross * taxRate;
      const netSalary = gross - tax;

      await ctx.db.insert("salaryPayments", {
        employeeId: emp._id,
        month: args.month,
        baseSalary: emp.baseSalary,
        workDays,
        actualDays: actualDays || workDays,
        overtime: totalOvertime,
        overtimePay,
        bonus: 0,
        deductions: 0,
        tax,
        netSalary,
        status: "draft",
        companyId: tenantId,
      });
      created++;
    }
    return created;
  },
});

export const updateSalaryPayment = mutation({
  args: {
    id: v.id("salaryPayments"),
    bonus: v.optional(v.number()),
    deductions: v.optional(v.number()),
    notes: v.optional(v.string()),
    status: v.optional(v.union(v.literal("draft"), v.literal("approved"), v.literal("paid"))),
    paidDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "hr.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);

    const current = await ctx.db.get(args.id);
    if (!current || current.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Topilmadi" });
    }

    const { id, ...fields } = args;
    if (fields.bonus !== undefined || fields.deductions !== undefined) {
      const bonus = fields.bonus ?? current.bonus;
      const deductions = fields.deductions ?? current.deductions;
      const gross = (current.baseSalary / current.workDays) * current.actualDays + current.overtimePay + bonus;
      const tax = gross * 0.12;
      const netSalary = gross - tax - deductions;
      await ctx.db.patch(id, { ...fields, tax, netSalary });
    } else {
      await ctx.db.patch(id, fields);
    }
  },
});

export const approveSalaryPayment = mutation({
  args: { id: v.id("salaryPayments") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "hr.approve");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const payment = await ctx.db.get(args.id);
    if (!payment || payment.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Topilmadi" });
    }
    await ctx.db.patch(args.id, { status: "approved" });
  },
});

export const markSalaryPaid = mutation({
  args: {
    id: v.id("salaryPayments"),
    paidDate: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "hr.approve");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const payment = await ctx.db.get(args.id);
    if (!payment || payment.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Topilmadi" });
    }
    if (payment.status !== "approved") {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Faqat tasdiqlangan maoshni to'langan deb belgilash mumkin" });
    }
    await ctx.db.patch(args.id, { status: "paid", paidDate: args.paidDate });
  },
});

// ─── LEAVES ──────────────────────────────────────────────────────────────────

export const listLeaves = query({
  args: {
    employeeId: v.optional(v.id("employees")),
    status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"))),
  },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    let leaves: Doc<"leaves">[];

    if (args.employeeId) {
      // Verify employee belongs to this company
      const emp = await ctx.db.get(args.employeeId);
      if (!emp || emp.companyId !== tenantId) return [];

      leaves = await ctx.db
        .query("leaves")
        .withIndex("by_employee", (q) => q.eq("employeeId", args.employeeId!))
        .order("desc")
        .take(50);
      leaves = leaves.filter((l) => l.companyId === tenantId);
    } else if (args.status) {
      leaves = await ctx.db
        .query("leaves")
        .withIndex("by_company_status", (q) => q.eq("companyId", tenantId).eq("status", args.status!))
        .take(100);
    } else {
      leaves = await ctx.db
        .query("leaves")
        .withIndex("by_company", (q) => q.eq("companyId", tenantId))
        .order("desc")
        .take(100);
    }

    return Promise.all(
      leaves.map(async (l) => {
        const emp = await ctx.db.get(l.employeeId);
        return { ...l, employeeName: emp?.name };
      })
    );
  },
});

export const createLeave = mutation({
  args: {
    employeeId: v.id("employees"),
    type: v.union(
      v.literal("annual"), v.literal("sick"), v.literal("unpaid"),
      v.literal("maternity"), v.literal("other"),
    ),
    startDate: v.string(),
    endDate: v.string(),
    days: v.number(),
    reason: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"leaves">> => {
    await requirePermission(ctx, "hr.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);

    // SECURITY: verify employee belongs to this company
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Xodim topilmadi" });
    }

    return ctx.db.insert("leaves", { ...args, status: "pending", companyId: tenantId });
  },
});

export const updateLeaveStatus = mutation({
  args: {
    id: v.id("leaves"),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    approvedBy: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "hr.approve");
    const tenantId = await requireTenantAccessForWrite(ctx);

    const leave = await ctx.db.get(args.id);
    if (!leave || leave.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Topilmadi" });
    }

    await ctx.db.patch(args.id, { status: args.status, approvedBy: args.approvedBy });

    // Update employee status if approved leave
    if (args.status === "approved") {
      const today = new Date().toISOString().slice(0, 10);
      if (leave.startDate <= today && leave.endDate >= today) {
        // Verify employee belongs to this company before patching
        const employee = await ctx.db.get(leave.employeeId);
        if (employee && employee.companyId === tenantId) {
          await ctx.db.patch(leave.employeeId, { status: "on_leave" });
        }
      }
    }
  },
});

/**
 * HR — Departments, Positions, Employees — fully tenant-scoped.
 */
import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Doc } from "../_generated/dataModel.d.ts";
import { getTenantId, requireTenantAccess, requireTenantAccessForWrite, requirePermission } from "../tenant.ts";

// ─── DEPARTMENTS ─────────────────────────────────────────────────────────────

export const listDepartments = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    return ctx.db.query("departments")
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .collect();
  },
});

export const createDepartment = mutation({
  args: {
    name: v.string(),
    code: v.string(),
    parentId: v.optional(v.id("departments")),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "hr.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const exists = await ctx.db
      .query("departments")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .first();
    if (exists) throw new ConvexError({ message: "Bu kod allaqachon mavjud", code: "CONFLICT" });
    return ctx.db.insert("departments", {
      name: args.name,
      code: args.code,
      parentId: args.parentId,
      isActive: args.isActive ?? true,
      companyId: tenantId,
    });
  },
});

export const updateDepartment = mutation({
  args: {
    id: v.id("departments"),
    name: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "hr.manage");
    const tenantId = await requireTenantAccess(ctx);
    const dept = await ctx.db.get(args.id);
    if (!dept || dept.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Bo'lim topilmadi" });
    }
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const deleteDepartment = mutation({
  args: { id: v.id("departments") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "hr.manage");
    const tenantId = await requireTenantAccess(ctx);
    const dept = await ctx.db.get(args.id);
    if (!dept || dept.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Bo'lim topilmadi" });
    }
    await ctx.db.delete(args.id);
  },
});

// ─── POSITIONS ───────────────────────────────────────────────────────────────

export const listPositions = query({
  args: { departmentId: v.optional(v.id("departments")) },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    const positions = args.departmentId
      ? await ctx.db.query("positions")
          .withIndex("by_department", (q) => q.eq("departmentId", args.departmentId!))
          .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
          .collect()
      : await ctx.db.query("positions")
          .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
          .collect();
    return Promise.all(
      positions.map(async (p) => {
        const dept = await ctx.db.get(p.departmentId);
        return { ...p, departmentName: dept?.name };
      })
    );
  },
});

export const createPosition = mutation({
  args: {
    name: v.string(),
    departmentId: v.id("departments"),
    level: v.optional(v.string()),
    minSalary: v.optional(v.number()),
    maxSalary: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "hr.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    // Verify department belongs to this tenant
    const dept = await ctx.db.get(args.departmentId);
    if (!dept || dept.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Bo'lim topilmadi" });
    }
    return ctx.db.insert("positions", { ...args, isActive: true, companyId: tenantId });
  },
});

export const deletePosition = mutation({
  args: { id: v.id("positions") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "hr.manage");
    const tenantId = await requireTenantAccess(ctx);
    const pos = await ctx.db.get(args.id);
    if (!pos || pos.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Lavozim topilmadi" });
    }
    await ctx.db.delete(args.id);
  },
});

// ─── EMPLOYEES ───────────────────────────────────────────────────────────────

export const listEmployees = query({
  args: {
    departmentId: v.optional(v.id("departments")),
    status: v.optional(v.union(v.literal("active"), v.literal("on_leave"), v.literal("terminated"))),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<(Doc<"employees"> & {
    departmentName?: string;
    positionName?: string;
  })[]> => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    let employees: Doc<"employees">[];
    if (args.search) {
      employees = await ctx.db
        .query("employees")
        .withSearchIndex("search_name", (q) =>
          q.search("name", args.search!).eq("companyId", tenantId)
        )
        .take(100);
    } else if (args.departmentId) {
      employees = await ctx.db
        .query("employees")
        .withIndex("by_department", (q) => q.eq("departmentId", args.departmentId!))
        .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
        .collect();
    } else if (args.status) {
      employees = await ctx.db
        .query("employees")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
        .collect();
    } else {
      employees = await ctx.db.query("employees")
        .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
        .order("desc").take(200);
    }

    return Promise.all(
      employees.map(async (emp) => {
        const [dept, pos] = await Promise.all([
          emp.departmentId ? ctx.db.get(emp.departmentId) : null,
          emp.positionId ? ctx.db.get(emp.positionId) : null,
        ]);
        return { ...emp, departmentName: dept?.name, positionName: pos?.name };
      })
    );
  },
});

export const getEmployee = query({
  args: { id: v.id("employees") },
  handler: async (ctx, args): Promise<(Doc<"employees"> & {
    departmentName?: string;
    positionName?: string;
    managerName?: string;
  }) | null> => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return null;
    const emp = await ctx.db.get(args.id);
    if (!emp) return null;
    // SECURITY: verify ownership
    if (emp.companyId !== tenantId) return null;
    const [dept, pos, mgr] = await Promise.all([
      emp.departmentId ? ctx.db.get(emp.departmentId) : null,
      emp.positionId ? ctx.db.get(emp.positionId) : null,
      emp.managerId ? ctx.db.get(emp.managerId) : null,
    ]);
    return { ...emp, departmentName: dept?.name, positionName: pos?.name, managerName: mgr?.name };
  },
});

export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return { total: 0, active: 0, onLeave: 0, terminated: 0, totalSalary: 0 };
    const employees = await ctx.db.query("employees")
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .collect();
    const total = employees.length;
    const active = employees.filter((e) => e.status === "active").length;
    const onLeave = employees.filter((e) => e.status === "on_leave").length;
    const terminated = employees.filter((e) => e.status === "terminated").length;
    const totalSalary = employees
      .filter((e) => e.status === "active")
      .reduce((s, e) => s + e.baseSalary, 0);
    return { total, active, onLeave, terminated, totalSalary };
  },
});

export const createEmployee = mutation({
  args: {
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    departmentId: v.optional(v.id("departments")),
    positionId: v.optional(v.id("positions")),
    managerId: v.optional(v.id("employees")),
    hireDate: v.string(),
    birthDate: v.optional(v.string()),
    gender: v.optional(v.union(v.literal("male"), v.literal("female"))),
    address: v.optional(v.string()),
    passportNumber: v.optional(v.string()),
    inn: v.optional(v.string()),
    baseSalary: v.number(),
    salaryType: v.union(v.literal("monthly"), v.literal("hourly"), v.literal("daily")),
    bankAccount: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "hr.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    // Generate code scoped to this company
    const lastEmp = await ctx.db.query("employees")
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .order("desc").first();
    let code = "EMP-0001";
    if (lastEmp) {
      const match = lastEmp.code.match(/EMP-(\d+)/);
      const n = match ? parseInt(match[1]) + 1 : 1;
      code = `EMP-${String(n).padStart(4, "0")}`;
    }
    return ctx.db.insert("employees", { ...args, code, status: "active", companyId: tenantId });
  },
});

export const updateEmployee = mutation({
  args: {
    id: v.id("employees"),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    departmentId: v.optional(v.id("departments")),
    positionId: v.optional(v.id("positions")),
    managerId: v.optional(v.id("employees")),
    baseSalary: v.optional(v.number()),
    salaryType: v.optional(v.union(v.literal("monthly"), v.literal("hourly"), v.literal("daily"))),
    status: v.optional(v.union(v.literal("active"), v.literal("on_leave"), v.literal("terminated"))),
    address: v.optional(v.string()),
    birthDate: v.optional(v.string()),
    bankAccount: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "hr.manage");
    const tenantId = await requireTenantAccess(ctx);
    const emp = await ctx.db.get(args.id);
    if (!emp || emp.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Xodim topilmadi" });
    }
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const deleteEmployee = mutation({
  args: { id: v.id("employees") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "hr.manage");
    const tenantId = await requireTenantAccess(ctx);
    const emp = await ctx.db.get(args.id);
    if (!emp || emp.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Xodim topilmadi" });
    }
    await ctx.db.delete(args.id);
  },
});

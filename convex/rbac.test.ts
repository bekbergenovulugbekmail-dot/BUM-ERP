/// <reference types="vite/client" />
/**
 * RBAC security regression tests: role and membership management cannot be
 * used for self-escalation or to touch other companies / global roles.
 */
import { convexTest, type TestConvex as TestConvexOf } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { DEFAULT_ROLES } from "../src/lib/permissions";

const modules = import.meta.glob("./**/*.ts");

type TestConvex = TestConvexOf<typeof schema>;

async function setupCompany(t: TestConvex, name: string) {
  return t.run(async (ctx) => {
    const companyId = await ctx.db.insert("companies", {
      name,
      country: "UZ",
      currency: "UZS",
      isDefault: false,
      isActive: true,
      status: "active",
    });
    for (const role of DEFAULT_ROLES) {
      await ctx.db.insert("roles", {
        name: role.name,
        description: role.description,
        color: role.color,
        permissions: [...role.permissions],
        isSystem: role.isSystem,
        isActive: true,
        memberCount: 0,
        companyId,
      });
    }
    const branchId = await ctx.db.insert("branches", {
      companyId,
      name: "Asosiy filial",
      code: "BR-001",
      isDefault: true,
      isActive: true,
    });
    return { companyId, branchId };
  });
}

async function addMember(t: TestConvex, companyId: Id<"companies">, companyRole: string) {
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: companyRole, isActive: true, activeCompanyId: companyId });
    const memberId = await ctx.db.insert("companyMembers", {
      companyId,
      userId,
      companyRole,
      isActive: true,
      joinedAt: new Date().toISOString(),
    });
    return { userId, memberId };
  });
  return { ...ids, as: t.withIdentity({ subject: `${ids.userId}|test-session` }) };
}

async function roleIdOf(t: TestConvex, companyId: Id<"companies"> | undefined, name: string) {
  const role = await t.run((ctx) =>
    ctx.db
      .query("roles")
      .withIndex("by_company_name", (q) => q.eq("companyId", companyId).eq("name", name))
      .first(),
  );
  return role!._id;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ data: expect.objectContaining({ code }) });
}

describe("admin.updateRole", () => {
  test("member without roles.manage cannot edit roles", async () => {
    const t = convexTest(schema, modules);
    const { companyId } = await setupCompany(t, "A");
    const kassir = await addMember(t, companyId, "Kassir");
    const kassirRole = await roleIdOf(t, companyId, "Kassir");
    await expectCode(
      kassir.as.mutation(api.admin.updateRole, { id: kassirRole, permissions: ["company.manage"] }),
      "FORBIDDEN",
    );
  });

  test("global roles and other companies' roles cannot be edited, even by the owner", async () => {
    const t = convexTest(schema, modules);
    const a = await setupCompany(t, "A");
    const b = await setupCompany(t, "B");
    const owner = await addMember(t, a.companyId, "Business Owner");
    const globalRole = await t.run((ctx) =>
      ctx.db.insert("roles", {
        name: "Kassir",
        permissions: ["pos.use"],
        isSystem: true,
        isActive: true,
        memberCount: 0,
      }),
    );

    await expectCode(
      owner.as.mutation(api.admin.updateRole, { id: globalRole, permissions: ["pos.use", "company.manage"] }),
      "FORBIDDEN",
    );
    await expectCode(
      owner.as.mutation(api.admin.updateRole, {
        id: await roleIdOf(t, b.companyId, "Kassir"),
        permissions: ["company.manage"],
      }),
      "FORBIDDEN",
    );
    const unchanged = await t.run((ctx) => ctx.db.get(globalRole));
    expect(unchanged!.permissions).toEqual(["pos.use"]);
  });

  test("a role manager cannot add permissions they do not hold (no self-escalation)", async () => {
    const t = convexTest(schema, modules);
    const { companyId } = await setupCompany(t, "A");
    const owner = await addMember(t, companyId, "Business Owner");
    await owner.as.mutation(api.admin.createRole, {
      name: "Rol menejeri",
      permissions: ["roles.manage", "users.view"],
    });
    const manager = await addMember(t, companyId, "Rol menejeri");
    const ownRole = await roleIdOf(t, companyId, "Rol menejeri");

    await expectCode(
      manager.as.mutation(api.admin.updateRole, {
        id: ownRole,
        permissions: ["roles.manage", "users.view", "company.manage"],
      }),
      "FORBIDDEN",
    );
    // Removing / keeping own permissions is fine
    await manager.as.mutation(api.admin.updateRole, { id: ownRole, permissions: ["roles.manage"] });
  });

  test("owner edits company role; unknown permissions rejected; system role cannot be renamed", async () => {
    const t = convexTest(schema, modules);
    const { companyId } = await setupCompany(t, "A");
    const owner = await addMember(t, companyId, "Business Owner");
    const kassirRole = await roleIdOf(t, companyId, "Kassir");

    await owner.as.mutation(api.admin.updateRole, { id: kassirRole, permissions: ["pos.use", "crm.view"] });
    expect((await t.run((ctx) => ctx.db.get(kassirRole)))!.permissions).toEqual(["pos.use", "crm.view"]);

    await expectCode(
      owner.as.mutation(api.admin.updateRole, { id: kassirRole, permissions: ["hamma.narsa"] }),
      "BAD_REQUEST",
    );
    await expectCode(owner.as.mutation(api.admin.updateRole, { id: kassirRole, name: "Sotuvchi" }), "FORBIDDEN");
    await expectCode(
      owner.as.mutation(api.admin.updateRole, {
        id: await roleIdOf(t, companyId, "Business Owner"),
        permissions: ["pos.use"],
      }),
      "FORBIDDEN",
    );
  });

  test("renaming a custom role keeps memberships in sync", async () => {
    const t = convexTest(schema, modules);
    const { companyId } = await setupCompany(t, "A");
    const owner = await addMember(t, companyId, "Business Owner");
    await owner.as.mutation(api.admin.createRole, { name: "Kuryer", permissions: ["sales.view"] });
    const courier = await addMember(t, companyId, "Kuryer");

    await owner.as.mutation(api.admin.updateRole, { id: await roleIdOf(t, companyId, "Kuryer"), name: "Yetkazuvchi" });
    expect((await t.run((ctx) => ctx.db.get(courier.memberId)))!.companyRole).toBe("Yetkazuvchi");
  });
});

describe("admin.createRole / deleteRole", () => {
  test("requires roles.manage; full-access names forbidden; roles in use cannot be deleted", async () => {
    const t = convexTest(schema, modules);
    const { companyId } = await setupCompany(t, "A");
    const owner = await addMember(t, companyId, "Business Owner");
    const kassir = await addMember(t, companyId, "Kassir");

    await expectCode(kassir.as.mutation(api.admin.createRole, { name: "X", permissions: ["pos.use"] }), "FORBIDDEN");
    await expectCode(
      owner.as.mutation(api.admin.createRole, { name: "Superadmin", permissions: ["pos.use"] }),
      "FORBIDDEN",
    );

    const tempRole = await owner.as.mutation(api.admin.createRole, { name: "Vaqtinchalik", permissions: ["pos.use"] });
    await addMember(t, companyId, "Vaqtinchalik");
    await expectCode(owner.as.mutation(api.admin.deleteRole, { id: tempRole }), "CONFLICT");
    await expectCode(
      owner.as.mutation(api.admin.deleteRole, { id: await roleIdOf(t, companyId, "Kassir") }),
      "FORBIDDEN",
    );
  });
});

describe("admin.updateUserRole", () => {
  test("cannot change own role, the owner's role, or grant Superadmin / permissions not held", async () => {
    const t = convexTest(schema, modules);
    const { companyId } = await setupCompany(t, "A");
    const owner = await addMember(t, companyId, "Business Owner");
    const direktor = await addMember(t, companyId, "Direktor");
    const kassir = await addMember(t, companyId, "Kassir");
    await owner.as.mutation(api.admin.createRole, { name: "Rol admin", permissions: ["roles.manage"] });

    const superadmin = await roleIdOf(t, companyId, "Superadmin");
    const omborchi = await roleIdOf(t, companyId, "Omborchi");

    await expectCode(
      kassir.as.mutation(api.admin.updateUserRole, { userId: kassir.userId, roleId: superadmin }),
      "FORBIDDEN",
    );
    await expectCode(
      direktor.as.mutation(api.admin.updateUserRole, { userId: direktor.userId, roleId: omborchi }),
      "FORBIDDEN",
    );
    await expectCode(
      direktor.as.mutation(api.admin.updateUserRole, { userId: kassir.userId, roleId: superadmin }),
      "FORBIDDEN",
    );
    await expectCode(
      direktor.as.mutation(api.admin.updateUserRole, { userId: owner.userId, roleId: omborchi }),
      "FORBIDDEN",
    );
    // Direktor lacks roles.manage, so cannot hand it out
    await expectCode(
      direktor.as.mutation(api.admin.updateUserRole, {
        userId: kassir.userId,
        roleId: await roleIdOf(t, companyId, "Rol admin"),
      }),
      "FORBIDDEN",
    );

    await direktor.as.mutation(api.admin.updateUserRole, { userId: kassir.userId, roleId: omborchi });
    expect((await t.run((ctx) => ctx.db.get(kassir.userId)))!.roleId).toBe(omborchi);
  });
});

describe("companies.updateMember", () => {
  test("a cashier cannot make themselves Business Owner", async () => {
    const t = convexTest(schema, modules);
    const { companyId } = await setupCompany(t, "A");
    const kassir = await addMember(t, companyId, "Kassir");
    await expectCode(
      kassir.as.mutation(api.companies.updateMember, { id: kassir.memberId, companyRole: "Business Owner" }),
      "FORBIDDEN",
    );
    expect((await t.run((ctx) => ctx.db.get(kassir.memberId)))!.companyRole).toBe("Kassir");
  });

  test("users.manage holder cannot grant full access, touch self/owner/other company, or use foreign branch", async () => {
    const t = convexTest(schema, modules);
    const a = await setupCompany(t, "A");
    const b = await setupCompany(t, "B");
    const owner = await addMember(t, a.companyId, "Business Owner");
    const direktor = await addMember(t, a.companyId, "Direktor");
    const kassir = await addMember(t, a.companyId, "Kassir");
    const foreign = await addMember(t, b.companyId, "Kassir");

    const update = (args: {
      id: Id<"companyMembers">;
      companyRole?: string;
      branchId?: Id<"branches">;
      isActive?: boolean;
    }) => direktor.as.mutation(api.companies.updateMember, args);

    await expectCode(update({ id: kassir.memberId, companyRole: "Business Owner" }), "FORBIDDEN");
    await expectCode(update({ id: kassir.memberId, companyRole: "Superadmin" }), "FORBIDDEN");
    await expectCode(update({ id: direktor.memberId, companyRole: "Omborchi" }), "FORBIDDEN");
    await expectCode(update({ id: owner.memberId, isActive: false }), "FORBIDDEN");
    await expectCode(update({ id: foreign.memberId, companyRole: "Omborchi" }), "FORBIDDEN");
    await expectCode(update({ id: kassir.memberId, branchId: b.branchId }), "FORBIDDEN");

    await update({ id: kassir.memberId, companyRole: "Omborchi", branchId: a.branchId });
    const member = await t.run((ctx) => ctx.db.get(kassir.memberId));
    expect(member).toMatchObject({ companyRole: "Omborchi", branchId: a.branchId });
  });
});

describe("admin.toggleUserActive", () => {
  test("cannot block self, the owner, or without users.manage", async () => {
    const t = convexTest(schema, modules);
    const { companyId } = await setupCompany(t, "A");
    const owner = await addMember(t, companyId, "Business Owner");
    const direktor = await addMember(t, companyId, "Direktor");
    const kassir = await addMember(t, companyId, "Kassir");

    await expectCode(
      kassir.as.mutation(api.admin.toggleUserActive, { userId: owner.userId, isActive: false }),
      "FORBIDDEN",
    );
    await expectCode(
      direktor.as.mutation(api.admin.toggleUserActive, { userId: owner.userId, isActive: false }),
      "FORBIDDEN",
    );
    await expectCode(
      direktor.as.mutation(api.admin.toggleUserActive, { userId: direktor.userId, isActive: false }),
      "FORBIDDEN",
    );

    await direktor.as.mutation(api.admin.toggleUserActive, { userId: kassir.userId, isActive: false });
    expect((await t.run((ctx) => ctx.db.get(kassir.userId)))!.isActive).toBe(false);
  });
});

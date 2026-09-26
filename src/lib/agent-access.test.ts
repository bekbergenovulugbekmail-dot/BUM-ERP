import { describe, expect, it } from "vitest";
import type { Permission } from "@bum/shared";
import { isFieldSupervisor } from "./agent-access.ts";

const perms = (...list: string[]) => list as Permission[];

describe("maydondagi supervayzer — 'Sotuv' agent ish joyi", () => {
  it("'Supervayzer' roli: kompaniya sales.create qo'shgan bo'lsa ham — agentdek", () => {
    expect(isFieldSupervisor(perms("sales_agent.use", "sales_agent.supervise", "sales.create", "sales.view"), "Supervayzer")).toBe(true);
  });
  it("Direktor / egasi / sotuv menejeri — oddiy Sotuv", () => {
    expect(isFieldSupervisor(perms("sales_agent.use", "sales_agent.supervise", "sales.create"), "Direktor")).toBe(false);
    expect(isFieldSupervisor(perms("sales_agent.use", "sales_agent.supervise", "sales.create"), "Business Owner")).toBe(false);
    expect(isFieldSupervisor(perms("sales_agent.supervise", "sales.create"), "Savdo menejeri")).toBe(false);
  });
  it("boshqa nomli maydon roli (agent + nazorat, sotuv yaratmaydi) — agentdek; agent ruxsatisiz — yo'q", () => {
    expect(isFieldSupervisor(perms("sales_agent.use", "sales_agent.supervise", "sales.view"), "Operator")).toBe(true);
    expect(isFieldSupervisor(perms("sales_agent.supervise", "sales.view"), "Supervayzer")).toBe(false);
  });
});

/**
 * Sozlamalar → Modullar: ro'yxatda FAQAT yoqilgan modullar turadi.
 * O'chirilgani biznes egasi uchun yo'q hisoblanadi — faqat nechtasini ulash mumkinligi eslatiladi.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CompanyModuleRow } from "./modules-section.tsx";

const modules: CompanyModuleRow[] = [
  {
    key: "products",
    name: "Mahsulotlar",
    description: "Katalog",
    icon: "Package",
    dependsOn: [],
    dependents: [],
    enabled: true,
    enabledAt: null,
    disabledAt: null,
    updatedAt: null,
  },
  {
    key: "manufacturing",
    name: "Ishlab chiqarish",
    description: "Retsept va buyurtma",
    icon: "Factory",
    dependsOn: ["products"],
    dependents: [],
    enabled: false,
    enabledAt: null,
    disabledAt: null,
    updatedAt: null,
  },
  {
    key: "crm",
    name: "CRM",
    description: "Lidlar",
    icon: "UserCheck",
    dependsOn: [],
    dependents: [],
    enabled: false,
    enabledAt: null,
    disabledAt: null,
    updatedAt: null,
  },
];

vi.mock("@/hooks/use-company.ts", () => ({ usePermissions: () => ({ can: () => false }) }));
vi.mock("@/lib/query.ts", () => ({
  useApiQuery: () => ({ data: { modules, history: [] }, isLoading: false }),
  useApiMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { default: ModulesSection } = await import("./modules-section.tsx");

describe("Modullar ro'yxati", () => {
  it("o'chirilgan modullar ro'yxatda turmaydi", () => {
    render(<ModulesSection />);

    expect(screen.getByText("Mahsulotlar")).toBeInTheDocument();
    expect(screen.queryByText("Ishlab chiqarish"), "o'chirilgan modul ko'rinmaydi").not.toBeInTheDocument();
    expect(screen.queryByText("CRM"), "o'chirilgan modul ko'rinmaydi").not.toBeInTheDocument();
    expect(screen.queryByText("O'chirilgan")).not.toBeInTheDocument();
  });

  it("nechta modul ulash mumkinligi eslatiladi", () => {
    render(<ModulesSection />);
    expect(screen.getByText(/Yana 2 ta modulni ulash mumkin/)).toBeInTheDocument();
  });
});

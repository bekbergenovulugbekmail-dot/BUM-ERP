/**
 * Shablon sanitizatsiyasi — bazasiz, sof funksiya darajasida.
 *
 * Bu yerda eng nozik qoida qulflanadi: shablon ichiga MAXFIY ustun (tannarx, marja)
 * ruxsatsiz tushmasligi kerak, hatto foydalanuvchi JSON'ni qo'lda yozib yuborsa ham.
 */
import { describe, expect, it } from "vitest";
import { sanitizeTemplateSchema } from "../src/modules/documents/sanitize.js";

const access = (permissions: string[]) => ({
  documentType: "sales_invoice" as const,
  permissions: new Set(permissions),
});

const tableSchema = {
  schemaVersion: 1,
  sections: [
    {
      key: "body",
      elements: [{ id: "t", type: "itemsTable", columns: [{ key: "name" }, { key: "cost" }, { key: "margin" }] }],
    },
  ],
};

const columnsOf = (result: ReturnType<typeof sanitizeTemplateSchema>) =>
  (result.schema.sections.find((section) => section.key === "body")?.elements[0]?.columns ?? []).map((column) => column.key);

describe("Maxfiy ustun sanitizatsiyada", () => {
  it("`products.view_cost` bo'lmasa tannarx va marja tashlanadi", () => {
    const result = sanitizeTemplateSchema(tableSchema, access([]));
    expect(columnsOf(result)).toEqual(["name"]);
    expect(result.warnings.join(" ")).toContain("cost");
  });

  it("ruxsat bo'lsa ikkalasi ham qoladi", () => {
    const result = sanitizeTemplateSchema(tableSchema, access(["products.view_cost"]));
    expect(columnsOf(result)).toEqual(["name", "cost", "margin"]);
  });

  it("hamma ustun rad etilsa element umuman saqlanmaydi", () => {
    const result = sanitizeTemplateSchema(
      { schemaVersion: 1, sections: [{ key: "body", elements: [{ id: "t", type: "itemsTable", columns: [{ key: "cost" }] }] }] },
      access([]),
    );
    expect(result.schema.sections.find((section) => section.key === "body")?.elements).toHaveLength(0);
  });

  it("bo'limlar har doim uchta va tartibda bo'ladi", () => {
    const result = sanitizeTemplateSchema({}, access([]));
    expect(result.schema.sections.map((section) => section.key)).toEqual(["header", "body", "footer"]);
    expect(result.schema.page.size).toBe("a4");
  });

  it("shart uchun mavjud bo'lmagan maydon olib tashlanadi", () => {
    const result = sanitizeTemplateSchema(
      {
        schemaVersion: 1,
        sections: [{ key: "body", elements: [{ id: "a", type: "text", label: "Bor", visibleWhen: { field: "secret.x", operator: "gt", value: 0 } }] }],
      },
      access([]),
    );
    const element = result.schema.sections.find((section) => section.key === "body")!.elements[0]!;
    expect(element.label).toBe("Bor");
    expect(element.visibleWhen, "yaroqsiz shart olib tashlanadi").toBeUndefined();
  });
});

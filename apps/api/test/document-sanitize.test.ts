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

/**
 * Rasm va kod elementlari — eng ehtiyotkorlik talab qiladigan joy: shablon ichiga tashqi
 * manzil yoki skriptli SVG tushib qolmasligi kerak.
 */
describe("Rasm va kod xavfsizligi", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  const imageSchema = (imageData: unknown) => ({
    schemaVersion: 1,
    sections: [{ key: "body", elements: [{ id: "i", type: "image", imageData }] }],
  });

  const bodyElements = (result: ReturnType<typeof sanitizeTemplateSchema>) =>
    result.schema.sections.find((section) => section.key === "body")?.elements ?? [];

  it("to'g'ri PNG data URL saqlanadi", () => {
    const result = sanitizeTemplateSchema(imageSchema(PNG), access([]));
    expect(bodyElements(result)[0]?.imageData).toBe(PNG);
  });

  it("tashqi URL, SVG va data:text/html rad etiladi", () => {
    for (const bad of [
      "https://evil.example/logo.png",
      "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+",
      "data:text/html;base64,PGgxPng8L2gxPg==",
      "javascript:alert(1)",
    ]) {
      const result = sanitizeTemplateSchema(imageSchema(bad), access([]));
      expect(bodyElements(result), `${bad} o'tib ketdi`).toHaveLength(0);
    }
  });

  it("juda katta rasm rad etiladi", () => {
    const huge = `data:image/png;base64,${"A".repeat(400_000)}`;
    const result = sanitizeTemplateSchema(imageSchema(huge), access([]));
    expect(bodyElements(result)).toHaveLength(0);
    expect(result.warnings.join(" ")).toContain("katta");
  });

  it("QR manbasi faqat ro'yxatdan — ixtiyoriy matn yozib bo'lmaydi", () => {
    const allowed = sanitizeTemplateSchema(
      { schemaVersion: 1, sections: [{ key: "body", elements: [{ id: "q", type: "qr", qrSource: "documentNumber" }] }] },
      access([]),
    );
    expect(bodyElements(allowed)[0]?.qrSource).toBe("documentNumber");

    const denied = sanitizeTemplateSchema(
      { schemaVersion: 1, sections: [{ key: "body", elements: [{ id: "q", type: "qr", qrSource: "https://evil.example" }] }] },
      access([]),
    );
    expect(bodyElements(denied)).toHaveLength(0);
  });

  it("ustun kengligi chegaraga tushiriladi va tartib saqlanadi", () => {
    const result = sanitizeTemplateSchema(
      {
        schemaVersion: 1,
        sections: [
          {
            key: "body",
            elements: [{ id: "t", type: "itemsTable", columns: [{ key: "total", width: 9999 }, { key: "name", width: 30 }] }],
          },
        ],
      },
      access([]),
    );
    const columns = bodyElements(result)[0]?.columns ?? [];
    expect(columns.map((column) => column.key), "tartib shablondagidek").toEqual(["total", "name"]);
    expect(columns[0]?.width).toBeLessThanOrEqual(420);
  });
});

/**
 * 2026-09-25: foydalanuvchi "jadval chiziqlarini tahrir qilib bo'lmayapti" dedi.
 * Sozlama UI da o'zgarsa ham, sanitizatsiya uni tashlab yuborsa saqlanmay qolardi —
 * shuning uchun har yangi kalit shu yerda qulflanadi.
 */
describe("Ko'rinish sozlamalari saqlanadi", () => {
  const view = {
    schemaVersion: 1,
    sections: [
      {
        key: "body",
        elements: [
          {
            id: "t",
            type: "itemsTable",
            columns: [{ key: "name", label: "Tovar", width: 50, align: "right" }],
            table: {
              borderStyle: "dashed", borderWidth: 0.6, borderColor: "#FF0000",
              outer: true, top: false, horizontal: true, vertical: false, headerBorder: false,
              paddingX: 3, paddingY: 1, rowHeight: 8, fontSize: 9,
              headerFill: "#1e2850", headerText: "#ffffff", zebra: false, valign: "middle",
            },
          },
          { id: "r", type: "rect", width: 80, height: 20, box: { borderStyle: "double", borderWidth: 0.5, borderColor: "#123456", radius: 2, fill: "#eeeeee" } },
          { id: "q", type: "qr", qrSource: "orderNumber", width: 26, qrLevel: "H", qrMargin: 2 },
        ],
      },
    ],
  };

  it("jadval chiziqlari, ustun kengligi, ramka va QR sozlamalari qoladi", () => {
    const { schema } = sanitizeTemplateSchema(view, access(["products.view_cost"]));
    const elements = schema.sections.find((section) => section.key === "body")!.elements;
    const table = elements.find((element) => element.type === "itemsTable")!;
    expect(table.columns?.[0]).toMatchObject({ key: "name", label: "Tovar", width: 50, align: "right" });
    expect(table.table).toMatchObject({
      borderStyle: "dashed", borderWidth: 0.6, borderColor: "#ff0000",
      outer: true, top: false, horizontal: true, vertical: false, headerBorder: false,
      paddingX: 3, paddingY: 1, rowHeight: 8, fontSize: 9, zebra: false, valign: "middle",
    });
    expect(elements.find((element) => element.type === "rect")?.box).toMatchObject({
      borderStyle: "double", borderWidth: 0.5, borderColor: "#123456", radius: 2, fill: "#eeeeee",
    });
    expect(elements.find((element) => element.type === "qr")).toMatchObject({ qrLevel: "H", qrMargin: 2, width: 26 });
  });

  it("noto'g'ri qiymat jimgina saqlanmaydi", () => {
    const { schema } = sanitizeTemplateSchema(
      {
        schemaVersion: 1,
        sections: [{ key: "body", elements: [{ id: "t", type: "itemsTable", columns: [{ key: "name" }], table: { borderStyle: "groove", borderColor: "red", borderWidth: 99 } }] }],
      },
      access([]),
    );
    const table = schema.sections.find((section) => section.key === "body")!.elements[0]!.table!;
    expect(table.borderStyle, "ro'yxatda yo'q chiziq turi").toBeUndefined();
    expect(table.borderColor, "`#rrggbb` bo'lmagan rang").toBeUndefined();
    expect(table.borderWidth, "chegaradan oshgani qisqartiriladi").toBe(3);
  });
});

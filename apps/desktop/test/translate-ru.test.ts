import { describe, expect, it } from "vitest";
import { RU_PATTERNS, RU_PHRASES } from "../src/renderer/settings/ru-dictionary.ts";
import { toRussian } from "../src/renderer/settings/translate-ru.ts";

const placeholders = (text: string) => text.split("{}").length - 1;

describe("Rus tili lug'ati", () => {
  it("lug'at butun: bo'sh qiymat yo'q, qoliplarda `{}` soni teng, kalit chetida bo'shliq yo'q", () => {
    expect(Object.keys(RU_PHRASES).length).toBeGreaterThan(200);
    for (const [uz, ru] of Object.entries(RU_PHRASES)) {
      expect(ru.trim(), uz).not.toBe("");
      expect(uz, uz).toBe(uz.trim());
    }
    for (const [uz, ru] of RU_PATTERNS) {
      expect(placeholders(uz), uz).toBeGreaterThan(0);
      expect(placeholders(ru), uz).toBe(placeholders(uz));
    }
  });

  it("aniq ibora (chetdagi bo'shliq saqlanadi), qolip, lug'atda yo'q matn o'zgarmaydi", () => {
    const [uz, ru] = Object.entries(RU_PHRASES)[0]!;
    expect(toRussian(`  ${uz} `)).toBe(`  ${ru} `);

    // Qolipga mos keladigan matn: `{}` o'rniga raqam
    const [patternUz, patternRu] = RU_PATTERNS.find(([key]) => !(key.replaceAll("{}", "12") in RU_PHRASES))!;
    const translated = toRussian(patternUz.replaceAll("{}", "12"));
    expect(translated).not.toBe(patternUz.replaceAll("{}", "12"));
    expect(translated).toContain("12");
    expect(placeholders(patternRu)).toBeGreaterThan(0);

    expect(toRussian("Coca-Cola 1.5L")).toBe("Coca-Cola 1.5L");
    expect(toRussian("K01-000123")).toBe("K01-000123");
    expect(toRussian("   ")).toBe("   ");
  });
});

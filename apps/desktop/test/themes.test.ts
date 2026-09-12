import { describe, expect, it } from "vitest";
import * as shared from "../../../packages/shared/src/pos-appearance.ts";
import {
  CUSTOM_THEME_COLOR_FIELDS,
  DARK_TEXT,
  LEGACY_POS_THEMES,
  LIGHT_TEXT,
  POS_DENSITIES,
  POS_FONT_SCALES,
  POS_SHADOWS,
  POS_THEMES,
  THEME_ICONS,
  THEME_LABELS,
  concreteTheme,
  contrastRatio,
  customThemeTokens,
  isDarkTheme,
  normalizePosTheme,
  parseCustomTheme,
  readableTextColor,
  resolvePosTheme,
} from "../src/shared/themes.js";

describe("Kassa mavzulari", () => {
  it("desktop ro'yxati va qoidalari umumiy paket (server, web) bilan bir xil", () => {
    expect(POS_THEMES).toEqual(shared.POS_THEMES);
    expect(POS_THEMES).toHaveLength(12);
    expect(LEGACY_POS_THEMES).toEqual(shared.LEGACY_POS_THEMES);
    expect(THEME_LABELS).toEqual(shared.POS_THEME_LABELS);
    expect(THEME_ICONS).toEqual(shared.POS_THEME_ICONS);
    expect(POS_DENSITIES).toEqual(shared.POS_DENSITIES);
    expect(POS_FONT_SCALES).toEqual(shared.POS_FONT_SCALES);
    expect(POS_SHADOWS).toEqual(shared.POS_SHADOWS);
    expect(CUSTOM_THEME_COLOR_FIELDS).toEqual(shared.CUSTOM_THEME_COLOR_FIELDS);
    expect([DARK_TEXT, LIGHT_TEXT]).toEqual([shared.DARK_TEXT, shared.LIGHT_TEXT]);
    for (const [a, b] of [
      ["#1d4ed8", "#ffffff"],
      ["#777777", "#111827"],
      ["#fde68a", "#0f172a"],
    ] as const) {
      expect(contrastRatio(a, b)).toBe(shared.contrastRatio(a, b));
      expect(readableTextColor(a)).toBe(shared.readableTextColor(a));
    }
    for (const value of ["ocean", "dark", "custom", "rainbow", 5]) {
      expect(normalizePosTheme(value)).toBe(shared.normalizePosTheme(value));
      expect(normalizePosTheme(value, false)).toBe(shared.normalizePosTheme(value, false));
    }
    expect(parseCustomTheme(shared.DEFAULT_CUSTOM_THEME)).toEqual(shared.parseCustomTheme(shared.DEFAULT_CUSTOM_THEME));
    expect(parseCustomTheme({ ...shared.DEFAULT_CUSTOM_THEME, radius: 30 })).toBeNull();
    expect(shared.validateCustomTheme(shared.DEFAULT_CUSTOM_THEME)).toEqual([]);
  });

  it("ustuvorlik: kompaniya qulfi → kassir tanlovi → kompaniya standarti → Windows; maxsus mavzu faqat mavjud bo'lsa", () => {
    const custom = shared.DEFAULT_CUSTOM_THEME;
    expect(resolvePosTheme({ company: null, cashierTheme: null })).toEqual({ theme: "system", source: "system", lock: null });
    expect(resolvePosTheme({ company: { locked: false, theme: "ocean", custom: null }, cashierTheme: null })).toEqual({ theme: "ocean", source: "company-default", lock: null });
    expect(resolvePosTheme({ company: { locked: false, theme: "ocean", custom: null }, cashierTheme: "neon" })).toEqual({ theme: "neon", source: "cashier", lock: null });
    expect(resolvePosTheme({ company: { locked: true, theme: "classic", custom: null }, cashierTheme: "neon" })).toEqual({ theme: "classic", source: "company-lock", lock: "classic" });
    expect(resolvePosTheme({ company: { locked: false, theme: "ocean", custom: null }, cashierTheme: "purple" }).theme).toBe("royal");
    expect(resolvePosTheme({ company: { locked: true, theme: "custom", custom: null }, cashierTheme: "custom" })).toEqual({ theme: "system", source: "system", lock: null });
    expect(resolvePosTheme({ company: { locked: true, theme: "custom", custom }, cashierTheme: null })).toEqual({ theme: "custom", source: "company-lock", lock: "custom" });
    expect(resolvePosTheme({ company: { locked: false, theme: "snow", custom }, cashierTheme: "custom" }).theme).toBe("custom");
  });

  it("Windows System tizim rejimiga ergashadi; qorong'i mavzular; maxsus mavzu tokenlari kontrastli matn bilan", () => {
    expect(concreteTheme("system", true, null)).toBe("midnight");
    expect(concreteTheme("system", false, null)).toBe("snow");
    expect(concreteTheme("custom", false, null)).toBe("snow");
    expect(concreteTheme("glass", true, null)).toBe("glass");
    expect(["midnight", "graphite", "neon", "high-contrast"].every((theme) => isDarkTheme(theme))).toBe(true);
    expect(["snow", "ocean", "emerald", "royal", "sunset", "glass", "classic"].some((theme) => isDarkTheme(theme))).toBe(false);

    const dark = { ...shared.DEFAULT_CUSTOM_THEME, base: "dark" as const, background: "#0f172a", surface: "#1e293b", card: "#1e293b" };
    expect(isDarkTheme("custom", dark)).toBe(true);
    const tokens = customThemeTokens(dark);
    expect(tokens).toMatchObject({ "--background": "#0f172a", "--foreground": LIGHT_TEXT, "--primary": "#1d4ed8", "--primary-foreground": LIGHT_TEXT, "--pos-action": "#15803d", "--radius": "0.625rem" });
    expect(customThemeTokens(shared.DEFAULT_CUSTOM_THEME)["--foreground"]).toBe(DARK_TEXT);
  });
});

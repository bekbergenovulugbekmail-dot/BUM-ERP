import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
  // Android/Gradle ishlab chiqargan fayllar tekshirilmaydi (build chiqishi, qo'lda yozilmagan)
  globalIgnores(["dist", "apps/api/dist", "apps/mobile/android/**/build/**", "apps/desktop/dist", "apps/desktop/release"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
    ],
    rules: {
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": true },
      ],
      "@typescript-eslint/no-unused-vars": "off",
      "prefer-const": "off",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    /**
     * TDZ xatosi production'da OQ EKRAN berdi (2026-09-24, Dostavka): `selected` holati
     * e'lon qilinishidan OLDIN `filter` callback'ida ishlatilgan edi. Ro'yxat bo'sh bo'lsa
     * callback ishlamaydi — shuning uchun lokalda ham, testda ham chiqmasdi, faqat real
     * ma'lumotda yiqilardi. React komponentida bunday xato butun sahifani o'chiradi.
     *
     * Qoida FRONTENDGA qo'yildi (render paytida ishlaydigan kod). Funksiya e'lonlari
     * ko'tariladi va odatda pastda yoziladi — shuning uchun `functions: false`.
     */
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/**"],
    rules: {
      "@typescript-eslint/no-use-before-define": [
        "error",
        { functions: false, classes: true, variables: true, enums: true, typedefs: false, ignoreTypeReferences: true },
      ],
    },
  },
  {
    // shadcn/ui components co-export their cva variant helpers by design.
    files: ["src/components/ui/**"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
]);

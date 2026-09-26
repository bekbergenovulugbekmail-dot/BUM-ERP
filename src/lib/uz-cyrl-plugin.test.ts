import { describe, expect, it } from "vitest";
import { transformUzCyrl } from "../../vite-plugin-uz-cyrl.ts";

const run = (code: string) => transformUzCyrl(code, "/repo/src/pages/x.tsx") ?? code;

describe("kirill build plagini", () => {
  it("JSX matni, atributlar, yorliq xususiyatlari va toast o'raladi; qator soni saqlanadi", () => {
    const code = [
      "export function X({ name }: { name: string }) {",
      "  toast.success(\"Saqlandi\");",
      "  const cards = [{ label: \"Jami mahsulot\", value: 1 }];",
      "  return (",
      "    <div title=\"Ombor\" placeholder={`Qidirish ${name}`}>",
      "      Mahsulot topilmadi",
      "      <b>{name}</b> ta qator",
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const out = run(code);
    expect(out).toContain('toast.success(__cyr("Saqlandi"))');
    expect(out).toContain('label: __cyr("Jami mahsulot")');
    expect(out).toContain('title={__cyr("Ombor")}');
    expect(out).toContain("placeholder={__cyrT`Qidirish ${name}`}");
    expect(out).toContain('__cyr("Mahsulot topilmadi")');
    expect(out).toContain('__cyr(" ta qator")');
    expect(out).toContain('import { __cyr, __cyrT } from "@/lib/uz-cyrl.ts"');
    // Birinchi 10 qator joyida (import oxirida)
    expect(out.split("\n").slice(0, 10).findIndex((line) => line.includes("return ("))).toBe(3);
  });

  it("solishtirish, kalit, API yo'li, ma'lumot ifodasi — o'ralmaydi", () => {
    const code = [
      "if (role === \"Supervayzer\") api.get(\"/api/sales\");",
      "const x = { key: \"Sotuv agenti\", label: row.name };",
      "const STATUS_LABELS = { draft: \"Qoralama\", done: \"Yakunlandi\" };",
      "const el = <Select value=\"Naqd\" />;",
    ].join("\n");
    const out = run(code);
    expect(out).toContain('role === "Supervayzer"');
    expect(out).toContain('api.get("/api/sales")');
    expect(out).toContain('key: "Sotuv agenti"');
    expect(out).toContain("label: row.name");
    expect(out).toContain('draft: __cyr("Qoralama")');
    expect(out).toContain('value="Naqd"');
  });
});

describe("kirill build plagini — JSX ifodalari va pul birligi", () => {
  it("shartli matn va so'm o'raladi; solishtirish yo'q", () => {
    const out = run('const a = <b>{busy ? "Tayyorlanmoqda" : "Eksport"}{ok && "Tayyor"}</b>;\nconst m = (n: number) => n + " so\'m";\nif (c === " so\'m") x();');
    expect(out).toContain('busy ? __cyr("Tayyorlanmoqda") : __cyr("Eksport")');
    expect(out).toContain('ok && __cyr("Tayyor")');
    expect(out).toContain('n + __cyr(" so\'m")');
    expect(out).toContain('c === " so\'m"');
  });
});

describe("kirill build plagini — JSX bo'shliqlari", () => {
  it("ifodadan keyingi matndagi bosh bo'shliq ikki marta chiqmaydi", () => {
    const out = run("const a = (\n  <span>\n    Balandlik: {h} mm — A4 ga {n} ta sig'adi\n  </span>\n);");
    expect(out).toContain('{h}{__cyr(" mm — A4 ga ")}{n}{__cyr(" ta sig\'adi")');
    expect(out).toContain('{__cyr("Balandlik: ")');
  });
});

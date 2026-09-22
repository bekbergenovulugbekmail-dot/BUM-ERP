/**
 * Avval kiritilgan qiymatlarni taklif qiladigan maydon: bosilganda ro'yxat ochiladi,
 * yozilganda qisqaradi, tanlangani maydonga tushadi — lekin ro'yxatda yo'q matnni ham yozish mumkin.
 */
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SuggestInput from "./suggest-input.tsx";

const OPTIONS = ["Urganch", "Xiva", "Xonqa"];

/** Maydon boshqariladigan (controlled) — testda ham haqiqiy formadagidek holat saqlanadi. */
function Harness({ initial, onChange }: { initial: string; onChange: (next: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <SuggestInput
      value={value}
      onChange={(next) => { setValue(next); onChange(next); }}
      options={OPTIONS}
      testId="city"
    />
  );
}

function setup(value = "") {
  const onChange = vi.fn();
  const view = render(<Harness initial={value} onChange={onChange} />);
  return { onChange, input: screen.getByTestId("city"), view };
}

describe("taklifli maydon", () => {
  it("bosilganda to'liq ro'yxat chiqadi", () => {
    const { input } = setup();
    expect(screen.queryByRole("option")).toBeNull();

    fireEvent.click(input);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(OPTIONS);
  });

  it("yozilgan matn bo'yicha qisqaradi va tanlangani maydonga tushadi", () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: "xo" } });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Xonqa"]);

    // Ro'yxat qatori `mousedown` da tanlanadi — maydon fokusdan chiqmaydi
    fireEvent.mouseDown(screen.getByRole("option", { name: "Xonqa" }));
    expect(onChange).toHaveBeenLastCalledWith("Xonqa");
  });

  it("qiymat aynan mos kelsa ro'yxat ochilmaydi (keraksiz taklif chiqmaydi)", () => {
    const { input } = setup("Urganch");
    fireEvent.click(input);
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("ro'yxatda yo'q qiymat ham yozilaveradi", () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: "Yangibozor" } });
    expect(onChange).toHaveBeenLastCalledWith("Yangibozor");
    expect(input).toHaveValue("Yangibozor");
    // Mos kelmagani uchun taklif yo'q, lekin matn maydonda qoladi
    expect(screen.queryByRole("option")).toBeNull();
  });
});

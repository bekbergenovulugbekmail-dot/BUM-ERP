/**
 * Import oqimi: fayl → ustunlarni moslash → "Tekshirish" oynasidagi JADVAL.
 *
 * Asosiy talab: yozishdan oldin har bir qiymat qaysi maydonga tushgani ko'rinsin — shuning uchun
 * test Windows-1251 dagi haqiqiy shaklga o'xshash faylni beradi va jadvaldagi kataklarni tekshiradi.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const outcome = { created: 0, valid: 2, updated: 0, errors: [], duplicates: [], warnings: [], dryRun: true };
const mutateAsync = vi.fn(async (_body: { rows: Record<string, string>[]; dryRun: boolean }) => outcome);

vi.mock("@/lib/query.ts", () => ({
  useApiQuery: () => ({ data: undefined }),
  useApiMutation: () => ({ mutateAsync, isPending: false }),
}));

const { default: CsvToolbar } = await import("./csv-toolbar.tsx");

const COLUMNS = [
  { key: "name", aliases: ["Nomi", "name"], required: true },
  { key: "partyType", aliases: ["Turi", "partyType"] },
  { key: "phone", aliases: ["Telefon", "phone"] },
  { key: "email", aliases: ["Email", "email"] },
  { key: "address", aliases: ["Manzil", "address"] },
];

/** Kirill matnni Windows-1251 baytlariga (Excel "ANSI" eksporti shunday chiqadi). */
function cp1251(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(text.length));
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes[index] = code;
    else if (code === 0x401) bytes[index] = 0xa8; // Ё
    else if (code === 0x451) bytes[index] = 0xb8; // ё
    else bytes[index] = code - 0x410 + 0xc0; // А–я ketma-ket
  }
  return bytes;
}

const FILE = [
  "Nomi\tTuri\tTelefon\tManzil",
  "Имона Маркет\tYuridik Shaxs\t+998995086866\tГулд бургер ёни",
  "Нурия ун оптом\tYuridik Shaxs\t+998999631212\tАсадбек тойхона ёни",
].join("\r\n");

function renderToolbar() {
  const view = render(
    <CsvToolbar
      exportUrl="/api/sales/customers/export"
      filename="mijozlar"
      importUrl="/api/sales/customers/import"
      invalidate={["/api/sales/customers"]}
      canImport
      columns={COLUMNS}
    />,
  );
  const input = view.container.querySelector('input[type="file"]');
  if (!input) throw new Error("fayl tanlagich topilmadi");
  return input as HTMLInputElement;
}

describe("Import — ustunlarni moslash oynasi", () => {
  it("fayl namunasi ko'rinadi: ustunlar, birinchi qatorlar va maydon tagida namuna qiymat", async () => {
    const input = renderToolbar();
    fireEvent.change(input, { target: { files: [new File([cp1251(FILE)], "mijozlar.csv", { type: "text/csv" })] } });

    await screen.findByTestId("csv-mapping");
    expect(screen.getByTestId("csv-delimiter-semicolon")).toBeInTheDocument();
    const preview = screen.getByTestId("csv-file-preview");

    // Sarlavhalar — fayldagi ustunlar; har birida "bu ustun qaysi maydon" tanlovi bor
    const headers = within(preview).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers.map((text) => text?.split("Nomi")[0] ?? text)).toHaveLength(4);
    expect(within(preview).getByTestId("csv-column-Telefon")).toBeInTheDocument();
    expect(within(preview).getByTestId("csv-column-Manzil")).toBeInTheDocument();

    // Fayl qatorlari aynan o'z ustunida ko'rinadi (kirill matn buzilmagan)
    const rows = within(preview).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual([
      ["Имона Маркет", "Yuridik Shaxs", "+998995086866", "Гулд бургер ёни"],
      ["Нурия ун оптом", "Yuridik Shaxs", "+998999631212", "Асадбек тойхона ёни"],
    ]);

    // Maydon tagida o'sha ustunning namuna qiymatlari
    expect(screen.getByText("+998995086866, +998999631212")).toBeInTheDocument();
  });

  it("ajratgichni qo'lda tanlash: fayl qayta ajratiladi", async () => {
    const input = renderToolbar();
    fireEvent.change(input, { target: { files: [new File([cp1251(FILE)], "mijozlar.csv", { type: "text/csv" })] } });
    await screen.findByTestId("csv-mapping");
    // Tab bilan ajratilgan fayl 4 ta ustunga bo'lindi
    expect(within(screen.getByTestId("csv-file-preview")).getAllByRole("columnheader")).toHaveLength(4);

    // Nuqtali vergul — bu faylda yo'q, ya'ni hamma narsa bitta ustunga tushadi va ogohlantirish chiqadi
    fireEvent.click(screen.getByTestId("csv-delimiter-semicolon"));
    expect(within(screen.getByTestId("csv-file-preview")).getAllByRole("columnheader")).toHaveLength(1);
    expect(screen.getByText(/Fayl ustunlarga ajralmadi/)).toBeInTheDocument();

    // Tabulyatsiyaga qaytarilsa — yana 4 ta ustun
    fireEvent.click(screen.getByTestId("csv-delimiter-tab"));
    expect(within(screen.getByTestId("csv-file-preview")).getAllByRole("columnheader")).toHaveLength(4);
  });
});

describe("Import — tekshirish oynasidagi jadval", () => {
  it("qiymatlar moslangan maydonlar ostida ko'rinadi (kirill matn buzilmaydi)", async () => {
    const input = renderToolbar();
    fireEvent.change(input, { target: { files: [new File([cp1251(FILE)], "mijozlar.csv", { type: "text/csv" })] } });

    // 1-bosqich: ustunlar avtomat moslandi
    await screen.findByTestId("csv-mapping");
    fireEvent.click(screen.getByTestId("csv-mapping-continue"));

    // 2-bosqich: jadval — sarlavha moslangan maydonlar, "Email" esa faylda yo'q, ustun ham yo'q
    const table = await screen.findByTestId("csv-preview-table");
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["#", "Nomi", "Turi", "Telefon", "Manzil"]);

    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual([
      ["2", "Имона Маркет", "Yuridik Shaxs", "+998995086866", "Гулд бургер ёни"],
      ["3", "Нурия ун оптом", "Yuridik Shaxs", "+998999631212", "Асадбек тойхона ёни"],
    ]);

    // Serverga aynan shu moslama yuborildi (dryRun — bazaga yozilmaydi)
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0]?.[0]).toMatchObject({
      dryRun: true,
      rows: [
        { name: "Имона Маркет", partyType: "Yuridik Shaxs", phone: "+998995086866", address: "Гулд бургер ёни" },
        { name: "Нурия ун оптом", partyType: "Yuridik Shaxs", phone: "+998999631212", address: "Асадбек тойхона ёни" },
      ],
    });
  });
});

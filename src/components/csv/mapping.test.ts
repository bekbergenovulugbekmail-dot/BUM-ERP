/**
 * Ustunlarni moslash mantig'i: bitta fayl ustuni FAQAT bitta maydonga tegishli bo'ladi
 * (aks holda import qaysi maydonga yozishni bilmay qoladi), namuna qiymatlar esa bo'sh kataklarni olmaydi.
 */
import { describe, expect, it } from "vitest";
import { SKIP, assignByColumn, assignColumn, columnOwner, sampleValues } from "./mapping.ts";

const ROWS = [
  { Nomi: "Bobur Market", Telefon: "+998995086866", Manzil: "" },
  { Nomi: "Saodat Kamron", Telefon: "", Manzil: "Petyorichka yoni" },
  { Nomi: "Bobur Market", Telefon: "937561005", Manzil: "Cholish yoli" },
  { Nomi: "Imona Market", Telefon: "87 735 51 57", Manzil: "Gold burger yoni" },
];

describe("ustunlarni moslash", () => {
  it("bir ustun ikkinchi maydonga o'tkazilsa, avvalgisi bo'shaydi", () => {
    const choice = { name: "Nomi", phone: "Telefon" };
    const next = assignColumn(choice, "contactName", "Telefon");
    expect(next).toEqual({ name: "Nomi", phone: SKIP, contactName: "Telefon" });
  });

  it("maydonni o'tkazib yuborish boshqalarga tegmaydi", () => {
    const choice = { name: "Nomi", phone: "Telefon" };
    expect(assignColumn(choice, "phone", SKIP)).toEqual({ name: "Nomi", phone: SKIP });
  });

  it("ustunni qaysi maydon egallagani topiladi", () => {
    const choice = { name: "Nomi", phone: SKIP };
    expect(columnOwner(choice, "Nomi")).toBe("name");
    expect(columnOwner(choice, "Telefon")).toBeNull();
  });

  it("jadval sarlavhasidan belgilash: ustun boshqa maydonga o'tadi yoki umuman olinmaydi", () => {
    const choice = { name: "Nomi", phone: "Telefon" };
    // "Telefon" ustuni endi "Mas'ul shaxs" maydoniga
    expect(assignByColumn(choice, "Telefon", "contactName")).toEqual({
      name: "Nomi",
      phone: SKIP,
      contactName: "Telefon",
    });
    // "olinmasin" — ustunni hech qaysi maydon olmaydi
    expect(assignByColumn(choice, "Telefon", null)).toEqual({ name: "Nomi", phone: SKIP });
  });

  it("namuna qiymatlar: bo'sh kataklar va takrorlar tashlanadi", () => {
    expect(sampleValues(ROWS, "Nomi")).toEqual(["Bobur Market", "Saodat Kamron", "Imona Market"]);
    expect(sampleValues(ROWS, "Telefon", 2)).toEqual(["+998995086866", "937561005"]);
    expect(sampleValues(ROWS, "Email")).toEqual([]);
  });
});

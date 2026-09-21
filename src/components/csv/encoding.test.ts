/**
 * Import faylining kodlashini aniqlash. Asosiy holat — Excel "ANSI" (Windows-1251) bilan saqlagan
 * kirill matnli CSV: u UTF-8 deb o'qilsa har bir harf `U+FFFD` belgisiga aylanadi.
 */
import { describe, expect, it } from "vitest";
import { decodeTextBytes, readTextFile } from "./encoding.ts";

/** Kirill matnni Windows-1251 baytlariga aylantiradi (test ma'lumoti uchun kichik jadval). */
function cp1251(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(text.length));
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes[index] = code;
    // А–я: 1251 da 0xC0 dan ketma-ket
    else if (code >= 0x410 && code <= 0x44f) bytes[index] = code - 0x410 + 0xc0;
    else if (code === 0x401) bytes[index] = 0xa8; // Ё
    else if (code === 0x451) bytes[index] = 0xb8; // ё
    else throw new Error(`1251 da yo'q: ${text[index]}`);
  }
  return bytes;
}

const bufferOf = (bytes: Uint8Array<ArrayBuffer>) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const utf8 = (text: string) => bufferOf(new TextEncoder().encode(text));

describe("import fayl kodlashi", () => {
  it("Windows-1251 dagi kirill matnni to'g'ri o'qiydi (U+FFFD chiqmaydi)", () => {
    const csv = "Nomi\tTelefon\r\nИмона Маркет\t+998995086866\r\nШарипова Санобар\t937561005\r\n";
    const { text, encoding } = decodeTextBytes(bufferOf(cp1251(csv)));
    expect(encoding).toBe("windows-1251");
    expect(text).toBe(csv);
    expect(text).not.toContain("\uFFFD");
  });

  it("UTF-8 faylga tegmaydi — BOM bilan ham, BOMsiz ham", () => {
    const csv = "Nomi;Manzil\r\nAnvar aka do'koni;Xiva ko'chasi\r\n";
    expect(decodeTextBytes(utf8(csv))).toEqual({ text: csv, encoding: "utf-8" });
    // BOM matnga qo'shilib ketmasligi kerak: aks holda birinchi sarlavha "\uFEFFNomi" bo'ladi
    expect(decodeTextBytes(utf8(`\uFEFF${csv}`))).toEqual({ text: csv, encoding: "utf-8" });
  });

  it("UTF-16 (Excel 'Unicode matn') BOM bo'yicha aniqlanadi", () => {
    const csv = "Nomi\tShahar\r\nИмона\tУрганч\r\n";
    const le = new Uint8Array(new ArrayBuffer(2 + csv.length * 2));
    le[0] = 0xff;
    le[1] = 0xfe;
    for (let index = 0; index < csv.length; index += 1) {
      le[2 + index * 2] = csv.charCodeAt(index) & 0xff;
      le[3 + index * 2] = csv.charCodeAt(index) >> 8;
    }
    expect(decodeTextBytes(bufferOf(le))).toEqual({ text: csv, encoding: "utf-16le" });
  });

  it("sof ASCII fayl UTF-8 bo'lib qoladi", () => {
    const csv = "name,phone\r\nShop A,+998901234567\r\n";
    expect(decodeTextBytes(utf8(csv))).toEqual({ text: csv, encoding: "utf-8" });
  });

  it("`File` dan o'qiydi (ilovadagi yo'l)", async () => {
    const bytes = cp1251("Nomi\r\nСаодат Камрон\r\n");
    const file = new File([bytes], "mijozlar.csv", { type: "text/csv" });
    await expect(readTextFile(file)).resolves.toEqual({ text: "Nomi\r\nСаодат Камрон\r\n", encoding: "windows-1251" });
  });
});

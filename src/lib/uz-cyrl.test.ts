import { afterEach, describe, expect, it } from "vitest";
import { __cyr, __cyrT, cyrMessage, setCyrillicActive, toCyrillic } from "./uz-cyrl.ts";

afterEach(() => setCyrillicActive(false));

describe("lotin → kirill", () => {
  it.each([
    ["Sotuv", "Сотув"],
    ["Ombor boshqaruvi", "Омбор бошқаруви"],
    ["O'zbek", "Ўзбек"],
    ["oʻzgartirish", "ўзгартириш"],
    ["G'alla", "Ғалла"],
    ["ma'lumot", "маълумот"],
    ["Yangi mijoz", "Янги мижоз"],
    ["Yordam", "Ёрдам"],
    ["yuklash", "юклаш"],
    ["Yetkazish", "Етказиш"],
    ["Eksport", "Экспорт"],
    ["Operatsiyalar", "Операциялар"],
    ["Litsenziya", "Лицензия"],
    ["Chiqarish", "Чиқариш"],
    ["Qabul qilish", "Қабул қилиш"],
    ["Hisobot", "Ҳисобот"],
    ["Xarid", "Харид"],
    ["SAQLASH", "САҚЛАШ"],
    ["Mahsulotlar soni", "Маҳсулотлар сони"],
    ["Qo'ng'iroq", "Қўнғироқ"],
    ["Tashrif kunlari", "Ташриф кунлари"],
  ])("%s → %s", (latin, cyrillic) => {
    expect(toCyrillic(latin)).toBe(cyrillic);
  });

  it("qisqartmalar, raqamlar, o'zgaruvchilar, teglar va havolalar o'zgarmaydi", () => {
    expect(toCyrillic("SKU va POS")).toBe("SKU ва POS");
    expect(toCyrillic("{{count}} ta mahsulot")).toBe("{{count}} та маҳсулот");
    expect(toCyrillic("A4 hisobot, 1L")).toBe("A4 ҳисобот, 1L");
    expect(toCyrillic("<b>Diqqat</b>: https://bum-erp.uz")).toBe("<b>Диққат</b>: https://bum-erp.uz");
    expect(toCyrillic("Excel fayl")).toBe("Excel файл");
  });

  it("kirill va ruscha matn o'zgarmaydi", () => {
    expect(toCyrillic("Сохранить")).toBe("Сохранить");
  });

  it("faqat kirill rejimida o'giriladi; shablonda qiymat (ma'lumot) o'zgarmaydi; server xabarida qo'shtirnoq ichi o'zgarmaydi", () => {
    expect(__cyr("Sotuv")).toBe("Sotuv");
    setCyrillicActive(true);
    expect(__cyr("Sotuv")).toBe("Сотув");
    const name = "Coca Cola";
    expect(__cyrT`Mahsulot: ${name}`).toBe("Маҳсулот: Coca Cola");
    expect(cyrMessage('Mahsulot topilmadi: "Coca Cola"')).toBe('Маҳсулот топилмади: "Coca Cola"');
  });
});

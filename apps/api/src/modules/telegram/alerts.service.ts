/**
 * Biznes egasiga DARHOL ogohlantirishlar (platformaning egalar boti orqali).
 *
 * Qoida: har bir funksiya tranzaksiyadan KEYIN, marshrut qatlamida `void` bilan chaqiriladi —
 * Telegram sekin ishlasa ham kassa yoki agent ilovasi kutib qolmaydi. Bot sozlanmagan bo'lsa jim o'tadi.
 */
import { notifyOwner } from "./notify.service.js";

const money = (value: string | number | null) => new Intl.NumberFormat("uz-UZ").format(Math.round(Number(value ?? 0)));

/** Smena yopildi, kassa farqi chegaradan oshdi. */
export function alertShiftDifference(
  companyId: string,
  input: { cashier: string | null; difference: string; expected: string; counted: string },
): Promise<void> {
  const sign = Number(input.difference) < 0 ? "kam" : "ortiq";
  return notifyOwner(
    companyId,
    [
      "<b>⚠️ Kassa farqi</b>",
      "",
      `Kassir: ${input.cashier ?? "—"}`,
      `Kutilgan: ${money(input.expected)} so'm`,
      `Sanalgan: ${money(input.counted)} so'm`,
      `Farq: <b>${money(input.difference)} so'm</b> (${sign})`,
      "",
      "Dasturda ko'rib chiqishni kutmoqda.",
    ].join("\n"),
  );
}

/** Chekda chegirma siyosat chegarasidan oshdi (rahbar bergan yoki oflayn sinxron). */
export function alertBigDiscount(
  companyId: string,
  input: { number: string; cashier: string | null; items: { name: string; discountPercent: string; maxDiscountPercent: string }[] },
): Promise<void> {
  const lines = [
    "<b>⚠️ Chegirma chegaradan oshdi</b>",
    "",
    `Chek: ${input.number}`,
    ...(input.cashier ? [`Kassir: ${input.cashier}`] : []),
    "",
    ...input.items.slice(0, 10).map((item) => `${item.name} — ${item.discountPercent}% (ruxsat ${item.maxDiscountPercent}%)`),
  ];
  return notifyOwner(companyId, lines.join("\n"));
}

/** Soxta GPS yoki imkonsiz sakrash — xodimning joylashuvi ishonchsiz. */
export function alertSuspiciousLocation(companyId: string, input: { agent: string; flags: string[] }): Promise<void> {
  const reason = input.flags.includes("mock") ? "soxta GPS (mock location)" : "imkonsiz tezlikdagi sakrash";
  return notifyOwner(
    companyId,
    ["<b>⚠️ Joylashuv shubhali</b>", "", `Xodim: ${input.agent}`, `Sabab: ${reason}`, "", "Joylashuv tarixini tekshiring."].join("\n"),
  );
}

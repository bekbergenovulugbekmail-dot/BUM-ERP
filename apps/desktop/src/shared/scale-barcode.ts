/**
 * Tarozi etiketkasi shtrix-kodi — do'kon ichidagi EAN-13 (GS1 prefiksi 20–29): prefiks (2) + mahsulot kodi (PLU) +
 * og'irlik + nazorat raqami. Tarozi qanday chop etsa kassada ham shunday sozlanadi (prefikslar, PLU uzunligi, og'irlik
 * kasrlari); nazorat raqami tekshiriladi — noto'g'ri o'qilgan kod savatga tushmaydi.
 */
export type WeightBarcodeFormat = {
  enabled: boolean;
  /** Ikki xonali prefikslar (20–29). */
  prefixes: string[];
  /** PLU raqamlari soni prefiksdan keyin (4–6); qolgan raqamlar — og'irlik. */
  codeLength: number;
  /** Og'irlik kasrlari: 3 — gramm (01234 → 1.234 kg). */
  weightDecimals: number;
};

export const DEFAULT_WEIGHT_BARCODE: WeightBarcodeFormat = { enabled: false, prefixes: ["22"], codeLength: 5, weightDecimals: 3 };

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let index = 0; index < 12; index++) sum += Number(first12[index]) * (index % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function normalizeWeightBarcodeFormat(input: Partial<WeightBarcodeFormat> | null | undefined): WeightBarcodeFormat {
  const prefixes = Array.isArray(input?.prefixes) ? [...new Set(input.prefixes.map(String).filter((prefix) => /^2\d$/.test(prefix)))] : [];
  const codeLength = [4, 5, 6].includes(Number(input?.codeLength)) ? Number(input!.codeLength) : DEFAULT_WEIGHT_BARCODE.codeLength;
  const maxDecimals = Math.min(3, 10 - codeLength);
  const decimals = Number(input?.weightDecimals);
  return {
    enabled: input?.enabled === true,
    prefixes: prefixes.length > 0 ? prefixes : [...DEFAULT_WEIGHT_BARCODE.prefixes],
    codeLength,
    weightDecimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= maxDecimals ? decimals : maxDecimals,
  };
}

/** Etiketka kodi bo'lsa — PLU va miqdor (kg, matn); aks holda null (oddiy shtrix-kod sifatida qidiriladi). */
export function parseWeightBarcode(code: string, format: WeightBarcodeFormat): { plu: number; quantity: string } | null {
  if (!format.enabled || !/^\d{13}$/.test(code) || !format.prefixes.includes(code.slice(0, 2))) return null;
  if (ean13CheckDigit(code.slice(0, 12)) !== Number(code[12])) return null;
  const plu = Number(code.slice(2, 2 + format.codeLength));
  const digits = code.slice(2 + format.codeLength, 12);
  const whole = digits.slice(0, digits.length - format.weightDecimals).replace(/^0+(?=\d)/, "") || "0";
  const fraction = format.weightDecimals > 0 ? digits.slice(digits.length - format.weightDecimals) : "";
  const quantity = fraction ? `${whole}.${fraction}` : whole;
  if (plu <= 0 || Number(quantity) <= 0) return null;
  return { plu, quantity };
}

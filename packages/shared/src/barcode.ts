/**
 * Shtrix-kod tekshiruvi. Faqat 13 xonali raqamli kod EAN-13 deb hisoblanadi va nazorat raqami tekshiriladi (skanerda
 * xato o'qilgan yoki qo'lda noto'g'ri terilgan kod saqlanmasin). Boshqa formatlar (EAN-8, UPC, ichki/qisqa kodlar,
 * harf-raqamli) — o'zgarishsiz qabul qilinadi.
 */
export function ean13CheckDigit(first12: string): number {
  const sum = [...first12].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Xato matni yoki `null`: 13 xonali raqamli kod nazorat raqami noto'g'ri bo'lsa. */
export function barcodeError(code: string | null | undefined): string | null {
  const value = code?.trim();
  if (!value || !/^\d{13}$/.test(value)) return null;
  if (isValidEan13(value)) return null;
  return `Shtrix-kod ${value} — EAN-13 nazorat raqami noto'g'ri (to'g'risi: ${value.slice(0, 12)}${ean13CheckDigit(value.slice(0, 12))})`;
}

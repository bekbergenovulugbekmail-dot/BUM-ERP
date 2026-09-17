/**
 * Chekni avtomatik chop etish — kassaning o'zida yoqib/o'chiriladigan tugma.
 *
 * Sukut qiymat kompaniya chek shablonidan (`autoPrint`) keladi. Kassir shu qurilma uchun uni
 * vaqtincha o'zgartirishi mumkin — tanlov FAQAT shu brauzerda saqlanadi va kompaniya sozlamasiga
 * tegmaydi (kassirda `settings.manage` ruxsati bo'lmasligi mumkin, va bir kassada o'chirish
 * boshqasida ham o'chib qolmasligi kerak).
 */
const KEY = "bum:pos:auto-print";

/** `null` — o'zgartirilmagan, kompaniya sozlamasi ishlatiladi. */
export function autoPrintOverride(): boolean | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? null : raw === "true";
  } catch {
    return null; // localStorage yopiq (xususiy rejim)
  }
}

export function setAutoPrintOverride(value: boolean | null) {
  try {
    if (value === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value ? "true" : "false");
  } catch {
    // yozib bo'lmasa — shu sessiyada ishlaydi, saqlanmaydi
  }
}

/** Amaldagi qiymat: qurilma tanlovi bo'lsa u, aks holda kompaniya sozlamasi. */
export const autoPrintEnabled = (companyDefault: boolean) => autoPrintOverride() ?? companyDefault;

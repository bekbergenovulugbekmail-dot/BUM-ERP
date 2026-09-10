/**
 * Convex Auth — parol bilan kirish (OIDC provayderisiz).
 *
 * Login identifikatori — telefon raqam. Convex Auth'ning Password provayderi
 * hisob identifikatorini `profile().email` dan oladi (bu shunchaki maydon nomi,
 * elektron pochta bo'lishi shart emas), shuning uchun normallashtirilgan
 * telefon raqam ham `email`, ham `phone` maydoniga yoziladi.
 *
 * Parollar Scrypt (lucia) bilan hash qilinadi — kutubxona ichida.
 */
import { ConvexError } from "convex/values";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import type { DataModel } from "./_generated/dataModel";

/**
 * Telefon raqamni yagona ko'rinishga keltiradi: +998XXXXXXXXX
 *
 * Qabul qilinadi: "+998 90 123 45 67", "998901234567", "901234567"
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 9) return "+998" + digits;
  if (digits.length === 12 && digits.startsWith("998")) return "+" + digits;
  if (digits.length === 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Telefon raqam kiritilmagan",
    });
  }
  // Boshqa davlat kodlari — shundayligicha, faqat + qo'shamiz
  return "+" + digits;
}

const PHONE_RE = /^\+\d{9,15}$/;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password<DataModel>({
      profile(params) {
        const raw = (params.email ?? params.phone ?? "") as string;
        const phone = normalizePhone(raw);

        if (!PHONE_RE.test(phone)) {
          throw new ConvexError({
            code: "BAD_REQUEST",
            message: "Telefon raqam noto'g'ri formatda",
          });
        }

        return {
          // Password provayderi hisob ID sifatida shuni ishlatadi
          email: phone,
          phone,
          name: (params.name as string | undefined) || undefined,
        };
      },

      validatePasswordRequirements(password: string) {
        if (password.length < 8) {
          throw new ConvexError({
            code: "BAD_REQUEST",
            message: "Parol kamida 8 ta belgidan iborat bo'lishi kerak",
          });
        }
      },
    }),
  ],
});

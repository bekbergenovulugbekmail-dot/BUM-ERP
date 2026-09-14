/**
 * O'zi ro'yxatdan o'tish (Convex'dagi companies.registerCompany).
 *
 * Qaror: standart holatda YOPIQ — platforma admini sozlamalardan
 * (`registrationEnabled`) yoqadi. Yangi kompaniya server vaqti bo'yicha 25 kunlik
 * bepul trial va 3 ta included litsenziya bilan ochiladi (obuna tizimi,
 * subscription/subscription.service.ts); muddat o'tgach faqat Bosh sahifa va Obuna
 * ochiq qoladi. Ega darhol tizimga kiritiladi.
 */
import { eq } from "drizzle-orm";
import type { ModuleKey } from "@bum/shared";
import { users } from "../../db/schema/platform.js";
import type { Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { startSession } from "../auth/auth.service.js";
import { createCompanyWithOwner } from "../platform/company.service.js";

export type RegistrationInput = {
  companyName: string;
  ownerName?: string;
  phone: string;
  password: string;
  city?: string;
  address?: string;
  country?: string;
  currency?: string;
  language?: string;
  modules?: ModuleKey[];
};

export async function registerCompany(tx: Tx, input: RegistrationInput, meta: RequestMeta) {
  const created = await createCompanyWithOwner(
    tx,
    null,
    {
      name: input.companyName,
      city: input.city,
      address: input.address,
      country: input.country,
      currency: input.currency,
      language: input.language,
      modules: input.modules,
      owner: { phone: input.phone, password: input.password, name: input.ownerName ?? null },
    },
    meta,
    { status: "trial", auditAction: "COMPANY_REGISTERED" },
  );

  const [owner] = await tx.select().from(users).where(eq(users.id, created.owner.id)).limit(1);
  const { session, me } = await startSession(tx, { user: owner!, upgradedHash: null }, meta);
  return { company: created.company, session, me };
}

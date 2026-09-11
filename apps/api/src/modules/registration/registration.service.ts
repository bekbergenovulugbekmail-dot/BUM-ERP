/**
 * O'zi ro'yxatdan o'tish (Convex'dagi companies.registerCompany).
 *
 * Qaror: standart holatda YOPIQ — platforma admini sozlamalardan
 * (`registrationEnabled`) yoqadi. Yangi kompaniya `defaultTrialDays` kunlik
 * sinov muddati bilan ochiladi (0 — darhol active); muddat o'tgach yozish
 * amallari yopiladi (company/tenant.ts). Ega darhol tizimga kiritiladi.
 */
import { eq } from "drizzle-orm";
import { users } from "../../db/schema/platform.js";
import type { Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { startSession } from "../auth/auth.service.js";
import { createCompanyWithOwner } from "../platform/company.service.js";
import type { PlatformSettings } from "../platform/platform.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

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
};

export async function registerCompany(
  tx: Tx,
  input: RegistrationInput,
  settings: PlatformSettings,
  meta: RequestMeta,
) {
  const trialDays = settings.defaultTrialDays;

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
      owner: { phone: input.phone, password: input.password, name: input.ownerName ?? null },
    },
    meta,
    {
      status: trialDays > 0 ? "trial" : "active",
      trialEndsAt: trialDays > 0 ? new Date(Date.now() + trialDays * DAY_MS) : null,
      auditAction: "COMPANY_REGISTERED",
    },
  );

  const [owner] = await tx.select().from(users).where(eq(users.id, created.owner.id)).limit(1);
  const { session, me } = await startSession(tx, { user: owner!, upgradedHash: null }, meta);
  return { company: created.company, session, me };
}

/**
 * Bank hisobidan pul chiqarishda (ta'minotchi, xarajat, maosh, qo'lda chiqim) komissiya oldindan ko'rinadi:
 * "Bank komissiyasi 1%: 10 000 so'm — hisobdan jami 1 010 000 so'm chiqadi". Faqat asosiy valyutadagi bank hisobi.
 */
import { formatMoney, useCurrencies } from "@/hooks/use-currencies.ts";
import { bankCommissionPreview } from "./bank-commission.ts";

type HintAccount = { type: string; currency: string; outgoingCommissionPercent?: string | null };

export function BankCommissionHint({ account, amount }: { account: HintAccount | null | undefined; amount: string | number | null | undefined }) {
  const currencies = useCurrencies();
  if (!account || account.type !== "bank" || account.currency !== currencies.base) return null;
  const preview = bankCommissionPreview(amount, account.outgoingCommissionPercent);
  if (!preview) return null;
  return (
    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
      Bank komissiyasi {preview.percent}%: <span className="font-semibold">{formatMoney(preview.fee, account.currency)}</span> — hisobdan jami{" "}
      <span className="font-semibold">{formatMoney(preview.total, account.currency)}</span> chiqadi
    </p>
  );
}

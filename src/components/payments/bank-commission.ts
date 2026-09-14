/**
 * Bank hisobidan chiqimda komissiyani oldindan ko'rsatish — server bilan bir xil qoida (`commissionMinor`):
 * summa × foiz / 100, tiyinda yarmidan yuqoriga yaxlitlanadi. Aniq yozuv serverda.
 */
export function bankCommissionPreview(amount: string | number | null | undefined, percent: string | number | null | undefined) {
  const amountMinor = Math.round(Number(String(amount ?? "").replace(/\s/g, "").replace(",", ".")) * 100);
  const rate = Math.round(Number(percent ?? 0) * 100);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0 || !Number.isFinite(rate) || rate <= 0) return null;
  const feeMinor = Math.round((amountMinor * rate) / 10_000);
  if (feeMinor <= 0) return null;
  return { fee: feeMinor / 100, total: (amountMinor + feeMinor) / 100, percent: rate / 100 };
}

/**
 * Obuna to'lovlari — `GET /api/platform/billing/payments`, `POST .../confirm`, `POST .../cancel`.
 * To'lov shlyuzi ulanmagan: egasi so'rov yuboradi, admin pul tushganini tekshirib tasdiqlaydi —
 * obuna yoki qo'shimcha litsenziya shu zahoti faollashadi (server tranzaksiyasi, takroriy tasdiq zararsiz).
 */
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, CreditCard, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { formatDay, formatUzs, type SubscriptionPayment } from "@/lib/subscription.ts";

const FILTERS = [
  { value: "pending", label: "Kutilmoqda" },
  { value: "paid", label: "Tasdiqlangan" },
  { value: "cancelled", label: "Bekor qilingan" },
  { value: "all", label: "Barchasi" },
] as const;

type Filter = (typeof FILTERS)[number]["value"];

export default function AdminBilling() {
  const [filter, setFilter] = useState<Filter>("pending");
  const query = useApiQuery<{ payments: SubscriptionPayment[] }>("/api/platform/billing/payments", {
    status: filter === "all" ? undefined : filter,
    limit: 200,
  });
  const confirm = useApiMutation(
    ({ id, reference }: { id: string; reference?: string }) => api.post(`/api/platform/billing/payments/${id}/confirm`, { reference }),
    { invalidate: ["/api/platform"] },
  );
  const cancel = useApiMutation((id: string) => api.post(`/api/platform/billing/payments/${id}/cancel`), { invalidate: ["/api/platform"] });

  const handleConfirm = async (payment: SubscriptionPayment) => {
    const input = window.prompt(
      `${payment.companyName ?? ""}: ${formatUzs(payment.amount)} to'lov tushganini tasdiqlaysizmi?\nTo'lov hujjati raqami (kvitansiya, bank o'tkazmasi) — ixtiyoriy:`,
    );
    if (input === null) return;
    try {
      await confirm.mutateAsync({ id: payment.id, reference: input.trim().slice(0, 200) || undefined });
      toast.success(payment.kind === "subscription" ? "Obuna faollashtirildi" : "Litsenziya faollashtirildi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleCancel = async (payment: SubscriptionPayment) => {
    if (!window.confirm("To'lov so'rovini bekor qilasizmi?")) return;
    try {
      await cancel.mutateAsync(payment.id);
      toast.success("So'rov bekor qilindi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const payments = query.data?.payments;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-primary" /> To'lovlar
        </h1>
        <p className="text-sm text-white/40 mt-0.5">Obuna va qo'shimcha litsenziya to'lov so'rovlari</p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            onClick={() => setFilter(item.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              filter === item.value ? "bg-primary text-white" : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-white/8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8 bg-white/4">
              {["Kompaniya", "To'lov", "Summa", "Holat", "Sana", ""].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-white/40 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {query.error ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-white/40">{errorMessage(query.error)}</td></tr>
            ) : !payments ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}><td colSpan={6} className="px-4 py-3"><Skeleton className="h-6 bg-white/5" /></td></tr>
              ))
            ) : payments.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-white/30">So'rovlar yo'q</td></tr>
            ) : (
              payments.map((payment) => (
                <tr key={payment.id} className="border-b border-white/5">
                  <td className="px-4 py-3 text-white">{payment.companyName}</td>
                  <td className="px-4 py-3">
                    <p className="text-white/80">{payment.kind === "subscription" ? "Obuna" : "Qo'shimcha litsenziya"}: {payment.planName}</p>
                    {payment.kind === "license" && (
                      <p className="text-xs text-white/40">{payment.licenseUserName ?? "—"} {payment.licenseUserPhone ?? ""}</p>
                    )}
                    {payment.reference && <p className="text-xs text-white/40">Hujjat: {payment.reference}</p>}
                  </td>
                  <td className="px-4 py-3 text-white tabular-nums">{formatUzs(payment.amount)}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className={payment.status === "paid" ? "text-green-400" : payment.status === "pending" ? "text-amber-400" : "text-white/40"}>
                      {payment.status === "paid" ? "Tasdiqlangan" : payment.status === "pending" ? "Kutilmoqda" : "Bekor qilingan"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-white/50">{formatDay(payment.createdAt)}</td>
                  <td className="px-4 py-3">
                    {payment.status === "pending" && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" className="h-7 text-xs" disabled={confirm.isPending} onClick={() => { void handleConfirm(payment); }}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Tasdiqlash
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-white/50 hover:text-white" disabled={cancel.isPending} onClick={() => { void handleCancel(payment); }}>
                          <XCircle className="h-3.5 w-3.5 mr-1" /> Bekor
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * To'lovni BEKOR QILISH — avval nima bo'lishini ko'rsatadi, keyin tasdiq so'raydi.
 *
 * Server ko'rib chiqish natijasini beradi (`GET /api/sales/payments/:id/reversal`): aralash to'lovning barcha qismlari,
 * qaysi buyurtmaning to'langan summasi qanchaga tushadi, pul qaysi kassadan qaytadi (yoki hamyon/keshbekka), komissiya,
 * yetkazma, smena va mijoz qarzi oldin → keyin. To'siq bo'lsa (kassada pul yo'q, qaytarilgan buyurtma) tugma o'chiq.
 * Hech narsa o'chirilmaydi — teskari yozuvlar yaratiladi, asl to'lov "bekor qilingan" bo'lib qoladi.
 */
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { money } from "../_lib/customer-statement.ts";

type Preview = {
  paymentIds: string[];
  customer: { id: string; name: string; debtBefore: string; debtAfter: string } | null;
  total: string;
  parts: {
    id: string;
    method: string;
    amount: string;
    currency: string;
    foreignAmount: string | null;
    paymentDate: string;
    moneyBack: { kind: "cash_account"; accountName: string; available: string; enough: boolean } | { kind: "wallet" | "cashback" };
    commission: string | null;
  }[];
  orders: { id: string; number: string; paidBefore: string; paidAfter: string }[];
  legacyAllocation: boolean;
  delivery: { taskId: string; collectedBefore: string; collectedAfter: string }[];
  shift: { id: string; open: boolean } | null;
  /** Bank tushumining avans qismi — to'lov bilan birga bekor qilinadi. */
  advance?: { amount: string; accountName: string; walletBefore: string; walletAfter: string } | null;
  blockers: string[];
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Naqd", card: "Karta", bank: "Bank", transfer: "O'tkazma", balance: "Hamyondan", cashback: "Keshbekdan",
};

function Change({ before, after }: { before: string; after: string }) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      {money(before)} <ArrowRight className="h-3 w-3 text-muted-foreground" /> <b>{money(after)}</b>
    </span>
  );
}

export default function PaymentReversalDialog({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
  const preview = useApiQuery<Preview>(`/api/sales/payments/${paymentId}/reversal`);
  const [reason, setReason] = useState("");
  const reverse = useApiMutation(() => api.post(`/api/sales/payments/${paymentId}/reverse`, { reason }));
  const data = preview.data;
  const blocked = !data || data.blockers.length > 0;

  const submit = async () => {
    try {
      await reverse.mutateAsync();
      toast.success("To'lov bekor qilindi — kassa, qarz va buxgalteriya qayta hisoblandi");
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl" data-testid="payment-reversal-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Undo2 className="h-4 w-4" /> To'lovni bekor qilish</DialogTitle>
          <DialogDescription>
            To'lov o'chirilmaydi: teskari yozuvlar yaratiladi, tarix saqlanadi. Quyidagi bog'langan operatsiyalar birga
            qaytariladi — hammasi bitta amalda, biri bajarilmasa hech biri bajarilmaydi.
          </DialogDescription>
        </DialogHeader>

        {preview.isLoading || !data ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                To'lov{data.parts.length > 1 ? ` (${data.parts.length} qism — aralash to'lov, birga bekor qilinadi)` : ""}
              </p>
              {data.parts.map((part) => (
                <div key={part.id} className="flex items-center justify-between py-0.5" data-testid="reversal-part">
                  <span>
                    {METHOD_LABELS[part.method] ?? part.method} · {part.paymentDate}
                    {part.moneyBack.kind === "cash_account" && (
                      <span className={part.moneyBack.enough ? "text-muted-foreground" : "text-destructive"}>
                        {" "}— {part.moneyBack.accountName}dan qaytadi (qoldiq {money(part.moneyBack.available)})
                      </span>
                    )}
                    {part.moneyBack.kind === "wallet" && <span className="text-muted-foreground"> — mijoz hamyoniga qaytadi</span>}
                    {part.moneyBack.kind === "cashback" && <span className="text-muted-foreground"> — keshbek hisobiga qaytadi</span>}
                    {part.commission && <span className="text-muted-foreground"> · komissiya {money(part.commission)} qaytadi</span>}
                  </span>
                  <b className="tabular-nums">{part.foreignAmount ? `${money(part.foreignAmount)} ${part.currency}` : money(part.amount)}</b>
                </div>
              ))}
            </div>

            {data.customer && (
              <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2" data-testid="reversal-debt">
                <span>{data.customer.name} — qarz</span>
                <Change before={data.customer.debtBefore} after={data.customer.debtAfter} />
              </div>
            )}
            {data.orders.length > 0 && (
              <div className="rounded-lg border p-3">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Buyurtmalarning to'langan summasi</p>
                {data.orders.map((order) => (
                  <div key={order.id} className="flex items-center justify-between py-0.5">
                    <span>{order.number}</span>
                    <Change before={order.paidBefore} after={order.paidAfter} />
                  </div>
                ))}
                {data.legacyAllocation && (
                  <p className="mt-1 text-xs text-muted-foreground">Eski to'lov: taqsimot saqlanmagan — oxirgi to'langan hujjatlardan qaytariladi.</p>
                )}
              </div>
            )}
            {data.advance && (
              <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2" data-testid="reversal-advance">
                <span>Avans qismi ({money(data.advance.amount)}) — {data.advance.accountName}dan qaytadi; hamyon</span>
                <Change before={data.advance.walletBefore} after={data.advance.walletAfter} />
              </div>
            )}
            {data.delivery.length > 0 && (
              <p className="text-xs text-muted-foreground">Yetkazmada yig'ilgan summa ham kamayadi ({data.delivery.length} ta vazifa).</p>
            )}
            {data.shift && (
              <p className="text-xs text-muted-foreground">
                {data.shift.open ? "Kassa smenasi ochiq — smena tushumi ham kamayadi." : "Smena yopilgan — uning hisoboti o'zgarmaydi, qaytim bugungi harakat bo'lib yoziladi."}
              </p>
            )}

            {data.blockers.length > 0 && (
              <div className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-destructive" data-testid="reversal-blockers">
                {data.blockers.map((blocker) => (
                  <p key={blocker} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {blocker}</p>
                ))}
              </div>
            )}

            {!blocked && (
              <div>
                <Label htmlFor="reversal-reason">Sabab (majburiy)</Label>
                <Textarea id="reversal-reason" data-testid="reversal-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)}
                  placeholder="Masalan: summa xato kiritilgan" />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Yopish</Button>
          <Button variant="destructive" data-testid="reversal-confirm" disabled={blocked || reason.trim().length < 3 || reverse.isPending} onClick={() => void submit()}>
            {data ? `${money(data.advance ? String(Number(data.total) + Number(data.advance.amount)) : data.total)} so'mni bekor qilish` : "Bekor qilish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

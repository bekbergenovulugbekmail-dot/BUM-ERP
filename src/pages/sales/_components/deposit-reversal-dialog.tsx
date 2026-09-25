/**
 * Avans kirimini (balansni to'ldirish yoki faqat avansdan iborat bank tushumi) BEKOR QILISH.
 *
 * O'chirilmaydi: pul hisobdan qaytadi, jurnal teskari (DR 2300 / CR kassa-bank), hamyon kamayadi, asl qator "bekor"
 * bo'lib tarixda qoladi. Avans ishlatilgan yoki hisobda pul yetmasa — server rad etadi va sababini aytadi.
 * Qarz qismi bor bank tushumi to'lov qatoridan bekor qilinadi (avans ham birga qaytadi).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";

export default function DepositReversalDialog({ customerId, depositId, onClose }: { customerId: string; depositId: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reverse = useApiMutation(() => api.post(`/api/sales/customers/${customerId}/balance-deposits/${depositId}/reverse`, { reason }));

  const submit = async () => {
    setError(null);
    try {
      await reverse.mutateAsync();
      toast.success("Avans kirimi bekor qilindi — hamyon, bank/kassa va buxgalteriya qayta hisoblandi");
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="deposit-reversal-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Undo2 className="h-4 w-4" /> Avans kirimini bekor qilish</DialogTitle>
          <DialogDescription>
            Kirim o'chirilmaydi: pul hisobdan qaytadi, mijoz hamyoni kamayadi, teskari yozuvlar tarixda qoladi.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="deposit-reversal-reason">Sabab (majburiy)</Label>
          <Textarea id="deposit-reversal-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Masalan: boshqa mijozning puli" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Yopish</Button>
          <Button variant="destructive" disabled={reason.trim().length < 3 || reverse.isPending} onClick={() => void submit()}>Bekor qilish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

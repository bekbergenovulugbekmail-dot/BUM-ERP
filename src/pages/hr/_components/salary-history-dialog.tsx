/**
 * FIKSATSIYALANGAN OYLIKNI O'ZGARTIRISH VA TARIXI.
 *
 * Nega alohida oyna: oylikni shunchaki "tahrirlab qo'yish" tugagan oy hisob-kitobini buzadi.
 * Shuning uchun o'zgarish QAYSI OYDAN amal qilishi va NEGA o'zgargani bilan yoziladi —
 * maosh tayyorlashda shu oyga amal qilgan stavka olinadi, tarix esa saqlanib qoladi.
 *
 * Ruxsat: `hr.salary` (server ham tekshiradi — bu yerda faqat ko'rinish boshqariladi).
 */
import { useState } from "react";
import { toast } from "sonner";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";

type Change = {
  id: string;
  oldSalary: string;
  newSalary: string;
  effectiveMonth: string;
  reason: string | null;
  createdAt: string;
};

const fmt = (value: string | number) => new Intl.NumberFormat("uz-UZ").format(Math.round(Number(value)));
/** Joriy oy "YYYY-MM" — sukut bo'yicha o'zgarish shu oydan amal qiladi. */
const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function SalaryHistoryDialog({
  employee,
  onClose,
}: {
  employee: { id: string; name: string; baseSalary: string };
  onClose: () => void;
}) {
  const [newSalary, setNewSalary] = useState("");
  const [effectiveMonth, setEffectiveMonth] = useState(thisMonth());
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const path = `/api/hr/employees/${employee.id}/salary-history`;
  const history = useApiQuery<{ history: Change[] }>(path).data?.history;
  const save = useApiMutation((body: object) => api.post(path, body), {
    invalidate: [path, "/api/hr/employees"],
  });

  const submit = async () => {
    setError(null);
    if (newSalary.trim() === "" || Number(newSalary) < 0) {
      setError("Yangi oylikni kiriting");
      return;
    }
    try {
      await save.mutateAsync({
        newSalary: newSalary.trim(),
        effectiveMonth,
        reason: reason.trim() || null,
      });
      toast.success("Oylik o'zgarishi yozildi");
      setNewSalary("");
      setReason("");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{employee.name} — fiksatsiyalangan oylik</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex justify-between rounded-lg border border-border px-3 py-2 text-sm">
            <span className="text-muted-foreground">Joriy oylik</span>
            <span className="font-semibold tabular-nums">{fmt(employee.baseSalary)} so&apos;m</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="salary-new">Yangi oylik (so&apos;m)</Label>
              <Input
                id="salary-new"
                inputMode="decimal"
                value={newSalary}
                onChange={(event) => setNewSalary(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="salary-month">Qaysi oydan</Label>
              <Input
                id="salary-month"
                type="month"
                value={effectiveMonth}
                onChange={(event) => setEffectiveMonth(event.target.value)}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            O&apos;zgarish SHU OYDAN amal qiladi. Undan oldingi oylar eski stavka bilan hisoblanadi —
            tugagan oyning oyligi qayta hisoblanganda ham buzilmaydi.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="salary-reason">Sabab</Label>
            <Textarea
              id="salary-reason"
              rows={2}
              placeholder="Masalan: ish hajmi oshdi"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <History className="h-4 w-4 text-muted-foreground" /> O&apos;zgarishlar tarixi
            </p>
            {history === undefined ? (
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, index) => <Skeleton key={index} className="h-10 w-full" />)}
              </div>
            ) : history.length === 0 ? (
              <p className="text-xs text-muted-foreground">Hali o&apos;zgarish yozilmagan.</p>
            ) : (
              <div className="max-h-48 divide-y divide-border overflow-auto rounded-lg border border-border">
                {history.map((change) => (
                  <div key={change.id} className="flex items-start justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm tabular-nums">
                        {fmt(change.oldSalary)} → <span className="font-semibold">{fmt(change.newSalary)}</span>
                      </p>
                      {change.reason && <p className="truncate text-[11px] text-muted-foreground">{change.reason}</p>}
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{change.effectiveMonth} dan</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Yopish</Button>
          <Button disabled={save.isPending} onClick={() => void submit()}>Saqlash</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

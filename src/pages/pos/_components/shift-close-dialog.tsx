import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

type Props = {
  shift: Doc<"posShifts">;
  onClose: () => void;
};

export default function ShiftCloseDialog({ shift, onClose }: Props) {
  const [closingCash, setClosingCash] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const closeShift = useMutation(api.sales.pos.closeShift);

  const handleClose = async () => {
    setLoading(true);
    try {
      await closeShift({
        shiftId: shift._id,
        closingCash: parseFloat(closingCash) || 0,
        notes: notes || undefined,
      });
      toast.success("Smena yopildi");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Xatolik");
    } finally { setLoading(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Smenani yopish</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* Stats */}
          <div className="bg-muted/40 rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Jami sotuv</p>
              <p className="font-bold">{fmt(shift.totalSales)} so'm</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cheklar soni</p>
              <p className="font-bold">{shift.receiptCount} ta</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Naqd sotuv</p>
              <p className="font-bold">{fmt(shift.totalCash)} so'm</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Karta sotuv</p>
              <p className="font-bold">{fmt(shift.totalCard)} so'm</p>
            </div>
          </div>
          <Separator />
          <div>
            <Label>Kassadagi naqd pul (so'm)</Label>
            <Input type="number" min="0" value={closingCash}
              onChange={(e) => setClosingCash(e.target.value)} placeholder="0" />
          </div>
          <div>
            <Label>Izoh</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ixtiyoriy..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button variant="destructive" onClick={handleClose} disabled={loading}>
            {loading ? "..." : "Smena yopish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

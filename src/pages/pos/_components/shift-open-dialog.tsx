import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

type Props = {
  warehouseId: Id<"warehouses">;
  onClose: () => void;
};

export default function ShiftOpenDialog({ warehouseId, onClose }: Props) {
  const [cashierName, setCashierName] = useState("");
  const [openingCash, setOpeningCash] = useState("");
  const [loading, setLoading] = useState(false);
  const openShift = useMutation(api.sales.pos.openShift);

  const handleOpen = async () => {
    setLoading(true);
    try {
      await openShift({
        warehouseId,
        cashierName: cashierName || undefined,
        openingCash: parseFloat(openingCash) || 0,
      });
      toast.success("Smena ochildi");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Xatolik");
    } finally { setLoading(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Smena ochish</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Kassir ismi</Label>
            <Input value={cashierName} onChange={(e) => setCashierName(e.target.value)} placeholder="Ismi sharifi" />
          </div>
          <div>
            <Label>Boshlang'ich naqd pul (so'm)</Label>
            <Input type="number" min="0" value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)} placeholder="0" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button onClick={handleOpen} disabled={loading}>
            {loading ? "..." : "Smena ochish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";

type Props = {
  warehouseId: string;
  warehouseName?: string;
  onClose: () => void;
};

export default function ShiftOpenDialog({ warehouseId, warehouseName, onClose }: Props) {
  // Kassir — tizimga kirgan foydalanuvchi (server o'zi yozadi)
  const [openingCash, setOpeningCash] = useState("");
  const [notes, setNotes] = useState("");
  const openShift = useApiMutation((body: object) => api.post("/api/sales/pos/shifts", body));

  const handleOpen = async () => {
    try {
      await openShift.mutateAsync({
        warehouseId,
        openingCash: openingCash.trim() || "0",
        notes: notes.trim() || null,
      });
      toast.success("Smena ochildi");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Smena ochish{warehouseName ? ` — ${warehouseName}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Boshlang'ich naqd pul (so'm)</Label>
            <Input type="number" min="0" value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)} placeholder="0" />
          </div>
          <div>
            <Label>Izoh</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ixtiyoriy..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button onClick={handleOpen} disabled={openShift.isPending}>
            {openShift.isPending ? "..." : "Smena ochish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

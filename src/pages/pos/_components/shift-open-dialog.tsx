import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";
import { useCurrencies } from "@/hooks/use-currencies.ts";

type Props = {
  warehouseId: string;
  warehouseName?: string;
  onClose: () => void;
};

export default function ShiftOpenDialog({ warehouseId, warehouseName, onClose }: Props) {
  // Kassir — tizimga kirgan foydalanuvchi (server o'zi yozadi)
  const [openingCash, setOpeningCash] = useState("");
  const [foreignCash, setForeignCash] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const openShift = useApiMutation((body: object) => api.post("/api/sales/pos/shifts", body));
  const currencies = useCurrencies();
  const foreignCodes = currencies.codes.filter((code) => code !== currencies.base);

  const handleOpen = async () => {
    // Chet valyutadagi boshlang'ich naqd — faqat kiritilganlari
    const openingForeignCash = foreignCodes
      .map((currency) => ({ currency, amount: (foreignCash[currency] ?? "").trim() }))
      .filter((row) => row.amount !== "" && Number(row.amount) > 0);
    try {
      await openShift.mutateAsync({
        warehouseId,
        openingCash: openingCash.trim() || "0",
        ...(openingForeignCash.length > 0 ? { openingForeignCash } : {}),
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
            <Label htmlFor="shift-opening-cash">Boshlang'ich naqd pul (so'm)</Label>
            <Input
              id="shift-opening-cash"
              data-testid="opening-cash"
              type="number"
              min="0"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              placeholder="0"
            />
          </div>
          {foreignCodes.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {foreignCodes.map((code) => (
                <div key={code}>
                  <Label>Boshlang'ich naqd ({code})</Label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={foreignCash[code] ?? ""}
                    onChange={(e) => setForeignCash((prev) => ({ ...prev, [code]: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              ))}
            </div>
          )}
          <div>
            <Label htmlFor="shift-open-notes">Izoh</Label>
            <Input id="shift-open-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ixtiyoriy..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button data-testid="open-session-confirm" onClick={handleOpen} disabled={openShift.isPending}>
            {openShift.isPending ? "..." : "Smena ochish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

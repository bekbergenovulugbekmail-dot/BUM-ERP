import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useCurrencies } from "@/hooks/use-currencies.ts";

type Kassa = { id: string; name: string; code: string | null; balance: string; openShift: { id: string; cashierName: string | null } | null };

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
  // Ko'p kassa: omborda kassalar bo'lsa — qaysi kassada (pul qutisi) ishlash tanlanadi; band kassa tanlanmaydi
  const kassaList = useApiQuery<{ kassas: Kassa[] }>("/api/sales/pos/kassas", { warehouseId }).data?.kassas;
  const [kassaId, setKassaId] = useState<string | null>(null);
  const freeKassas = kassaList?.filter((kassa) => !kassa.openShift) ?? [];
  const selectedKassa = kassaId ?? (freeKassas.length === 1 ? freeKassas[0]!.id : null);
  const needsKassa = (kassaList?.length ?? 0) > 0;
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
        ...(needsKassa && selectedKassa ? { cashAccountId: selectedKassa } : {}),
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
          {needsKassa && (
            <div>
              <Label>Kassa</Label>
              <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="kassa-picker">
                {kassaList!.map((kassa) => {
                  const busy = Boolean(kassa.openShift);
                  const active = selectedKassa === kassa.id;
                  return (
                    <button
                      key={kassa.id}
                      type="button"
                      disabled={busy}
                      data-testid={`kassa-${kassa.code ?? kassa.id}`}
                      onClick={() => setKassaId(kassa.id)}
                      className={`rounded-lg border p-2 text-left text-sm transition ${
                        active ? "border-primary bg-primary/10 ring-2 ring-primary" : "hover:bg-muted"
                      } ${busy ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                      <div className="font-semibold">{kassa.code ? `${kassa.code} · ${kassa.name}` : kassa.name}</div>
                      <div className={`text-xs ${!busy && Number(kassa.balance) < 0 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                        {busy ? `Band: ${kassa.openShift!.cashierName ?? "smena ochiq"}` : `Qoldiq: ${Number(kassa.balance).toLocaleString("ru-RU")} so'm`}
                      </div>
                    </button>
                  );
                })}
              </div>
              {freeKassas.length === 0 && <p className="mt-1 text-xs text-destructive">Bo'sh kassa yo'q — barcha kassalarda smena ochiq</p>}
              {/* Manfiy qoldiqli kassada naqd sotuv serverda rad etiladi — kassir sababni sotuv paytida emas, hozir bilsin */}
              {selectedKassa && Number(kassaList!.find((kassa) => kassa.id === selectedKassa)?.balance ?? 0) < 0 && (
                <p className="mt-1 text-xs text-destructive" data-testid="kassa-negative-warning">
                  Bu kassada qoldiq manfiy — naqd sotuv va to'lov rad etiladi. Rahbar Kassalar bo'limida qoldiqni
                  to'g'rilagach ishlaydi.
                </p>
              )}
            </div>
          )}
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
          <Button data-testid="open-session-confirm" onClick={handleOpen} disabled={openShift.isPending || (needsKassa && !selectedKassa)}>
            {openShift.isPending ? "..." : "Smena ochish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

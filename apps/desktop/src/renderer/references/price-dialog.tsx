import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import type { PriceRow } from "../../shared/kassa-api.js";
import { decimalInput, trimDecimal } from "../format.ts";
import { call, errorText } from "../kassa.ts";

type Field = "salesPrice" | "wholesalePrice" | "retailPrice" | "promoPrice" | "purchasePrice";

const FIELDS: { key: Field; label: string; required?: boolean }[] = [
  { key: "salesPrice", label: "Sotuv narxi", required: true },
  { key: "retailPrice", label: "Chakana narx" },
  { key: "wholesalePrice", label: "Ulgurji narx" },
  { key: "promoPrice", label: "Aksiya narxi" },
  { key: "purchasePrice", label: "Xarid narxi", required: true },
];

const text = (value: string | null) => (value == null ? "" : trimDecimal(value));

/** Mahsulot narxlari (asosiy birlik, mahsulot valyutasida) — kassada darhol, serverga sinxronda. */
export default function PriceDialog({ row, baseCurrency, onClose, onSaved }: { row: PriceRow; baseCurrency: string; onClose: () => void; onSaved: (row: PriceRow) => void }) {
  const [values, setValues] = useState<Record<Field, string>>({
    salesPrice: text(row.salesPrice),
    wholesalePrice: text(row.wholesalePrice),
    retailPrice: text(row.retailPrice),
    promoPrice: text(row.promoPrice),
    purchasePrice: text(row.purchasePrice),
  });
  const [promoEnd, setPromoEnd] = useState(row.promoPriceEnd ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visible = FIELDS.filter((field) => field.key !== "purchasePrice" || row.purchasePrice !== null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await call("ref:price-update", {
        productId: row.productId,
        salesPrice: values.salesPrice,
        wholesalePrice: values.wholesalePrice || null,
        retailPrice: values.retailPrice || null,
        promoPrice: values.promoPrice || null,
        promoPriceEnd: values.promoPrice ? promoEnd || null : null,
        ...(row.purchasePrice !== null ? { purchasePrice: values.purchasePrice } : {}),
      });
      onSaved(saved);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const currencyOf = (key: Field) => (key === "purchasePrice" ? (row.purchaseCurrency ?? baseCurrency) : (row.salesCurrency ?? baseCurrency));

  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{row.name}</DialogTitle>
          <DialogDescription>
            {row.sku} · 1 {row.unitName} uchun. Kassada darhol amal qiladi; serverga faqat o'zgargan narxlar yuboriladi.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            {visible.map((field) => (
              <div key={field.key} className="space-y-1">
                <Label htmlFor={`price-${field.key}`}>
                  {field.label} ({currencyOf(field.key)})
                </Label>
                <Input
                  id={`price-${field.key}`}
                  inputMode="decimal"
                  className="text-right"
                  placeholder={field.required ? "" : "yo'q"}
                  value={values[field.key]}
                  onChange={(e) => setValues((current) => ({ ...current, [field.key]: decimalInput(e.target.value, 4) }))}
                />
              </div>
            ))}
            {values.promoPrice && (
              <div className="space-y-1">
                <Label htmlFor="price-promo-end">Aksiya tugashi</Label>
                <Input id="price-promo-end" type="date" value={promoEnd} onChange={(e) => setPromoEnd(e.target.value)} />
              </div>
            )}
          </div>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Bekor qilish
            </Button>
            <Button type="submit" disabled={busy || values.salesPrice === "" || (row.purchasePrice !== null && values.purchasePrice === "")}>
              Saqlash
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

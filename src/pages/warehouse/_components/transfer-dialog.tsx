import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog.tsx";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select.tsx";
import { ArrowLeftRight } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import type { ProductListResponse } from "@/pages/products/_lib/types.ts";
import { formatQty } from "@/pages/products/_lib/types.ts";
import type { WarehouseItem } from "../_lib/types.ts";
import { localIsoDate, occurredAtFor } from "../_lib/dates.ts";
import { useProductUnits } from "../_lib/use-product-units.ts";

const schema = z.object({
  productId: z.string().min(1, "Mahsulot tanlang"),
  unitId: z.string(),
  toWarehouseId: z.string().min(1, "Manzil ombor tanlang"),
  quantity: z.number().gt(0, "Miqdor 0 dan katta bo'lishi kerak"),
  date: z.string().min(1),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  fromWarehouseId: string;
  warehouses: WarehouseItem[];
  onClose: () => void;
};

export default function TransferDialog({ fromWarehouseId, warehouses, onClose }: Props) {
  const products = useApiQuery<ProductListResponse>("/api/catalog/products", { isActive: true, limit: 200 }).data
    ?.products;

  const today = localIsoDate();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      productId: "",
      unitId: "",
      toWarehouseId: "",
      quantity: 0,
      date: today,
      notes: "",
    },
  });

  const otherWarehouses = warehouses.filter((w) => w.id !== fromWarehouseId);
  const fromWarehouse = warehouses.find((w) => w.id === fromWarehouseId);
  const selectedProductId = useWatch({ control: form.control, name: "productId" });
  const toWarehouseId = useWatch({ control: form.control, name: "toWarehouseId" });
  const selectedProduct = products?.find((p) => p.id === selectedProductId);
  const unitOptions = useProductUnits(selectedProduct);

  // Tannarx serverda: qabul qiluvchi ombor manbadagi o'rtacha tannarxni oladi
  const transfer = useApiMutation((values: FormValues) =>
    api.post("/api/inventory/stock/transfers", {
      productId: values.productId,
      fromWarehouseId,
      toWarehouseId: values.toWarehouseId,
      quantity: values.quantity,
      ...(selectedProduct && values.unitId && values.unitId !== selectedProduct.baseUnitId ? { unitId: values.unitId } : {}),
      occurredAt: occurredAtFor(values.date),
      notes: values.notes?.trim() || null,
    }),
  );

  const onSubmit = async (values: FormValues) => {
    try {
      await transfer.mutateAsync(values);
      toast.success("Ko'chirish amalga oshirildi");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-blue-600" />
            Omborlar o'rtasida ko'chirish
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* From/To visual */}
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-xl text-sm">
              <div className="flex-1 text-center">
                <p className="text-xs text-muted-foreground">Qayerdan</p>
                <p className="font-semibold">{fromWarehouse?.name ?? "—"}</p>
              </div>
              <ArrowLeftRight className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 text-center">
                <p className="text-xs text-muted-foreground">Qayerga</p>
                <p className="font-semibold text-primary">
                  {toWarehouseId
                    ? warehouses.find((w) => w.id === toWarehouseId)?.name ?? "—"
                    : "Tanlang..."}
                </p>
              </div>
            </div>

            <FormField control={form.control} name="toWarehouseId" render={({ field }) => (
              <FormItem>
                <FormLabel>Manzil ombor *</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {otherWarehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="productId" render={({ field }) => (
              <FormItem>
                <FormLabel>Mahsulot *</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(productId) => {
                    field.onChange(productId);
                    form.setValue("unitId", products?.find((p) => p.id === productId)?.baseUnitId ?? "");
                  }}
                >
                  <FormControl><SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {products?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="font-mono text-xs mr-2 text-muted-foreground">{p.sku}</span>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="quantity" render={({ field }) => (
                <FormItem>
                  <FormLabel>Miqdor *</FormLabel>
                  <FormControl>
                    <Input type="number" min="0" step="any" {...field}
                      onChange={(e) => field.onChange(e.target.valueAsNumber)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="unitId" render={({ field }) => (
                <FormItem>
                  <FormLabel>O'lchov</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={!selectedProduct}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {unitOptions.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.label}
                          {u.factor !== "1" ? ` (= ${formatQty(u.factor)} ${selectedProduct?.baseUnitName ?? ""})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="date" render={({ field }) => (
              <FormItem>
                <FormLabel>Sana</FormLabel>
                <FormControl><Input type="date" max={today} {...field} /></FormControl>
              </FormItem>
            )} />

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Izoh</FormLabel>
                <FormControl><Textarea rows={2} placeholder="Ixtiyoriy..." {...field} /></FormControl>
              </FormItem>
            )} />

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={onClose}>Bekor</Button>
              <Button type="submit" disabled={transfer.isPending}>
                {transfer.isPending ? "..." : "Ko'chirish"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

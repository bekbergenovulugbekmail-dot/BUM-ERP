import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
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
import type { Id } from "@/convex/_generated/dataModel.d.ts";

const schema = z.object({
  productId: z.string().min(1, "Mahsulot tanlang"),
  toWarehouseId: z.string().min(1, "Manzil ombor tanlang"),
  quantity: z.number().min(0.001),
  unitId: z.string().min(1),
  costPrice: z.number().min(0),
  notes: z.string().optional(),
  date: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  fromWarehouseId: Id<"warehouses">;
  warehouses: { _id: Id<"warehouses">; name: string }[];
  onClose: () => void;
};

export default function TransferDialog({ fromWarehouseId, warehouses, onClose }: Props) {
  const products = useQuery(api.products.products.list, {
    paginationOpts: { cursor: null, numItems: 200 },
  });
  const units = useQuery(api.products.units.list, {});
  const transferStock = useMutation(api.warehouse.stock.transferStock);
  const [loading, setLoading] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      productId: "",
      toWarehouseId: "",
      quantity: 0,
      unitId: "",
      costPrice: 0,
      notes: "",
      date: today,
    },
  });

  const otherWarehouses = warehouses.filter((w) => w._id !== fromWarehouseId);
  const fromWarehouse = warehouses.find((w) => w._id === fromWarehouseId);

  const handleProductChange = (productId: string) => {
    form.setValue("productId", productId);
    const product = products?.page.find((p) => p._id === productId);
    if (product) {
      form.setValue("costPrice", product.purchasePrice);
      form.setValue("unitId", product.baseUnitId);
    }
  };

  const onSubmit = async (values: FormValues) => {
    setLoading(true);
    try {
      await transferStock({
        productId: values.productId as Id<"products">,
        fromWarehouseId,
        toWarehouseId: values.toWarehouseId as Id<"warehouses">,
        quantity: values.quantity,
        unitId: values.unitId as Id<"units">,
        costPrice: values.costPrice,
        notes: values.notes || undefined,
        date: values.date,
      });
      toast.success("Ko'chirish amalga oshirildi");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Xatolik yuz berdi");
    } finally {
      setLoading(false);
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
                  {form.watch("toWarehouseId")
                    ? warehouses.find((w) => w._id === form.watch("toWarehouseId"))?.name ?? "—"
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
                      <SelectItem key={w._id} value={w._id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="productId" render={({ field }) => (
              <FormItem>
                <FormLabel>Mahsulot *</FormLabel>
                <Select value={field.value} onValueChange={handleProductChange}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {products?.page.map((p) => (
                      <SelectItem key={p._id} value={p._id}>
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
                    <Input type="number" min="0" step="0.001" {...field}
                      onChange={(e) => field.onChange(e.target.valueAsNumber)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="unitId" render={({ field }) => (
                <FormItem>
                  <FormLabel>O'lchov</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {units?.map((u) => (
                        <SelectItem key={u._id} value={u._id}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="date" render={({ field }) => (
              <FormItem>
                <FormLabel>Sana</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
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
              <Button type="submit" disabled={loading}>
                {loading ? "..." : "Ko'chirish"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

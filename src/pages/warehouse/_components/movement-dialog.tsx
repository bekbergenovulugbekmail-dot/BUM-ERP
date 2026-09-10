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
import { PackagePlus, PackageMinus, SlidersHorizontal, Trash2 } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const MOVEMENT_INFO = {
  receive: {
    title: "Tovar qabul qilish",
    icon: <PackagePlus className="h-5 w-5 text-green-600" />,
    color: "text-green-600",
    qtyLabel: "Qabul miqdori",
  },
  issue: {
    title: "Tovar chiqarish",
    icon: <PackageMinus className="h-5 w-5 text-amber-600" />,
    color: "text-amber-600",
    qtyLabel: "Chiqarish miqdori",
  },
  adjust: {
    title: "Zaxirani tuzatish",
    icon: <SlidersHorizontal className="h-5 w-5 text-purple-600" />,
    color: "text-purple-600",
    qtyLabel: "Yangi miqdor (faktik)",
  },
  writeoff: {
    title: "Hisobdan chiqarish",
    icon: <Trash2 className="h-5 w-5 text-destructive" />,
    color: "text-destructive",
    qtyLabel: "Chiqariladigan miqdor",
  },
};

const schema = z.object({
  productId: z.string().min(1, "Mahsulot tanlang"),
  unitId: z.string().min(1),
  quantity: z.number().min(0.001, "Miqdor 0 dan katta bo'lishi kerak"),
  costPrice: z.number().min(0),
  notes: z.string().optional(),
  date: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  type: "receive" | "issue" | "adjust" | "writeoff";
  warehouseId: Id<"warehouses">;
  onClose: () => void;
};

export default function MovementDialog({ type, warehouseId, onClose }: Props) {
  const info = MOVEMENT_INFO[type];
  const products = useQuery(api.products.products.list, {
    paginationOpts: { cursor: null, numItems: 200 },
  });
  const units = useQuery(api.products.units.list, {});
  const recordMovement = useMutation(api.warehouse.stock.recordMovement);
  const [loading, setLoading] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      productId: "",
      unitId: "",
      quantity: 0,
      costPrice: 0,
      notes: "",
      date: today,
    },
  });

  const selectedProductId = form.watch("productId");
  const selectedProduct = products?.page.find((p) => p._id === selectedProductId);

  // Auto-fill cost price and unit when product selected
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
      // For "adjust" type, we need to figure out the delta
      // We record it as "adjust" type; the backend treats positive qty as "in"
      await recordMovement({
        type: type === "adjust" ? "adjust" : type === "writeoff" ? "writeoff" : type,
        productId: values.productId as Id<"products">,
        warehouseId,
        quantity: values.quantity,
        unitId: values.unitId as Id<"units">,
        costPrice: values.costPrice,
        notes: values.notes || undefined,
        date: values.date,
      });

      toast.success(
        type === "receive" ? "Tovar qabul qilindi" :
        type === "issue" ? "Tovar chiqarildi" :
        type === "adjust" ? "Zaxira tuzatildi" : "Hisobdan chiqarildi"
      );
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
            {info.icon}
            <span>{info.title}</span>
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="productId" render={({ field }) => (
              <FormItem>
                <FormLabel>Mahsulot *</FormLabel>
                <Select value={field.value} onValueChange={handleProductChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Mahsulot tanlang" />
                    </SelectTrigger>
                  </FormControl>
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
                  <FormLabel>{info.qtyLabel} *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      {...field}
                      onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    />
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

            <FormField control={form.control} name="costPrice" render={({ field }) => (
              <FormItem>
                <FormLabel>Narx (so'm)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min="0"
                    {...field}
                    onChange={(e) => field.onChange(e.target.valueAsNumber)}
                  />
                </FormControl>
              </FormItem>
            )} />

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
                {loading ? "..." : info.title}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

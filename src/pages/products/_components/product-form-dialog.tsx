import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

const schema = z.object({
  name: z.string().min(1, "Nomi kiritilishi shart"),
  sku: z.string().min(1, "SKU kiritilishi shart"),
  barcode: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
  manufacturer: z.string().optional(),
  baseUnitId: z.string().min(1, "O'lchov birligi shart"),
  purchaseUnitId: z.string().optional(),
  salesUnitId: z.string().optional(),
  purchasePrice: z.number().min(0),
  salesPrice: z.number().min(0),
  wholesalePrice: z.number().optional(),
  retailPrice: z.number().optional(),
  promoPrice: z.number().optional(),
  taxRate: z.number().min(0).max(100),
  taxIncluded: z.boolean(),
  minStock: z.number().min(0),
  maxStock: z.number().optional(),
  trackBatch: z.boolean(),
  trackExpiry: z.boolean(),
  shelfLifeDays: z.number().optional(),
  costingMethod: z.enum(["fifo", "fefo", "average", "manual"]),
  isSaleable: z.boolean(),
  isPurchaseable: z.boolean(),
  isManufactured: z.boolean(),
  weight: z.number().optional(),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  open: boolean;
  onClose: () => void;
  editId: Id<"products"> | null;
};

const COSTING_METHODS = [
  { value: "fifo", label: "FIFO (Birinchi kirgan — birinchi chiqadi)" },
  { value: "fefo", label: "FEFO (Muddati avval tugagan — birinchi chiqadi)" },
  { value: "average", label: "O'rtacha narx" },
  { value: "manual", label: "Qo'lda" },
];

export default function ProductFormDialog({ open, onClose, editId }: Props) {
  const categories = useQuery(api.products.categories.list, {});
  const brands = useQuery(api.products.brands.list, {});
  const units = useQuery(api.products.units.list, {});
  const existingProduct = useQuery(
    api.products.products.getById,
    editId ? { id: editId } : "skip"
  );

  const createProduct = useMutation(api.products.products.create);
  const updateProduct = useMutation(api.products.products.update);
  const [loading, setLoading] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "", sku: "", barcode: "", description: "",
      imageUrl: "", manufacturer: "",
      purchasePrice: 0, salesPrice: 0,
      taxRate: 12, taxIncluded: false,
      minStock: 0,
      trackBatch: false, trackExpiry: false,
      costingMethod: "fifo",
      isSaleable: true, isPurchaseable: true, isManufactured: false,
    },
  });

  useEffect(() => {
    if (existingProduct && editId) {
      form.reset({
        name: existingProduct.name,
        sku: existingProduct.sku,
        barcode: existingProduct.barcode ?? "",
        description: existingProduct.description ?? "",
        imageUrl: existingProduct.imageUrl ?? "",
        categoryId: existingProduct.categoryId ?? "",
        brandId: existingProduct.brandId ?? "",
        manufacturer: existingProduct.manufacturer ?? "",
        baseUnitId: existingProduct.baseUnitId,
        purchaseUnitId: existingProduct.purchaseUnitId ?? "",
        salesUnitId: existingProduct.salesUnitId ?? "",
        purchasePrice: existingProduct.purchasePrice,
        salesPrice: existingProduct.salesPrice,
        wholesalePrice: existingProduct.wholesalePrice,
        retailPrice: existingProduct.retailPrice,
        promoPrice: existingProduct.promoPrice,
        taxRate: existingProduct.taxRate,
        taxIncluded: existingProduct.taxIncluded,
        minStock: existingProduct.minStock,
        maxStock: existingProduct.maxStock,
        trackBatch: existingProduct.trackBatch,
        trackExpiry: existingProduct.trackExpiry,
        shelfLifeDays: existingProduct.shelfLifeDays,
        costingMethod: existingProduct.costingMethod,
        isSaleable: existingProduct.isSaleable,
        isPurchaseable: existingProduct.isPurchaseable,
        isManufactured: existingProduct.isManufactured,
        weight: existingProduct.weight,
      });
    } else if (!editId) {
      form.reset({
        name: "", sku: "", barcode: "", description: "",
        imageUrl: "", manufacturer: "",
        purchasePrice: 0, salesPrice: 0,
        taxRate: 12, taxIncluded: false,
        minStock: 0,
        trackBatch: false, trackExpiry: false,
        costingMethod: "fifo",
        isSaleable: true, isPurchaseable: true, isManufactured: false,
      });
    }
  }, [existingProduct, editId, form]);

  const onSubmit = async (values: FormValues) => {
    setLoading(true);
    try {
      const payload = {
        name: values.name,
        sku: values.sku,
        barcode: values.barcode || undefined,
        description: values.description || undefined,
        imageUrl: values.imageUrl || undefined,
        categoryId: values.categoryId ? (values.categoryId as Id<"categories">) : undefined,
        brandId: values.brandId ? (values.brandId as Id<"brands">) : undefined,
        manufacturer: values.manufacturer || undefined,
        baseUnitId: values.baseUnitId as Id<"units">,
        purchaseUnitId: values.purchaseUnitId ? (values.purchaseUnitId as Id<"units">) : undefined,
        salesUnitId: values.salesUnitId ? (values.salesUnitId as Id<"units">) : undefined,
        purchasePrice: values.purchasePrice,
        salesPrice: values.salesPrice,
        wholesalePrice: values.wholesalePrice,
        retailPrice: values.retailPrice,
        promoPrice: values.promoPrice,
        taxRate: values.taxRate,
        taxIncluded: values.taxIncluded,
        minStock: values.minStock,
        maxStock: values.maxStock,
        trackBatch: values.trackBatch,
        trackExpiry: values.trackExpiry,
        shelfLifeDays: values.shelfLifeDays,
        costingMethod: values.costingMethod,
        isSaleable: values.isSaleable,
        isPurchaseable: values.isPurchaseable,
        isManufactured: values.isManufactured,
        weight: values.weight,
      };

      if (editId) {
        await updateProduct({ id: editId, ...payload });
      } else {
        await createProduct(payload);
      }
      toast.success(editId ? "Mahsulot yangilandi" : "Mahsulot qo'shildi");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Xatolik yuz berdi");
    } finally {
      setLoading(false);
    }
  };

  const margin = (() => {
    const sp = form.watch("salesPrice");
    const pp = form.watch("purchasePrice");
    if (pp > 0 && sp > 0) return (((sp - pp) / sp) * 100).toFixed(1);
    return "0.0";
  })();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editId ? "Mahsulotni tahrirlash" : "Yangi mahsulot qo'shish"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-0">
            <Tabs defaultValue="basic">
              <TabsList className="w-full">
                <TabsTrigger value="basic" className="flex-1">Asosiy</TabsTrigger>
                <TabsTrigger value="pricing" className="flex-1">Narxlar</TabsTrigger>
                <TabsTrigger value="units" className="flex-1">O'lchov</TabsTrigger>
                <TabsTrigger value="stock" className="flex-1">Zaxira</TabsTrigger>
                <TabsTrigger value="flags" className="flex-1">Qo'shimcha</TabsTrigger>
              </TabsList>

              {/* Basic info */}
              <TabsContent value="basic" className="space-y-4 pt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Mahsulot nomi *</FormLabel>
                      <FormControl><Input placeholder="Coca-Cola 1L" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="sku" render={({ field }) => (
                    <FormItem>
                      <FormLabel>SKU *</FormLabel>
                      <FormControl><Input placeholder="CC-1L-001" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="barcode" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Barcode</FormLabel>
                      <FormControl><Input placeholder="5449000000996" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="categoryId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kategoriya</FormLabel>
                      <Select value={field.value ?? ""} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {categories?.map((c) => (
                            <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="brandId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Brend</FormLabel>
                      <Select value={field.value ?? ""} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {brands?.map((b) => (
                            <SelectItem key={b._id} value={b._id}>{b.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="manufacturer" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ishlab chiqaruvchi</FormLabel>
                      <FormControl><Input placeholder="The Coca-Cola Company" {...field} /></FormControl>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="imageUrl" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Rasm URL</FormLabel>
                      <FormControl><Input placeholder="https://..." {...field} /></FormControl>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="description" render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Tavsif</FormLabel>
                      <FormControl><Textarea rows={3} placeholder="Mahsulot haqida..." {...field} /></FormControl>
                    </FormItem>
                  )} />
                </div>
              </TabsContent>

              {/* Pricing */}
              <TabsContent value="pricing" className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="purchasePrice" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Xarid narxi (so'm) *</FormLabel>
                      <FormControl><Input type="number" min="0" {...field} onChange={e => field.onChange(e.target.valueAsNumber)} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="salesPrice" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sotuv narxi (so'm) *</FormLabel>
                      <FormControl><Input type="number" min="0" {...field} onChange={e => field.onChange(e.target.valueAsNumber)} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="wholesalePrice" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ulgurji narx</FormLabel>
                      <FormControl><Input type="number" min="0" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.valueAsNumber || undefined)} /></FormControl>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="retailPrice" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Chakana narx</FormLabel>
                      <FormControl><Input type="number" min="0" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.valueAsNumber || undefined)} /></FormControl>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="promoPrice" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Aksiya narxi</FormLabel>
                      <FormControl><Input type="number" min="0" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.valueAsNumber || undefined)} /></FormControl>
                    </FormItem>
                  )} />

                  <div className="flex items-center gap-4 self-end pb-2">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Marja: </span>
                      <span className="font-bold text-green-600">{margin}%</span>
                    </div>
                  </div>

                  <FormField control={form.control} name="taxRate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Soliq stavkasi (%)</FormLabel>
                      <FormControl><Input type="number" min="0" max="100" {...field} onChange={e => field.onChange(e.target.valueAsNumber)} /></FormControl>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="taxIncluded" render={({ field }) => (
                    <FormItem className="flex items-center gap-3 self-end pb-2">
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <FormLabel className="!mt-0">Narxga soliq kiritilgan</FormLabel>
                    </FormItem>
                  )} />
                </div>
              </TabsContent>

              {/* Units */}
              <TabsContent value="units" className="space-y-4 pt-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField control={form.control} name="baseUnitId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Asosiy o'lchov *</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {units?.map((u) => (
                            <SelectItem key={u._id} value={u._id}>{u.name} ({u.shortName})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="purchaseUnitId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Xarid o'lchovi</FormLabel>
                      <Select value={field.value ?? ""} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Asosiy bilan bir" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {units?.map((u) => (
                            <SelectItem key={u._id} value={u._id}>{u.name} ({u.shortName})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="salesUnitId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sotuv o'lchovi</FormLabel>
                      <Select value={field.value ?? ""} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Asosiy bilan bir" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {units?.map((u) => (
                            <SelectItem key={u._id} value={u._id}>{u.name} ({u.shortName})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>

                <Separator />
                <div>
                  <p className="text-sm font-medium mb-1">O'lchov konversiyalari</p>
                  <p className="text-xs text-muted-foreground">
                    Masalan: 1 quti = 12 dona, 1 blok = 10 quti. Bu sozlamalar mahsulot saqlanganidan so'ng qo'shiladi.
                  </p>
                </div>
              </TabsContent>

              {/* Stock */}
              <TabsContent value="stock" className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="minStock" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minimal zaxira *</FormLabel>
                      <FormControl><Input type="number" min="0" {...field} onChange={e => field.onChange(e.target.valueAsNumber)} /></FormControl>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="maxStock" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Maksimal zaxira</FormLabel>
                      <FormControl><Input type="number" min="0" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.valueAsNumber || undefined)} /></FormControl>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="costingMethod" render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Tannarx hisobi usuli</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {COSTING_METHODS.map((m) => (
                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="trackBatch" render={({ field }) => (
                    <FormItem className="flex items-center gap-3 col-span-2">
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div>
                        <FormLabel className="!mt-0">Partiya kuzatuvi</FormLabel>
                        <p className="text-xs text-muted-foreground">Batch/Lot raqamlari bo'yicha hisob</p>
                      </div>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="trackExpiry" render={({ field }) => (
                    <FormItem className="flex items-center gap-3 col-span-2">
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div>
                        <FormLabel className="!mt-0">Yaroqlilik muddati kuzatuvi</FormLabel>
                        <p className="text-xs text-muted-foreground">Muddat tugayotgan mahsulotlarga ogohlantirish</p>
                      </div>
                    </FormItem>
                  )} />

                  {form.watch("trackExpiry") && (
                    <FormField control={form.control} name="shelfLifeDays" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Saqlash muddati (kun)</FormLabel>
                        <FormControl><Input type="number" min="1" placeholder="365" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.valueAsNumber || undefined)} /></FormControl>
                      </FormItem>
                    )} />
                  )}
                </div>
              </TabsContent>

              {/* Flags */}
              <TabsContent value="flags" className="space-y-4 pt-4">
                <div className="space-y-4">
                  {(
                    [
                      { name: "isSaleable" as const, label: "Sotiladi", desc: "Bu mahsulotni sotish mumkin" },
                      { name: "isPurchaseable" as const, label: "Xarid qilinadi", desc: "Bu mahsulotni xarid qilish mumkin" },
                      { name: "isManufactured" as const, label: "Ishlab chiqariladi", desc: "Bu mahsulot ishlab chiqariladi (BOM kerak)" },
                    ] as const
                  ).map((flag) => (
                    <FormField key={flag.name} control={form.control} name={flag.name} render={({ field }) => (
                      <FormItem className="flex items-center gap-3">
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div>
                          <FormLabel className="!mt-0">{flag.label}</FormLabel>
                          <p className="text-xs text-muted-foreground">{flag.desc}</p>
                        </div>
                      </FormItem>
                    )} />
                  ))}

                  <Separator />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="weight" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Og'irligi (kg)</FormLabel>
                        <FormControl><Input type="number" step="0.001" min="0" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.valueAsNumber || undefined)} /></FormControl>
                      </FormItem>
                    )} />
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            <DialogFooter className="mt-6 pt-4 border-t">
              <Button type="button" variant="secondary" onClick={onClose}>Bekor qilish</Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Saqlanmoqda..." : editId ? "Yangilash" : "Saqlash"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect, useMemo, useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ImageIcon } from "lucide-react";
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
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import {
  removeProductImage, uploadProductImage, useProductImageUrl, validateProductImage,
} from "../_lib/product-files.ts";
import type { Brand, Category, ProductDetail, Unit } from "../_lib/types.ts";
import { formatMoney, useCurrencies } from "@/hooks/use-currencies.ts";

function CurrencySelect({ value, codes, onChange }: { value: string; codes: string[]; onChange: (code: string) => void }) {
  // Nofaol qilingan valyutada saqlangan narx ham ko'rinib tursin
  const options = codes.includes(value) ? codes : [...codes, value];
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-24 shrink-0" aria-label="Valyuta"><SelectValue /></SelectTrigger>
      <SelectContent position="popper">
        {options.map((code) => <SelectItem key={code} value={code}>{code}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

const schema = z.object({
  name: z.string().min(1, "Nomi kiritilishi shart"),
  /** Bo'sh qoldirilsa serverda avtomatik raqam (1001, 1002, …). */
  sku: z.string(),
  barcode: z.string().optional(),
  description: z.string().optional(),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
  manufacturer: z.string().optional(),
  baseUnitId: z.string().min(1, "O'lchov birligi shart"),
  purchaseUnitId: z.string().optional(),
  salesUnitId: z.string().optional(),
  purchasePrice: z.number().min(0),
  salesPrice: z.number().min(0),
  /** "" — asosiy valyuta. */
  purchaseCurrency: z.string(),
  salesCurrency: z.string(),
  wholesalePrice: z.number().optional(),
  retailPrice: z.number().optional(),
  promoPrice: z.number().optional(),
  taxRate: z.number().min(0).max(100),
  taxIncluded: z.boolean(),
  minStock: z.number().min(0),
  maxStock: z.number().optional(),
  trackBatch: z.boolean(),
  trackExpiry: z.boolean(),
  shelfLifeDays: z.number().int().optional(),
  isSaleable: z.boolean(),
  isPurchaseable: z.boolean(),
  isManufactured: z.boolean(),
  weight: z.number().optional(),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  open: boolean;
  onClose: () => void;
  editId: string | null;
};

const EMPTY_VALUES: FormValues = {
  name: "", sku: "", barcode: "", description: "",
  manufacturer: "", baseUnitId: "",
  purchasePrice: 0, salesPrice: 0, purchaseCurrency: "", salesCurrency: "",
  taxRate: 12, taxIncluded: false,
  minStock: 0,
  trackBatch: false, trackExpiry: false,
  isSaleable: true, isPurchaseable: true, isManufactured: false,
};

/** Bo'sh qiymat — `null`: tahrirlashda maydonni tozalash ham shu yo'l bilan. */
const idOrNull = (value?: string) => (value && value !== "none" ? value : null);
const textOrNull = (value?: string) => (value?.trim() ? value.trim() : null);
const numOrNull = (value?: number) => (value === undefined || Number.isNaN(value) ? null : value);
const optionalNumber = (value: string | null) => (value === null ? undefined : Number(value));

function toPayload(values: FormValues) {
  return {
    name: values.name.trim(),
    ...(values.sku.trim() ? { sku: values.sku.trim() } : {}),
    barcode: textOrNull(values.barcode),
    description: textOrNull(values.description),
    categoryId: idOrNull(values.categoryId),
    brandId: idOrNull(values.brandId),
    manufacturer: textOrNull(values.manufacturer),
    baseUnitId: values.baseUnitId,
    purchaseUnitId: idOrNull(values.purchaseUnitId),
    salesUnitId: idOrNull(values.salesUnitId),
    purchasePrice: values.purchasePrice,
    salesPrice: values.salesPrice,
    purchaseCurrency: values.purchaseCurrency || null,
    salesCurrency: values.salesCurrency || null,
    wholesalePrice: numOrNull(values.wholesalePrice),
    retailPrice: numOrNull(values.retailPrice),
    promoPrice: numOrNull(values.promoPrice),
    taxRate: values.taxRate,
    taxIncluded: values.taxIncluded,
    minStock: values.minStock,
    maxStock: numOrNull(values.maxStock),
    trackBatch: values.trackBatch,
    trackExpiry: values.trackExpiry,
    shelfLifeDays: numOrNull(values.shelfLifeDays),
    // costingMethod yuborilmaydi — server faqat o'rtacha tannarxni (AVCO) qo'llaydi
    isSaleable: values.isSaleable,
    isPurchaseable: values.isPurchaseable,
    isManufactured: values.isManufactured,
    weight: numOrNull(values.weight),
  };
}

export default function ProductFormDialog({ open, onClose, editId }: Props) {
  const categories = useApiQuery<{ categories: Category[] }>(open ? "/api/catalog/categories" : null).data?.categories;
  const brands = useApiQuery<{ brands: Brand[] }>(open ? "/api/catalog/brands" : null, { isActive: true }).data?.brands;
  const units = useApiQuery<{ units: Unit[] }>(open ? "/api/catalog/units" : null).data?.units;
  const currencies = useCurrencies();
  const existingProduct = useApiQuery<{ product: ProductDetail }>(
    open && editId ? `/api/catalog/products/${editId}` : null,
  ).data?.product;

  // Rasm: yangi fayl tanlangan yoki mavjud rasm olib tashlanadi — mahsulot saqlangach bajariladi
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentImageUrl = useProductImageUrl(editId, existingProduct?.imageKey);
  const previewUrl = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : null), [imageFile]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY_VALUES,
  });

  // Dialog ochilganda yoki boshqa mahsulot tahrirlanganda rasm tanlovi tozalanadi (render paytida moslash)
  const imageScope = open ? `open:${editId ?? "new"}` : "closed";
  const [imageStateScope, setImageStateScope] = useState(imageScope);
  if (imageStateScope !== imageScope) {
    setImageStateScope(imageScope);
    if (open) {
      setImageFile(null);
      setRemoveImage(false);
    }
  }
  // Fayl maydonining o'zi (DOM) — effektda
  useEffect(() => {
    if (open && fileInputRef.current) fileInputRef.current.value = "";
  }, [open, editId]);

  useEffect(() => {
    if (!open) return;
    if (existingProduct && editId) {
      form.reset({
        name: existingProduct.name,
        sku: existingProduct.sku,
        barcode: existingProduct.barcode ?? "",
        description: existingProduct.description ?? "",
        categoryId: existingProduct.categoryId ?? "",
        brandId: existingProduct.brandId ?? "",
        manufacturer: existingProduct.manufacturer ?? "",
        baseUnitId: existingProduct.baseUnitId,
        purchaseUnitId: existingProduct.purchaseUnitId ?? "",
        salesUnitId: existingProduct.salesUnitId ?? "",
        purchasePrice: Number(existingProduct.purchasePrice),
        salesPrice: Number(existingProduct.salesPrice),
        purchaseCurrency: existingProduct.purchaseCurrency ?? "",
        salesCurrency: existingProduct.salesCurrency ?? "",
        wholesalePrice: optionalNumber(existingProduct.wholesalePrice),
        retailPrice: optionalNumber(existingProduct.retailPrice),
        promoPrice: optionalNumber(existingProduct.promoPrice),
        taxRate: Number(existingProduct.taxRate),
        taxIncluded: existingProduct.taxIncluded,
        minStock: Number(existingProduct.minStock),
        maxStock: optionalNumber(existingProduct.maxStock),
        trackBatch: existingProduct.trackBatch,
        trackExpiry: existingProduct.trackExpiry,
        shelfLifeDays: existingProduct.shelfLifeDays ?? undefined,
        isSaleable: existingProduct.isSaleable,
        isPurchaseable: existingProduct.isPurchaseable,
        isManufactured: existingProduct.isManufactured,
        weight: optionalNumber(existingProduct.weight),
      });
    } else if (!editId) {
      form.reset(EMPTY_VALUES);
    }
  }, [open, existingProduct, editId, form]);

  const save = useApiMutation(async (values: FormValues) => {
    const payload = toPayload(values);
    const { product } = editId
      ? await api.patch<{ product: { id: string } }>(`/api/catalog/products/${editId}`, payload)
      : await api.post<{ product: { id: string } }>("/api/catalog/products", payload);

    // Mahsulot saqlandi; rasm xatosi alohida ko'rsatiladi (masalan saqlash sozlanmagan — 503)
    let imageError: string | null = null;
    try {
      if (imageFile) await uploadProductImage(product.id, imageFile);
      else if (removeImage && existingProduct?.imageKey) await removeProductImage(product.id);
    } catch (err) {
      imageError = errorMessage(err);
    }
    return { imageError };
  });

  const onSubmit = async (values: FormValues) => {
    try {
      const { imageError } = await save.mutateAsync(values);
      toast.success(editId ? "Mahsulot yangilandi" : "Mahsulot qo'shildi");
      if (imageError) toast.error(`Rasm saqlanmadi: ${imageError}`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    const problem = validateProductImage(file);
    if (problem) {
      toast.error(problem);
      e.target.value = "";
      return;
    }
    setImageFile(file);
    setRemoveImage(false);
  };

  const clearImage = () => {
    setImageFile(null);
    setRemoveImage(Boolean(existingProduct?.imageKey));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const shownImage = previewUrl ?? (removeImage ? null : currentImageUrl ?? null);
  const hasImage = Boolean(imageFile) || (Boolean(existingProduct?.imageKey) && !removeImage);

  const sp = useWatch({ control: form.control, name: "salesPrice" });
  const pp = useWatch({ control: form.control, name: "purchasePrice" });
  const salesCurrency = useWatch({ control: form.control, name: "salesCurrency" }) || currencies.base;
  const purchaseCurrency = useWatch({ control: form.control, name: "purchaseCurrency" }) || currencies.base;
  const trackExpiry = useWatch({ control: form.control, name: "trackExpiry" });
  // Marja asosiy valyutada — xarid va sotuv narxi turli valyutada bo'lishi mumkin
  const spBase = currencies.toBase(sp, salesCurrency);
  const ppBase = currencies.toBase(pp, purchaseCurrency);
  const margin =
    ppBase > 0 && spBase > 0 && Number.isFinite(spBase + ppBase) ? (((spBase - ppBase) / spBase) * 100).toFixed(1) : "0.0";
  const showCurrency = (code: string) => currencies.codes.length > 1 || code !== currencies.base;
  const setCurrency = (name: "purchaseCurrency" | "salesCurrency", code: string) =>
    form.setValue(name, code === currencies.base ? "" : code, { shouldDirty: true });

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
                      <FormLabel>SKU</FormLabel>
                      <FormControl><Input placeholder={editId ? "" : "Avtomatik (1001…)"} {...field} /></FormControl>
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
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
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
                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
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

                  {/* Rasm — tashqi URL emas, fayl saqlashga yuklanadi (JPG/PNG/WEBP, 5 MB) */}
                  <div className="space-y-2">
                    <Label>Rasm</Label>
                    <div className="flex items-center gap-3">
                      {shownImage ? (
                        <img src={shownImage} alt="" className="h-14 w-14 rounded-md object-cover border border-border shrink-0" />
                      ) : (
                        <div className="h-14 w-14 rounded-md bg-muted flex items-center justify-center shrink-0">
                          <ImageIcon className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex flex-col gap-1 min-w-0">
                        <Input
                          ref={fileInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="text-xs h-9"
                          onChange={handleImagePick}
                        />
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-muted-foreground">JPG, PNG yoki WEBP, 5 MB gacha</span>
                          {hasImage && (
                            <button
                              type="button"
                              onClick={clearImage}
                              className="text-[11px] text-destructive hover:underline cursor-pointer"
                            >
                              Olib tashlash
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

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
                      <FormLabel>Xarid narxi ({purchaseCurrency}) *</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input className="flex-1" type="number" min="0" step="any" {...field} onChange={e => field.onChange(e.target.valueAsNumber)} />
                        </FormControl>
                        {showCurrency(purchaseCurrency) && (
                          <CurrencySelect
                            value={purchaseCurrency}
                            codes={currencies.codes}
                            onChange={(code) => setCurrency("purchaseCurrency", code)}
                          />
                        )}
                      </div>
                      {purchaseCurrency !== currencies.base && pp > 0 && Number.isFinite(ppBase) && (
                        <p className="text-[11px] text-muted-foreground">≈ {formatMoney(ppBase, currencies.base)} (joriy kurs)</p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="salesPrice" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sotuv narxi ({salesCurrency}) *</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input className="flex-1" type="number" min="0" step="any" {...field} onChange={e => field.onChange(e.target.valueAsNumber)} />
                        </FormControl>
                        {showCurrency(salesCurrency) && (
                          <CurrencySelect
                            value={salesCurrency}
                            codes={currencies.codes}
                            onChange={(code) => setCurrency("salesCurrency", code)}
                          />
                        )}
                      </div>
                      {salesCurrency !== currencies.base && sp > 0 && Number.isFinite(spBase) && (
                        <p className="text-[11px] text-muted-foreground">
                          ≈ {formatMoney(spBase, currencies.base)} — kassada joriy kurs bilan sotiladi
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="wholesalePrice" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ulgurji narx</FormLabel>
                      <FormControl><Input type="number" min="0" step="any" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.valueAsNumber || undefined)} /></FormControl>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="retailPrice" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Chakana narx</FormLabel>
                      <FormControl><Input type="number" min="0" step="any" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.valueAsNumber || undefined)} /></FormControl>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="promoPrice" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Aksiya narxi</FormLabel>
                      <FormControl><Input type="number" min="0" step="any" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.valueAsNumber || undefined)} /></FormControl>
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
                      <FormControl><Input type="number" min="0" max="100" step="any" {...field} onChange={e => field.onChange(e.target.valueAsNumber)} /></FormControl>
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
                            <SelectItem key={u.id} value={u.id}>{u.name} ({u.shortName})</SelectItem>
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
                            <SelectItem key={u.id} value={u.id}>{u.name} ({u.shortName})</SelectItem>
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
                            <SelectItem key={u.id} value={u.id}>{u.name} ({u.shortName})</SelectItem>
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
                      <FormControl><Input type="number" min="0" step="any" {...field} onChange={e => field.onChange(e.target.valueAsNumber)} /></FormControl>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="maxStock" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Maksimal zaxira</FormLabel>
                      <FormControl><Input type="number" min="0" step="any" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.valueAsNumber || undefined)} /></FormControl>
                    </FormItem>
                  )} />

                  {/* Tannarx usuli: API hozircha faqat o'rtacha tannarxni (AVCO) qo'llaydi — tanlov olib tashlandi */}
                  <div className="col-span-2 rounded-md border border-border px-3 py-2">
                    <p className="text-xs text-muted-foreground">Tannarx hisobi usuli</p>
                    <p className="text-sm font-medium">O'rtacha narx (AVCO)</p>
                  </div>

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

                  {trackExpiry && (
                    <FormField control={form.control} name="shelfLifeDays" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Saqlash muddati (kun)</FormLabel>
                        <FormControl><Input type="number" min="1" step="1" placeholder="365" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.valueAsNumber || undefined)} /></FormControl>
                        <FormMessage />
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
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saqlanmoqda..." : editId ? "Yangilash" : "Saqlash"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

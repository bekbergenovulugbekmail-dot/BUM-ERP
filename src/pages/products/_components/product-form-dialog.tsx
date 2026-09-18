import { useState, useEffect, useMemo, useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ImageIcon, Loader2, Plus, ScanLine, Trash2 } from "lucide-react";
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
import BarcodeScanner from "@/components/barcode-scanner.tsx";
import { useTaxEnabled } from "@/hooks/use-tax.ts";

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
  kind: z.enum(["product", "raw_material", "semi_finished"]),
  isSaleable: z.boolean(),
  isPurchaseable: z.boolean(),
  isManufactured: z.boolean(),
  weight: z.number().optional(),
  weightUnit: z.enum(["kg", "g", "t"]),
  isWeighted: z.boolean(),
  pluCode: z.number().int().min(1, "PLU 1–999999").max(999999, "PLU 1–999999").optional(),
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
  kind: "product", isSaleable: true, isPurchaseable: true, isManufactured: false,
  weightUnit: "kg",
  isWeighted: false,
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
    kind: values.kind,
    isSaleable: values.isSaleable,
    isPurchaseable: values.isPurchaseable,
    isManufactured: values.isManufactured,
    weight: numOrNull(values.weight),
    // Birlik faqat og'irlik kiritilganda (avtomatik biriktirishda transport yuki shu bilan hisoblanadi)
    weightUnit: numOrNull(values.weight) === null ? null : values.weightUnit,
    isWeighted: values.isWeighted,
    pluCode: values.pluCode ?? null,
  };
}

export default function ProductFormDialog({ open, onClose, editId }: Props) {
  // Soliq o'chirilgan bo'lsa maydonlar ko'rinmaydi (server ham 0 yozadi)
  const taxEnabled = useTaxEnabled();
  const categories = useApiQuery<{ categories: Category[] }>(open ? "/api/catalog/categories" : null).data?.categories;
  const brands = useApiQuery<{ brands: Brand[] }>(open ? "/api/catalog/brands" : null, { isActive: true }).data?.brands;
  const units = useApiQuery<{ units: Unit[] }>(open ? "/api/catalog/units" : null).data?.units;
  const currencies = useCurrencies();
  const existingProduct = useApiQuery<{ product: ProductDetail }>(
    open && editId ? `/api/catalog/products/${editId}` : null,
  ).data?.product;

  /** Telefonda barkodni kamera bilan o'qish (USB skaner ham shu oynaga yozadi). */
  const [scannerOpen, setScannerOpen] = useState(false);
  /** "Kategoriya qo'shish" / "Brend qo'shish" — ro'yxat bo'sh bo'lsa ham shu yerdan yaratiladi. */
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [newBrand, setNewBrand] = useState<string | null>(null);
  /** O'lchov konversiyalari: 1 <birlik> = <koeffitsient> <asosiy birlik>. */
  const [conversionDraft, setConversionDraft] = useState<{ unitId: string; factor: string }[]>([]);

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
      setConversionDraft([]);
      setNewCategory(null);
      setNewBrand(null);
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
        kind: existingProduct.kind ?? "product",
        isSaleable: existingProduct.isSaleable,
        isPurchaseable: existingProduct.isPurchaseable,
        isManufactured: existingProduct.isManufactured,
        weight: optionalNumber(existingProduct.weight),
        weightUnit: existingProduct.weightUnit === "g" || existingProduct.weightUnit === "t" ? existingProduct.weightUnit : "kg",
        isWeighted: existingProduct.isWeighted ?? false,
        pluCode: existingProduct.pluCode ?? undefined,
      });
    } else if (!editId) {
      form.reset(EMPTY_VALUES);
    }
  }, [open, existingProduct, editId, form]);

  /** Ro'yxat bo'sh bo'lsa ham shu yerdan kategoriya/brend qo'shiladi. */
  const createCategory = useApiMutation(
    (name: string) => api.post<{ category: { id: string } }>("/api/catalog/categories", { name }),
    { invalidate: ["/api/catalog/categories"] },
  );
  const createBrand = useApiMutation(
    (name: string) => api.post<{ brand: { id: string } }>("/api/catalog/brands", { name }),
    { invalidate: ["/api/catalog/brands"] },
  );

  const addCategory = async () => {
    const name = (newCategory ?? "").trim();
    if (!name) return;
    try {
      const { category } = await createCategory.mutateAsync(name);
      form.setValue("categoryId", category.id);
      setNewCategory(null);
      toast.success("Kategoriya qo'shildi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const addBrand = async () => {
    const name = (newBrand ?? "").trim();
    if (!name) return;
    try {
      const { brand } = await createBrand.mutateAsync(name);
      form.setValue("brandId", brand.id);
      setNewBrand(null);
      toast.success("Brend qo'shildi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const save = useApiMutation(async (values: FormValues) => {
    const payload = toPayload(values);
    const { product } = editId
      ? await api.patch<{ product: { id: string } }>(`/api/catalog/products/${editId}`, payload)
      : await api.post<{ product: { id: string } }>("/api/catalog/products", payload);

    // O'lchov konversiyalari: mahsulot id'si kerak, shuning uchun saqlangandan keyin yoziladi
    let conversionError: string | null = null;
    for (const row of conversionDraft) {
      if (!row.unitId || !row.factor.trim() || row.unitId === values.baseUnitId) continue;
      try {
        await api.post("/api/catalog/unit-conversions", {
          fromUnitId: row.unitId,
          toUnitId: values.baseUnitId,
          factor: row.factor.trim(),
          productId: product.id,
        });
      } catch (err) {
        conversionError = errorMessage(err);
      }
    }

    // Mahsulot saqlandi; rasm xatosi alohida ko'rsatiladi (masalan saqlash sozlanmagan — 503)
    let imageError: string | null = null;
    try {
      if (imageFile) await uploadProductImage(product.id, imageFile);
      else if (removeImage && existingProduct?.imageKey) await removeProductImage(product.id);
    } catch (err) {
      imageError = errorMessage(err);
    }
    return { imageError, conversionError };
  });

  const onSubmit = async (values: FormValues) => {
    try {
      const { imageError, conversionError } = await save.mutateAsync(values);
      toast.success(editId ? "Mahsulot yangilandi" : "Mahsulot qo'shildi");
      if (imageError) toast.error(`Rasm saqlanmadi: ${imageError}`);
      if (conversionError) toast.error(`Konversiya saqlanmadi: ${conversionError}`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  /** Skanerdan kelgan kod to'g'ridan-to'g'ri maydonga tushadi. */
  const handleScan = (code: string) => {
    form.setValue("barcode", code.trim());
    setScannerOpen(false);
    toast.success(`Shtrix-kod o'qildi: ${code.trim()}`);
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

  /** Konversiyalar asosiy birlikka nisbatan yoziladi — shuning uchun uning nomi kerak. */
  const baseUnitId = useWatch({ control: form.control, name: "baseUnitId" });
  const baseUnitName = units?.find((unit) => unit.id === baseUnitId)?.shortName ?? "asosiy birlik";
  const conversionsQuery = useApiQuery<{ conversions: { id: string; fromUnitId: string; toUnitId: string; factor: string }[] }>(
    open && editId ? "/api/catalog/unit-conversions" : null,
    editId ? { productId: editId } : undefined,
  );
  const unitName = (id: string) => units?.find((unit) => unit.id === id)?.shortName ?? "?";
  const savedConversions = conversionsQuery.data?.conversions.map((row) => ({
    id: row.id,
    factor: row.factor,
    fromUnitName: unitName(row.fromUnitId),
    toUnitName: unitName(row.toUnitId),
  }));
  const deleteConversion = useApiMutation((id: string) => api.delete(`/api/catalog/unit-conversions/${id}`), {
    invalidate: ["/api/catalog/unit-conversions"],
  });
  const removeConversion = async (id: string) => {
    try {
      await deleteConversion.mutateAsync(id);
      toast.success("Konversiya o'chirildi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

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
    <>
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editId ? "Mahsulotni tahrirlash" : "Yangi mahsulot qo'shish"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          {/* Xato boshqa tabda bo'lsa ham foydalanuvchi ko'rsin — aks holda "Saqlash" jim qoladi */}
          <form onSubmit={form.handleSubmit(onSubmit, (errors) => {
            const first = Object.values(errors)[0];
            toast.error(typeof first?.message === "string" ? first.message : "Majburiy maydonlarni to'ldiring");
          })} className="space-y-0">
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
                      <FormLabel>Shtrix-kod</FormLabel>
                      <div className="flex items-center gap-2">
                        <FormControl><Input placeholder="5449000000996" inputMode="numeric" data-testid="product-barcode" {...field} /></FormControl>
                        {/* Telefonda kamera bilan o'qish; USB skaner ham shu oynaga yozadi */}
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          title="Skaner bilan o'qish"
                          aria-label="Shtrix-kodni skanerlash"
                          data-testid="product-barcode-scan"
                          onClick={() => setScannerOpen(true)}
                        >
                          <ScanLine className="h-4 w-4" />
                        </Button>
                      </div>
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
                          {categories?.length === 0 && (
                            <p className="px-2 py-1.5 text-xs text-muted-foreground">Kategoriya yo'q — pastdan qo'shing</p>
                          )}
                        </SelectContent>
                      </Select>
                      {newCategory === null ? (
                        <button
                          type="button"
                          data-testid="product-add-category"
                          className="mt-1 text-xs text-primary hover:underline cursor-pointer"
                          onClick={() => setNewCategory("")}
                        >
                          + Kategoriya qo'shish
                        </button>
                      ) : (
                        <div className="mt-1 flex items-center gap-2">
                          <Input
                            autoFocus
                            placeholder="Yangi kategoriya nomi"
                            value={newCategory}
                            onChange={(event) => setNewCategory(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") { event.preventDefault(); void addCategory(); }
                              if (event.key === "Escape") setNewCategory(null);
                            }}
                          />
                          <Button type="button" size="sm" disabled={createCategory.isPending} onClick={() => void addCategory()}>
                            {createCategory.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Qo'shish"}
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setNewCategory(null)}>Bekor</Button>
                        </div>
                      )}
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
                          {brands?.length === 0 && (
                            <p className="px-2 py-1.5 text-xs text-muted-foreground">Brend yo'q — pastdan qo'shing</p>
                          )}
                        </SelectContent>
                      </Select>
                      {newBrand === null ? (
                        <button
                          type="button"
                          data-testid="product-add-brand"
                          className="mt-1 text-xs text-primary hover:underline cursor-pointer"
                          onClick={() => setNewBrand("")}
                        >
                          + Brend qo'shish
                        </button>
                      ) : (
                        <div className="mt-1 flex items-center gap-2">
                          <Input
                            autoFocus
                            placeholder="Yangi brend nomi"
                            value={newBrand}
                            onChange={(event) => setNewBrand(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") { event.preventDefault(); void addBrand(); }
                              if (event.key === "Escape") setNewBrand(null);
                            }}
                          />
                          <Button type="button" size="sm" disabled={createBrand.isPending} onClick={() => void addBrand()}>
                            {createBrand.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Qo'shish"}
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setNewBrand(null)}>Bekor</Button>
                        </div>
                      )}
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

                  {/* Soliq hisoblash o'chirilgan bo'lsa stavka ham so'ralmaydi — hujjatlarda baribir 0 bo'ladi */}
                  {taxEnabled ? (
                    <>
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
                    </>
                  ) : (
                    <p className="self-end pb-2 text-xs text-muted-foreground md:col-span-2">
                      Soliqni avtomatik hisoblash o'chirilgan (Sozlamalar → Kompaniya) — hujjatlarda QQS 0.
                    </p>
                  )}
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
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium">O'lchov konversiyalari</p>
                    <p className="text-xs text-muted-foreground">
                      Masalan: 1 quti = 12 dona. Bir nechta konversiya qo'shsa bo'ladi — "+ Konversiya qo'shish".
                      Ular mahsulot saqlanganda birga yoziladi.
                    </p>
                  </div>

                  {conversionDraft.map((row, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-2" data-testid="conversion-row">
                      <span className="text-sm text-muted-foreground">1</span>
                      <Select
                        value={row.unitId}
                        onValueChange={(value) =>
                          setConversionDraft((rows) => rows.map((item, i) => (i === index ? { ...item, unitId: value } : item)))
                        }
                      >
                        <SelectTrigger className="w-40"><SelectValue placeholder="Birlik" /></SelectTrigger>
                        <SelectContent>
                          {units?.filter((unit) => unit.id !== baseUnitId).map((unit) => (
                            <SelectItem key={unit.id} value={unit.id}>{unit.name} ({unit.shortName})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-sm text-muted-foreground">=</span>
                      <Input
                        className="w-28"
                        inputMode="decimal"
                        placeholder="12"
                        value={row.factor}
                        onChange={(event) =>
                          setConversionDraft((rows) => rows.map((item, i) => (i === index ? { ...item, factor: event.target.value } : item)))
                        }
                      />
                      <span className="text-sm text-muted-foreground">{baseUnitName}</span>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        aria-label="Konversiyani o'chirish"
                        onClick={() => setConversionDraft((rows) => rows.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}

                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    data-testid="conversion-add"
                    onClick={() => setConversionDraft((rows) => [...rows, { unitId: "", factor: "" }])}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Konversiya qo'shish
                  </Button>

                  {savedConversions && savedConversions.length > 0 && (
                    <div className="rounded-xl border border-border p-3">
                      <p className="text-xs font-medium text-muted-foreground">Saqlangan konversiyalar</p>
                      <ul className="mt-1 space-y-1 text-sm">
                        {savedConversions.map((row) => (
                          <li key={row.id} className="flex items-center justify-between gap-2">
                            <span>1 {row.fromUnitName} = {Number(row.factor)} {row.toUnitName}</span>
                            <button
                              type="button"
                              className="text-xs text-destructive hover:underline cursor-pointer"
                              onClick={() => void removeConversion(row.id)}
                            >
                              O'chirish
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
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
                  {/* Katalog turi — omborda ham shu bo'yicha ajratiladi */}
                  <FormField control={form.control} name="kind" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Katalog turi</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        </FormControl>
                        <SelectContent position="popper">
                          <SelectItem value="product">Mahsulot — sotiladigan tayyor mahsulot</SelectItem>
                          <SelectItem value="raw_material">Xom ashyo — ishlab chiqarishga kiradi</SelectItem>
                          <SelectItem value="semi_finished">Yarim tayyor — ishlab chiqarilgan, yana ishlatiladi</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {(
                    [
                      { name: "isSaleable" as const, label: "Sotiladi", desc: "Bu mahsulotni sotish mumkin" },
                      { name: "isPurchaseable" as const, label: "Xarid qilinadi", desc: "Bu mahsulotni xarid qilish mumkin" },
                      { name: "isManufactured" as const, label: "Ishlab chiqariladi", desc: "Bu mahsulot ishlab chiqariladi (BOM kerak)" },
                      { name: "isWeighted" as const, label: "Tarozida tortiladi", desc: "Miqdor og'irlik (kg): kassada tarozidan yoki etiketka shtrix-kodidan olinadi" },
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
                        <FormLabel>Og'irligi (1 asosiy birlik)</FormLabel>
                        <div className="flex gap-2">
                          <FormControl><Input type="number" step="0.001" min="0" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.valueAsNumber || undefined)} /></FormControl>
                          <FormField control={form.control} name="weightUnit" render={({ field: unit }) => (
                            <Select value={unit.value} onValueChange={unit.onChange}>
                              <SelectTrigger className="w-20" aria-label="Og'irlik birligi"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="kg">kg</SelectItem>
                                <SelectItem value="g">g</SelectItem>
                                <SelectItem value="t">t</SelectItem>
                              </SelectContent>
                            </Select>
                          )} />
                        </div>
                        <p className="text-xs text-muted-foreground">Dostavkada transport yuk sig'imi shu bilan hisoblanadi</p>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="pluCode" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tarozi PLU kodi</FormLabel>
                        <FormControl><Input type="number" step="1" min="1" max="999999" placeholder="123" {...field} value={field.value ?? ""} onChange={e => field.onChange(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : undefined)} /></FormControl>
                        <FormMessage />
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
        {/* Skaner DialogContent ICHIDA: modal ochiq bo'lsa tashqaridagi elementlar bosilmaydi */}
        {scannerOpen && (
          <BarcodeScanner
            title="Shtrix-kodni skanerlash"
            hint="Kamerani shtrix-kodga to'g'rilang yoki USB skaner bilan o'qing"
            onScan={handleScan}
            onClose={() => setScannerOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}

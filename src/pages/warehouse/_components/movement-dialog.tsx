import { useMemo, useState } from "react";
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
import { PackagePlus, PackageMinus, SlidersHorizontal, Trash2 } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { formatQty, toNumber, type ProductListResponse } from "@/pages/products/_lib/types.ts";
import { localIsoDate, occurredAtFor, round4 } from "../_lib/dates.ts";
import { useProductUnits } from "../_lib/use-product-units.ts";
import { useCurrencies } from "@/hooks/use-currencies.ts";

type MovementKind = "receive" | "issue" | "adjust" | "writeoff";

const MOVEMENT_INFO: Record<MovementKind, { title: string; icon: React.ReactNode; qtyLabel: string }> = {
  receive: {
    title: "Tovar qabul qilish",
    icon: <PackagePlus className="h-5 w-5 text-green-600" />,
    qtyLabel: "Qabul miqdori",
  },
  issue: {
    title: "Tovar chiqarish",
    icon: <PackageMinus className="h-5 w-5 text-amber-600" />,
    qtyLabel: "Chiqarish miqdori",
  },
  adjust: {
    title: "Zaxirani tuzatish",
    icon: <SlidersHorizontal className="h-5 w-5 text-purple-600" />,
    // Server `adjust` ni ishorali farq sifatida qabul qiladi (yangi qoldiq emas)
    qtyLabel: "Farq (+ ko'paytirish / − kamaytirish)",
  },
  writeoff: {
    title: "Hisobdan chiqarish",
    icon: <Trash2 className="h-5 w-5 text-destructive" />,
    qtyLabel: "Chiqariladigan miqdor",
  },
};

/** Buxgalteriyadagi standart qarshi hisob (server `postStockJournal`). */
const DEFAULT_COUNTER: Record<MovementKind, string> = {
  receive: "Standart: 3000 Ustav kapitali (boshlang'ich qoldiq)",
  issue: "Standart: 5500 Boshqa xarajatlar",
  adjust: "Standart: ortiqcha — 4100 daromad, kamomad — 5500 xarajat",
  writeoff: "Standart: 5500 Boshqa xarajatlar",
};

type AccountOption = { id: string; code: string; name: string; subtype: string | null; isActive: boolean };

type FormValues = {
  productId: string;
  unitId: string;
  quantity: number;
  costPrice: number;
  notes?: string;
  date: string;
};

function schemaFor(type: MovementKind) {
  return z.object({
    productId: z.string().min(1, "Mahsulot tanlang"),
    unitId: z.string(),
    quantity:
      type === "adjust"
        ? z.number().refine((v) => v !== 0, "Farq 0 bo'lmasligi kerak")
        : z.number().gt(0, "Miqdor 0 dan katta bo'lishi kerak"),
    costPrice: z.number().min(0),
    notes: z.string().optional(),
    date: z.string().min(1),
  });
}

type Props = {
  type: MovementKind;
  warehouseId: string;
  onClose: () => void;
};

export default function MovementDialog({ type, warehouseId, onClose }: Props) {
  const info = MOVEMENT_INFO[type];
  const currencies = useCurrencies();
  // Kirim narxi boshqa valyutada bo'lsa — joriy kurs bilan asosiy valyutada (tannarx so'mda)
  // Tannarxni ko'rish ruxsati bo'lmasa server narxni yubormaydi — maydon bo'sh qoladi, 0 taxmin qilinmaydi
  const baseCost = (product: { purchasePrice?: string; purchaseCurrency: string | null }) =>
    currencies.toBase(toNumber(product.purchasePrice ?? 0), product.purchaseCurrency) || 0;
  // Tanlash ro'yxati: faol mahsulotlar, API chegarasi 200 ta
  const products = useApiQuery<ProductListResponse>("/api/catalog/products", { isActive: true, limit: 200 }).data
    ?.products;

  // Qarshi hisob tanlash — moliyani ko'rish ruxsati bo'lsa (aks holda standart hisob)
  const accountOptions = useApiQuery<{ accounts: AccountOption[] }>("/api/finance/accounts").data?.accounts;
  const [counterAccountId, setCounterAccountId] = useState("default");

  const today = localIsoDate();
  const schema = useMemo(() => schemaFor(type), [type]);

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

  const selectedProductId = useWatch({ control: form.control, name: "productId" });
  const selectedUnitId = useWatch({ control: form.control, name: "unitId" });
  const selectedProduct = products?.find((p) => p.id === selectedProductId);
  const unitOptions = useProductUnits(selectedProduct);
  const selectedUnit = unitOptions.find((u) => u.id === selectedUnitId);

  // Mahsulot tanlanganda: asosiy birlik va kirim narxi
  const handleProductChange = (productId: string) => {
    form.setValue("productId", productId, { shouldValidate: true });
    const product = products?.find((p) => p.id === productId);
    if (product) {
      form.setValue("unitId", product.baseUnitId);
      form.setValue("costPrice", round4(baseCost(product)));
    }
  };

  // Narx tanlangan birlik uchun: 1 quti narxi = dona narxi × koeffitsient
  const handleUnitChange = (unitId: string) => {
    form.setValue("unitId", unitId);
    const option = unitOptions.find((u) => u.id === unitId);
    if (selectedProduct && option) {
      form.setValue("costPrice", round4(baseCost(selectedProduct) * Number(option.factor)));
    }
  };

  const record = useApiMutation((values: FormValues) =>
    api.post("/api/inventory/stock/movements", {
      type,
      productId: values.productId,
      warehouseId,
      quantity: values.quantity,
      // Asosiy birlikdan boshqasi — server konversiya bilan asosiy birlikka o'tkazadi (narx ham shu birlik uchun)
      ...(selectedProduct && values.unitId && values.unitId !== selectedProduct.baseUnitId ? { unitId: values.unitId } : {}),
      // Tannarx faqat kirimda o'rtachani o'zgartiradi; chiqim joriy o'rtacha tannarxda yoziladi
      ...(type === "receive" ? { costPrice: values.costPrice } : {}),
      ...(counterAccountId !== "default" ? { counterAccountId } : {}),
      notes: values.notes?.trim() || null,
      // Bugungi sana — server vaqti; o'tgan sana tanlansa shu kun yoziladi
      occurredAt: occurredAtFor(values.date),
    }),
  );

  const onSubmit = async (values: FormValues) => {
    try {
      await record.mutateAsync(values);
      toast.success(
        type === "receive" ? "Tovar qabul qilindi" :
        type === "issue" ? "Tovar chiqarildi" :
        type === "adjust" ? "Zaxira tuzatildi" : "Hisobdan chiqarildi"
      );
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
                  <FormLabel>{info.qtyLabel} *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      {...(type === "adjust" ? {} : { min: "0" })}
                      step="any"
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
                  <Select value={field.value} onValueChange={handleUnitChange} disabled={!selectedProduct}>
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

            {type === "receive" ? (
              <FormField control={form.control} name="costPrice" render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Narx (so'm{selectedUnit && selectedUnit.factor !== "1" ? `, 1 ${selectedUnit.label} uchun` : ""})
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      {...field}
                      onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            ) : (
              <p className="text-xs text-muted-foreground">
                Tannarx omborning joriy o'rtacha narxi bo'yicha yoziladi.
              </p>
            )}

            {accountOptions ? (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Buxgalteriyada qarshi hisob</p>
                <Select value={counterAccountId} onValueChange={setCounterAccountId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">{DEFAULT_COUNTER[type]}</SelectItem>
                    {accountOptions
                      .filter((a) => a.isActive && a.subtype !== "inventory")
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Buxgalteriya: {DEFAULT_COUNTER[type].replace("Standart: ", "")}.</p>
            )}

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
              <Button type="submit" disabled={record.isPending}>
                {record.isPending ? "..." : info.title}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

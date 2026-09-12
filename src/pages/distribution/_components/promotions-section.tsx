import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { todayLocal } from "@/pages/sales/_lib/types.ts";
import { num, type DistPromotion } from "../_lib/types.ts";

type Status = "all" | "active" | "upcoming" | "ended";
const STATUSES: Status[] = ["all", "active", "upcoming", "ended"];
const INVALIDATE = ["/api/sales-agent/supervisor/promotions"];

function ruleText(promotion: Pick<DistPromotion, "type" | "minQuantity" | "freeQuantity" | "discountPercent">, t: TFunction<"distribution">) {
  return promotion.type === "buy_x_get_y"
    ? t("promo.rule.bxgy", { min: num(promotion.minQuantity), free: num(promotion.freeQuantity) })
    : t("promo.rule.percent", { min: num(promotion.minQuantity), percent: num(promotion.discountPercent) });
}

function PromotionDialog({ promotion, onClose }: { promotion: DistPromotion | null; onClose: () => void }) {
  const { t } = useTranslation("distribution");
  const [form, setForm] = useState(() => ({
    name: promotion?.name ?? "",
    description: promotion?.description ?? "",
    type: promotion?.type ?? ("buy_x_get_y" as DistPromotion["type"]),
    productId: promotion?.productId ?? "",
    productName: promotion?.productName ?? "",
    minQuantity: promotion ? String(num(promotion.minQuantity)) : "10",
    freeQuantity: promotion?.freeQuantity ? String(num(promotion.freeQuantity)) : "1",
    discountPercent: promotion?.discountPercent ? String(num(promotion.discountPercent)) : "5",
    startsAt: promotion?.startsAt ?? todayLocal(),
    endsAt: promotion?.endsAt ?? todayLocal(),
    isActive: promotion?.isActive ?? true,
  }));
  const [search, setSearch] = useState("");
  const [debounced] = useDebounce(search.trim(), 300);
  const products =
    useApiQuery<{ products: { id: string; name: string; sku: string }[] }>(
      "/api/catalog/products",
      { isActive: true, limit: 30, search: debounced || undefined },
      { placeholderData: (previous) => previous },
    ).data?.products ?? [];
  const save = useApiMutation(
    (body: Record<string, unknown>) =>
      promotion
        ? api.patch(`/api/sales-agent/supervisor/promotions/${promotion.id}`, body)
        : api.post("/api/sales-agent/supervisor/promotions", body),
    { invalidate: INVALIDATE },
  );

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (!form.name.trim() || !form.productId) {
      toast.error(t("promo.required"));
      return;
    }
    try {
      await save.mutateAsync({
        name: form.name.trim(),
        description: form.description.trim() || null,
        type: form.type,
        productId: form.productId,
        minQuantity: form.minQuantity,
        freeQuantity: form.type === "buy_x_get_y" ? form.freeQuantity : null,
        discountPercent: form.type === "percent_discount" ? form.discountPercent : null,
        startsAt: form.startsAt,
        endsAt: form.endsAt,
        isActive: form.isActive,
      });
      toast.success(t("promo.saved"));
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{promotion ? t("promo.edit") : t("promo.new")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="promo-name">{t("promo.field.name")}</Label>
            <Input id="promo-name" maxLength={200} value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("promo.field.type")}</Label>
            <Select value={form.type} onValueChange={(value) => set("type", value as DistPromotion["type"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="buy_x_get_y">{t("promo.type.buy_x_get_y")}</SelectItem>
                <SelectItem value="percent_discount">{t("promo.type.percent_discount")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="promo-product">{t("promo.field.product")}</Label>
            {form.productName && <p className="text-sm font-medium">{form.productName}</p>}
            <Input id="promo-product" placeholder={t("promo.field.product_search")} value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, productId: product.id, productName: product.name }))}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/50",
                    form.productId === product.id && "bg-primary/10 font-medium",
                  )}
                >
                  <span className="truncate">{product.name}</span>
                  <span className="text-xs text-muted-foreground">{product.sku}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="promo-min">{t("promo.field.min")}</Label>
              <Input id="promo-min" type="number" min={1} step="any" value={form.minQuantity} onChange={(e) => set("minQuantity", e.target.value)} />
            </div>
            {form.type === "buy_x_get_y" ? (
              <div className="space-y-1">
                <Label htmlFor="promo-free">{t("promo.field.free")}</Label>
                <Input id="promo-free" type="number" min={1} step="any" value={form.freeQuantity} onChange={(e) => set("freeQuantity", e.target.value)} />
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="promo-percent">{t("promo.field.percent")}</Label>
                <Input
                  id="promo-percent"
                  type="number"
                  min={0.01}
                  max={100}
                  step="any"
                  value={form.discountPercent}
                  onChange={(e) => set("discountPercent", e.target.value)}
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="promo-starts">{t("promo.field.starts")}</Label>
              <Input id="promo-starts" type="date" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="promo-ends">{t("promo.field.ends")}</Label>
              <Input id="promo-ends" type="date" min={form.startsAt} value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="promo-description">{t("promo.field.description")}</Label>
            <Textarea id="promo-description" rows={2} maxLength={1000} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
            <span className="text-sm">{t("promo.field.active")}</span>
            <Switch checked={form.isActive} onCheckedChange={(checked) => set("isActive", checked)} />
          </label>
          <p className="text-xs text-muted-foreground">{t("promo.hint")}</p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="secondary" onClick={onClose}>{t("promo.cancel")}</Button>
          <Button disabled={save.isPending} onClick={() => void submit()}>{t("promo.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Aksiyalar (`promotions.manage`): ro'yxat, yaratish/tahrirlash, faollik, o'chirish. Hisoblash buyurtmada, serverda. */
export default function PromotionsSection() {
  const { t } = useTranslation("distribution");
  const [status, setStatus] = useState<Status>("all");
  const [editing, setEditing] = useState<DistPromotion | "new" | null>(null);
  const promotions = useApiQuery<{ promotions: DistPromotion[] }>("/api/sales-agent/supervisor/promotions", { status }).data?.promotions;
  const toggle = useApiMutation(
    (promotion: DistPromotion) => api.patch(`/api/sales-agent/supervisor/promotions/${promotion.id}`, { isActive: !promotion.isActive }),
    { invalidate: INVALIDATE },
  );
  const remove = useApiMutation((promotionId: string) => api.delete(`/api/sales-agent/supervisor/promotions/${promotionId}`), {
    invalidate: INVALIDATE,
  });

  const handleToggle = async (promotion: DistPromotion) => {
    try {
      await toggle.mutateAsync(promotion);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleDelete = async (promotion: DistPromotion) => {
    if (!window.confirm(t("promo.delete_confirm"))) return;
    try {
      await remove.mutateAsync(promotion.id);
      toast.success(t("promo.deleted"));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={(value) => setStatus(value as Status)}>
          <SelectTrigger className="h-9 w-60"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUSES.map((value) => (
              <SelectItem key={value} value={value}>{t(`promo.status.${value}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button className="ml-auto" onClick={() => setEditing("new")}>
          <Plus className="mr-1.5 h-4 w-4" /> {t("promo.new")}
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {!promotions ? (
          <div className="space-y-2 p-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
        ) : promotions.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">{t("promo.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t("promo.col.name")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("promo.col.product")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("promo.col.rule")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("promo.col.period")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("promo.col.active")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {promotions.map((promotion) => (
                  <tr key={promotion.id}>
                    <td className="min-w-40 px-3 py-2 font-medium">{promotion.name}</td>
                    <td className="min-w-40 px-3 py-2">{promotion.productName}</td>
                    <td className="whitespace-nowrap px-3 py-2">{ruleText(promotion, t)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {promotion.startsAt} — {promotion.endsAt}
                    </td>
                    <td className="px-3 py-2">
                      <Switch checked={promotion.isActive} disabled={toggle.isPending} onCheckedChange={() => void handleToggle(promotion)} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title={t("promo.edit")} onClick={() => setEditing(promotion)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => void handleDelete(promotion)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <PromotionDialog key={editing === "new" ? "new" : editing.id} promotion={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

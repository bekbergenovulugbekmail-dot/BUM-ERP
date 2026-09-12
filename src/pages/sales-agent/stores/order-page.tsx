import { useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, ImageIcon, Loader2, Minus, Plus, Save, Search, Send } from "lucide-react";
import type { SalesAgentPolicy } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ApiError, api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { formatMoney } from "@/hooks/use-currencies.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { cn } from "@/lib/utils.ts";
import { todayLocal } from "@/pages/sales/_lib/types.ts";
import { originParams, useAgentLocation } from "../_lib/agent-location.ts";
import { clearLocalDraft, initialDraft, stampDraft, writeLocalDraft, type DraftLine, type LocalDraft } from "../_lib/order-draft.ts";
import { freshPosition, visitErrorMessage } from "../_lib/visit-api.ts";
import {
  formatDistance,
  num,
  type AgentMe,
  type AgentOrder,
  type CatalogProduct,
  type PaymentType,
  type StoreProfile,
} from "../_lib/types.ts";

const PAGE_SIZE = 30;
const PAYMENT_TYPES: PaymentType[] = ["cash", "card", "credit"];
const shiftIso = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

type RowProduct = Omit<DraftLine, "pieces" | "boxes"> & { hasImage: boolean; available: string | null };

function QtyStepper({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-9 text-xs text-muted-foreground">{label}</span>
      <Button type="button" variant="secondary" size="icon" className="h-10 w-10" disabled={value <= 0} onClick={() => onChange(value - 1)}>
        <Minus className="h-4 w-4" />
      </Button>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        className="h-10 w-16 text-center text-base"
        placeholder="0"
        value={value === 0 ? "" : value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <Button type="button" variant="secondary" size="icon" className="h-10 w-10" onClick={() => onChange(value + 1)}>
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

function ProductRow({
  product,
  line,
  money,
  onChange,
  onImage,
}: {
  product: RowProduct;
  line: DraftLine | undefined;
  money: (value: number | string) => string;
  onChange: (field: "pieces" | "boxes", value: number) => void;
  onImage: () => void;
}) {
  const { t } = useTranslation("agent");
  const pieces = line?.pieces ?? 0;
  const boxes = line?.boxes ?? 0;
  const totalPieces = pieces + boxes * num(product.box?.factor);
  const lineTotal = pieces * num(product.piecePrice) + boxes * num(product.box?.price);
  const available = product.available === null ? null : num(product.available);

  return (
    <div className={cn("rounded-2xl border bg-card p-3 space-y-2", totalPieces > 0 ? "border-primary/50" : "border-border")}>
      <div className="flex gap-3">
        <button
          type="button"
          aria-label={t("order.image")}
          disabled={!product.hasImage}
          onClick={onImage}
          className="h-14 w-14 shrink-0 rounded-xl bg-muted flex items-center justify-center enabled:active:bg-accent"
        >
          <ImageIcon className={cn("h-6 w-6", product.hasImage ? "text-primary" : "text-muted-foreground/50")} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-tight">{product.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("order.piece")}: {money(product.piecePrice)}
            {product.box && ` · ${t("order.box")}: ${money(product.box.price)}`}
          </p>
          {product.box && <p className="text-[11px] text-muted-foreground">{t("order.box_factor", { factor: num(product.box.factor) })}</p>}
          {available !== null && (
            <p className={cn("text-[11px]", available <= 0 ? "text-destructive" : "text-muted-foreground")}>
              {t("order.available", { count: available })}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <QtyStepper label={t("order.piece")} value={pieces} onChange={(value) => onChange("pieces", value)} />
        {product.box && <QtyStepper label={t("order.box")} value={boxes} onChange={(value) => onChange("boxes", value)} />}
      </div>
      {totalPieces > 0 && <p className="text-sm font-semibold">{t("order.line_total", { count: totalPieces, amount: money(lineTotal) })}</p>}
    </div>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right", strong ? "text-base font-bold" : "font-medium")}>{value}</span>
    </div>
  );
}

function OrderEditor({ customerId, serverDraft }: { customerId: string; serverDraft: AgentOrder | null }) {
  const { t } = useTranslation("agent");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const navigate = useNavigate();
  const { company } = useOutletContext<AgentMe>();
  const position = useAgentLocation();
  const policy = useApiQuery<{ policy: SalesAgentPolicy }>("/api/sales-agent/policy").data?.policy;
  const store = useApiQuery<{ store: StoreProfile }>(`/api/sales-agent/stores/${customerId}`, originParams(position)).data?.store;

  const [draft, setDraft] = useState<LocalDraft>(() => initialDraft(customerId, serverDraft));
  const [saved, setSaved] = useState<AgentOrder | null>(serverDraft);
  const [search, setSearch] = useState("");
  const [debounced] = useDebounce(search.trim(), 300);
  const [offset, setOffset] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);

  const catalog = useApiQuery<{ products: CatalogProduct[]; nextOffset: number | null }>(
    "/api/sales-agent/catalog",
    { search: debounced || undefined, offset, limit: PAGE_SIZE },
    { placeholderData: (previous) => previous },
  ).data;

  const money = (value: number | string) => formatMoney(num(value), company.currency);
  const today = todayLocal();

  const update = (next: Omit<LocalDraft, "changedAt">) => {
    const stamped = stampDraft(next);
    setDraft(stamped);
    writeLocalDraft(stamped);
  };

  const setQty = (product: RowProduct, field: "pieces" | "boxes", value: number) => {
    const clean = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    const existing = draft.lines.find((line) => line.productId === product.productId);
    const { hasImage: _hasImage, available: _available, ...base } = product;
    const line: DraftLine = { ...(existing ?? { ...base, pieces: 0, boxes: 0 }), [field]: clean };
    const lines = existing
      ? draft.lines.map((row) => (row.productId === product.productId ? line : row))
      : [...draft.lines, line];
    update({ ...draft, lines: lines.filter((row) => row.pieces > 0 || row.boxes > 0) });
  };

  const save = useApiMutation(
    (body: LocalDraft) =>
      api.put<{ order: AgentOrder }>(`/api/sales-agent/orders/drafts/${body.requestId}`, {
        customerId,
        paymentType: body.paymentType,
        paymentDueDate: body.paymentType === "credit" && body.paymentDueDate ? body.paymentDueDate : null,
        deliveryDate: policy?.deliveryDateMode === "choose" && body.deliveryDate ? body.deliveryDate : null,
        items: body.lines.map((line) => ({ productId: line.productId, pieces: String(line.pieces), boxes: String(line.boxes) })),
      }),
    { invalidate: false },
  );
  const submit = useApiMutation(
    async (orderId: string) => api.post<{ order: AgentOrder }>(`/api/sales-agent/orders/${orderId}/submit`, await freshPosition()),
    { invalidate: ["/api/sales-agent"] },
  );

  const persist = async (): Promise<AgentOrder | null> => {
    if (draft.lines.length === 0) {
      toast.error(t("order.empty"));
      return null;
    }
    try {
      const { order } = await save.mutateAsync(draft);
      setSaved(order);
      return order;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Bu identifikator bilan buyurtma allaqachon yuborilgan — qurilmadagi nusxa eskirgan
        clearLocalDraft(customerId);
        toast.error(errorMessage(err));
        navigate(`/${lng}/sales-agent/stores/${customerId}`);
        return null;
      }
      toast.error(visitErrorMessage(err, t, "order"));
      return null;
    }
  };

  const openConfirm = async () => {
    if (await persist()) setConfirming(true);
  };

  const handleSubmit = async () => {
    if (!saved) return;
    try {
      const { order } = await submit.mutateAsync(saved.id);
      clearLocalDraft(customerId);
      setConfirming(false);
      toast.success(order.approvalStatus === "pending" ? t("order.pending_approval") : t("order.submitted", { number: order.number }));
      navigate(`/${lng}/sales-agent/stores/${customerId}`);
    } catch (err) {
      toast.error(visitErrorMessage(err, t, "order"));
    }
  };

  const openImage = async (product: RowProduct) => {
    try {
      const { url } = await api.get<{ url: string }>(`/api/sales-agent/catalog/${product.productId}/image`);
      setPreview({ url, name: product.name });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const lineOf = (productId: string) => draft.lines.find((line) => line.productId === productId);
  const catalogRows: RowProduct[] = (catalog?.products ?? []).map((product) => ({
    productId: product.id,
    name: product.name,
    piecePrice: product.piecePrice,
    box: product.box ? { unitName: product.box.unitName, factor: product.box.factor, price: product.box.price } : null,
    hasImage: product.hasImage,
    available: product.available,
  }));
  const shownIds = new Set(catalogRows.map((row) => row.productId));
  const selectedOnly = draft.lines.filter((line) => !shownIds.has(line.productId));
  const totalPieces = draft.lines.reduce((sum, line) => sum + line.pieces + line.boxes * num(line.box?.factor), 0);
  const total = draft.lines.reduce((sum, line) => sum + line.pieces * num(line.piecePrice) + line.boxes * num(line.box?.price), 0);
  const busy = save.isPending || submit.isPending;

  return (
    <div className="pb-44">
      <div className="sticky top-14 z-20 space-y-2 border-b border-border bg-background/95 px-4 pb-2 pt-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 -ml-2">
            <Link to={`/${lng}/sales-agent/stores/${customerId}`} aria-label={t("back")}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="min-w-0">
            <p className="font-semibold truncate">{store?.name ?? "…"}</p>
            <p className="text-xs text-muted-foreground">{saved ? t("order.draft_number", { number: saved.number }) : t("order.new")}</p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-11 pl-10 text-base"
            placeholder={t("order.search")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <div>
            <Label>{t("order.payment")}</Label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {PAYMENT_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => update({ ...draft, paymentType: type })}
                  className={cn(
                    "h-11 rounded-xl border text-sm font-medium",
                    draft.paymentType === type ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {t(`order.payment_type.${type}`)}
                </button>
              ))}
            </div>
          </div>
          {draft.paymentType === "credit" && (
            <div className="space-y-1">
              <Label htmlFor="order-due">
                {t("order.due_date")}
                {policy?.creditDueDateRequired && " *"}
              </Label>
              <Input
                id="order-due"
                type="date"
                min={today}
                className="h-11"
                value={draft.paymentDueDate}
                onChange={(e) => update({ ...draft, paymentDueDate: e.target.value })}
              />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="order-delivery">{t("order.delivery_date")}</Label>
            {policy?.deliveryDateMode === "choose" ? (
              <Input
                id="order-delivery"
                type="date"
                min={today}
                max={shiftIso(today, policy.maxDeliveryDays)}
                className="h-11"
                value={draft.deliveryDate}
                onChange={(e) => update({ ...draft, deliveryDate: e.target.value })}
              />
            ) : (
              <p className="text-sm font-medium">{saved?.deliveryDate ?? t("order.delivery_assigned")}</p>
            )}
          </div>
        </div>

        {selectedOnly.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("order.selected")}</p>
            {selectedOnly.map((line) => {
              const product: RowProduct = { ...line, hasImage: false, available: null };
              return (
                <ProductRow
                  key={line.productId}
                  product={product}
                  line={line}
                  money={money}
                  onChange={(field, value) => setQty(product, field, value)}
                  onImage={() => undefined}
                />
              );
            })}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("order.catalog")}</p>
          {!catalog ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
          ) : catalogRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("order.no_products")}</p>
          ) : (
            catalogRows.map((product) => (
              <ProductRow
                key={product.productId}
                product={product}
                line={lineOf(product.productId)}
                money={money}
                onChange={(field, value) => setQty(product, field, value)}
                onImage={() => void openImage(product)}
              />
            ))
          )}
          {catalog && (offset > 0 || catalog.nextOffset !== null) && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" className="h-11" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                ‹
              </Button>
              <Button
                variant="secondary"
                className="h-11"
                disabled={catalog.nextOffset === null}
                onClick={() => catalog.nextOffset !== null && setOffset(catalog.nextOffset)}
              >
                {t("order.more")} ›
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-16 z-30 space-y-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("order.summary", { products: draft.lines.length, pieces: totalPieces })}</span>
          <span className="text-lg font-bold">{money(total)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            className="h-12"
            disabled={busy || draft.lines.length === 0}
            onClick={() => void persist().then((order) => order && toast.success(t("order.saved")))}
          >
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {t("order.save")}
          </Button>
          <Button className="h-12" disabled={busy || draft.lines.length === 0} onClick={() => void openConfirm()}>
            <Send className="mr-2 h-4 w-4" /> {t("order.review")}
          </Button>
        </div>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("order.confirm_title")}</DialogTitle>
            <DialogDescription>{store?.name}</DialogDescription>
          </DialogHeader>
          {saved && (
            <div className="space-y-2 text-sm">
              {store && (
                <>
                  <SummaryRow label={t("store.distance")} value={formatDistance(store.distanceMeters, t) ?? "—"} />
                  <SummaryRow label={t("store.debt")} value={money(store.totalDebt)} />
                  <SummaryRow
                    label={t("store.available_credit")}
                    value={store.availableCredit === null ? t("store.no_limit") : money(store.availableCredit)}
                  />
                </>
              )}
              <SummaryRow label={t("order.delivery_date")} value={saved.deliveryDate ?? "—"} />
              <SummaryRow
                label={t("order.payment")}
                value={`${t(`order.payment_type.${saved.paymentType}`)}${saved.paymentDueDate ? ` · ${saved.paymentDueDate}` : ""}`}
              />
              <div className="divide-y divide-border rounded-xl border border-border">
                {saved.items?.map((item) => (
                  <div key={item.productId} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate">
                      {item.productName} × {num(item.quantity)}
                    </span>
                    <span className="font-medium">{money(item.lineTotal)}</span>
                  </div>
                ))}
              </div>
              <SummaryRow label={t("order.total")} value={money(saved.totalAmount)} strong />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="secondary" className="h-12" onClick={() => setConfirming(false)}>
              {t("visit.cancel")}
            </Button>
            <Button className="h-12" disabled={submit.isPending} onClick={() => void handleSubmit()}>
              {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("order.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{preview?.name}</DialogTitle>
          </DialogHeader>
          {preview && <img src={preview.url} alt={preview.name} className="max-h-[75vh] w-full rounded-xl bg-muted object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Buyurtma: katalogdan dona va blok, to'lov turi (nasiya — muddat), yetkazish kuni (siyosat bo'yicha), tasdiqlash
 * oynasida do'kon, masofa, qarz, kredit, jami; yuborishda yangi GPS o'lchovi — geofence, kredit va qoldiq serverda.
 */
export default function AgentOrderPage() {
  const { customerId = "" } = useParams<{ customerId: string }>();
  const drafts = useApiQuery<{ orders: AgentOrder[] }>(customerId ? "/api/sales-agent/orders" : null, { state: "draft", customerId });
  const draftId = drafts.data?.orders[0]?.id;
  const detail = useApiQuery<{ order: AgentOrder }>(draftId ? `/api/sales-agent/orders/${draftId}` : null);

  if (drafts.data === undefined || (draftId && detail.data === undefined)) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    );
  }
  return <OrderEditor key={draftId ?? "new"} customerId={customerId} serverDraft={detail.data?.order ?? null} />;
}

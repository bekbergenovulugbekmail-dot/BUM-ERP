import { useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, ImageIcon, Loader2, Minus, Plus, Save, Search } from "lucide-react";
import type { SalesAgentPolicy } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { ApiError, api, apiUrl, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { formatMoney } from "@/hooks/use-currencies.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { cn } from "@/lib/utils.ts";
import { todayLocal } from "@/pages/sales/_lib/types.ts";
import { originParams, useAgentLocation } from "../_lib/agent-location.ts";
import { clearLocalDraft, initialDraft, stampDraft, writeLocalDraft, type DraftLine, type LocalDraft } from "../_lib/order-draft.ts";
import { freshPosition, visitErrorMessage } from "../_lib/visit-api.ts";
import { useActAs } from "@/lib/act-as.ts";
import {
  formatDistance,
  num,
  promotionRule,
  type AgentMe,
  type AgentOrder,
  type CatalogProduct,
  type PaymentType,
  type Promotion,
  type StoreProfile,
} from "../_lib/types.ts";

/**
 * Rasm manzili: saqlash (S3) sozlanmagan bo'lsa server API yo'lini beradi (`/api/files/...`) —
 * unga biznes konteksti qo'shilishi shart, aks holda sessiya topilmay 401 bo'ladi.
 */
const imageSrc = (url: string | null) => (url?.startsWith("/api/") ? apiUrl(url) : url);

const PAGE_SIZE = 30;
const ALL = "all";
const PAYMENT_TYPES: PaymentType[] = ["cash", "card", "credit"];
const shiftIso = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

type RowProduct = Omit<DraftLine, "pieces" | "boxes"> & {
  hasImage: boolean;
  imageUrl: string | null;
  available: string | null;
  promotions: Promotion[];
  brandName: string | null;
  categoryName: string | null;
};
type CatalogFilters = { categories: { id: string; name: string }[]; brands: { id: string; name: string }[] };

/** Ro'yxat belgisi: eng katta foiz chegirma ("-10%") yoki "AKSIYA". */
function promoBadge(promotions: Promotion[], t: TFunction<"agent">): string | null {
  const percent = Math.max(0, ...promotions.filter((promotion) => promotion.type === "percent_discount").map((promotion) => num(promotion.discountPercent)));
  if (percent > 0) return `-${percent}%`;
  return promotions.length > 0 ? t("promo.badge") : null;
}

function QtyStepper({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="w-12 text-sm text-muted-foreground">
        {label}
      </Label>
      <Button type="button" variant="secondary" size="icon" className="h-12 w-12" disabled={value <= 0} onClick={() => onChange(value - 1)}>
        <Minus className="h-5 w-5" />
      </Button>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        className="h-12 w-20 text-center text-lg"
        placeholder="0"
        value={value === 0 ? "" : value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <Button type="button" variant="secondary" size="icon" className="h-12 w-12" onClick={() => onChange(value + 1)}>
        <Plus className="h-5 w-5" />
      </Button>
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

/** Katalog kartasi: rasm, aksiya belgisi, brend va kategoriya, narx; bosilganda mahsulot oynasi. */
function ProductCard({
  product,
  line,
  money,
  onOpen,
}: {
  product: RowProduct;
  line: DraftLine | undefined;
  money: (value: number | string) => string;
  onOpen: () => void;
}) {
  const { t } = useTranslation("agent");
  const totalPieces = (line?.pieces ?? 0) + (line?.boxes ?? 0) * num(product.box?.factor);
  const badge = promoBadge(product.promotions, t);
  const available = product.available === null ? null : num(product.available);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left transition-colors active:bg-accent",
        totalPieces > 0 ? "border-primary/60 ring-1 ring-primary/30" : "border-border",
      )}
    >
      <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
        {product.imageUrl ? (
          <img src={imageSrc(product.imageUrl)!} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="h-6 w-6 text-muted-foreground/50" />
        )}
        {badge && (
          <span className="absolute left-0 top-0 rounded-br-lg bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
            {badge}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-medium leading-tight">{product.name}</p>
        {(product.brandName || product.categoryName) && (
          <p className="truncate text-[11px] text-muted-foreground">{[product.brandName, product.categoryName].filter(Boolean).join(" · ")}</p>
        )}
        <p className="mt-0.5 text-xs">
          <span className="font-semibold tabular-nums">{money(product.piecePrice)}</span>
          {product.box && (
            <span className="text-muted-foreground">
              {" "}
              · {t("order.box")}: {money(product.box.price)}
            </span>
          )}
        </p>
        {available !== null && available <= 0 && <p className="text-[11px] text-destructive">{t("order.available", { count: available })}</p>}
      </div>
      {totalPieces > 0 && (
        <span className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground tabular-nums">{totalPieces}</span>
      )}
    </button>
  );
}

/** Mahsulot oynasi: katta rasm, narx, qoldiq, aksiya qoidasi, dona/blok; SAQLASH ro'yxatga qaytaradi (qidiruv va sahifa saqlanadi). */
/** Gorizontal surish (px): shundan kam — tasodifiy tegish, surish emas. */
const SWIPE_MIN_PX = 60;

function ProductDialog({
  product,
  line,
  money,
  onSave,
  onClose,
  onMove,
  hasPrev = false,
  hasNext = false,
  position,
}: {
  product: RowProduct;
  line: DraftLine | undefined;
  money: (value: number | string) => string;
  onSave: (pieces: number, boxes: number) => void;
  onClose: () => void;
  /**
   * Chapga surish — keyingi, o'ngga — oldingi mahsulot (yoki ‹ › tugmalari). Kiritilgan miqdor o'tishda saqlanadi —
   * orqaga qaytib keyingi mahsulotni qidirish shart emas.
   */
  onMove?: (direction: 1 | -1, pieces: number, boxes: number) => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** Ro'yxatdagi o'rni: "3 / 20". */
  position?: string;
}) {
  const { t } = useTranslation("agent");
  const [pieces, setPieces] = useState(line?.pieces ?? 0);
  const [boxes, setBoxes] = useState(line?.boxes ?? 0);
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
  const move = (direction: 1 | -1) => {
    if (!onMove || (direction === 1 ? !hasNext : !hasPrev)) return;
    onMove(direction, pieces, boxes);
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchStart;
    setTouchStart(null);
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    // Faqat aniq gorizontal surish (vertikal aylantirish bilan adashmasin)
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    move(dx < 0 ? 1 : -1);
  };
  const clean = (value: number) => Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const totalPieces = pieces + boxes * num(product.box?.factor);
  const lineTotal = pieces * num(product.piecePrice) + boxes * num(product.box?.price);
  const available = product.available === null ? null : num(product.available);
  const subtitle = [product.brandName, product.categoryName].filter(Boolean).join(" · ");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[92vh] max-w-md overflow-y-auto animate-in fade-in-0 duration-150"
        data-testid="product-dialog"
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (touch) setTouchStart({ x: touch.clientX, y: touch.clientY });
        }}
        onTouchEnd={onTouchEnd}
      >
        <DialogHeader>
          <DialogTitle className="pr-6">{product.name}</DialogTitle>
          <DialogDescription>{subtitle || t("order.catalog")}</DialogDescription>
        </DialogHeader>
        {onMove && (hasPrev || hasNext) && (
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <Button variant="secondary" size="icon" className="h-9 w-9" disabled={!hasPrev} aria-label={t("order.prev_product")} data-testid="product-prev" onClick={() => move(-1)}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="tabular-nums" data-testid="product-position">{position} · {t("order.swipe_hint")}</span>
            <Button variant="secondary" size="icon" className="h-9 w-9" disabled={!hasNext} aria-label={t("order.next_product")} data-testid="product-next" onClick={() => move(1)}>
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        )}
        {product.imageUrl ? (
          <img src={imageSrc(product.imageUrl)!} alt={product.name} className="max-h-72 w-full rounded-xl bg-muted object-contain" />
        ) : (
          <div className="flex h-28 items-center justify-center gap-2 rounded-xl bg-muted text-xs text-muted-foreground">
            <ImageIcon className="h-5 w-5" /> {t("order.no_image")}
          </div>
        )}
        <div className="space-y-1 text-sm">
          <SummaryRow label={t("order.price_piece")} value={money(product.piecePrice)} />
          {product.box && (
            <SummaryRow label={t("order.price_box")} value={`${money(product.box.price)} · ${t("order.box_factor", { factor: num(product.box.factor) })}`} />
          )}
          {available !== null && (
            <p className={cn("text-xs", available <= 0 ? "text-destructive" : "text-muted-foreground")}>{t("order.available", { count: available })}</p>
          )}
        </div>
        {product.promotions.length > 0 && (
          <div className="space-y-0.5 rounded-xl bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {product.promotions.map((promotion) => (
              <p key={promotion.id}>
                <span className="font-semibold">{promotion.name}</span>: {promotionRule(promotion, t)}
              </p>
            ))}
          </div>
        )}
        <div className="space-y-2">
          <QtyStepper id="product-pieces" label={t("order.piece")} value={pieces} onChange={(value) => setPieces(clean(value))} />
          {product.box && <QtyStepper id="product-boxes" label={t("order.box")} value={boxes} onChange={(value) => setBoxes(clean(value))} />}
        </div>
        {totalPieces > 0 && <p className="text-sm font-semibold">{t("order.line_total", { count: totalPieces, amount: money(lineTotal) })}</p>}
        <DialogFooter className="gap-2">
          <Button variant="secondary" className="h-12" onClick={onClose}>
            {t("visit.cancel")}
          </Button>
          <Button className="h-12" onClick={() => onSave(pieces, boxes)}>
            <CheckCircle2 className="mr-2 h-5 w-5" /> {t("order.dialog_save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const filters = useApiQuery<CatalogFilters>("/api/sales-agent/catalog/filters").data;

  const [draft, setDraft] = useState<LocalDraft>(() => initialDraft(customerId, serverDraft));
  const [saved, setSaved] = useState<AgentOrder | null>(serverDraft);
  const [search, setSearch] = useState("");
  const [debounced] = useDebounce(search.trim(), 300);
  const [categoryId, setCategoryId] = useState(ALL);
  const [brandId, setBrandId] = useState(ALL);
  const [offset, setOffset] = useState(0);
  const [confirming, setConfirming] = useState(false);
  // Supervayzer agent nomidan: GPS/tashrif/ish vaqti sharti bajarilmasa — sabab bilan (server alohida audit yozadi)
  const acting = useActAs();
  const [overrideNeeded, setOverrideNeeded] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [openProduct, setOpenProduct] = useState<RowProduct | null>(null);

  const catalog = useApiQuery<{ products: CatalogProduct[]; nextOffset: number | null }>(
    "/api/sales-agent/catalog",
    {
      search: debounced || undefined,
      categoryId: categoryId === ALL ? undefined : categoryId,
      brandId: brandId === ALL ? undefined : brandId,
      offset,
      limit: PAGE_SIZE,
    },
    { placeholderData: (previous) => previous },
  ).data;

  const money = (value: number | string) => formatMoney(num(value), company.currency);
  const today = todayLocal();

  const update = (next: Omit<LocalDraft, "changedAt">) => {
    const stamped = stampDraft(next);
    setDraft(stamped);
    writeLocalDraft(stamped);
  };

  const setLine = (product: RowProduct, pieces: number, boxes: number) => {
    const existing = draft.lines.find((line) => line.productId === product.productId);
    const { hasImage: _hasImage, imageUrl: _imageUrl, available: _available, promotions: _promotions, brandName: _brand, categoryName: _category, ...base } =
      product;
    const line: DraftLine = { ...(existing ?? base), pieces, boxes };
    const lines = existing ? draft.lines.map((row) => (row.productId === product.productId ? line : row)) : [...draft.lines, line];
    update({ ...draft, lines: lines.filter((row) => row.pieces > 0 || row.boxes > 0) });
  };

  const save = useApiMutation(
    (body: LocalDraft) =>
      api.put<{ order: AgentOrder }>(`/api/sales-agent/orders/drafts/${body.requestId}`, {
        customerId,
        paymentType: body.paymentType,
        paymentDueDate: body.paymentType === "credit" && body.paymentDueDate ? body.paymentDueDate : null,
        deliveryDate: policy?.deliveryDateMode === "choose" && body.deliveryDate ? body.deliveryDate : null,
        notes: body.notes.trim() || null,
        items: body.lines.map((line) => ({ productId: line.productId, pieces: String(line.pieces), boxes: String(line.boxes) })),
      }),
    { invalidate: false },
  );
  const submit = useApiMutation(
    async ({ orderId, reason }: { orderId: string; reason?: string }) =>
      api.post<{ order: AgentOrder }>(`/api/sales-agent/orders/${orderId}/submit`, { ...(await freshPosition()), ...(reason ? { overrideReason: reason } : {}) }),
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
      const reason = overrideNeeded && overrideReason.trim().length >= 5 ? overrideReason.trim() : undefined;
      const { order } = await submit.mutateAsync({ orderId: saved.id, reason });
      clearLocalDraft(customerId);
      setConfirming(false);
      toast.success(order.approvalStatus === "pending" ? t("order.pending_approval") : t("order.submitted", { number: order.number }));
      // Tashrif buyurtma bilan yakunlandi — bugungi marshrutga qaytish
      navigate(`/${lng}/sales-agent/sales`);
    } catch (err) {
      const details = err instanceof ApiError ? (err.details as { overrideAvailable?: boolean } | undefined) : undefined;
      if (acting && details?.overrideAvailable) {
        setOverrideNeeded(errorMessage(err));
        return;
      }
      toast.error(visitErrorMessage(err, t, "order"));
    }
  };

  const lineOf = (productId: string) => draft.lines.find((line) => line.productId === productId);
  const catalogRows: RowProduct[] = (catalog?.products ?? []).map((product) => ({
    productId: product.id,
    name: product.name,
    piecePrice: product.piecePrice,
    box: product.box ? { unitName: product.box.unitName, factor: product.box.factor, price: product.box.price } : null,
    hasImage: product.hasImage,
    imageUrl: product.imageUrl,
    available: product.available,
    promotions: product.promotions,
    brandName: product.brandName,
    categoryName: product.categoryName,
  }));
  const shownIds = new Set(catalogRows.map((row) => row.productId));
  const selectedOnly: RowProduct[] = draft.lines
    .filter((line) => !shownIds.has(line.productId))
    .map((line) => ({ ...line, hasImage: false, imageUrl: null, available: null, promotions: [], brandName: null, categoryName: null }));
  // Mahsulot oynasida surib o'tish tartibi — ekrandagi bilan bir xil: avval "Tanlangan", keyin katalog sahifasi
  const navList = [...selectedOnly, ...catalogRows];
  const openIndex = openProduct ? navList.findIndex((row) => row.productId === openProduct.productId) : -1;
  const totalPieces = draft.lines.reduce((sum, line) => sum + line.pieces + line.boxes * num(line.box?.factor), 0);
  const total = draft.lines.reduce((sum, line) => sum + line.pieces * num(line.piecePrice) + line.boxes * num(line.box?.price), 0);
  const busy = save.isPending || submit.isPending;
  const resetPage = () => setOffset(0);

  return (
    <div className="pb-44">
      <div className="sticky top-14 z-20 space-y-2 border-b border-border bg-background/95 px-4 pb-2 pt-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" className="-ml-2 h-10 w-10">
            <Link to={`/${lng}/sales-agent/stores/${customerId}`} aria-label={t("back")}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{store?.name ?? "…"}</p>
            <p className="text-xs text-muted-foreground">{saved ? t("order.draft_number", { number: saved.number }) : t("order.new")}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11px] text-muted-foreground">{t("order.total")}</p>
            <p className="text-lg font-bold tabular-nums">{money(total)}</p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="order-search"
            className="h-11 pl-10 text-base"
            placeholder={t("order.search")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
          />
        </div>
        {filters && (filters.categories.length > 0 || filters.brands.length > 0) && (
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={categoryId}
              onValueChange={(value) => {
                setCategoryId(value);
                resetPage();
              }}
            >
              <SelectTrigger className="h-10" aria-label={t("order.filter.category")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("order.filter.category_all")}</SelectItem>
                {filters.categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={brandId}
              onValueChange={(value) => {
                setBrandId(value);
                resetPage();
              }}
            >
              <SelectTrigger className="h-10" aria-label={t("order.filter.brand")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("order.filter.brand_all")}</SelectItem>
                {filters.brands.map((brand) => (
                  <SelectItem key={brand.id} value={brand.id}>
                    {brand.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
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
            <Label htmlFor="order-notes">{draft.paymentType === "credit" ? t("order.credit_note") : t("order.note")}</Label>
            <Textarea id="order-notes" rows={2} maxLength={1000} value={draft.notes} onChange={(e) => update({ ...draft, notes: e.target.value })} />
          </div>
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
            {selectedOnly.map((product) => (
              <ProductCard key={product.productId} product={product} line={lineOf(product.productId)} money={money} onOpen={() => setOpenProduct(product)} />
            ))}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("order.catalog")}</p>
          {!catalog ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
          ) : catalogRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("order.no_products")}</p>
          ) : (
            catalogRows.map((product) => (
              <ProductCard key={product.productId} product={product} line={lineOf(product.productId)} money={money} onOpen={() => setOpenProduct(product)} />
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
          <span className="text-lg font-bold tabular-nums">{money(total)}</span>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Button
            variant="secondary"
            size="icon"
            className="h-12 w-12"
            aria-label={t("order.save")}
            title={t("order.save")}
            disabled={busy || draft.lines.length === 0}
            onClick={() => void persist().then((order) => order && toast.success(t("order.saved")))}
          >
            {save.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
          </Button>
          <Button className="h-12 text-base font-bold" disabled={busy || draft.lines.length === 0} onClick={() => void openConfirm()}>
            {t("order.finish")}
          </Button>
        </div>
      </div>

      {openProduct && (
        <ProductDialog
          key={openProduct.productId}
          product={openProduct}
          line={lineOf(openProduct.productId)}
          money={money}
          onClose={() => setOpenProduct(null)}
          onSave={(pieces, boxes) => {
            setLine(openProduct, pieces, boxes);
            setOpenProduct(null);
          }}
          hasPrev={openIndex > 0}
          hasNext={openIndex >= 0 && openIndex < navList.length - 1}
          position={openIndex >= 0 ? `${openIndex + 1} / ${navList.length}` : undefined}
          onMove={(direction, pieces, boxes) => {
            // Qo'shni mahsulot ro'yxat O'ZGARMASDAN oldin topiladi (nol qilingan "tanlangan" qator ro'yxatdan chiqadi)
            const target = navList[openIndex + direction];
            if (!target) return;
            const current = lineOf(openProduct.productId);
            if ((current?.pieces ?? 0) !== pieces || (current?.boxes ?? 0) !== boxes) setLine(openProduct, pieces, boxes);
            setOpenProduct(target);
          }}
        />
      )}

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
              {saved.notes && <SummaryRow label={saved.paymentType === "credit" ? t("order.credit_note") : t("order.note")} value={saved.notes} />}
              <div className="divide-y divide-border rounded-xl border border-border">
                {saved.items?.map((item, index) => (
                  <div key={`${item.productId}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate">
                      {item.productName} × {num(item.quantity)}
                    </span>
                    <span className="font-medium">{money(item.lineTotal)}</span>
                  </div>
                ))}
              </div>
              {saved.promotions && saved.promotions.length > 0 && (
                <div className="space-y-1 rounded-xl bg-destructive/5 px-3 py-2">
                  <p className="text-xs font-semibold text-destructive">{t("order.promotions")}</p>
                  {saved.promotions.map((promotion) => (
                    <div key={`${promotion.promotionId}-${promotion.productId}`} className="flex justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate">{promotion.rule.name}</span>
                      <span className="font-medium">
                        {num(promotion.freeQuantity) > 0
                          ? t("order.promo_free", { count: num(promotion.freeQuantity) })
                          : t("order.promo_discount", { amount: money(promotion.discountAmount) })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <SummaryRow label={t("order.total")} value={money(saved.totalAmount)} strong />
            </div>
          )}
          {acting && overrideNeeded && (
            <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="act-as-override">
              <p className="text-amber-800 dark:text-amber-300">{overrideNeeded}</p>
              <Label htmlFor="override-reason">Sabab (supervayzer, alohida auditga yoziladi)</Label>
              <Textarea id="override-reason" rows={2} maxLength={500} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Masalan: mijoz telefon orqali buyurtma berdi" />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="secondary" className="h-12" onClick={() => setConfirming(false)}>
              {t("visit.cancel")}
            </Button>
            <Button className="h-12" disabled={submit.isPending || Boolean(overrideNeeded && overrideReason.trim().length < 5)} onClick={() => void handleSubmit()}>
              {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("order.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Buyurtma: katalog (rasm, kategoriya/brend filtri, qidiruv, sahifalash), mahsulot oynasida dona/blok, yuqorida jami,
 * to'lov turi (nasiya — muddat va izoh), yetkazish kuni (siyosat bo'yicha), pastda "BUYURTMANI YAKUNLASH" va
 * tasdiqlash oynasi; yuborishda yangi GPS o'lchovi — geofence, tashrif, kredit va qoldiq serverda.
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

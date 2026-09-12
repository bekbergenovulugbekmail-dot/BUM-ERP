/**
 * Kassa qurilmalari (BUM POS KASSA desktop) — `GET /api/pos/devices`, `PATCH /api/pos/devices/:id` (nomi, faolligi),
 * offline sinxron nomuvofiqliklari `GET /api/pos/devices/conflicts`, `POST …/conflicts/:id/resolve`
 * (hammasi `pos.devices.manage`). Nomuvofiqlik — kassada offline qilingan amal serverda boshqacha holatga tushgani
 * (qoldiq yetmadi, narx o'zgargan…): amal allaqachon yozilgan, rahbar tekshirib «Ko'rib chiqildi» qiladi.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CUSTOM_THEME_COLOR_FIELDS,
  CUSTOM_THEME_COLOR_LABELS,
  DEFAULT_CUSTOM_THEME,
  MAX_QUICK_SALE_ITEMS,
  POS_DENSITIES,
  POS_DENSITY_LABELS,
  POS_FONT_SCALES,
  POS_FONT_SCALE_LABELS,
  POS_SHADOWS,
  POS_THEMES,
  POS_THEME_ICONS,
  POS_THEME_LABELS,
  QUICK_SALE_PERIODS,
  activePromoPrice,
  contrastRatio,
  readableTextColor,
  validateCustomTheme,
  type PosAppearance,
  type PosCustomTheme,
  type PosThemeChoice,
  type QuickSalePeriod,
} from "@bum/shared";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Download, ImageIcon, Monitor, Pencil, Plus, Save, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, apiUrl, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { SettingsGroup } from "./form-controls.tsx";

const DEVICES_PATH = "/api/pos/devices";
const APPEARANCE_PATH = "/api/pos/devices/appearance";
const CONFLICTS_PATH = "/api/pos/devices/conflicts";

type Device = {
  id: string;
  name: string;
  code: string;
  warehouseId: string;
  warehouseName: string | null;
  isActive: boolean;
  appVersion: string | null;
  platform: string | null;
  lastSeenAt: string | null;
  lastPullAt: string | null;
  lastPushAt: string | null;
  createdAt: string;
  registeredByName: string | null;
};

type Installer = {
  id: string;
  version: string;
  fileName: string;
  size: number;
  sha256: string;
  notes: string | null;
  publishedAt: string | null;
};

type DevicesResponse = { devices: Device[]; installer: Installer | null };

type Conflict = {
  id: string;
  kind: string;
  kindLabel: string;
  referenceType: string | null;
  referenceId: string | null;
  details: Record<string, unknown>;
  productNames: Record<string, string>;
  opId: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
  deviceId: string;
  deviceName: string;
  deviceCode: string;
};

const fmtDate = (value: string | null) =>
  value ? new Date(value).toLocaleString("uz-UZ", { dateStyle: "short", timeStyle: "short" }) : "—";

/** Qurilma oxirgi marta 10 daqiqa ichida bog'langan bo'lsa — onlayn. */
const isOnline = (device: Device) => !!device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < 10 * 60_000;

const DETAIL_LABELS: Record<string, string> = {
  requested: "So'ralgan",
  available: "Qoldiq",
  quantity: "Miqdor",
  price: "Narx",
  expected: "Kutilgan",
  actual: "Kassada",
  field: "Maydon",
  from: "Oldin",
  to: "Kassada",
  server: "Serverda",
  number: "Raqam",
  amount: "Summa",
  limit: "Limit",
  debt: "Qarz",
  balance: "Balans",
};

const valueText = (value: unknown) =>
  value === null || value === undefined ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);

function ConflictDetails({ conflict }: { conflict: Conflict }) {
  const { items, ...rest } = conflict.details as { items?: Record<string, unknown>[] } & Record<string, unknown>;
  const pairs = (record: Record<string, unknown>, skip: string[] = []) =>
    Object.entries(record)
      .filter(([key]) => !skip.includes(key))
      .map(([key, value]) => `${DETAIL_LABELS[key] ?? key}: ${valueText(value)}`)
      .join(" · ");
  return (
    <div className="space-y-0.5 text-xs text-muted-foreground">
      {Array.isArray(items) &&
        items.map((item, index) => {
          const productId = typeof item.productId === "string" ? item.productId : null;
          return (
            <p key={index}>
              <span className="font-medium text-foreground">
                {productId ? (conflict.productNames[productId] ?? "Mahsulot") : `#${index + 1}`}
              </span>
              {pairs(item, ["productId"]) && <> — {pairs(item, ["productId"])}</>}
            </p>
          );
        })}
      {Object.keys(rest).length > 0 && <p className="break-all">{pairs(rest)}</p>}
    </div>
  );
}

/** Yangi kassa o'rnatish: e'lon qilingan BUM POS KASSA o'rnatuvchisi (sessiya cookie bilan yuklanadi). */
function InstallerCard() {
  const installer = useApiQuery<DevicesResponse>(DEVICES_PATH).data?.installer;
  if (installer === undefined) return <Skeleton className="h-16 rounded-xl" />;
  if (!installer) {
    return <p className="text-sm text-muted-foreground">Ilova o'rnatuvchisi hali e'lon qilinmagan — platforma administratoriga murojaat qiling.</p>;
  }
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-sm font-medium">
          BUM POS KASSA {installer.version} <span className="text-muted-foreground font-normal">· Windows 10/11 · {(installer.size / 1024 / 1024).toFixed(0)} MB</span>
        </p>
        {installer.notes && <p className="text-xs text-muted-foreground">{installer.notes}</p>}
        <p className="text-[11px] text-muted-foreground font-mono break-all">SHA-256: {installer.sha256}</p>
      </div>
      <Button asChild className="shrink-0">
        <a href={apiUrl(`${DEVICES_PATH}/installer/${installer.id}/download`)} download={installer.fileName}>
          <Download className="h-4 w-4 mr-1.5" /> Yuklab olish
        </a>
      </Button>
    </div>
  );
}

/** Kassa mavzusi: qulf yoqilsa hamma kassada tanlangan mavzu, kassirlar o'zgartira olmaydi. */
/** Tayyor mavzularning taxminiy ranglari (web ro'yxatida belgi): fon, panel, asosiy. Aniq tokenlar — desktop CSS. */
const THEME_SWATCHES: Record<Exclude<PosThemeChoice, "custom">, [string, string, string]> = {
  midnight: ["#1b2231", "#232b3c", "#7aa2f7"],
  snow: ["#f1f3f7", "#fdfdfe", "#4455c7"],
  ocean: ["#e9f1f8", "#1d3a6b", "#2b5bb8"],
  emerald: ["#ebf6f1", "#16433c", "#137269"],
  royal: ["#f3eef8", "#3a2361", "#6c3fc2"],
  sunset: ["#faf3ea", "#4a2d1c", "#b24a14"],
  graphite: ["#34363a", "#3e4045", "#9cc3dc"],
  glass: ["#e3e6f6", "#f7f7fc", "#4b50c4"],
  neon: ["#171429", "#1f1b36", "#3fd3e0"],
  classic: ["#dfe2e7", "#1e3350", "#2c8b4f"],
  "high-contrast": ["#000000", "#212121", "#f2e14a"],
  system: ["#f1f3f7", "#1b2231", "#4455c7"],
};

function ThemeSwatch({ theme, custom }: { theme: PosThemeChoice; custom: PosCustomTheme | null }) {
  const colors = theme === "custom" ? (custom ? [custom.background, custom.sidebar, custom.primary] : ["#ccc", "#999", "#666"]) : THEME_SWATCHES[theme];
  return (
    <span className="flex h-6 w-9 shrink-0 overflow-hidden rounded-md border" aria-hidden>
      {colors.map((color, index) => (
        <span key={index} className="flex-1" style={{ background: color }} />
      ))}
    </span>
  );
}

/**
 * Kassa ko'rinishi: kompaniya standart mavzusi (kassir tanlamaguncha), qulf (hamma kassada majburiy) va kompaniya maxsus
 * mavzusi (kontrast WCAG AA tekshiriladi). Kassada ustuvorlik: qulf → kassir tanlovi → kompaniya standarti → Windows.
 */
function AppearanceCard() {
  const appearance = useApiQuery<{ appearance: PosAppearance }>(APPEARANCE_PATH).data?.appearance;
  const save = useApiMutation((body: PosAppearance) => api.put<{ appearance: PosAppearance }>(APPEARANCE_PATH, body), { invalidate: [APPEARANCE_PATH] });
  if (!appearance) return <Skeleton className="h-16 rounded-xl" />;
  const update = async (patch: Partial<PosAppearance>, message = "Kassa ko'rinishi saqlandi — kassalarga sinxronda boradi") => {
    try {
      await save.mutateAsync({ ...appearance, ...patch });
      toast.success(message);
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    }
  };
  const choices: PosThemeChoice[] = appearance.custom ? [...POS_THEMES, "custom"] : [...POS_THEMES];
  return (
    <div className="space-y-4">
      <label htmlFor="pos-theme-lock" className="flex items-center justify-between gap-3">
        <span className="text-sm">
          Mavzuni hamma kassada qulflash
          <span className="block text-xs text-muted-foreground">
            O'chiq bo'lsa tanlangan mavzu — kompaniya standarti: kassir o'zi tanlamaguncha kassada shu mavzu
          </span>
        </span>
        <Switch id="pos-theme-lock" checked={appearance.locked} disabled={save.isPending} onCheckedChange={(locked) => void update({ locked })} />
      </label>
      <div className="space-y-2">
        <p className="text-sm font-medium">{appearance.locked ? "Qulflangan mavzu" : "Kompaniya standart mavzusi"}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {choices.map((theme) => (
            <button
              key={theme}
              type="button"
              disabled={save.isPending}
              onClick={() => void update({ theme })}
              aria-pressed={appearance.theme === theme}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-60",
                appearance.theme === theme ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted",
              )}
            >
              <ThemeSwatch theme={theme} custom={appearance.custom} />
              <span aria-hidden>{POS_THEME_ICONS[theme]}</span>
              <span className="truncate">{theme === "custom" && appearance.custom ? appearance.custom.name : POS_THEME_LABELS[theme]}</span>
            </button>
          ))}
        </div>
      </div>
      <CustomThemeEditor
        saved={appearance.custom}
        saving={save.isPending}
        onSave={(custom) => update({ custom }, "Maxsus mavzu saqlandi")}
        onRemove={() => void update({ custom: null, theme: appearance.theme === "custom" ? "system" : appearance.theme }, "Maxsus mavzu o'chirildi")}
      />
    </div>
  );
}

/** Maxsus mavzuning jonli ko'rinishi: haqiqiy kassa tuzilishi (yon panel, kategoriya, kartalar, savat, jami, to'lov tugmasi). */
function CustomThemePreview({ theme }: { theme: PosCustomTheme }) {
  const text = readableTextColor;
  const radius = `${theme.radius}px`;
  const shadow = theme.shadow === "none" ? "none" : theme.shadow === "soft" ? "0 1px 3px rgb(0 0 0 / 0.12)" : "0 3px 10px rgb(0 0 0 / 0.25)";
  const muted = { color: text(theme.card), opacity: 0.7 };
  return (
    <div className="flex h-72 overflow-hidden rounded-xl border text-[10px]" style={{ background: theme.background, color: text(theme.background) }} aria-label="Maxsus mavzu ko'rinishi">
      <div className="flex w-10 flex-col items-center gap-2 py-2" style={{ background: theme.sidebar }}>
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className="h-5 w-5" style={{ borderRadius: radius, background: index === 0 ? theme.primary : text(theme.sidebar), opacity: index === 0 ? 1 : 0.35 }} />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-2 py-1.5" style={{ background: theme.surface, color: text(theme.surface) }}>
          <b>{theme.name}</b>
          <span>Kassir · 12:30</span>
        </div>
        <div className="flex min-h-0 flex-1 gap-2 p-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex gap-1">
              {["Hammasi", "Non", "Sut"].map((label, index) => (
                <span
                  key={label}
                  className="px-2 py-0.5 font-semibold"
                  style={{ borderRadius: radius, background: index === 0 ? theme.primary : theme.secondary, color: text(index === 0 ? theme.primary : theme.secondary) }}
                >
                  {label}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {["Olma", "Non", "Sut"].map((name, index) => (
                <div key={name} className="overflow-hidden" style={{ borderRadius: radius, background: theme.card, color: text(theme.card), boxShadow: shadow }}>
                  <div className="h-8" style={{ background: theme.accent }} />
                  <div className="p-1">
                    <b className="block">{name}</b>
                    <b className="block">18 000</b>
                    <span style={muted}>{index === 0 ? "AKSIYA" : "12 kg"}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex w-28 flex-col gap-1 p-1.5" style={{ borderRadius: radius, background: theme.surface, color: text(theme.surface), boxShadow: shadow }}>
            <span>Olma × 2</span>
            <span>Non × 1</span>
            <div className="mt-auto p-1" style={{ borderRadius: radius, background: theme.accent, color: text(theme.accent) }}>
              <span className="block">JAMI</span>
              <b className="block text-xs">40 000</b>
            </div>
            <span className="py-1 text-center font-bold" style={{ borderRadius: radius, background: theme.button, color: text(theme.button) }}>
              YAKUNLASH
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomThemeEditor({
  saved,
  saving,
  onSave,
  onRemove,
}: {
  saved: PosCustomTheme | null;
  saving: boolean;
  onSave: (theme: PosCustomTheme) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<PosCustomTheme | null>(null);
  if (!draft) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">🎨 Kompaniya maxsus mavzusi</p>
          <p className="text-xs text-muted-foreground">
            {saved ? `«${saved.name}» — mavzular ro'yxatida tanlanadi` : "O'z ranglaringiz bilan mavzu; matn kontrasti (WCAG AA, 4.5:1) tekshiriladi"}
          </p>
        </div>
        <div className="flex gap-2">
          {saved && (
            <Button size="sm" variant="ghost" disabled={saving} onClick={onRemove}>
              O'chirish
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setDraft(saved ?? DEFAULT_CUSTOM_THEME)}>
            {saved ? "Tahrirlash" : "Yaratish"}
          </Button>
        </div>
      </div>
    );
  }
  const issues = validateCustomTheme(draft);
  const set = (patch: Partial<PosCustomTheme>) => setDraft({ ...draft, ...patch });
  const option = <T extends string>(value: T, current: T, label: string, onPick: (value: T) => void) => (
    <Button key={value} type="button" size="sm" variant={value === current ? "default" : "secondary"} onClick={() => onPick(value)}>
      {label}
    </Button>
  );
  return (
    <div className="grid gap-4 rounded-lg border p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="custom-theme-name" className="text-sm font-medium">
              Mavzu nomi
            </label>
            <Input id="custom-theme-name" maxLength={40} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Asos</p>
            <div className="flex gap-1">
              {option("light", draft.base, "Yorug'", (base) => set({ base }))}
              {option("dark", draft.base, "Qorong'i", (base) => set({ base }))}
            </div>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {CUSTOM_THEME_COLOR_FIELDS.map((field) => {
            const ratio = contrastRatio(draft[field], readableTextColor(draft[field]));
            return (
              <label key={field} htmlFor={`custom-theme-${field}`} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                <input
                  id={`custom-theme-${field}`}
                  type="color"
                  className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent"
                  value={draft[field]}
                  onChange={(e) => set({ [field]: e.target.value } as Partial<PosCustomTheme>)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{CUSTOM_THEME_COLOR_LABELS[field]}</span>
                  <span className={cn("block font-mono text-[11px]", ratio < 4.5 ? "text-destructive" : "text-muted-foreground")}>
                    {draft[field]} · matn {Math.round(ratio * 10) / 10}:1
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="custom-theme-radius" className="text-sm font-medium">
              Burchak radiusi: {draft.radius}px
            </label>
            <input id="custom-theme-radius" type="range" min={0} max={24} value={draft.radius} className="w-full" onChange={(e) => set({ radius: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Soya</p>
            <div className="flex flex-wrap gap-1">
              {POS_SHADOWS.map((shadow) => option(shadow, draft.shadow, shadow === "none" ? "Yo'q" : shadow === "soft" ? "Yumshoq" : "Kuchli", (value) => set({ shadow: value })))}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Zichlik (standart)</p>
            <div className="flex flex-wrap gap-1">{POS_DENSITIES.map((density) => option(density, draft.density, POS_DENSITY_LABELS[density], (value) => set({ density: value })))}</div>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Shrift (standart)</p>
            <div className="flex flex-wrap gap-1">{POS_FONT_SCALES.map((scale) => option(scale, draft.fontScale, POS_FONT_SCALE_LABELS[scale], (value) => set({ fontScale: value })))}</div>
          </div>
        </div>
        {issues.length > 0 && (
          <ul className="space-y-0.5 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {issues.map((issue) => (
              <li key={`${issue.field}:${issue.min}`}>{issue.message}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={saving || issues.length > 0 || !draft.name.trim()}
            onClick={() =>
              void onSave(draft).then((ok) => {
                if (ok) setDraft(null);
              })
            }
          >
            <Save className="h-4 w-4 mr-1.5" /> Saqlash
          </Button>
          <Button variant="ghost" onClick={() => setDraft(null)}>
            Bekor qilish
          </Button>
        </div>
      </div>
      <CustomThemePreview theme={draft} />
    </div>
  );
}

const QUICK_SALE_PATH = "/api/pos/devices/quick-sale";

type QuickSaleProduct = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  categoryName: string | null;
  unitName: string | null;
  salesPrice: string;
  salesCurrency: string | null;
  /** Bugun amaldagi aksiya narxi. */
  promoPrice: string | null;
  promoPriceEnd: string | null;
  hasImage: boolean;
  isActive: boolean;
  isSaleable: boolean;
};
type QuickSaleResponse = { productIds: string[]; products: QuickSaleProduct[] };
type QuickSaleSuggestion = { product: QuickSaleProduct; quantity: string; revenue: string; receipts: number };
type CatalogProduct = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  salesPrice: string;
  salesCurrency: string | null;
  promoPrice: string | null;
  promoPriceEnd: string | null;
  imageKey: string | null;
  isActive: boolean;
  isSaleable: boolean;
};

const amount = (value: string, currency?: string | null) =>
  `${Number(value).toLocaleString("uz-UZ", { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;

function QuickSalePrice({ product }: { product: QuickSaleProduct }) {
  if (!product.promoPrice) return <span className="tabular-nums">{amount(product.salesPrice, product.salesCurrency)}</span>;
  return (
    <span className="tabular-nums">
      <span className="rounded bg-destructive px-1 text-[10px] font-bold uppercase text-white">Aksiya</span>{" "}
      <span className="font-semibold text-destructive">{amount(product.promoPrice, product.salesCurrency)}</span> <s>{amount(product.salesPrice)}</s>
    </span>
  );
}

/**
 * Tezkor sotuv assortimenti: kassada katta rasmli kartalar (bosilganda savatga +1), tartibi shu ro'yxatdagidek.
 * Tavsiya — oxirgi 7/30/90 kunda kassada eng ko'p sotilganlar (qaytarilgani ayirilgan).
 */
function QuickSaleCard() {
  const saved = useApiQuery<QuickSaleResponse>(QUICK_SALE_PATH);
  const [draft, setDraft] = useState<QuickSaleProduct[] | null>(null);
  const [days, setDays] = useState<QuickSalePeriod>(30);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const suggestions = useApiQuery<{ suggestions: QuickSaleSuggestion[] }>(`${QUICK_SALE_PATH}/suggestions`, { days, limit: 40 });
  const found = useApiQuery<{ products: CatalogProduct[] }>(term ? "/api/catalog/products" : null, { search: term, isActive: true, limit: 20 });
  const save = useApiMutation((productIds: string[]) => api.put<QuickSaleResponse>(QUICK_SALE_PATH, { productIds }), { invalidate: [QUICK_SALE_PATH] });

  if (saved.error) return <p className="text-sm text-destructive">{errorMessage(saved.error)}</p>;
  if (!saved.data) return <Skeleton className="h-40 rounded-xl" />;

  const list = draft ?? saved.data.products;
  const inList = new Set(list.map((product) => product.id));
  const full = list.length >= MAX_QUICK_SALE_ITEMS;
  const edit = (next: QuickSaleProduct[]) => setDraft(next.slice(0, MAX_QUICK_SALE_ITEMS));
  const add = (product: QuickSaleProduct) => {
    if (!inList.has(product.id)) edit([...list, product]);
  };
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[index], next[target]] = [next[target]!, next[index]!];
    edit(next);
  };
  const submit = async () => {
    try {
      await save.mutateAsync(list.map((product) => product.id));
      setDraft(null);
      toast.success("Tezkor sotuv saqlandi — kassalarga sinxronda boradi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const today = new Date().toISOString().slice(0, 10);
  const fromCatalog = (product: CatalogProduct): QuickSaleProduct => {
    const promoPrice = activePromoPrice(product, today);
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      categoryName: null,
      unitName: null,
      salesPrice: product.salesPrice,
      salesCurrency: product.salesCurrency,
      promoPrice,
      promoPriceEnd: promoPrice ? product.promoPriceEnd : null,
      hasImage: Boolean(product.imageKey),
      isActive: product.isActive,
      isSaleable: product.isSaleable,
    };
  };
  const suggestionRows = suggestions.data?.suggestions ?? [];
  const missing = suggestionRows.filter((row) => !inList.has(row.product.id));
  const results = (found.data?.products ?? []).filter((product) => product.isSaleable);

  const addButton = (product: QuickSaleProduct) => (
    <Button size="sm" variant="secondary" className="shrink-0" disabled={inList.has(product.id) || full} onClick={() => add(product)}>
      {inList.has(product.id) ? (
        "Qo'shilgan"
      ) : (
        <>
          <Plus className="h-4 w-4 mr-1" /> Qo'shish
        </>
      )}
    </Button>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">
            Assortiment{" "}
            <span className="font-normal text-muted-foreground">
              · {list.length} / {MAX_QUICK_SALE_ITEMS}
            </span>
          </p>
          <div className="flex gap-1.5">
            {draft && (
              <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => setDraft(null)}>
                Bekor qilish
              </Button>
            )}
            <Button size="sm" disabled={!draft || save.isPending} onClick={() => void submit()}>
              <Save className="h-4 w-4 mr-1.5" /> Saqlash
            </Button>
          </div>
        </div>
        {list.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Hali mahsulot tanlanmagan. Tavsiyadan yoki qidiruvdan qo'shing — kassada "Tezkor sotuv" tabida katta rasmli kartalar bo'lib chiqadi.
          </p>
        ) : (
          <ol className="max-h-[28rem] divide-y overflow-y-auto rounded-lg border">
            {list.map((product, index) => (
              <li key={product.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 font-medium">
                    <span className="truncate">{product.name}</span>
                    {product.hasImage && <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Rasm bor" />}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {product.sku}
                    {product.categoryName ? ` · ${product.categoryName}` : ""} · <QuickSalePrice product={product} />
                  </p>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Yuqoriga">
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" disabled={index === list.length - 1} onClick={() => move(index, 1)} aria-label="Pastga">
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  onClick={() => edit(list.filter((item) => item.id !== product.id))}
                  aria-label="Olib tashlash"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="min-w-0 space-y-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Kassada eng ko'p sotilganlar</p>
            <div className="flex gap-1">
              {QUICK_SALE_PERIODS.map((period) => (
                <Button key={period} size="sm" variant={days === period ? "default" : "secondary"} onClick={() => setDays(period)}>
                  {period} kun
                </Button>
              ))}
            </div>
          </div>
          {suggestions.error ? (
            <p className="text-sm text-destructive">{errorMessage(suggestions.error)}</p>
          ) : !suggestions.data ? (
            <Skeleton className="h-24 rounded-lg" />
          ) : suggestionRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Oxirgi {days} kunda kassa sotuvi yo'q.</p>
          ) : (
            <>
              <div className="max-h-64 divide-y overflow-y-auto rounded-lg border">
                {suggestionRows.map((row, index) => (
                  <div key={row.product.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                    <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{row.product.name}</p>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {amount(row.quantity)} {row.product.unitName ?? ""} · {row.receipts} chek · {amount(row.revenue)}
                      </p>
                    </div>
                    {addButton(row.product)}
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" disabled={missing.length === 0 || full} onClick={() => edit([...list, ...missing.map((row) => row.product)])}>
                Hammasini qo'shish ({missing.length})
              </Button>
            </>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="quick-sale-search" className="text-sm font-medium">
            Mahsulot qidirish
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input id="quick-sale-search" className="pl-8" placeholder="Nomi, SKU yoki shtrix-kod" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {term &&
            (found.error ? (
              <p className="text-sm text-destructive">{errorMessage(found.error)}</p>
            ) : !found.data ? (
              <Skeleton className="h-16 rounded-lg" />
            ) : results.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sotiladigan mahsulot topilmadi</p>
            ) : (
              <div className="max-h-64 divide-y overflow-y-auto rounded-lg border">
                {results.map((product) => {
                  const row = fromCatalog(product);
                  return (
                    <div key={product.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{product.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {product.sku} · <QuickSalePrice product={row} />
                        </p>
                      </div>
                      {addButton(row)}
                    </div>
                  );
                })}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function DevicesTable() {
  const devicesQuery = useApiQuery<DevicesResponse>(DEVICES_PATH);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const update = useApiMutation(
    ({ id, ...patch }: { id: string; name?: string; isActive?: boolean }) => api.patch<{ device: Device }>(`${DEVICES_PATH}/${id}`, patch),
    { invalidate: [DEVICES_PATH] },
  );

  const save = async (id: string, patch: { name?: string; isActive?: boolean }, message: string) => {
    try {
      await update.mutateAsync({ id, ...patch });
      setEditing(null);
      toast.success(message);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const toggle = (device: Device, isActive: boolean) => {
    if (!isActive && !window.confirm(`«${device.name}» o'chirilsinmi? Kassa serverga ulana olmaydi (offline navbati qurilmada saqlanadi).`)) return;
    void save(device.id, { isActive }, isActive ? "Qurilma yoqildi" : "Qurilma o'chirildi");
  };

  if (devicesQuery.error) return <p className="text-sm text-destructive">{errorMessage(devicesQuery.error)}</p>;
  if (!devicesQuery.data) return <Skeleton className="h-40 rounded-xl" />;
  const devices = devicesQuery.data.devices;
  if (devices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Hali qurilma yo'q. Yuqoridagi o'rnatuvchini kassa kompyuteriga o'rnating, server manzili
        https://www.bum-erp.uz va «Kassa qurilmalarini boshqarish» ruxsati bor login bilan ro'yxatdan o'tkazing.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="text-left font-medium px-2 py-1.5">Kod</th>
            <th className="text-left font-medium px-2 py-1.5">Nomi</th>
            <th className="text-left font-medium px-2 py-1.5">Ombor</th>
            <th className="text-left font-medium px-2 py-1.5">Versiya</th>
            <th className="text-left font-medium px-2 py-1.5">Oxirgi aloqa</th>
            <th className="text-left font-medium px-2 py-1.5">Sinxron (olish / yuborish)</th>
            <th className="text-left font-medium px-2 py-1.5">Ro'yxatga oldi</th>
            <th className="text-center font-medium px-2 py-1.5">Faol</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <tr key={device.id} className={cn("border-t border-border/60 align-middle", !device.isActive && "opacity-60")}>
              <td className="px-2 py-2 font-mono text-xs">{device.code}</td>
              <td className="px-2 py-2 min-w-[200px]">
                {editing?.id === device.id ? (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = editing.name.trim();
                      if (name && name !== device.name) void save(device.id, { name }, "Nomi saqlandi");
                      else setEditing(null);
                    }}
                  >
                    <Input
                      id={`device-name-${device.id}`}
                      value={editing.name}
                      maxLength={100}
                      autoFocus
                      className="h-8"
                      onChange={(event) => setEditing({ id: device.id, name: event.target.value })}
                    />
                    <Button type="submit" size="icon" variant="ghost" className="h-8 w-8" title="Saqlash" disabled={update.isPending}>
                      <Save className="h-4 w-4" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" title="Bekor qilish" onClick={() => setEditing(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </form>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className={cn("h-2 w-2 rounded-full shrink-0", isOnline(device) ? "bg-emerald-500" : "bg-muted-foreground/40")} title={isOnline(device) ? "Onlayn" : "Oflayn"} />
                    <span className="font-medium">{device.name}</span>
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="Nomini o'zgartirish" onClick={() => setEditing({ id: device.id, name: device.name })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </td>
              <td className="px-2 py-2">{device.warehouseName ?? "—"}</td>
              <td className="px-2 py-2 tabular-nums">
                {device.appVersion ?? "—"}
                {device.platform && <span className="text-xs text-muted-foreground"> · {device.platform}</span>}
              </td>
              <td className="px-2 py-2 tabular-nums whitespace-nowrap">{fmtDate(device.lastSeenAt)}</td>
              <td className="px-2 py-2 tabular-nums whitespace-nowrap text-xs">
                {fmtDate(device.lastPullAt)} / {fmtDate(device.lastPushAt)}
              </td>
              <td className="px-2 py-2 text-xs">
                {device.registeredByName ?? "—"}
                <div className="text-muted-foreground">{fmtDate(device.createdAt)}</div>
              </td>
              <td className="px-2 py-2 text-center">
                <Switch
                  checked={device.isActive}
                  disabled={update.isPending}
                  onCheckedChange={(isActive) => toggle(device, isActive)}
                  aria-label={`${device.name} faol`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConflictsList() {
  const [resolved, setResolved] = useState(false);
  const conflictsQuery = useApiQuery<{ conflicts: Conflict[] }>(CONFLICTS_PATH, { resolved: String(resolved), limit: 200 });
  const resolve = useApiMutation((id: string) => api.post(`${CONFLICTS_PATH}/${id}/resolve`), { invalidate: [CONFLICTS_PATH] });

  const handleResolve = async (id: string) => {
    try {
      await resolve.mutateAsync(id);
      toast.success("Ko'rib chiqildi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const conflicts = conflictsQuery.data?.conflicts;
  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border border-border p-0.5 text-sm">
        {[
          { value: false, label: "Ochiq" },
          { value: true, label: "Ko'rib chiqilgan" },
        ].map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => setResolved(option.value)}
            className={cn(
              "px-3 py-1 rounded-md cursor-pointer transition-colors",
              resolved === option.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {conflictsQuery.error ? (
        <p className="text-sm text-destructive">{errorMessage(conflictsQuery.error)}</p>
      ) : !conflicts ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : conflicts.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          {resolved ? "Ko'rib chiqilgan nomuvofiqlik yo'q" : "Ochiq nomuvofiqlik yo'q — kassalar serverga mos"}
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border">
          {conflicts.map((conflict) => (
            <li key={conflict.id} className="flex flex-col sm:flex-row sm:items-start gap-2 px-3 py-2.5">
              <AlertTriangle className={cn("h-4 w-4 mt-0.5 shrink-0", conflict.resolvedAt ? "text-muted-foreground" : "text-amber-500")} />
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-medium">{conflict.kindLabel}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{conflict.deviceCode}</span> · {conflict.deviceName} · {fmtDate(conflict.createdAt)}
                  {conflict.referenceType && (
                    <>
                      {" "}· {conflict.referenceType}
                      {conflict.referenceId && <span className="font-mono"> {conflict.referenceId.slice(0, 8)}</span>}
                    </>
                  )}
                </p>
                <ConflictDetails conflict={conflict} />
              </div>
              {conflict.resolvedAt ? (
                <p className="text-xs text-muted-foreground sm:text-right shrink-0">
                  {conflict.resolvedByName ?? "—"}
                  <br />
                  {fmtDate(conflict.resolvedAt)}
                </p>
              ) : (
                <Button size="sm" variant="secondary" className="shrink-0" disabled={resolve.isPending} onClick={() => { void handleResolve(conflict.id); }}>
                  <CheckCircle2 className="h-4 w-4 mr-1.5" /> Ko'rib chiqildi
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PosDevicesSection() {
  const { can, isLoading } = usePermissions();

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-center gap-3 pb-2 border-b border-border">
        <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
          <Monitor className="h-5 w-5 text-violet-500" />
        </div>
        <div>
          <p className="font-semibold">Kassa qurilmalari</p>
          <p className="text-xs text-muted-foreground">
            BUM POS KASSA desktop ilovalari: internet bo'lmasa ham sotadi, aloqa tiklanganda serverga yuboradi.
          </p>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : !can("pos.devices.manage") ? (
        <p className="text-sm text-muted-foreground">Bu bo'lim uchun «Kassa qurilmalarini boshqarish» ruxsati kerak.</p>
      ) : (
        <>
          <SettingsGroup title="Ilovani o'rnatish" description="Kassa kompyuteriga o'rnating va server manzili, rahbar telefoni va paroli bilan bir marta ro'yxatdan o'tkazing">
            <InstallerCard />
          </SettingsGroup>
          <SettingsGroup title="Kassa ko'rinishi" description="Mavzu faqat ko'rinish: hisob, qoldiq va to'lovga ta'sir qilmaydi">
            <AppearanceCard />
          </SettingsGroup>
          <SettingsGroup
            title="Tezkor sotuv"
            description="Kassada rasmli kartalar bilan tez sotiladigan mahsulotlar. Aksiya narxi mahsulot kartasidan olinadi va serverda hisoblanadi"
          >
            <QuickSaleCard />
          </SettingsGroup>
          <SettingsGroup title="Qurilmalar" description="O'chirilgan qurilma serverga ulana olmaydi; qayta yoqilganda offline navbatini yuboradi">
            <DevicesTable />
          </SettingsGroup>
          <SettingsGroup
            title="Sinxron nomuvofiqliklari"
            description="Kassada offline qilingan amal serverda boshqacha holatga tushgan. Amal yozilgan — tekshirib, kerak bo'lsa hujjat bilan tuzating"
          >
            <ConflictsList />
          </SettingsGroup>
        </>
      )}
    </div>
  );
}

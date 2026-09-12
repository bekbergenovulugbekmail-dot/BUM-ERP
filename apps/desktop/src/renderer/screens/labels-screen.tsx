import { useEffect, useState } from "react";
import { DEFAULT_LABEL_SETTINGS, type LabelSettings } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { buildLabelsHtml, labelCode, toLabelProduct, type LabelItem } from "@/lib/print/label-html.ts";
import type { AppStatus, DevicePrefs, PosContext, PosProduct } from "../../shared/kassa-api.js";
import { num } from "../format.ts";
import { call, errorText } from "../kassa.ts";
import ProductPicker from "../stock/product-picker.tsx";

const MAX_LABELS = 2000;

/** Server sozlamasi to'liq bo'lsa — o'sha, aks holda standart shablonlar. */
function labelSettings(context: PosContext | null): LabelSettings {
  const value = context?.labels as Partial<LabelSettings> | null | undefined;
  return value && Array.isArray(value.templates) && value.templates.length > 0 && typeof value.defaultTemplateId === "string"
    ? (value as LabelSettings)
    : DEFAULT_LABEL_SETTINGS;
}

/**
 * Etiketka: web'dagi shablonlar (Sozlamalar → Etiketka), mahsulot skaner/qidiruv yoki bugungi xaridlardan (qabul
 * qilingan miqdor bo'yicha), nusxa soni, jonli ko'rinish; etiketka printeriga dialogsiz. Internet shart emas.
 */
export default function LabelsScreen({ status, onExit }: { status: AppStatus; onExit: () => void }) {
  const [context, setContext] = useState<PosContext | null>(null);
  const [prefs, setPrefs] = useState<DevicePrefs | null>(null);
  const [printers, setPrinters] = useState<{ name: string; displayName: string }[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [items, setItems] = useState<LabelItem[]>([]);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([call("pos:context"), call("device:prefs"), call("device:printers")]).then(
      ([loadedContext, loadedPrefs, list]) => {
        setContext(loadedContext);
        setPrefs(loadedPrefs);
        setPrinters(list);
      },
      (err: unknown) => setNotice({ tone: "error", text: errorText(err) }),
    );
  }, [status.sync.lastSyncAt]);

  const settings = labelSettings(context);
  const template = settings.templates.find((item) => item.id === (templateId ?? settings.defaultTemplateId)) ?? settings.templates[0]!;
  const companyName = context?.company?.name ?? status.company?.name ?? "";
  const canPurchases = (context?.permissions ?? []).includes("purchase.create");
  const total = items.reduce((sum, item) => sum + item.quantity, 0);

  const add = (product: PosProduct, copies = 1) => {
    setNotice(null);
    setItems((current) => {
      const index = current.findIndex((item) => item.product.id === product.id);
      if (index >= 0) return current.map((item, i) => (i === index ? { ...item, quantity: Math.min(MAX_LABELS, item.quantity + copies) } : item));
      const labelProduct = toLabelProduct({ id: product.id, name: product.name, sku: product.sku, barcode: product.barcode, salesPrice: product.price ?? "0" });
      return [...current, { product: labelProduct, quantity: Math.min(MAX_LABELS, copies) }];
    });
  };

  const setQuantity = (index: number, value: number) =>
    setItems((current) => current.map((item, i) => (i === index ? { ...item, quantity: Math.max(0, Math.min(MAX_LABELS, Math.round(value) || 0)) } : item)));

  const fromPurchases = async () => {
    setNotice(null);
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const purchases = await call("purchase:list", { from: start.toISOString(), limit: 500 });
      const copies = new Map<string, number>();
      for (const purchase of purchases) {
        if (purchase.sync.state === "rejected" || purchase.sync.state === "discarded") continue;
        for (const line of purchase.lines) copies.set(line.productId, (copies.get(line.productId) ?? 0) + Math.ceil(num(line.quantity)));
      }
      if (copies.size === 0) {
        setNotice({ tone: "info", text: "Bugun xarid yo'q" });
        return;
      }
      const products = await call("pos:products-by-ids", { ids: [...copies.keys()] });
      for (const product of products) add(product, copies.get(product.id) ?? 1);
      setNotice({ tone: "info", text: `${products.length} ta mahsulot bugungi xaridlardan qo'shildi` });
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err) });
    }
  };

  const firstItem = items.find((item) => item.quantity > 0);
  const preview = firstItem
    ? buildLabelsHtml([{ product: firstItem.product, quantity: template.layout === "a4" ? template.columns : 1 }], template, { companyName, previewWidthPx: 360 })
    : null;

  const print = async () => {
    if (total === 0 || busy) return;
    if (total > MAX_LABELS) {
      setNotice({ tone: "error", text: `Bir martada ko'pi bilan ${MAX_LABELS} ta etiketka` });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await call("device:print-labels", { html: buildLabelsHtml(items, template, { companyName }), layout: template.layout, widthMm: template.widthMm, heightMm: template.heightMm });
      setNotice({ tone: "info", text: `${total} ta etiketka printerga yuborildi` });
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const savePrinter = (name: string) => {
    if (!prefs) return;
    call("device:save-prefs", { ...prefs, labelPrinterName: name || null }).then(setPrefs, (err: unknown) => setNotice({ tone: "error", text: errorText(err) }));
  };

  return (
    <main className="grid h-full grid-rows-[auto_1fr] bg-muted/40">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2">
        <Button size="sm" variant="secondary" onClick={onExit}>
          ← Bosh sahifa
        </Button>
        <h1 className="font-semibold">Etiketka</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Label htmlFor="label-printer" className="text-sm">
            Etiketka printeri
          </Label>
          <select
            id="label-printer"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={prefs?.labelPrinterName ?? ""}
            disabled={!prefs}
            onChange={(e) => savePrinter(e.target.value)}
          >
            <option value="">Windows standart printeri</option>
            {printers.map((printer) => (
              <option key={printer.name} value={printer.name}>
                {printer.displayName}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[minmax(0,340px)_minmax(0,1fr)_380px] gap-3 p-3">
        <ProductPicker source="pos" onPick={(product) => add(product)} placeholder="Skanerlang yoki qidiring — har biri +1 nusxa" />

        <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <Label htmlFor="label-template">Shablon</Label>
            <select
              id="label-template"
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
              value={template.id}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              {settings.templates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.widthMm}×{item.heightMm} mm{item.layout === "a4" ? ` · A4, ${item.columns} ustun` : ""}
                </option>
              ))}
            </select>
            {canPurchases && (
              <Button size="sm" variant="secondary" onClick={() => void fromPurchases()}>
                Bugungi xaridlardan
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={items.length === 0} onClick={() => setItems([])}>
              Tozalash
            </Button>
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
            {items.map((item, index) => (
              <li key={item.product.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.product.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{labelCode(item.product)}</p>
                </div>
                <Button size="sm" variant="ghost" aria-label="Kamaytirish" onClick={() => setQuantity(index, item.quantity - 1)}>
                  −
                </Button>
                <Input
                  id={`label-copies-${item.product.id}`}
                  className="h-8 w-20 text-center"
                  inputMode="numeric"
                  value={String(item.quantity)}
                  onChange={(e) => setQuantity(index, Number(e.target.value.replace(/\D/g, "")))}
                />
                <Button size="sm" variant="ghost" aria-label="Ko'paytirish" onClick={() => setQuantity(index, item.quantity + 1)}>
                  +
                </Button>
                <button
                  type="button"
                  aria-label={`${item.product.name} ni olib tashlash`}
                  className="px-1 text-muted-foreground hover:text-destructive"
                  onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                >
                  ✕
                </button>
              </li>
            ))}
            {items.length === 0 && <li className="px-3 py-12 text-center text-sm text-muted-foreground">Mahsulotni chapdan tanlang, skanerlang yoki bugungi xaridlardan qo'shing</li>}
          </ul>
        </section>

        <section className="flex min-h-0 flex-col gap-3">
          {preview ? (
            <iframe title="Etiketka ko'rinishi" sandbox="" srcDoc={preview} className="h-72 w-full rounded-xl border border-border bg-muted/40" />
          ) : (
            <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">Ko'rinish</div>
          )}
          <p className="text-xs text-muted-foreground">
            {template.layout === "roll" ? "Termal etiketka printeri — har etiketka alohida" : `A4 varaq — ${template.columns} ustun`} · {template.widthMm}×{template.heightMm} mm. Shablonlar
            web'da: Sozlamalar → Etiketka.
          </p>
          {notice && (
            <p className={`rounded-lg px-3 py-2 text-sm ${notice.tone === "error" ? "bg-destructive/10 text-destructive" : "bg-pos-success/10 text-pos-success"}`}>{notice.text}</p>
          )}
          <Button className="h-12 w-full text-base font-bold" disabled={busy || total === 0} onClick={() => void print()}>
            {total} ta etiketka chop etish
          </Button>
        </section>
      </div>
    </main>
  );
}

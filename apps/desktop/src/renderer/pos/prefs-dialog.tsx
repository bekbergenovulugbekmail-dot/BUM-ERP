import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import type { DevicePrefs, DrawerPrefs, PosContext } from "../../shared/kassa-api.js";
import { call, errorText } from "../kassa.ts";
import { printSample } from "./receipt.ts";

const DRAWER_MODES: { key: DrawerPrefs["mode"]; label: string }[] = [
  { key: "none", label: "Yo'q" },
  { key: "driver", label: "Printer drayveri" },
  { key: "tcp", label: "Tarmoq printeri" },
  { key: "share", label: "Ulashilgan printer" },
];

/** Qurilma sozlamalari: chek printeri, qog'oz kengligi, avtomatik chop etish, pul qutisi. */
export default function PrefsDialog({
  open,
  context,
  cashierName,
  onClose,
  onSaved,
}: {
  open: boolean;
  context: PosContext | null;
  cashierName: string | null;
  onClose: () => void;
  onSaved: (prefs: DevicePrefs) => void;
}) {
  const [prefs, setPrefs] = useState<DevicePrefs | null>(null);
  const [printers, setPrinters] = useState<{ name: string; displayName: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    Promise.all([call("device:prefs"), call("device:printers")]).then(
      ([loaded, list]) => {
        setPrefs(loaded);
        setPrinters(list);
      },
      (err: unknown) => setMessage({ tone: "error", text: errorText(err) }),
    );
  }, [open]);

  const patch = (change: Partial<DevicePrefs>) => setPrefs((current) => (current ? { ...current, ...change } : current));
  const patchDrawer = (change: Partial<DrawerPrefs>) => setPrefs((current) => (current ? { ...current, drawer: { ...current.drawer, ...change } } : current));

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ tone: "ok", text: await action() });
    } catch (err) {
      setMessage({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Printer va pul qutisi</DialogTitle>
          <DialogDescription>Shu kompyuter uchun sozlamalar. Chek shabloni — web'dagi Sozlamalar → Chop etish.</DialogDescription>
        </DialogHeader>
        {prefs && (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="prefs-printer">Chek printeri</Label>
              <select
                id="prefs-printer"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={prefs.printerName ?? ""}
                onChange={(e) => patch({ printerName: e.target.value || null })}
              >
                <option value="">Windows standart printeri</option>
                {printers.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="prefs-label-printer">Etiketka printeri</Label>
              <select
                id="prefs-label-printer"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={prefs.labelPrinterName ?? ""}
                onChange={(e) => patch({ labelPrinterName: e.target.value || null })}
              >
                <option value="">Windows standart printeri</option>
                {printers.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label>Qog'oz kengligi</Label>
              <div className="flex gap-1">
                {([58, 80] as const).map((width) => (
                  <Button key={width} size="sm" variant={prefs.paperWidth === width ? "default" : "secondary"} onClick={() => patch({ paperWidth: width })}>
                    {width} mm
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="prefs-autoprint">Chek yakunlanganda avtomatik chop etish</Label>
              <Switch id="prefs-autoprint" checked={prefs.autoPrint} onCheckedChange={(checked) => patch({ autoPrint: checked })} />
            </div>

            <div className="space-y-2 rounded-lg border border-border p-3">
              <Label>Pul qutisi</Label>
              <div className="flex flex-wrap gap-1">
                {DRAWER_MODES.map((mode) => (
                  <Button key={mode.key} size="sm" variant={prefs.drawer.mode === mode.key ? "default" : "secondary"} onClick={() => patchDrawer({ mode: mode.key })}>
                    {mode.label}
                  </Button>
                ))}
              </div>
              {prefs.drawer.mode === "tcp" && (
                <div className="grid grid-cols-[1fr_96px] gap-2">
                  <Input id="drawer-host" placeholder="192.168.1.50" value={prefs.drawer.host ?? ""} onChange={(e) => patchDrawer({ host: e.target.value })} />
                  <Input
                    id="drawer-port"
                    inputMode="numeric"
                    placeholder="9100"
                    value={prefs.drawer.port ? String(prefs.drawer.port) : ""}
                    onChange={(e) => patchDrawer({ port: Number(e.target.value.replace(/\D/g, "")) || undefined })}
                  />
                </div>
              )}
              {prefs.drawer.mode === "share" && (
                <Input id="drawer-share" placeholder="Ulashma nomi, masalan POS80" value={prefs.drawer.share ?? ""} onChange={(e) => patchDrawer({ share: e.target.value })} />
              )}
              {prefs.drawer.mode === "driver" && <p className="text-xs text-muted-foreground">Printer xususiyatlarida "Cash drawer" yoqilgan bo'lsin — chek chiqqanda quti ochiladi.</p>}
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="prefs-drawer-cash">Naqd to'lovda ochish</Label>
                <Switch id="prefs-drawer-cash" checked={prefs.openDrawerOnCash} onCheckedChange={(checked) => patch({ openDrawerOnCash: checked })} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => void run(async () => (await printSample(context, prefs, cashierName), "Namuna chek yuborildi"))}>
                Namuna chek
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void run(async () => (await call("device:open-drawer"), "Pul qutisiga buyruq yuborildi"))}>
                Qutini sinash
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const saved = await call("device:save-prefs", prefs);
                    onSaved(saved);
                    return "Saqlandi";
                  })
                }
              >
                Saqlash
              </Button>
            </div>
          </div>
        )}
        {message && (
          <p className={`rounded-md px-3 py-2 text-sm ${message.tone === "error" ? "bg-destructive/10 text-destructive" : "bg-pos-success/10 text-pos-success"}`}>{message.text}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

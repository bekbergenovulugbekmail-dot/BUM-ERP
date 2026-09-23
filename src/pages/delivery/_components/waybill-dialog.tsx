/**
 * NAKLADNOY OYNASI — qog'ozga nima chiqishini chop etishdan OLDIN ko'rish va to'g'rilash joyi.
 *
 * Nega kerak: hujjatdagi mas'ul shaxs, agent nomi va ombor avtomatik to'ldiriladi, lekin
 * amalda ular boshqacha bo'lishi mumkin (tovarni boshqa odam topshiradi, agentning ismi
 * bazada qisqa yozilgan). Shuning uchun har bir maydon shu yerda tahrirlanadi, jami summa va
 * jami qarz esa darhol ko'rinadi — foydalanuvchi qaysi son qayerga tushishini oldindan biladi.
 *
 * Sozlamalar BRAUZERDA saqlanadi (kompaniya bo'yicha alohida kalit): boshqa bizneslarning
 * hujjatiga ham, serverdagi ma'lumotga ham tegmaydi.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { DEFAULT_WAYBILL_COLUMNS, type WaybillColumns, type WaybillTask } from "@/lib/pdf/delivery-waybill-pdf.ts";

/** Oynada tahrirlanadigan hamma narsa — chop etishda shu holat PDF'ga uzatiladi. */
export type WaybillSettings = {
  number: string;
  responsibleName: string;
  agentName: string;
  warehouseName: string;
  notes: string;
  columns: WaybillColumns;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  currency: string;
  tasks: WaybillTask[];
  /** Serverdan kelgan qiymatlar — oyna shular bilan to'ldiriladi. */
  defaults: Omit<WaybillSettings, "columns" | "notes">;
  /** Qarz ma'lumoti umuman kelmagan bo'lsa (moliya ruxsati yo'q) — ustunni yoqib bo'lmaydi. */
  debtAvailable: boolean;
  /** Sozlamalarni eslab qolish kaliti (kompaniya bo'yicha). */
  storageKey: string;
  printing: boolean;
  onPrint: (settings: WaybillSettings) => void;
};

/** Eslab qolinadigan qism: har safar qaytadan yozmaslik uchun. */
type StoredPrefs = { responsibleName?: string; columns?: Partial<WaybillColumns>; notes?: string };

function readPrefs(key: string): StoredPrefs {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredPrefs) : {};
  } catch {
    return {};
  }
}

function writePrefs(key: string, prefs: StoredPrefs) {
  try {
    localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // Saqlash imkoni bo'lmasa (maxfiy oyna) — hujjat baribir chiqadi
  }
}

/** Qog'ozdagi kabi ko'rinish: uch xonali guruh va valyuta belgisi. */
const money = (value: number, currency: string) =>
  `${new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 2 }).format(value)} ${currency}`;

export default function WaybillDialog(props: Props) {
  const { defaults, storageKey, debtAvailable } = props;
  /**
   * Oyna faqat ma'lumot yuklangach ULANADI (chaqiruvchi tomonda shartli render), shuning uchun
   * boshlang'ich holat bir marta — mount paytida — hisoblanadi: serverdagi qiymatlar ustiga
   * eslab qolingan sozlamalar qo'yiladi. Effekt kerak emas.
   */
  const [settings, setSettings] = useState<WaybillSettings>(() => {
    const prefs = readPrefs(storageKey);
    return {
      ...defaults,
      responsibleName: prefs.responsibleName?.trim() || defaults.responsibleName,
      notes: prefs.notes ?? "",
      columns: { ...DEFAULT_WAYBILL_COLUMNS, ...prefs.columns },
    };
  });

  const set = (patch: Partial<WaybillSettings>) => setSettings((prev) => ({ ...prev, ...patch }));
  const setColumn = (patch: Partial<WaybillColumns>) =>
    setSettings((prev) => ({ ...prev, columns: { ...prev.columns, ...patch } }));

  const total = props.tasks.reduce((sum, task) => sum + task.orderTotal, 0);
  const debtTotal = props.tasks.reduce((sum, task) => sum + (task.customerDebt ?? 0), 0);
  const showDebt = debtAvailable && settings.columns.debt;

  const handlePrint = () => {
    writePrefs(storageKey, {
      responsibleName: settings.responsibleName,
      columns: settings.columns,
      notes: settings.notes,
    });
    props.onPrint(settings);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nakladnoy — chop etishdan oldin</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="waybill-number">Hujjat raqami</Label>
              <Input id="waybill-number" value={settings.number} onChange={(e) => set({ number: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="waybill-date">Sana</Label>
              <Input id="waybill-date" value={props.date} disabled />
            </div>
            <div className="space-y-1">
              <Label htmlFor="waybill-responsible">Mas&apos;ul shaxs (topshiruvchi)</Label>
              <Input
                id="waybill-responsible"
                value={settings.responsibleName}
                placeholder="Masalan: Ombor mudiri F.I.Sh."
                onChange={(e) => set({ responsibleName: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="waybill-agent">Agent nomi (qabul qiluvchi)</Label>
              <Input id="waybill-agent" value={settings.agentName} onChange={(e) => set({ agentName: e.target.value })} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="waybill-warehouse">Ombor</Label>
              <Input
                id="waybill-warehouse"
                value={settings.warehouseName}
                onChange={(e) => set({ warehouseName: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Qog&apos;ozdagi ustunlar</Label>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={settings.columns.address}
                  onCheckedChange={(value) => setColumn({ address: value === true })}
                />
                Manzil
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={settings.columns.phone}
                  onCheckedChange={(value) => setColumn({ phone: value === true })}
                />
                Telefon
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  disabled={!debtAvailable}
                  checked={showDebt}
                  onCheckedChange={(value) => setColumn({ debt: value === true })}
                />
                Mijoz qarzi
              </label>
            </div>
            {!debtAvailable && (
              <p className="text-[11px] text-muted-foreground">
                Qarz ma&apos;lumoti sizga ochiq emas — bu ustun qog&apos;ozga chiqmaydi.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="waybill-notes">Izoh (qog&apos;oz pastida chiqadi)</Label>
            <Textarea
              id="waybill-notes"
              rows={2}
              value={settings.notes}
              placeholder="Masalan: pul kechqurun kassaga topshiriladi"
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>

          {/* Qaysi son qayerga tushishi oldindan ko'rinsin */}
          <div className="divide-y divide-border rounded-lg border border-border text-xs">
            <div className="flex justify-between px-3 py-2">
              <span className="text-muted-foreground">Yetkazmalar</span>
              <span className="font-medium">{props.tasks.length} ta</span>
            </div>
            <div className="flex justify-between px-3 py-2">
              <span className="text-muted-foreground">Jami summa</span>
              <span className="font-semibold">{money(total, props.currency)}</span>
            </div>
            {showDebt && (
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted-foreground">Jami qarz</span>
                <span className="font-semibold text-destructive">{money(debtTotal, props.currency)}</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => props.onOpenChange(false)}>
            Bekor
          </Button>
          <Button disabled={props.printing || props.tasks.length === 0} onClick={handlePrint}>
            PDF chiqarish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

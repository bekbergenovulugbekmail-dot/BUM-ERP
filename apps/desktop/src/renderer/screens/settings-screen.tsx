import { useEffect, useState } from "react";
import { PERMISSIONS, type Permission } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import type { AppStatus, DevicePrefs, HotkeyAction, PosContext, SettingsOverview, UpdateInfo } from "../../shared/kassa-api.js";
import type { PaymentMethod } from "../../shared/sync-types.js";
import { DEFAULT_HOTKEYS, HOTKEY_ACTIONS, HOTKEY_LABELS, keyName } from "../../shared/hotkeys.js";
import { PAYMENT_LABELS, fmtMoney } from "../format.ts";
import { call, errorText } from "../kassa.ts";
import PrefsDialog from "../pos/prefs-dialog.tsx";

type Tab = "settings" | "printer" | "marketing" | "warehouse" | "company" | "permissions" | "subscription";
type Section = "language" | "appearance" | "currencies" | "hotkeys" | "sale" | "payment" | "general" | "security" | "version" | "logout";

const TABS: { key: Tab; label: string }[] = [
  { key: "settings", label: "Sozlamalar" },
  { key: "printer", label: "Printer" },
  { key: "marketing", label: "Marketing" },
  { key: "warehouse", label: "Ombor" },
  { key: "company", label: "Tashkilot" },
  { key: "permissions", label: "Ruxsatlar" },
  { key: "subscription", label: "Obuna" },
];

const SECTIONS: { key: Section; label: string }[] = [
  { key: "language", label: "Dastur tili" },
  { key: "appearance", label: "Tashqi ko'rinish" },
  { key: "currencies", label: "Valyutalar" },
  { key: "hotkeys", label: "Qaynoq tugmalar" },
  { key: "sale", label: "Savdo sozlamalari" },
  { key: "payment", label: "To'lov sozlamalari" },
  { key: "general", label: "Umumiy sozlamalar" },
  { key: "security", label: "Xavfsizlik sozlamalari" },
  { key: "version", label: "Ilova versiyasi" },
  { key: "logout", label: "Tizimdan chiqish" },
];

const METHODS: PaymentMethod[] = ["cash", "card", "bank", "transfer"];
const METHOD_NAMES: Record<PaymentMethod, string> = { cash: "Naqd", card: "Karta", bank: "Bank", transfer: "O'tkazma" };
const SUBSCRIPTION_LABELS: Record<string, string> = { trial: "Sinov davri", active: "Faol", suspended: "To'xtatilgan", cancelled: "Tugatilgan", expired: "Muddati tugagan" };

type SaveFn = (patch: Partial<DevicePrefs>) => Promise<boolean>;

/** Sozlamalar (skrinshot bo'yicha): yuqorida bo'limlar, "Sozlamalar" ichida chapda ro'yxat. Qurilma sozlamalari offline ham. */
export default function SettingsScreen({
  status,
  prefs,
  onPrefs,
  onStatus,
  onExit,
}: {
  status: AppStatus;
  prefs: DevicePrefs | null;
  onPrefs: (prefs: DevicePrefs) => void;
  onStatus: (status: AppStatus) => void;
  onExit: () => void;
}) {
  const [tab, setTab] = useState<Tab>("settings");
  const [section, setSection] = useState<Section>("language");
  const [overview, setOverview] = useState<SettingsOverview | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    call("settings:overview").then(setOverview, (err: unknown) => setNotice({ tone: "error", text: errorText(err) }));
  }, [status.sync.lastSyncAt]);

  const save: SaveFn = async (patch) => {
    if (!prefs) return false;
    try {
      onPrefs(await call("device:save-prefs", { ...prefs, ...patch }));
      setNotice({ tone: "info", text: "Saqlandi" });
      return true;
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err) });
      return false;
    }
  };

  return (
    <main className="grid h-full grid-rows-[auto_1fr] bg-muted/40">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2">
        <Button size="sm" variant="secondary" onClick={onExit}>
          ← Bosh sahifa
        </Button>
        <nav className="flex flex-wrap gap-1">
          {TABS.map((item) => (
            <Button
              key={item.key}
              size="sm"
              variant={tab === item.key ? "default" : "ghost"}
              onClick={() => {
                setTab(item.key);
                setNotice(null);
              }}
            >
              {item.label}
            </Button>
          ))}
        </nav>
        {notice && <span className={`ml-auto text-sm ${notice.tone === "error" ? "text-destructive" : "text-emerald-700"}`}>{notice.text}</span>}
      </header>

      <div className="min-h-0 overflow-auto p-4">
        {!prefs || !overview ? (
          <p className="text-muted-foreground">Yuklanmoqda…</p>
        ) : tab === "settings" ? (
          <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="self-start rounded-xl border border-border bg-card p-2">
              {SECTIONS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setSection(item.key);
                    setNotice(null);
                  }}
                  className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${section === item.key ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted"} ${item.key === "logout" ? "text-destructive" : ""}`}
                >
                  {item.label}
                </button>
              ))}
            </aside>
            <section className="rounded-xl border border-border bg-card p-5">
              {section === "language" && <LanguagePanel prefs={prefs} save={save} />}
              {section === "appearance" && <AppearancePanel prefs={prefs} save={save} />}
              {section === "currencies" && <CurrenciesPanel overview={overview} />}
              {section === "hotkeys" && <HotkeysPanel prefs={prefs} save={save} />}
              {section === "sale" && <SalePanel prefs={prefs} save={save} />}
              {section === "payment" && <PaymentPanel prefs={prefs} save={save} />}
              {section === "general" && <GeneralPanel prefs={prefs} save={save} overview={overview} onStatus={onStatus} />}
              {section === "security" && <SecurityPanel prefs={prefs} save={save} />}
              {section === "version" && <VersionPanel overview={overview} pending={status.sync.pending} />}
              {section === "logout" && <LogoutPanel status={status} onStatus={onStatus} />}
            </section>
          </div>
        ) : (
          <section className="rounded-xl border border-border bg-card p-5">
            {tab === "printer" && <PrinterTab prefs={prefs} cashierName={status.cashier?.name ?? null} onPrefs={onPrefs} />}
            {tab === "marketing" && <MarketingTab overview={overview} />}
            {tab === "warehouse" && <WarehouseTab overview={overview} />}
            {tab === "company" && <CompanyTab overview={overview} />}
            {tab === "permissions" && <PermissionsTab overview={overview} cashierName={status.cashier?.name ?? status.cashier?.phone ?? ""} />}
            {tab === "subscription" && <SubscriptionTab overview={overview} />}
          </section>
        )}
      </div>
    </main>
  );
}

function Title({ children, hint }: { children: string; hint?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold">{children}</h2>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Choice<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => (
        <Button key={String(option.value)} size="sm" variant={value === option.value ? "default" : "secondary"} onClick={() => onChange(option.value)}>
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0">
      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function LanguagePanel({ prefs, save }: { prefs: DevicePrefs; save: SaveFn }) {
  return (
    <>
      <Title hint="Ekrandagi matn tanlangan tilga o'giriladi; mahsulot nomlari, kodlar va raqamlar o'zgarmaydi.">Dastur tili</Title>
      <Choice
        value={prefs.language}
        options={[
          { value: "uz-Latn", label: "O'zbekcha (lotin)" },
          { value: "uz-Cyrl", label: "Ўзбекча (кирилл)" },
          { value: "ru", label: "Русский" },
        ]}
        onChange={(language) => void save({ language })}
      />
    </>
  );
}

function AppearancePanel({ prefs, save }: { prefs: DevicePrefs; save: SaveFn }) {
  return (
    <>
      <Title>Tashqi ko'rinish</Title>
      <Row label="Mavzu">
        <Choice
          value={prefs.theme}
          options={[
            { value: "light", label: "Yorug'" },
            { value: "dark", label: "Qorong'i" },
            { value: "system", label: "Windows bo'yicha" },
          ]}
          onChange={(theme) => void save({ theme })}
        />
      </Row>
      <Row label="Shrift o'lchami" hint="Katta — sensorli ekran va uzoqdan ko'rish uchun">
        <Choice
          value={prefs.fontScale}
          options={[
            { value: "normal", label: "Oddiy" },
            { value: "large", label: "Katta" },
          ]}
          onChange={(fontScale) => void save({ fontScale })}
        />
      </Row>
    </>
  );
}

function CurrenciesPanel({ overview }: { overview: SettingsOverview }) {
  return (
    <>
      <Title hint="Kurslar web'da (Moliya → Valyutalar) o'zgartiriladi va sinxronda keladi; offline chek oxirgi kurs bilan.">Valyutalar</Title>
      <p className="mb-3 text-sm">
        Asosiy valyuta: <span className="font-semibold">{overview.baseCurrency}</span>
      </p>
      <table className="w-full max-w-lg text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-1">Valyuta</th>
            <th className="py-1 text-right">Kurs ({overview.baseCurrency})</th>
            <th className="py-1">Sana</th>
            <th className="py-1">Holati</th>
          </tr>
        </thead>
        <tbody>
          {overview.currencies.map((row) => (
            <tr key={row.code} className="border-t border-border">
              <td className="py-1.5 font-medium">{row.code}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtMoney(row.rate, overview.baseCurrency)}</td>
              <td className="py-1.5 text-muted-foreground">{row.rateDate ?? "—"}</td>
              <td className={`py-1.5 ${row.isActive ? "text-emerald-700" : "text-muted-foreground"}`}>{row.isActive ? "yoqilgan" : "o'chiq"}</td>
            </tr>
          ))}
          {overview.currencies.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-muted-foreground">
                Qo'shimcha valyuta yo'q
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

function HotkeysPanel({ prefs, save }: { prefs: DevicePrefs; save: SaveFn }) {
  const [draft, setDraft] = useState<Record<HotkeyAction, string>>(prefs.hotkeys);
  const [capturing, setCapturing] = useState<HotkeyAction | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const listener = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCapturing(null);
        return;
      }
      const name = keyName(event);
      if (!name) return;
      setDraft((current) => ({ ...current, [capturing]: name }));
      setCapturing(null);
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [capturing]);

  const duplicates = new Set(Object.values(draft).filter((key, index, all) => all.indexOf(key) !== index));
  return (
    <>
      <Title hint="Kassa ekrani tugmalari: F1–F12 yoki Ctrl/Alt + harf. Tugmani bosing va yangi tugmani kiriting (Esc — bekor).">Qaynoq tugmalar</Title>
      <div className="max-w-xl">
        {HOTKEY_ACTIONS.map((action) => (
          <Row key={action} label={HOTKEY_LABELS[action]}>
            <Button size="sm" variant={capturing === action ? "default" : "secondary"} className={`min-w-28 font-mono ${duplicates.has(draft[action]) ? "border border-destructive text-destructive" : ""}`} onClick={() => setCapturing(action)}>
              {capturing === action ? "tugmani bosing…" : draft[action]}
            </Button>
          </Row>
        ))}
      </div>
      {duplicates.size > 0 && <p className="mt-2 text-sm text-destructive">Takrorlangan tugmalar: {[...duplicates].join(", ")}</p>}
      <div className="mt-4 flex gap-2">
        <Button disabled={duplicates.size > 0} onClick={() => void save({ hotkeys: draft })}>
          Saqlash
        </Button>
        <Button variant="secondary" onClick={() => setDraft({ ...DEFAULT_HOTKEYS })}>
          Standartga qaytarish
        </Button>
      </div>
    </>
  );
}

function SalePanel({ prefs, save }: { prefs: DevicePrefs; save: SaveFn }) {
  return (
    <>
      <Title>Savdo sozlamalari</Title>
      <div className="max-w-2xl">
        <Row label="Qoldiq yetmasa sotishni taqiqlash" hint="O'chiq bo'lsa — ogohlantirib sotiladi, server sinxronda nomuvofiqlik qayd etadi">
          <Switch id="pref-block-negative" checked={prefs.blockNegativeStock} onCheckedChange={(blockNegativeStock) => void save({ blockNegativeStock })} />
        </Row>
        <Row label="Chek yakunlanganda avtomatik chop etish">
          <Switch id="pref-auto-print" checked={prefs.autoPrint} onCheckedChange={(autoPrint) => void save({ autoPrint })} />
        </Row>
        <Row label="Naqd to'lovda pul qutisini ochish" hint="Pul qutisi ulanishi — Printer bo'limida">
          <Switch id="pref-drawer-cash" checked={prefs.openDrawerOnCash} onCheckedChange={(openDrawerOnCash) => void save({ openDrawerOnCash })} />
        </Row>
      </div>
    </>
  );
}

function PaymentPanel({ prefs, save }: { prefs: DevicePrefs; save: SaveFn }) {
  const toggle = (method: PaymentMethod, enabled: boolean) => {
    const next = enabled ? [...new Set([...prefs.enabledPaymentMethods, method])] : prefs.enabledPaymentMethods.filter((item) => item !== method);
    void save({ enabledPaymentMethods: METHODS.filter((item) => next.includes(item)) });
  };
  return (
    <>
      <Title hint="O'chirilgan usul kassa ekranida ko'rinmaydi va chekda qabul qilinmaydi.">To'lov sozlamalari</Title>
      <div className="max-w-2xl">
        {METHODS.map((method) => (
          <Row key={method} label={METHOD_NAMES[method]}>
            <Switch
              id={`pref-method-${method}`}
              checked={prefs.enabledPaymentMethods.includes(method)}
              disabled={prefs.enabledPaymentMethods.length === 1 && prefs.enabledPaymentMethods.includes(method)}
              onCheckedChange={(checked) => toggle(method, checked)}
            />
          </Row>
        ))}
        <Row label="Standart to'lov usuli" hint="Yangi chek shu usul bilan boshlanadi">
          <Choice
            value={prefs.defaultPaymentMethod}
            options={prefs.enabledPaymentMethods.map((method) => ({ value: method, label: PAYMENT_LABELS[method] ?? method }))}
            onChange={(defaultPaymentMethod) => void save({ defaultPaymentMethod })}
          />
        </Row>
      </div>
    </>
  );
}

function GeneralPanel({ prefs, save, overview, onStatus }: { prefs: DevicePrefs; save: SaveFn; overview: SettingsOverview; onStatus: (status: AppStatus) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <>
      <Title>Umumiy sozlamalar</Title>
      <div className="max-w-2xl">
        <Row label="Avtomatik sinxron oralig'i" hint="Internet bo'lganda serverga yuborish va yangilanishlarni olish">
          <Choice
            value={prefs.syncIntervalSec}
            options={[15, 30, 60, 120, 300].map((value) => ({ value, label: value < 60 ? `${value} s` : `${value / 60} daq` }))}
            onChange={(syncIntervalSec) => void save({ syncIntervalSec })}
          />
        </Row>
        <Row label="Sinxron holati" hint={overview.sync.lastSyncAt ? `Oxirgi: ${new Date(overview.sync.lastSyncAt).toLocaleString("uz-UZ")}` : "Hali sinxron bo'lmagan"}>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              navbatda {overview.sync.pending}, rad etilgan {overview.sync.rejected}
            </span>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                call("sync:run").then(
                  (next) => {
                    onStatus(next);
                    setMessage(next.sync.state === "idle" ? "Sinxron bajarildi" : (next.sync.lastError ?? "Sinxron bajarilmadi"));
                    setBusy(false);
                  },
                  (err: unknown) => {
                    setMessage(errorText(err));
                    setBusy(false);
                  },
                );
              }}
            >
              Hozir sinxronlash
            </Button>
          </div>
        </Row>
        {message && <p className="pt-2 text-sm text-muted-foreground">{message}</p>}
      </div>
    </>
  );
}

function SecurityPanel({ prefs, save }: { prefs: DevicePrefs; save: SaveFn }) {
  const [form, setForm] = useState({ oldPin: "", newPin: "", confirm: "" });
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const digits = (value: string) => value.replace(/\D/g, "").slice(0, 8);

  const changePin = async () => {
    if (form.newPin !== form.confirm) {
      setMessage({ tone: "error", text: "Yangi PIN va takrori mos emas" });
      return;
    }
    setBusy(true);
    try {
      await call("cashier:change-pin", { oldPin: form.oldPin, newPin: form.newPin });
      setForm({ oldPin: "", newPin: "", confirm: "" });
      setMessage({ tone: "info", text: "PIN almashtirildi" });
    } catch (err) {
      setMessage({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Title>Xavfsizlik sozlamalari</Title>
      <div className="max-w-2xl">
        <Row label="Harakatsizlikda kassani bloklash" hint="Ochiq chek saqlanadi; davom etish uchun kassir PIN'i so'raladi">
          <Choice
            value={prefs.autoLockMinutes}
            options={[0, 5, 10, 15, 30, 60].map((value) => ({ value, label: value === 0 ? "O'chiq" : `${value} daq` }))}
            onChange={(autoLockMinutes) => void save({ autoLockMinutes })}
          />
        </Row>
      </div>
      <form
        className="mt-6 max-w-sm space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void changePin();
        }}
      >
        <p className="font-medium">PIN'ni almashtirish</p>
        {(
          [
            ["oldPin", "Joriy PIN"],
            ["newPin", "Yangi PIN (4–8 raqam)"],
            ["confirm", "Yangi PIN takrori"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={`pin-${key}`}>{label}</Label>
            <Input id={`pin-${key}`} type="password" inputMode="numeric" value={form[key]} onChange={(e) => setForm((current) => ({ ...current, [key]: digits(e.target.value) }))} />
          </div>
        ))}
        {message && <p className={`text-sm ${message.tone === "error" ? "text-destructive" : "text-emerald-700"}`}>{message.text}</p>}
        <Button type="submit" disabled={busy || form.oldPin.length < 4 || form.newPin.length < 4}>
          Almashtirish
        </Button>
      </form>
    </>
  );
}

function VersionPanel({ overview, pending }: { overview: SettingsOverview; pending: number }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState<"check" | "download" | "install" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (kind: "check" | "download" | "install") => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === "install") await call("update:install");
      else setInfo(await call(kind === "check" ? "update:check" : "update:download"));
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Title>Ilova versiyasi</Title>
      <div className="max-w-2xl">
        <Row label="BUM POS KASSA" hint={`Qurilma: ${overview.device?.name ?? "—"} (${overview.device?.code ?? "—"})`}>
          <span className="font-mono text-lg">{overview.appVersion}</span>
        </Row>
        <Row label="Yangilanish" hint="Internet kerak; o'rnatuvchi yuklangach nazorat yig'indisi (SHA-256) tekshiriladi">
          <Button size="sm" disabled={busy !== null} onClick={() => void run("check")}>
            {busy === "check" ? "Tekshirilmoqda…" : "Tekshirish"}
          </Button>
        </Row>
      </div>
      {info && (
        <div className="mt-4 max-w-2xl space-y-3 rounded-lg bg-muted/50 p-4 text-sm">
          {!info.configured && <p>Serverda yangilanish sozlanmagan — administrator bilan bog'laning.</p>}
          {info.configured && !info.available && <p className="text-emerald-700">Eng so'nggi versiya o'rnatilgan ({info.current}).</p>}
          {info.available && (
            <>
              <p className="font-medium">
                Yangi versiya: {info.latest}
                {info.mandatory && <span className="ml-2 text-destructive">majburiy</span>}
              </p>
              {info.notes && <p className="whitespace-pre-line text-muted-foreground">{info.notes}</p>}
              {!info.downloaded && info.partialBytes > 0 && (
                <p className="text-muted-foreground">Oldingi yuklab olish uzilgan: {(info.partialBytes / 1024 / 1024).toFixed(1)} MB yuklangan — shu joydan davom etadi.</p>
              )}
              {pending > 0 &&<p className="text-amber-700">Navbatda {pending} ta amal bor — ular o'rnatishdan keyin ham saqlanadi va yuboriladi.</p>}
              <div className="flex gap-2">
                {!info.downloaded ? (
                  <Button disabled={busy !== null} onClick={() => void run("download")}>
                    {busy === "download" ? "Yuklanmoqda…" : info.partialBytes > 0 ? "Yuklab olishni davom ettirish" : "Yuklab olish"}
                  </Button>
                ) : (
                  <Button disabled={busy !== null} onClick={() => void run("install")}>
                    O'rnatish (dastur yopiladi)
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {message && <p className="mt-3 text-sm text-destructive">{message}</p>}
    </>
  );
}

function LogoutPanel({ status, onStatus }: { status: AppStatus; onStatus: (status: AppStatus) => void }) {
  return (
    <>
      <Title hint="Kassir chiqadi; qurilma, lokal ma'lumotlar va navbat saqlanadi. Qurilmani o'chirish — web'da (Kassa qurilmalari).">Tizimdan chiqish</Title>
      <p className="mb-4 text-sm">
        Joriy kassir: <span className="font-semibold">{status.cashier?.name ?? status.cashier?.phone}</span>
        {status.shift && <span className="text-muted-foreground"> · smena ochiq — boshqa kassir smenani yopa olmaydi (rahbar ruxsatisiz)</span>}
      </p>
      <Button variant="destructive" onClick={() => void call("cashier:logout").then(onStatus)}>
        Chiqish
      </Button>
    </>
  );
}

function PrinterTab({ prefs, cashierName, onPrefs }: { prefs: DevicePrefs; cashierName: string | null; onPrefs: (prefs: DevicePrefs) => void }) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<PosContext | null>(null);
  return (
    <>
      <Title hint="Shu kompyuter uchun. Chek va etiketka shablonlari — web'dagi Sozlamalar → Chop etish / Etiketka.">Printer va pul qutisi</Title>
      <div className="max-w-2xl">
        <Row label="Chek printeri">
          <span className="text-sm">{prefs.printerName ?? "Windows standart printeri"}</span>
        </Row>
        <Row label="Qog'oz kengligi">
          <span className="text-sm">{prefs.paperWidth} mm</span>
        </Row>
        <Row label="Etiketka printeri">
          <span className="text-sm">{prefs.labelPrinterName ?? "Windows standart printeri"}</span>
        </Row>
        <Row label="Pul qutisi">
          <span className="text-sm">{{ none: "Yo'q", driver: "Printer drayveri", tcp: "Tarmoq printeri", share: "Ulashilgan printer" }[prefs.drawer.mode]}</span>
        </Row>
      </div>
      <Button
        className="mt-4"
        onClick={() => {
          call("pos:context").then(setContext, () => setContext(null));
          setOpen(true);
        }}
      >
        Sozlash va sinash
      </Button>
      <PrefsDialog open={open} context={context} cashierName={cashierName} onClose={() => setOpen(false)} onSaved={onPrefs} />
    </>
  );
}

function MarketingTab({ overview }: { overview: SettingsOverview }) {
  const cashback = overview.cashback;
  return (
    <>
      <Title hint="Keshbek qoidalari web'da (Sotuv → Keshbek) sozlanadi; kassada offline ham shu qoidalar bilan hisoblanadi.">Marketing: keshbek</Title>
      {!cashback ? (
        <p className="text-muted-foreground">Sozlama hali sinxron bo'lmagan</p>
      ) : (
        <div className="max-w-2xl">
          <Row label="Keshbek">
            <span className={cashback.enabled ? "font-semibold text-emerald-700" : "text-muted-foreground"}>{cashback.enabled ? "Yoqilgan" : "O'chiq"}</span>
          </Row>
          <Row label="Hisoblash asosi">
            <span className="text-sm">{cashback.accrualBase === "paid" ? "To'langan summadan" : "Chek summasidan"}</span>
          </Row>
          <Row label="Chekning qancha qismini keshbek bilan to'lash mumkin">
            <span className="text-sm">{cashback.maxUsagePercent}%</span>
          </Row>
          <Row label="Darajalar (chek summasi bo'yicha)">
            <span className="text-right text-sm">
              {cashback.tiers.length === 0
                ? "—"
                : cashback.tiers.map((tier) => (
                    <span key={tier.minAmount} className="block">
                      {fmtMoney(tier.minAmount, overview.baseCurrency)} dan — {tier.percent}%
                    </span>
                  ))}
            </span>
          </Row>
          <Row label="Kategoriya bo'yicha foizlar">
            <span className="text-sm">{cashback.categoryRates.length} ta</span>
          </Row>
        </div>
      )}
    </>
  );
}

function WarehouseTab({ overview }: { overview: SettingsOverview }) {
  return (
    <>
      <Title hint="Qurilma ombori ro'yxatdan o'tkazishda tanlanadi; o'zgartirish — web'da (Kassa qurilmalari).">Omborlar</Title>
      <ul className="max-w-2xl divide-y divide-border text-sm">
        {overview.warehouses.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 py-2">
            <span>
              <span className="font-medium">{row.name}</span> <span className="text-muted-foreground">({row.code})</span>
              {row.isDefault && <span className="ml-2 text-xs text-muted-foreground">asosiy</span>}
            </span>
            <span className={row.current ? "font-semibold text-primary" : row.isActive ? "text-muted-foreground" : "text-destructive"}>
              {row.current ? "shu kassa ombori" : row.isActive ? "faol" : "faol emas"}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function CompanyTab({ overview }: { overview: SettingsOverview }) {
  const company = overview.company;
  return (
    <>
      <Title hint="Rekvizitlar web'dagi kompaniya sozlamalaridan — chekda shu ma'lumotlar chiqadi.">Tashkilot</Title>
      <div className="max-w-2xl">
        <Row label="Nomi">
          <span className="text-sm font-semibold">{company?.name ?? "—"}</span>
        </Row>
        <Row label="STIR">
          <span className="text-sm">{company?.taxId ?? "—"}</span>
        </Row>
        <Row label="Manzil">
          <span className="text-sm">{company?.address ?? "—"}</span>
        </Row>
        <Row label="Telefon">
          <span className="text-sm">{company?.phone ?? "—"}</span>
        </Row>
        <Row label="Asosiy valyuta">
          <span className="text-sm">{overview.baseCurrency}</span>
        </Row>
        <Row label="Kassa qurilmasi" hint={overview.apiUrl ?? undefined}>
          <span className="text-sm">
            {overview.device?.name} ({overview.device?.code}) · {overview.device?.warehouseName}
          </span>
        </Row>
      </div>
    </>
  );
}

function PermissionsTab({ overview, cashierName }: { overview: SettingsOverview; cashierName: string }) {
  const groups = new Map<string, string[]>();
  for (const key of overview.permissions) {
    const meta = (PERMISSIONS as Record<string, { label: string; group: string } | undefined>)[key as Permission];
    const group = meta?.group ?? "Boshqa";
    groups.set(group, [...(groups.get(group) ?? []), meta?.label ?? key]);
  }
  return (
    <>
      <Title hint="Ruxsatlar web'da (Xodimlar → Rollar) beriladi va sinxronda yangilanadi.">Ruxsatlar</Title>
      <p className="mb-3 text-sm">
        Joriy kassir: <span className="font-semibold">{cashierName}</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[...groups.entries()].map(([group, labels]) => (
          <div key={group} className="rounded-lg border border-border p-3">
            <p className="mb-1 text-sm font-semibold">{group}</p>
            <ul className="space-y-0.5 text-sm text-muted-foreground">
              {labels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mb-2 mt-6 font-medium">Shu kassadagi kassirlar</p>
      <ul className="max-w-2xl divide-y divide-border text-sm">
        {overview.cashiers.map((row) => (
          <li key={row.userId} className="flex items-center justify-between gap-3 py-2">
            <span>
              {row.name ?? row.phone} <span className="text-muted-foreground">· {row.role}</span>
            </span>
            <span className={row.active ? "text-emerald-700" : "text-destructive"}>
              {row.active ? "faol" : "kira olmaydi"}
              {row.hasPin ? " · PIN o'rnatilgan" : ""}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function SubscriptionTab({ overview }: { overview: SettingsOverview }) {
  const { status, trialEndsAt } = overview.subscription;
  const daysLeft = trialEndsAt ? Math.ceil((Date.parse(trialEndsAt) - Date.parse(overview.sync.lastSyncAt ?? trialEndsAt)) / 86_400_000) : null;
  return (
    <>
      <Title hint="Holat oxirgi sinxrondagi ma'lumot bo'yicha. To'lov va tarif — web'da.">Obuna</Title>
      <div className="max-w-2xl">
        <Row label="Holati">
          <span className={`text-sm font-semibold ${status === "active" ? "text-emerald-700" : status === "trial" ? "text-amber-700" : "text-destructive"}`}>
            {status ? (SUBSCRIPTION_LABELS[status] ?? status) : "Ma'lumot yo'q (sinxron qiling)"}
          </span>
        </Row>
        {trialEndsAt && (
          <Row label="Sinov davri tugashi" hint={daysLeft !== null && daysLeft >= 0 ? `Oxirgi sinxrondan ${daysLeft} kun qolgan edi` : undefined}>
            <span className="text-sm">{new Date(trialEndsAt).toLocaleDateString("uz-UZ")}</span>
          </Row>
        )}
        <Row label="Kompaniya">
          <span className="text-sm">{overview.company?.name ?? "—"}</span>
        </Row>
      </div>
    </>
  );
}

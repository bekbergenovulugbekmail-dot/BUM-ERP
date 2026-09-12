import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import type { WeightBarcodeFormat } from "../../shared/scale-barcode.js";
import {
  SCALE_PROVIDERS,
  SCALE_PROVIDER_INFO,
  SERIAL_BAUD_RATES,
  type ScaleConfigInput,
  type ScaleConnection,
  type ScaleProviderId,
  type ScaleQueueItem,
  type ScaleQueueStatus,
  type ScaleReconcileResult,
  type ScaleTestStatus,
  type ScaleTransport,
  type ScaleView,
} from "../../shared/scale-types.js";
import { call, errorText } from "../kassa.ts";

type Notice = { tone: "error" | "info"; text: string } | null;

const TEST_STATUS: Record<ScaleTestStatus, { text: string; tone: string }> = {
  simulator: { text: "Simulyator", tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  connected: { text: "Ulangan — og'irlik o'qildi", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  port_reachable: { text: "Port ochiq — protokol tasdiqlanmagan", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  unreachable: { text: "Ulanib bo'lmadi", tone: "bg-destructive/15 text-destructive" },
  docs_required: { text: "Protokol hujjati kerak", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  error: { text: "Xato", tone: "bg-destructive/15 text-destructive" },
};

const QUEUE_LABELS: Record<ScaleQueueStatus, string> = { PENDING: "Kutmoqda", PROCESSING: "Yuborilmoqda", SUCCESS: "Yuborildi", FAILED: "Xato" };
const QUEUE_STATUSES: ScaleQueueStatus[] = ["PENDING", "PROCESSING", "SUCCESS", "FAILED"];

const SELECT = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("uz-UZ", { dateStyle: "short", timeStyle: "medium" }) : "—");

const defaultConnection = (type: ScaleTransport): ScaleConnection =>
  type === "tcp"
    ? { type: "tcp", host: "", port: 0 }
    : type === "serial"
      ? { type: "serial", port: "COM1", baudRate: 9600, dataBits: 8, parity: "none", stopBits: 1 }
      : { type: "none" };

const connectionText = (connection: ScaleConnection) =>
  connection.type === "tcp"
    ? `LAN ${connection.host}:${connection.port}`
    : connection.type === "serial"
      ? `${connection.port} · ${connection.baudRate} · ${connection.dataBits}${connection.parity[0]!.toUpperCase()}${connection.stopBits}`
      : "ulanishsiz";

const EMPTY_FORM: ScaleConfigInput = {
  name: "",
  provider: "simulator",
  connection: { type: "none" },
  enabled: true,
  autoSync: true,
  maxAttempts: 5,
  pollCommand: "",
  simulatedWeight: "1.000",
};

/** Sozlamalar → Tarozilar: ro'yxat, qo'shish/tahrirlash, tekshirish, sinxron, to'liq sinxron (progress), navbat, solishtirish. */
export default function ScalesPanel({ permissions }: { permissions: string[] }) {
  const canView = permissions.includes("scale.view");
  const canManage = permissions.includes("scale.manage");
  const canSync = permissions.includes("scale.sync");
  const [scales, setScales] = useState<ScaleView[] | null>(null);
  const [form, setForm] = useState<ScaleConfigInput | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [queueFor, setQueueFor] = useState<string | null>(null);
  const [reconciled, setReconciled] = useState<Record<string, ScaleReconcileResult>>({});

  const load = useCallback(() => call("scale:list").then(setScales, (err: unknown) => setNotice({ tone: "error", text: errorText(err) })), []);
  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  // Navbatda yozuv bor (to'liq sinxron, qayta urinish) — holat va progress yangilanib turadi
  const active = scales?.some((scale) => scale.queue.PENDING + scale.queue.PROCESSING > 0) ?? false;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void load(), 2_000);
    return () => clearInterval(timer);
  }, [active, load]);

  const run = async <T,>(key: string, action: () => Promise<T>, message?: (result: T) => string | null) => {
    setBusy(key);
    setNotice(null);
    try {
      const result = await action();
      const text = message?.(result);
      if (text) setNotice({ tone: "info", text });
      await load();
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  if (!canView) {
    return (
      <div>
        <h2 className="text-lg font-semibold">Tarozilar</h2>
        <p className="text-sm text-muted-foreground">Ruxsat yo'q: scale.view</p>
      </div>
    );
  }

  const queueScale = scales?.find((scale) => scale.id === queueFor) ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Tarozilar</h2>
          <p className="text-sm text-muted-foreground">
            Og'irlikni savatga o'qish va mahsulotlarni (PLU) taroziga yuborish. Tarozi LAN yoki COM portda — internetsiz ham ishlaydi.
          </p>
        </div>
        {canManage && !form && <Button onClick={() => setForm(EMPTY_FORM)}>Tarozi qo'shish</Button>}
      </div>

      {notice && <p className={`rounded-lg px-3 py-2 text-sm ${notice.tone === "error" ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>{notice.text}</p>}

      {form && (
        <ScaleForm
          value={form}
          busy={busy === "save"}
          onChange={setForm}
          onCancel={() => setForm(null)}
          onSave={() =>
            void run(
              "save",
              () => call("scale:save", form),
              () => {
                setForm(null);
                return "Saqlandi";
              },
            )
          }
        />
      )}

      {scales === null ? (
        <p className="text-sm text-muted-foreground">Yuklanmoqda…</p>
      ) : scales.length === 0 ? (
        !form && <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Hali tarozi qo'shilmagan.</p>
      ) : (
        scales.map((scale) => (
          <ScaleCard
            key={scale.id}
            scale={scale}
            busy={busy}
            canManage={canManage}
            canSync={canSync}
            reconciled={reconciled[scale.id] ?? null}
            onTest={() => void run(`test:${scale.id}`, () => call("scale:test", { id: scale.id }), (result) => result.message)}
            onSync={() =>
              void run(
                `sync:${scale.id}`,
                () => call("scale:process", { id: scale.id }),
                (result) => `Yuborildi: ${result.sent}, xato: ${result.failed}, kutmoqda: ${result.waiting}`,
              )
            }
            onFullSync={() =>
              void run(`full:${scale.id}`, () => call("scale:full-sync", { id: scale.id }), (result) => `To'liq sinxron boshlandi: ${result.total} ta amal`)
            }
            onReconcile={() =>
              void run(
                `reconcile:${scale.id}`,
                async () => {
                  const result = await call("scale:reconcile", { id: scale.id });
                  setReconciled((current) => ({ ...current, [scale.id]: result }));
                  return result;
                },
                () => null,
              )
            }
            onQueue={() => setQueueFor(queueFor === scale.id ? null : scale.id)}
            onEdit={() => setForm({ ...scale })}
            onRemove={() => {
              if (!window.confirm(`«${scale.name}» o'chirilsinmi? Uning navbati ham o'chadi (tarozidagi mahsulotlarga tegilmaydi).`)) return;
              void run(`remove:${scale.id}`, () => call("scale:remove", { id: scale.id }), () => "O'chirildi");
            }}
          />
        ))
      )}

      {queueScale && <QueuePanel scale={queueScale} canSync={canSync} onClose={() => setQueueFor(null)} onChanged={() => void load()} />}

      <BarcodeFormatCard canManage={canManage} />
    </div>
  );
}

function ScaleCard({
  scale,
  busy,
  canManage,
  canSync,
  reconciled,
  onTest,
  onSync,
  onFullSync,
  onReconcile,
  onQueue,
  onEdit,
  onRemove,
}: {
  scale: ScaleView;
  busy: string | null;
  canManage: boolean;
  canSync: boolean;
  reconciled: ScaleReconcileResult | null;
  onTest: () => void;
  onSync: () => void;
  onFullSync: () => void;
  onReconcile: () => void;
  onQueue: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { info, lastTest, lastRun } = scale;
  const canUpload = info.capabilities.uploadProducts && scale.enabled;
  const runDone = lastRun ? lastRun.counts.SUCCESS + lastRun.counts.FAILED : 0;
  const runActive = lastRun ? lastRun.counts.PENDING + lastRun.counts.PROCESSING > 0 : false;
  return (
    <article className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">
            {scale.name} {!scale.enabled && <span className="text-xs font-normal text-muted-foreground">(o'chirilgan)</span>}
          </h3>
          <p className="text-xs text-muted-foreground">
            {info.label} · {connectionText(scale.connection)}
            {scale.autoSync && info.capabilities.uploadProducts ? " · avtomatik sinxron" : ""}
          </p>
        </div>
        {lastTest ? (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TEST_STATUS[lastTest.status].tone}`}>{TEST_STATUS[lastTest.status].text}</span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Tekshirilmagan</span>
        )}
      </div>

      {info.docsRequired ? (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <b>Protokol hujjati kerak.</b> {info.docsRequired} {info.note}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{info.note}</p>
      )}
      {lastTest && (
        <p className="text-xs text-muted-foreground">
          Oxirgi tekshiruv {when(lastTest.at)}: {lastTest.message}
        </p>
      )}

      {info.capabilities.uploadProducts && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {QUEUE_STATUSES.map((status) => (
            <span
              key={status}
              className={`rounded-md border px-2 py-0.5 tabular-nums ${status === "FAILED" && scale.queue.FAILED > 0 ? "border-destructive/50 text-destructive" : "border-border"}`}
            >
              {QUEUE_LABELS[status]}: {scale.queue[status]}
            </span>
          ))}
          <span className="text-muted-foreground">oxirgi yuborish: {when(scale.lastSyncAt)}</span>
        </div>
      )}

      {lastRun && info.capabilities.uploadProducts && (
        <div className="space-y-1">
          <div className="flex justify-between gap-2 text-xs">
            <span>To'liq sinxron · {when(lastRun.startedAt)}</span>
            <span className="tabular-nums">
              {runDone} / {lastRun.total}
              {lastRun.counts.FAILED > 0 ? ` · ${lastRun.counts.FAILED} xato` : ""}
              {runActive ? " · yuborilmoqda…" : ""}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-[width] ${lastRun.counts.FAILED > 0 ? "bg-amber-500" : "bg-primary"}`}
              style={{ width: `${lastRun.total > 0 ? Math.round((runDone / lastRun.total) * 100) : 100}%` }}
            />
          </div>
        </div>
      )}

      {reconciled && <ReconcileBox result={reconciled} />}

      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" disabled={busy !== null} onClick={onTest}>
          {busy === `test:${scale.id}` ? "Tekshirilmoqda…" : "Tekshirish"}
        </Button>
        {canSync && (
          <Button size="sm" variant="secondary" disabled={busy !== null || !canUpload} onClick={onSync}>
            Sinxron
          </Button>
        )}
        {canSync && (
          <Button size="sm" variant="secondary" disabled={busy !== null || !canUpload} onClick={onFullSync}>
            To'liq sinxron
          </Button>
        )}
        <Button size="sm" variant="secondary" disabled={busy !== null} onClick={onReconcile}>
          Solishtirish
        </Button>
        {info.capabilities.uploadProducts && (
          <Button size="sm" variant="ghost" onClick={onQueue}>
            Navbat
          </Button>
        )}
        {canManage && (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Tahrirlash
          </Button>
        )}
        {canManage && (
          <Button size="sm" variant="ghost" className="text-destructive" disabled={busy !== null} onClick={onRemove}>
            O'chirish
          </Button>
        )}
      </div>
    </article>
  );
}

function ScaleForm({
  value,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  value: ScaleConfigInput;
  busy: boolean;
  onChange: (value: ScaleConfigInput) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const info = SCALE_PROVIDER_INFO[value.provider];
  const connection = value.connection;
  const set = (patch: Partial<ScaleConfigInput>) => onChange({ ...value, ...patch });
  const setProvider = (provider: ScaleProviderId) => {
    const transports = SCALE_PROVIDER_INFO[provider].transports;
    set({ provider, connection: transports.includes(connection.type) ? connection : defaultConnection(transports[0]!) });
  };
  return (
    <form
      className="space-y-4 rounded-xl border border-primary/40 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <h3 className="font-semibold">{value.id ? "Tarozini tahrirlash" : "Yangi tarozi"}</h3>
      <div className="max-w-md space-y-1">
        <Label htmlFor="scale-name">Nomi</Label>
        <Input id="scale-name" value={value.name} maxLength={60} placeholder="Go'sht bo'limi" onChange={(e) => set({ name: e.target.value })} />
      </div>

      <div className="space-y-1.5">
        <Label>Tarozi turi</Label>
        <div className="flex flex-wrap gap-1">
          {SCALE_PROVIDERS.map((provider) => (
            <Button key={provider} type="button" size="sm" variant={value.provider === provider ? "default" : "secondary"} onClick={() => setProvider(provider)}>
              {SCALE_PROVIDER_INFO[provider].label}
            </Button>
          ))}
        </div>
        <p className={`text-xs ${info.docsRequired ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
          {info.docsRequired ? `${info.note} ${info.docsRequired}` : info.note}
        </p>
      </div>

      {!info.transports.includes("none") && (
        <div className="space-y-1.5">
          <Label>Ulanish</Label>
          <div className="flex flex-wrap gap-1">
            {info.transports.map((transport) => (
              <Button
                key={transport}
                type="button"
                size="sm"
                variant={connection.type === transport ? "default" : "secondary"}
                onClick={() => set({ connection: defaultConnection(transport) })}
              >
                {transport === "tcp" ? "LAN (TCP/IP)" : "COM / USB"}
              </Button>
            ))}
          </div>
        </div>
      )}

      {connection.type === "tcp" && (
        <div className="grid max-w-md gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <div className="space-y-1">
            <Label htmlFor="scale-host">IP manzil</Label>
            <Input id="scale-host" value={connection.host} placeholder="192.168.1.50" onChange={(e) => set({ connection: { ...connection, host: e.target.value.trim() } })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="scale-port">Port</Label>
            <Input
              id="scale-port"
              inputMode="numeric"
              value={connection.port > 0 ? String(connection.port) : ""}
              onChange={(e) => set({ connection: { ...connection, port: Number(e.target.value.replace(/\D/g, "").slice(0, 5)) || 0 } })}
            />
          </div>
        </div>
      )}

      {connection.type === "serial" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            USB tarozi Windows'da virtual COM port bo'lib ko'rinadi (Qurilmalar menejeri → Portlar). Tezlik va format tarozidagi sozlama bilan bir xil bo'lsin.
          </p>
          <div className="grid gap-3 sm:grid-cols-5">
            <div className="space-y-1">
              <Label htmlFor="scale-com">Port</Label>
              <Input id="scale-com" value={connection.port} placeholder="COM3" onChange={(e) => set({ connection: { ...connection, port: e.target.value.toUpperCase().trim() } })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="scale-baud">Tezlik</Label>
              <select id="scale-baud" className={SELECT} value={connection.baudRate} onChange={(e) => set({ connection: { ...connection, baudRate: Number(e.target.value) } })}>
                {SERIAL_BAUD_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="scale-data">Ma'lumot bitlari</Label>
              <select id="scale-data" className={SELECT} value={connection.dataBits} onChange={(e) => set({ connection: { ...connection, dataBits: Number(e.target.value) === 7 ? 7 : 8 } })}>
                <option value={8}>8</option>
                <option value={7}>7</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="scale-parity">Juftlik</Label>
              <select
                id="scale-parity"
                className={SELECT}
                value={connection.parity}
                onChange={(e) => set({ connection: { ...connection, parity: e.target.value === "even" || e.target.value === "odd" ? e.target.value : "none" } })}
              >
                <option value="none">Yo'q</option>
                <option value="even">Juft</option>
                <option value="odd">Toq</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="scale-stop">Stop bitlari</Label>
              <select id="scale-stop" className={SELECT} value={connection.stopBits} onChange={(e) => set({ connection: { ...connection, stopBits: Number(e.target.value) === 2 ? 2 : 1 } })}>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {value.provider === "generic-ascii" && (
        <div className="max-w-md space-y-1">
          <Label htmlFor="scale-poll">So'rov buyrug'i (ixtiyoriy)</Label>
          <Input id="scale-poll" value={value.pollCommand} maxLength={32} placeholder="bo'sh — tarozi o'zi yuboradi" onChange={(e) => set({ pollCommand: e.target.value })} />
          <p className="text-xs text-muted-foreground">Tarozi hujjatidagi og'irlik so'rash buyrug'i; \r, \n va \xNN yoziladi.</p>
        </div>
      )}
      {value.provider === "simulator" && (
        <div className="max-w-40 space-y-1">
          <Label htmlFor="scale-sim-weight">Simulyator og'irligi, kg</Label>
          <Input id="scale-sim-weight" inputMode="decimal" value={value.simulatedWeight} onChange={(e) => set({ simulatedWeight: e.target.value.replace(",", ".") })} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-5">
        <label htmlFor="scale-enabled" className="flex items-center gap-2 text-sm">
          <Switch id="scale-enabled" checked={value.enabled} onCheckedChange={(enabled) => set({ enabled })} />
          Yoqilgan
        </label>
        <label htmlFor="scale-auto" className="flex items-center gap-2 text-sm">
          <Switch id="scale-auto" checked={value.autoSync && info.capabilities.uploadProducts} disabled={!info.capabilities.uploadProducts} onCheckedChange={(autoSync) => set({ autoSync })} />
          Mahsulot o'zgarsa avtomatik yuborish
        </label>
        <div className="flex items-center gap-2 text-sm">
          <Label htmlFor="scale-attempts">Urinishlar soni</Label>
          <Input
            id="scale-attempts"
            className="w-16"
            inputMode="numeric"
            value={String(value.maxAttempts || "")}
            onChange={(e) => set({ maxAttempts: Number(e.target.value.replace(/\D/g, "").slice(0, 2)) || 0 })}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          Saqlash
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Bekor qilish
        </Button>
      </div>
    </form>
  );
}

function QueuePanel({ scale, canSync, onClose, onChanged }: { scale: ScaleView; canSync: boolean; onClose: () => void; onChanged: () => void }) {
  const [status, setStatus] = useState<ScaleQueueStatus | "ALL">("ALL");
  const [items, setItems] = useState<ScaleQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () => call("scale:queue", { id: scale.id, ...(status === "ALL" ? {} : { status }) }).then(setItems, (err: unknown) => setError(errorText(err))),
    [scale.id, status],
  );
  useEffect(() => {
    void load();
  }, [load, scale.queue]);

  const retry = (itemIds?: number[]) =>
    call("scale:retry", { id: scale.id, ...(itemIds ? { itemIds } : {}) }).then(
      () => {
        onChanged();
        void load();
      },
      (err: unknown) => setError(errorText(err)),
    );

  return (
    <section className="space-y-2 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Navbat: {scale.name}</h3>
        <div className="flex flex-wrap gap-1">
          {(["ALL", ...QUEUE_STATUSES] as const).map((key) => (
            <Button key={key} size="sm" variant={status === key ? "default" : "secondary"} onClick={() => setStatus(key)}>
              {key === "ALL" ? "Hammasi" : QUEUE_LABELS[key]}
            </Button>
          ))}
          {canSync && scale.queue.FAILED > 0 && (
            <Button size="sm" onClick={() => void retry()}>
              Xatolarni qayta yuborish ({scale.queue.FAILED})
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            Yopish
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="max-h-80 overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5">Mahsulot</th>
              <th className="px-2 py-1.5">PLU</th>
              <th className="px-2 py-1.5">Amal</th>
              <th className="px-2 py-1.5">Holat</th>
              <th className="px-2 py-1.5">Urinish</th>
              <th className="px-2 py-1.5">Keyingi urinish</th>
              <th className="px-2 py-1.5">Xato</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((item) => (
              <tr key={item.id} className="border-t border-border align-top">
                <td className="px-2 py-1.5">{item.productName ?? item.productId}</td>
                <td className="px-2 py-1.5 tabular-nums">{item.plu}</td>
                <td className="px-2 py-1.5">{item.action === "upsert" ? "Yuborish" : "O'chirish"}</td>
                <td className={`px-2 py-1.5 ${item.status === "FAILED" ? "text-destructive" : item.status === "SUCCESS" ? "text-emerald-700 dark:text-emerald-300" : ""}`}>
                  {QUEUE_LABELS[item.status]}
                </td>
                <td className="px-2 py-1.5 tabular-nums">
                  {item.attempts}/{item.maxAttempts}
                </td>
                <td className="px-2 py-1.5 text-xs">{item.status === "PENDING" ? when(item.nextAttemptAt) : "—"}</td>
                <td className="px-2 py-1.5 text-xs text-muted-foreground">{item.lastError ?? ""}</td>
                <td className="px-2 py-1.5">
                  {canSync && item.status === "FAILED" && (
                    <Button size="sm" variant="ghost" onClick={() => void retry([item.id])}>
                      Qayta
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items?.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">Navbat bo'sh</p>}
      </div>
    </section>
  );
}

function ReconcileBox({ result }: { result: ScaleReconcileResult }) {
  const clean = result.missingOnScale.length === 0 && result.extraOnScale.length === 0 && result.mismatched.length === 0;
  return (
    <div className="space-y-1 rounded-lg bg-muted/60 p-3 text-xs">
      <p className="font-medium">
        Solishtirish {when(result.checkedAt)} — {result.source === "scale" ? "tarozidan o'qilgan ro'yxat" : "kassa yozuvlari bo'yicha (tarozi ro'yxat bermaydi)"}
      </p>
      <p className="tabular-nums">
        Mos: {result.inSync} · taroziga yetmagan: {result.missingOnScale.length} · tarozida ortiqcha: {result.extraOnScale.length} · farqli: {result.mismatched.length}
      </p>
      {clean ? (
        <p className="text-emerald-700 dark:text-emerald-300">Farq yo'q</p>
      ) : (
        <>
          <ul className="max-h-40 list-disc overflow-auto pl-4">
            {result.missingOnScale.map((row) => (
              <li key={`m${row.plu}`}>
                PLU {row.plu} {row.name} — taroziga yuborilmagan
              </li>
            ))}
            {result.extraOnScale.map((row) => (
              <li key={`e${row.plu}`}>
                PLU {row.plu} {row.name} — kassada bunday tortiladigan mahsulot yo'q
              </li>
            ))}
            {result.mismatched.map((row) => (
              <li key={`d${row.plu}`}>
                PLU {row.plu} {row.name} — {row.field === "name" ? "nomi" : "narxi"}: kassada {row.expected}, tarozida {row.actual}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">Tuzatish uchun «To'liq sinxron».</p>
        </>
      )}
    </div>
  );
}

function BarcodeFormatCard({ canManage }: { canManage: boolean }) {
  const [format, setFormat] = useState<WeightBarcodeFormat | null>(null);
  const [prefixes, setPrefixes] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => {
    call("scale:barcode").then(
      (value) => {
        setFormat(value);
        setPrefixes(value.prefixes.join(", "));
      },
      (err: unknown) => setNotice({ tone: "error", text: errorText(err) }),
    );
  }, []);
  if (!format) return notice ? <p className="text-sm text-destructive">{notice.text}</p> : null;
  const weightDigits = 10 - format.codeLength;
  const save = () =>
    call("scale:save-barcode", { ...format, prefixes: prefixes.split(/[\s,;]+/).filter(Boolean) }).then(
      (value) => {
        setFormat(value);
        setPrefixes(value.prefixes.join(", "));
        setNotice({ tone: "info", text: "Saqlandi" });
      },
      (err: unknown) => setNotice({ tone: "error", text: errorText(err) }),
    );
  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      <div>
        <h3 className="font-semibold">Tarozi etiketkasi shtrix-kodi</h3>
        <p className="text-xs text-muted-foreground">
          Tarozi chop etgan EAN-13 etiketka skanerlansa mahsulot PLU bo'yicha topiladi, miqdor — etiketkadagi og'irlik (nazorat raqami tekshiriladi). Format
          tarozidagi sozlama bilan bir xil bo'lsin.
        </p>
      </div>
      <label htmlFor="barcode-enabled" className="flex items-center gap-2 text-sm">
        <Switch id="barcode-enabled" checked={format.enabled} disabled={!canManage} onCheckedChange={(enabled) => setFormat({ ...format, enabled })} />
        Etiketka shtrix-kodini o'qish
      </label>
      <div className="grid max-w-xl gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="barcode-prefixes">Prefikslar (20–29)</Label>
          <Input id="barcode-prefixes" value={prefixes} disabled={!canManage} placeholder="22, 23" onChange={(e) => setPrefixes(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="barcode-code">PLU raqamlari</Label>
          <select
            id="barcode-code"
            className={SELECT}
            disabled={!canManage}
            value={format.codeLength}
            onChange={(e) => {
              const codeLength = Number(e.target.value);
              setFormat({ ...format, codeLength, weightDecimals: Math.min(format.weightDecimals, 10 - codeLength) });
            }}
          >
            {[4, 5, 6].map((length) => (
              <option key={length} value={length}>
                {length}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="barcode-decimals">Og'irlik kasrlari</Label>
          <select id="barcode-decimals" className={SELECT} disabled={!canManage} value={format.weightDecimals} onChange={(e) => setFormat({ ...format, weightDecimals: Number(e.target.value) })}>
            {[0, 1, 2, 3]
              .filter((decimals) => decimals <= weightDigits)
              .map((decimals) => (
                <option key={decimals} value={decimals}>
                  {decimals === 3 ? "3 (gramm)" : decimals}
                </option>
              ))}
          </select>
        </div>
      </div>
      <p className="font-mono text-xs text-muted-foreground">
        PP {"K".repeat(format.codeLength)} {"O".repeat(weightDigits)} N — P prefiks, K PLU, O og'irlik, N nazorat raqami
      </p>
      <div className="flex items-center gap-3">
        {canManage && (
          <Button size="sm" onClick={() => void save()}>
            Saqlash
          </Button>
        )}
        {notice && <span className={`text-sm ${notice.tone === "error" ? "text-destructive" : "text-emerald-700 dark:text-emerald-300"}`}>{notice.text}</span>}
      </div>
    </section>
  );
}

import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import type { AppStatus, RejectedOperation } from "../../shared/kassa-api.js";
import type { SyncState } from "../../shared/sync-types.js";
import { call, errorText } from "../kassa.ts";

const SYNC_LABEL: Record<SyncState, { text: string; tone: string }> = {
  idle: { text: "Sinxron", tone: "bg-emerald-500" },
  syncing: { text: "Sinxron qilinmoqda…", tone: "bg-sky-500 animate-pulse" },
  offline: { text: "Offline", tone: "bg-amber-500" },
  unauthorized: { text: "Qurilma o'chirilgan", tone: "bg-destructive" },
  error: { text: "Sinxron xatosi", tone: "bg-destructive" },
};

const SECTIONS = ["Kassa (POS)", "Sotuv tarixi", "Kassa hisobi", "Xarid", "Ombor", "Mahsulot harakati", "Inventarizatsiya", "Etiketka", "Ma'lumotlar", "Analitika", "Sozlamalar"];

/** Bosh ekran: qurilma, kassir, sinxron holati va navbat, smena; bo'limlar (Kassa — ishlaydi, qolganlari keyingi bosqichlarda). */
export default function HomeScreen({ status, onChange, onOpenPos }: { status: AppStatus; onChange: (status: AppStatus) => void; onOpenPos: () => void }) {
  const [cash, setCash] = useState("");
  const [rejected, setRejected] = useState<RejectedOperation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sync = SYNC_LABEL[status.sync.state];

  const run = async (action: () => Promise<AppStatus>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await action());
      setCash("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-full flex-col bg-muted/40">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-card px-6 py-3">
        <div className="min-w-0">
          <p className="font-semibold">{status.company?.name}</p>
          <p className="text-xs text-muted-foreground">
            {status.device?.name} ({status.device?.code}) · {status.device?.warehouseName}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={`h-2.5 w-2.5 rounded-full ${sync.tone}`} />
          <span>{sync.text}</span>
          {status.sync.pending > 0 && <span className="text-muted-foreground">· navbatda {status.sync.pending}</span>}
          {status.sync.lastSyncAt && (
            <span className="text-xs text-muted-foreground">· {new Date(status.sync.lastSyncAt).toLocaleTimeString("uz-UZ")}</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm">{status.cashier?.name ?? status.cashier?.phone}</span>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => call("sync:run"))}>
            Sinxronlash
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void run(() => call("cashier:logout"))}>
            Chiqish
          </Button>
        </div>
      </header>

      <div className="grid flex-1 gap-4 p-6 lg:grid-cols-[360px_1fr]">
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <h2 className="font-semibold">Smena</h2>
          {status.shift ? (
            <p className="text-sm text-muted-foreground">
              Ochiq: {new Date(status.shift.openedAt).toLocaleString("uz-UZ")} · {status.shift.cashierName} · boshlang'ich {status.shift.openingCash}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Smena yopiq</p>
          )}
          <div className="space-y-1">
            <Label htmlFor="shift-cash">{status.shift ? "Kassadagi naqd (sanalgan)" : "Boshlang'ich naqd"}</Label>
            <Input id="shift-cash" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, ""))} />
          </div>
          <Button
            className="h-11 w-full"
            disabled={busy || cash === ""}
            onClick={() => void run(() => (status.shift ? call("shift:close", { closingCash: cash }) : call("shift:open", { openingCash: cash })))}
          >
            {status.shift ? "Smenani yopish" : "Smenani ochish"}
          </Button>

          <div className="space-y-1 border-t border-border pt-4 text-sm">
            <p>Mahsulotlar: {status.counts.products}</p>
            <p>Mijozlar: {status.counts.customers}</p>
            <p>Kassirlar: {status.counts.cashiers}</p>
            {status.counts.rejected > 0 && (
              <button type="button" className="text-destructive underline-offset-4 hover:underline" onClick={() => void call("sync:rejected").then(setRejected)}>
                Rad etilgan amallar: {status.counts.rejected}
              </button>
            )}
          </div>
          {rejected && (
            <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
              {rejected.map((op) => (
                <li key={op.opId} className="rounded-md bg-destructive/5 px-2 py-1">
                  {op.type} · {new Date(op.createdAt).toLocaleString("uz-UZ")} — {op.error?.message}
                </li>
              ))}
            </ul>
          )}
          {status.sync.lastError && <p className="text-xs text-muted-foreground">{status.sync.lastError}</p>}
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        </section>

        <section className="grid content-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <button type="button" onClick={onOpenPos} className="rounded-2xl border border-primary/40 bg-primary/5 p-5 text-left transition-colors hover:bg-primary/10">
            <p className="font-medium">{SECTIONS[0]}</p>
            <p className="text-xs text-muted-foreground">Sotuv, qaytarish, kechiktirilgan cheklar — internet bo'lmasa ham</p>
          </button>
          {SECTIONS.slice(1).map((title) => (
            <div key={title} className="rounded-2xl border border-dashed border-border bg-card/60 p-5">
              <p className="font-medium">{title}</p>
              <p className="text-xs text-muted-foreground">Keyingi bosqichda</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

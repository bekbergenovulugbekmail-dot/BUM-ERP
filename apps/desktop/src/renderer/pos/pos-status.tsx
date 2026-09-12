import { useEffect, useState, type ComponentType } from "react";
import { CloudOff, Printer, RefreshCw, Scale, Wifi, WifiOff } from "lucide-react";
import type { ScaleTestStatus } from "../../shared/scale-types.js";
import type { SyncStatus } from "../../shared/sync-types.js";
import { call } from "../kassa.ts";
import { useClock } from "./use-clock.ts";

type Tone = "success" | "warning" | "danger" | "info" | "muted";

/**
 * Semantik rang + ikonka + matn: holat faqat rang bilan bildirilmaydi. Fon kartaga aralashtirilgan (shaffof emas) — qorong'i
 * yuqori panelli mavzularda (Klassik) ham matn o'qiladi.
 */
const TONES: Record<Tone, string> = {
  success: "border-pos-success/40 bg-[color-mix(in_oklab,var(--pos-success)_12%,var(--card))] text-pos-success",
  warning: "border-pos-warning/40 bg-[color-mix(in_oklab,var(--pos-warning)_12%,var(--card))] text-pos-warning",
  danger: "border-pos-danger/40 bg-[color-mix(in_oklab,var(--pos-danger)_12%,var(--card))] text-pos-danger",
  info: "border-pos-info/40 bg-[color-mix(in_oklab,var(--pos-info)_12%,var(--card))] text-pos-info",
  muted: "border-border bg-card text-muted-foreground",
};

function StatusPill({ icon: Icon, tone, label, title, spin, onClick }: { icon: ComponentType<{ className?: string }>; tone: Tone; label: string; title?: string; spin?: boolean; onClick?: () => void }) {
  const className = `inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold ${TONES[tone]}`;
  const content = (
    <>
      <Icon className={`size-3.5 shrink-0 ${spin ? "animate-spin" : ""}`} />
      {label}
    </>
  );
  return onClick ? (
    <button type="button" className={`${className} hover:brightness-95`} title={title} onClick={onClick}>
      {content}
    </button>
  ) : (
    <span className={className} title={title}>
      {content}
    </span>
  );
}

const SYNC: Record<SyncStatus["state"], { icon: ComponentType<{ className?: string }>; tone: Tone; label: string }> = {
  idle: { icon: Wifi, tone: "success", label: "Online" },
  syncing: { icon: RefreshCw, tone: "info", label: "Sinxron…" },
  offline: { icon: CloudOff, tone: "warning", label: "Offline" },
  unauthorized: { icon: WifiOff, tone: "danger", label: "Qurilma o'chirilgan" },
  error: { icon: WifiOff, tone: "danger", label: "Sinxron xatosi" },
};

const SCALE: Record<ScaleTestStatus | "untested", { tone: Tone; label: string }> = {
  simulator: { tone: "info", label: "Tarozi: simulyator" },
  connected: { tone: "success", label: "Tarozi ulangan" },
  port_reachable: { tone: "warning", label: "Tarozi: protokol yo'q" },
  docs_required: { tone: "warning", label: "Tarozi: protokol yo'q" },
  unreachable: { tone: "danger", label: "Tarozi ulanmagan" },
  error: { tone: "danger", label: "Tarozi xatosi" },
  untested: { tone: "muted", label: "Tarozi tekshirilmagan" },
};

/**
 * Yuqori panel holatlari: sinxron (online/offline, navbat), printer (tanlangan printer Windows'da topildimi — qog'oz holatini
 * bildirmaydi), tarozi (oxirgi tekshiruv natijasi, faqat tarozi sozlangan bo'lsa) va soat.
 */
export function PosStatusBar({
  sync,
  unsynced,
  printerName,
  canViewScales,
  onSyncClick,
}: {
  sync: SyncStatus;
  unsynced: number;
  printerName: string | null;
  canViewScales: boolean;
  onSyncClick: () => void;
}) {
  const now = useClock();
  const [printer, setPrinter] = useState<{ tone: Tone; label: string } | null>(null);
  const [scale, setScale] = useState<{ tone: Tone; label: string; title: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    call("device:printers").then(
      (list) => {
        if (cancelled) return;
        if (printerName) setPrinter(list.some((item) => item.name === printerName) ? { tone: "success", label: "Printer topildi" } : { tone: "danger", label: "Printer topilmadi" });
        else setPrinter(list.length > 0 ? { tone: "info", label: "Standart printer" } : { tone: "warning", label: "Printer yo'q" });
      },
      () => !cancelled && setPrinter(null),
    );
    return () => {
      cancelled = true;
    };
  }, [printerName]);

  useEffect(() => {
    if (!canViewScales) return;
    let cancelled = false;
    call("scale:list").then(
      (scales) => {
        if (cancelled) return;
        const enabled = scales.find((item) => item.enabled);
        if (!enabled) {
          setScale(null);
          return;
        }
        const state = SCALE[enabled.lastTest?.status ?? "untested"];
        setScale({ ...state, title: `${enabled.name}${enabled.lastTest ? ` — ${enabled.lastTest.message}` : ""}` });
      },
      () => !cancelled && setScale(null),
    );
    return () => {
      cancelled = true;
    };
  }, [canViewScales, sync.lastSyncAt]);

  const syncState = SYNC[sync.state];
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <StatusPill
        icon={syncState.icon}
        tone={unsynced > 0 && sync.state === "idle" ? "warning" : syncState.tone}
        label={unsynced > 0 ? `${syncState.label} · ${unsynced} navbatda` : syncState.label}
        title={sync.lastError ?? undefined}
        spin={sync.state === "syncing"}
        onClick={onSyncClick}
      />
      {printer && <StatusPill icon={Printer} tone={printer.tone} label={printer.label} title={printerName ?? undefined} />}
      {scale && canViewScales && <StatusPill icon={Scale} tone={scale.tone} label={scale.label} title={scale.title} />}
      <span className="hidden min-w-12 text-right text-sm font-semibold tabular-nums xl:inline" aria-label="Vaqt">
        {now.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}
      </span>
    </div>
  );
}

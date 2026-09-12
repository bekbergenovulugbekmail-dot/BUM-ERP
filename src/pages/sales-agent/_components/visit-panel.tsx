import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, Ban, Camera, CheckCircle2, Clock, Loader2, PlayCircle, ShoppingCart, XCircle } from "lucide-react";
import type { SalesAgentPolicy } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { useAgentLocation } from "../_lib/agent-location.ts";
import { useNow } from "../_lib/use-now.ts";
import { freshPosition, uploadVisitPhoto, visitErrorMessage } from "../_lib/visit-api.ts";
import { effectiveVisitSeconds, remainingVisitSeconds } from "../_lib/visit-timer.ts";
import { formatClock, formatDistance, type AgentVisit, type PhotoKind, type StoreProfile } from "../_lib/types.ts";
import CompleteVisitDialog from "./complete-visit-dialog.tsx";

const VISIT_QUERIES = ["/api/sales-agent/visits", "/api/sales-agent/stores", "/api/sales-agent/today"];

/** Bitta rasm qadami: faqat kamera (`capture`), joy bilan yuklanadi; server hudud va fayl turini tekshiradi. */
function PhotoButton({
  visit,
  kind,
  done,
  disabled,
  compact = false,
}: {
  visit: AgentVisit;
  kind: PhotoKind;
  done: boolean;
  disabled: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation("agent");
  const input = useRef<HTMLInputElement>(null);
  const upload = useApiMutation(async (file: File) => uploadVisitPhoto(visit.id, file, kind, await freshPosition()), {
    invalidate: VISIT_QUERIES,
  });

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      await upload.mutateAsync(file);
      toast.success(t("visit.photo.added"));
    } catch (err) {
      toast.error(visitErrorMessage(err, t));
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <Button
        variant={done || compact ? "secondary" : "default"}
        className={cn("w-full justify-start", compact ? "h-10 text-xs" : "h-12")}
        disabled={disabled || upload.isPending}
        onClick={() => input.current?.click()}
      >
        {upload.isPending ? (
          <Loader2 className="h-5 w-5 mr-2 animate-spin" />
        ) : done ? (
          <CheckCircle2 className="h-5 w-5 mr-2 text-emerald-600" />
        ) : (
          <Camera className="h-5 w-5 mr-2" />
        )}
        <span className="truncate">
          {upload.isPending ? t("visit.photo.uploading") : done && !compact ? t(`visit.step.${kind}_done`) : t(`visit.step.${kind}`)}
        </span>
      </Button>
    </>
  );
}

function ActiveVisit({ visit, policy }: { visit: AgentVisit; policy: SalesAgentPolicy }) {
  const { t } = useTranslation("agent");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const now = useNow(1000);
  const [closing, setClosing] = useState(false);

  const has = (kind: PhotoKind) => visit.photos.some((photo) => photo.kind === kind);
  const storefrontReady = !policy.storefrontPhotoRequired || has("storefront");
  const photosReady = storefrontReady && (!policy.shelfPhotoRequired || has("shelf"));
  const invalid = visit.invalidatedAt !== null;
  const elapsed = effectiveVisitSeconds(visit, now, policy.visitExitPolicy);
  const remaining = remainingVisitSeconds(visit, now, policy.visitExitPolicy, policy.minVisitMinutes);

  return (
    <div className={cn("rounded-2xl border-2 p-4 space-y-3", invalid ? "border-destructive/40 bg-destructive/5" : "border-primary/40 bg-primary/5")}>
      <div className="flex items-center gap-2">
        <Clock className={cn("h-5 w-5", invalid ? "text-destructive" : "text-primary")} />
        <span className="font-semibold">{t("visit.in_progress")}</span>
        {visit.timerStartedAt ? (
          <span className="ml-auto font-mono text-lg font-semibold tabular-nums">{formatClock(elapsed)}</span>
        ) : (
          <span className="ml-auto text-xs text-muted-foreground">{t("visit.timer_waiting")}</span>
        )}
      </div>

      {invalid ? (
        <p className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <XCircle className="h-4 w-4 mt-0.5 shrink-0" /> {t("visit.invalid")}
        </p>
      ) : (
        visit.outsideSince && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {t(`visit.outside.${policy.visitExitPolicy === "pause" ? "pause" : "flag"}`)}
          </p>
        )
      )}

      <div className="space-y-2">
        <PhotoButton visit={visit} kind="storefront" done={has("storefront")} disabled={invalid} />
        {policy.shelfPhotoRequired && (
          <PhotoButton visit={visit} kind="shelf" done={has("shelf")} disabled={invalid || !storefrontReady} />
        )}
        <div className="grid grid-cols-2 gap-2">
          {!policy.shelfPhotoRequired && <PhotoButton visit={visit} kind="shelf" done={has("shelf")} disabled={invalid || !storefrontReady} compact />}
          <PhotoButton visit={visit} kind="placement" done={has("placement")} disabled={invalid || !storefrontReady} compact />
          <PhotoButton visit={visit} kind="promotion" done={has("promotion")} disabled={invalid || !storefrontReady} compact />
        </div>
      </div>

      {!invalid && visit.timerStartedAt && policy.minVisitMinutes > 0 && (
        <p className={cn("text-xs tabular-nums", remaining > 0 ? "text-muted-foreground" : "text-emerald-600")}>
          {remaining > 0 ? t("visit.min_remaining", { time: formatClock(remaining) }) : t("visit.min_done", { minutes: policy.minVisitMinutes })}
        </p>
      )}
      {!invalid && !photosReady && <p className="text-xs text-muted-foreground">{t("visit.photos_first")}</p>}

      <div className="grid grid-cols-2 gap-2">
        {photosReady && !invalid ? (
          <Button asChild className="h-14 text-base">
            <Link to={`/${lng}/sales-agent/stores/${visit.customerId}/order`}>
              <ShoppingCart className="h-5 w-5 mr-2" /> {t("visit.order")}
            </Link>
          </Button>
        ) : (
          <Button className="h-14 text-base" disabled>
            <ShoppingCart className="h-5 w-5 mr-2" /> {t("visit.order")}
          </Button>
        )}
        <Button
          variant={invalid ? "destructive" : "outline"}
          className="h-14 text-base"
          disabled={!invalid && !storefrontReady}
          onClick={() => setClosing(true)}
        >
          <Ban className="h-5 w-5 mr-2" /> {invalid ? t("visit.close_invalid") : t("visit.no_order")}
        </Button>
      </div>
      <CompleteVisitDialog visit={visit} policy={policy} open={closing} onOpenChange={setClosing} />
    </div>
  );
}

/**
 * Do'kon sahifasidagi tashrif: boshlash (yangi GPS o'lchovi, server geofence tekshiradi) → vitrina rasmi (taymer
 * boshlanadi) → polka rasmi → BUYURTMA yoki BUYURTMA YO'Q. Boshqa do'konda ochiq tashrif bo'lsa — havola.
 */
export default function VisitPanel({ store }: { store: StoreProfile }) {
  const { t } = useTranslation("agent");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const location = useAgentLocation();
  const current = useApiQuery<{ visit: AgentVisit | null }>("/api/sales-agent/visits/current");
  const policy = useApiQuery<{ policy: SalesAgentPolicy }>("/api/sales-agent/policy").data?.policy;
  const start = useApiMutation(
    async () => api.post<{ visit: AgentVisit }>("/api/sales-agent/visits/start", { customerId: store.id, ...(await freshPosition()) }),
    { invalidate: VISIT_QUERIES },
  );

  if (!current.data || !policy) return <Skeleton className="h-28 rounded-2xl" />;
  const visit = current.data.visit;

  if (visit && visit.customerId !== store.id) {
    return (
      <div className="rounded-2xl bg-amber-500/10 p-4 space-y-3 text-amber-700 dark:text-amber-400">
        <p className="flex items-start gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {t("visit.other_open", { store: visit.customerName })}
        </p>
        <Button asChild variant="secondary" className="h-11 w-full">
          <Link to={`/${lng}/sales-agent/stores/${visit.customerId}`}>{t("visit.continue")}</Link>
        </Button>
      </div>
    );
  }

  if (visit) return <ActiveVisit visit={visit} policy={policy} />;

  const handleStart = async () => {
    try {
      await start.mutateAsync();
      toast.success(t("visit.started"));
    } catch (err) {
      toast.error(visitErrorMessage(err, t));
    }
  };

  const last = store.todayVisit;
  const distance = formatDistance(store.distanceMeters, t);
  return (
    <div className="space-y-2">
      {last?.status === "completed" && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-1 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className={cn("h-4 w-4", last.result === "ordered" ? "text-emerald-600" : "text-amber-600")} />
            {last.result === "ordered"
              ? t("visit.result.ordered")
              : `${t("visit.result.no_order")}${last.noOrderReason ? `: ${t(`visit.reason.${last.noOrderReason}`)}` : ""}`}
          </p>
          {last.durationSeconds !== null && (
            <p className="text-muted-foreground">
              {t("visit.duration", { time: t("visit.minutes", { count: Math.max(1, Math.round(last.durationSeconds / 60)) }) })}
              {last.photos.length > 0 && ` · ${t("visit.photo.count", { count: last.photos.length })}`}
            </p>
          )}
          {last.invalidatedAt && <p className="text-destructive">{t("visit.invalid_short")}</p>}
        </div>
      )}
      <Button
        variant={last ? "secondary" : "default"}
        className="h-14 w-full text-base"
        disabled={start.isPending || location.status === "denied"}
        onClick={() => void handleStart()}
      >
        {start.isPending ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <PlayCircle className="h-5 w-5 mr-2" />}
        {last ? t("visit.again") : t("visit.start")}
      </Button>
      {distance && (
        <p className="text-xs text-center text-muted-foreground">
          {t("visit.distance_hint", { distance, radius: policy.geofenceRadiusMeters })}
        </p>
      )}
      {policy.orderRequiresVisit && <p className="text-xs text-center text-muted-foreground">{t("visit.required_hint")}</p>}
    </div>
  );
}

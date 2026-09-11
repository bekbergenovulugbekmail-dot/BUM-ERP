import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, Camera, CheckCircle2, Clock, Loader2, PlayCircle } from "lucide-react";
import type { SalesAgentPolicy } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { useAgentLocation } from "../_lib/agent-location.ts";
import { useNow } from "../_lib/use-now.ts";
import { freshPosition, uploadVisitPhoto, visitErrorMessage } from "../_lib/visit-api.ts";
import { PHOTO_KINDS, formatClock, formatDistance, type AgentVisit, type PhotoKind, type StoreProfile } from "../_lib/types.ts";
import CompleteVisitDialog from "./complete-visit-dialog.tsx";

function VisitTimer({ startedAt }: { startedAt: string }) {
  const now = useNow(1000);
  return <span className="ml-auto font-mono text-lg font-semibold tabular-nums">{formatClock((now - new Date(startedAt).getTime()) / 1000)}</span>;
}

function VisitPhotos({ visit, required }: { visit: AgentVisit; required: boolean }) {
  const { t } = useTranslation("agent");
  const location = useAgentLocation();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<PhotoKind>("storefront");
  const upload = useApiMutation(
    (file: File) => uploadVisitPhoto(visit.id, file, kind, location.point ? { ...location.point, accuracy: location.accuracy } : null),
    { invalidate: ["/api/sales-agent/visits", "/api/sales-agent/stores"] },
  );

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
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{t("visit.photo.count", { count: visit.photos.length })}</span>
        {required && visit.photos.length === 0 && (
          <span className="flex items-center gap-1 text-xs text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5" /> {t("visit.photo.required")}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PHOTO_KINDS.map((value) => {
          const taken = visit.photos.some((photo) => photo.kind === value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              className={cn(
                "rounded-full border px-3 min-h-9 text-xs font-medium transition-colors",
                kind === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
              )}
            >
              {taken && "✓ "}
              {t(`visit.photo.kind.${value}`)}
            </button>
          );
        })}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <Button variant="secondary" className="h-12 w-full" disabled={upload.isPending} onClick={() => input.current?.click()}>
        {upload.isPending ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Camera className="h-5 w-5 mr-2" />}
        {upload.isPending ? t("visit.photo.uploading") : t("visit.photo.add")}
      </Button>
    </div>
  );
}

/**
 * Do'kon sahifasidagi tashrif: boshlash (yangi GPS o'lchovi, server geofence tekshiradi), davom etayotgan tashrif
 * (taymer, rasmlar, yakunlash) yoki bugungi yakunlangan tashrif natijasi. Boshqa do'konda ochiq tashrif bo'lsa — havola.
 */
export default function VisitPanel({ store }: { store: StoreProfile }) {
  const { t } = useTranslation("agent");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const location = useAgentLocation();
  const current = useApiQuery<{ visit: AgentVisit | null }>("/api/sales-agent/visits/current");
  const policy = useApiQuery<{ policy: SalesAgentPolicy }>("/api/sales-agent/policy").data?.policy;
  const start = useApiMutation(
    async () => api.post<{ visit: AgentVisit }>("/api/sales-agent/visits/start", { customerId: store.id, ...(await freshPosition()) }),
    { invalidate: ["/api/sales-agent/visits", "/api/sales-agent/stores", "/api/sales-agent/today"] },
  );
  const [completing, setCompleting] = useState(false);

  if (!current.data) return <Skeleton className="h-28 rounded-2xl" />;
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

  if (visit) {
    return (
      <div className="rounded-2xl border-2 border-primary/40 bg-primary/5 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          <span className="font-semibold">{t("visit.in_progress")}</span>
          <VisitTimer startedAt={visit.startedAt} />
        </div>
        <VisitPhotos visit={visit} required={policy?.photoRequired ?? false} />
        <Button className="h-14 w-full text-base" onClick={() => setCompleting(true)}>
          <CheckCircle2 className="h-5 w-5 mr-2" /> {t("visit.complete")}
        </Button>
        <CompleteVisitDialog
          visit={visit}
          open={completing}
          onOpenChange={setCompleting}
          photoRequired={policy?.photoRequired ?? false}
        />
      </div>
    );
  }

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
      {distance && policy && (
        <p className="text-xs text-center text-muted-foreground">
          {t("visit.distance_hint", { distance, radius: policy.geofenceRadiusMeters })}
        </p>
      )}
    </div>
  );
}

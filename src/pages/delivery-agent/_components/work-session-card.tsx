import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Briefcase, Loader2, Power } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { api } from "@/lib/api.ts";
import { deliveryErrorMessage } from "@/lib/delivery/errors.ts";
import type { WorkSession } from "@/lib/delivery/types.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { freshPosition } from "@/pages/sales-agent/_lib/visit-api.ts";

const INVALIDATE = ["/api/delivery/agent"];

/**
 * Yetkazuvchi ish vaqti: "ISHNI BOSHLASH" (yangi GPS o'lchovi bilan) va "ISHNI YAKUNLASH" (mijozdagi yetkazma
 * yakunlanmagan bo'lsa server rad etadi). Lokatsiya faqat faol sessiyada kuzatiladi.
 * `compact` — yetkazma sahifasida: faqat ish boshlanmagan bo'lsa ogohlantirish.
 */
export default function DeliveryWorkSessionCard({ variant = "full" }: { variant?: "full" | "compact" }) {
  const { t, i18n } = useTranslation("delivery");
  const [confirming, setConfirming] = useState(false);
  const query = useApiQuery<{ session: WorkSession | null }>("/api/delivery/agent/work-session", undefined, { refetchInterval: 60_000 });
  const session = query.data?.session;
  const onDuty = session?.status === "active";

  const start = useApiMutation(async () => api.post("/api/delivery/agent/work-session/start", await freshPosition()), { invalidate: INVALIDATE });
  const end = useApiMutation(async () => api.post("/api/delivery/agent/work-session/end", await freshPosition().catch(() => ({}))), {
    invalidate: INVALIDATE,
  });
  const clock = useMemo(() => new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }), [i18n.language]);

  const handleStart = async () => {
    try {
      await start.mutateAsync();
      toast.success(t("work.started"));
    } catch (err) {
      toast.error(deliveryErrorMessage(err, t));
    }
  };

  const handleEnd = async () => {
    try {
      await end.mutateAsync();
      setConfirming(false);
      toast.success(t("work.ended"));
    } catch (err) {
      toast.error(deliveryErrorMessage(err, t));
    }
  };

  if (!query.data) return null;
  if (variant === "compact" && onDuty) return null;

  if (!onDuty) {
    return (
      <div className="space-y-3 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-4">
        <p className="flex items-start gap-2 text-sm font-medium">
          <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          {variant === "compact" ? t("work.required") : t("work.off_duty")}
        </p>
        <Button className="h-14 w-full text-base font-semibold tracking-wide" disabled={start.isPending} onClick={() => void handleStart()}>
          {start.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Power className="mr-2 h-5 w-5" />}
          {t("work.start")}
        </Button>
        {variant === "full" && <p className="text-xs text-muted-foreground">{t("work.privacy")}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        <span className="font-medium">{t("work.started_at", { time: clock.format(new Date(session!.startedAt)) })}</span>
      </div>
      <p className="text-xs text-muted-foreground">{t("work.tracking_note")}</p>
      {confirming ? (
        <div className="space-y-2">
          <p className="text-sm">{t("work.end_confirm")}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" className="h-12" onClick={() => setConfirming(false)}>
              {t("common.no")}
            </Button>
            <Button variant="destructive" className="h-12" disabled={end.isPending} onClick={() => void handleEnd()}>
              {end.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("common.yes")}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" className="h-12 w-full font-semibold tracking-wide" onClick={() => setConfirming(true)}>
          <Power className="mr-2 h-4 w-4" /> {t("work.end")}
        </Button>
      )}
    </div>
  );
}

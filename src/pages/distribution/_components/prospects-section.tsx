import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { mapAppUrl } from "@/lib/maps/index.ts";
import type { DistProspect, DistributionRoute } from "../_lib/types.ts";

type Status = "new" | "converted" | "rejected" | "all";
const STATUSES: Status[] = ["new", "converted", "rejected", "all"];
const INVALIDATE = ["/api/sales-agent/supervisor/prospects", "/api/distribution", "/api/sales"];

/**
 * Yangi mijozlar (`sales_agent.supervise`): agentlar topgan potentsial do'konlar — mijozga aylantirish (koordinata va
 * aloqa bilan, ixtiyoriy marshrutga) yoki sabab bilan rad etish.
 */
export default function ProspectsSection() {
  const { t, i18n } = useTranslation("distribution");
  const [status, setStatus] = useState<Status>("new");
  const [converting, setConverting] = useState<DistProspect | null>(null);
  const [routeId, setRouteId] = useState("none");
  const [rejecting, setRejecting] = useState<DistProspect | null>(null);
  const [reason, setReason] = useState("");

  const prospects = useApiQuery<{ prospects: DistProspect[] }>("/api/sales-agent/supervisor/prospects", {
    status: status === "all" ? undefined : status,
  }).data?.prospects;
  const routes = useApiQuery<{ routes: DistributionRoute[] }>(converting ? "/api/distribution/routes" : null).data?.routes;
  const convert = useApiMutation(
    (body: { id: string; routeId: string | null }) =>
      api.post(`/api/sales-agent/supervisor/prospects/${body.id}/convert`, { routeId: body.routeId }),
    { invalidate: INVALIDATE },
  );
  const reject = useApiMutation(
    (body: { id: string; reason: string }) => api.post(`/api/sales-agent/supervisor/prospects/${body.id}/reject`, { reason: body.reason }),
    { invalidate: INVALIDATE },
  );
  const formatDate = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
    [i18n.language],
  );

  const handleConvert = async () => {
    if (!converting) return;
    try {
      await convert.mutateAsync({ id: converting.id, routeId: routeId === "none" ? null : routeId });
      toast.success(t("prospects.converted"));
      setConverting(null);
      setRouteId("none");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleReject = async () => {
    if (!rejecting) return;
    if (reason.trim().length < 3) {
      toast.error(t("prospects.reason_short"));
      return;
    }
    try {
      await reject.mutateAsync({ id: rejecting.id, reason: reason.trim() });
      toast.success(t("prospects.rejected"));
      setRejecting(null);
      setReason("");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <Select value={status} onValueChange={(value) => setStatus(value as Status)}>
        <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
        <SelectContent>
          {STATUSES.map((value) => (
            <SelectItem key={value} value={value}>{t(`prospects.status.${value}`)}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {!prospects ? (
          <div className="space-y-2 p-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
        ) : prospects.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">{t("prospects.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t("prospects.col.name")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("prospects.col.agent")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("prospects.col.contact")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("prospects.col.location")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("prospects.col.created")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {prospects.map((prospect) => (
                  <tr key={prospect.id} className="align-top">
                    <td className="min-w-40 px-3 py-2">
                      <p className="font-medium">{prospect.name}</p>
                      {prospect.comment && <p className="text-xs text-muted-foreground">{prospect.comment}</p>}
                      {prospect.rejectionReason && <p className="text-xs text-destructive">{prospect.rejectionReason}</p>}
                      {prospect.status !== "new" && <p className="text-xs text-muted-foreground">{t(`prospects.status.${prospect.status}`)}</p>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{prospect.salesRepName}</td>
                    <td className="min-w-36 px-3 py-2">
                      {prospect.phone && <p>{prospect.phone}</p>}
                      {prospect.address && <p className="text-xs text-muted-foreground">{prospect.address}</p>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {prospect.latitude && prospect.longitude ? (
                        <a
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                          href={mapAppUrl(prospect.latitude, prospect.longitude, prospect.name)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <MapPin className="h-3.5 w-3.5" /> {t("prospects.map")}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDate.format(new Date(prospect.createdAt))}</td>
                    <td className="px-3 py-2">
                      {prospect.status === "new" && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" className="h-8" onClick={() => setConverting(prospect)}>
                            <Check className="mr-1 h-4 w-4" /> {t("prospects.convert")}
                          </Button>
                          <Button size="sm" variant="secondary" className="h-8" onClick={() => setRejecting(prospect)}>
                            <X className="mr-1 h-4 w-4" /> {t("prospects.reject")}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={converting !== null} onOpenChange={(open) => !open && setConverting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("prospects.convert_title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm font-medium">{converting?.name}</p>
          <div className="space-y-1">
            <Label>{t("prospects.route")}</Label>
            <Select value={routeId} onValueChange={setRouteId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("prospects.no_route")}</SelectItem>
                {routes?.map((route) => (
                  <SelectItem key={route.id} value={route.id}>{route.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setConverting(null)}>{t("prospects.cancel")}</Button>
            <Button disabled={convert.isPending} onClick={() => void handleConvert()}>{t("prospects.convert")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("prospects.reject")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="prospect-reason">
              {t("prospects.reject_reason")} · {rejecting?.name}
            </Label>
            <Textarea id="prospect-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setRejecting(null)}>{t("prospects.cancel")}</Button>
            <Button variant="destructive" disabled={reject.isPending} onClick={() => void handleReject()}>
              {t("prospects.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

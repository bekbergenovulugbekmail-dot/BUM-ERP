import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, MapPin, Phone, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import EmptyState from "../_components/empty-state.tsx";
import { useAgentLocation } from "../_lib/agent-location.ts";
import type { Prospect, ProspectStatus } from "../_lib/types.ts";

const STATUS_TONES: Record<ProspectStatus, string> = {
  new: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  converted: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  rejected: "bg-destructive/10 text-destructive",
};

function ProspectDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("agent");
  const location = useAgentLocation();
  const [form, setForm] = useState({ name: "", phone: "", address: "", comment: "", attach: true });
  const create = useApiMutation((body: Record<string, unknown>) => api.post("/api/sales-agent/prospects", body), {
    invalidate: ["/api/sales-agent/prospects", "/api/sales-agent/dashboard"],
  });
  const canAttach = location.point !== null;

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error(t("prospect.name_required"));
      return;
    }
    try {
      await create.mutateAsync({
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        comment: form.comment.trim() || null,
        ...(form.attach && location.point
          ? { latitude: location.point.latitude, longitude: location.point.longitude, accuracy: location.accuracy }
          : {}),
      });
      toast.success(t("prospect.saved"));
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("prospect.add")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="prospect-name">{t("prospect.name")} *</Label>
            <Input id="prospect-name" className="h-11" maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="prospect-phone">{t("prospect.phone")}</Label>
            <Input
              id="prospect-phone"
              className="h-11"
              type="tel"
              inputMode="tel"
              maxLength={20}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="prospect-address">{t("prospect.address")}</Label>
            <Input id="prospect-address" className="h-11" maxLength={500} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="prospect-comment">{t("prospect.comment")}</Label>
            <Textarea id="prospect-comment" rows={2} maxLength={1000} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
          </div>
          <label className={cn("flex items-center gap-3 rounded-xl border border-border px-3 py-3", !canAttach && "opacity-60")}>
            <Checkbox
              checked={canAttach && form.attach}
              disabled={!canAttach}
              onCheckedChange={(checked) => setForm({ ...form, attach: checked === true })}
            />
            <span className="text-sm">{canAttach ? t("prospect.attach_location") : t("prospect.no_location")}</span>
          </label>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="secondary" className="h-12" onClick={onClose}>
            {t("visit.cancel")}
          </Button>
          <Button className="h-12" disabled={create.isPending} onClick={() => void submit()}>
            {t("prospect.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Yangi mijoz topish: agent potentsial do'konni (nomi, aloqa, manzil, joylashuv) yuboradi, supervayzer ko'rib chiqadi. */
export default function AgentProspectsPage() {
  const { t } = useTranslation("agent");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const [adding, setAdding] = useState(false);
  const prospects = useApiQuery<{ prospects: Prospect[] }>("/api/sales-agent/prospects").data?.prospects;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" className="-ml-2 h-10 w-10">
          <Link to={`/${lng}/sales-agent/dashboard`} aria-label={t("back")}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <h1 className="text-lg font-bold">{t("prospect.title")}</h1>
      </div>

      <Button className="h-14 w-full text-base" onClick={() => setAdding(true)}>
        <UserPlus className="mr-2 h-5 w-5" /> {t("prospect.add")}
      </Button>

      {!prospects ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : prospects.length === 0 ? (
        <EmptyState icon={UserPlus} title={t("prospect.title")} message={t("prospect.empty")} />
      ) : (
        <div className="space-y-2">
          {prospects.map((prospect) => (
            <div key={prospect.id} className="space-y-1 rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate font-semibold">{prospect.name}</p>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_TONES[prospect.status])}>
                  {t(`prospect.status.${prospect.status}`)}
                </span>
              </div>
              {prospect.phone && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" /> {prospect.phone}
                </p>
              )}
              {(prospect.address || prospect.latitude) && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" /> {prospect.address ?? `${prospect.latitude}, ${prospect.longitude}`}
                </p>
              )}
              {prospect.rejectionReason && <p className="text-xs text-destructive">{prospect.rejectionReason}</p>}
            </div>
          ))}
        </div>
      )}

      {adding && <ProspectDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

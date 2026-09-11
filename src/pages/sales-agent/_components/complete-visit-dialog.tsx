import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Label } from "@/components/ui/label.tsx";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { freshPosition, visitErrorMessage } from "../_lib/visit-api.ts";
import { NO_ORDER_REASONS, type AgentVisit, type NoOrderReason } from "../_lib/types.ts";

type Props = {
  visit: AgentVisit;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photoRequired: boolean;
};

/** Tashrifni yakunlash: buyurtma bo'lmasa sabab majburiy ("Boshqa" — izoh bilan); siyosat talab qilsa — rasm. */
export default function CompleteVisitDialog({ visit, open, onOpenChange, photoRequired }: Props) {
  const { t } = useTranslation("agent");
  const [reason, setReason] = useState<NoOrderReason | "">("");
  const [comment, setComment] = useState("");
  const [notes, setNotes] = useState("");
  const complete = useApiMutation(
    async () =>
      api.post<{ visit: AgentVisit }>(`/api/sales-agent/visits/${visit.id}/complete`, {
        ...(await freshPosition()),
        noOrderReason: reason || undefined,
        noOrderComment: comment.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    { invalidate: ["/api/sales-agent/visits", "/api/sales-agent/stores", "/api/sales-agent/today"] },
  );
  const missingPhoto = photoRequired && visit.photos.length === 0;

  const submit = async () => {
    if (missingPhoto) {
      toast.error(t("visit.photo.required"));
      return;
    }
    if (!reason) {
      toast.error(t("visit.reason.required"));
      return;
    }
    if (reason === "other" && comment.trim().length < 3) {
      toast.error(t("visit.comment_required"));
      return;
    }
    try {
      await complete.mutateAsync();
      toast.success(t("visit.done"));
      onOpenChange(false);
    } catch (err) {
      toast.error(visitErrorMessage(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("visit.complete")}</DialogTitle>
          <DialogDescription>{visit.customerName}</DialogDescription>
        </DialogHeader>

        {missingPhoto && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {t("visit.photo.required")}
          </p>
        )}

        <div className="space-y-2">
          <Label>{t("visit.reason.title")}</Label>
          <RadioGroup value={reason} onValueChange={(value) => setReason(value as NoOrderReason)} className="gap-2">
            {NO_ORDER_REASONS.map((value) => (
              <label
                key={value}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-3 min-h-12 cursor-pointer",
                  reason === value ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <RadioGroupItem value={value} />
                <span className="text-sm">{t(`visit.reason.${value}`)}</span>
              </label>
            ))}
          </RadioGroup>
        </div>

        {reason === "other" && (
          <div className="space-y-1">
            <Label htmlFor="visit-comment">{t("visit.comment")}</Label>
            <Textarea id="visit-comment" rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="visit-notes">{t("visit.notes")}</Label>
          <Textarea id="visit-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="secondary" className="h-12" onClick={() => onOpenChange(false)}>
            {t("visit.cancel")}
          </Button>
          <Button className="h-12" disabled={complete.isPending} onClick={() => void submit()}>
            {complete.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t("visit.complete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

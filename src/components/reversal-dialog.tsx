/**
 * Hujjatni BEKOR QILISH oynasi (ta'minotchi to'lovi, to'langan xarajat): avval serverdan to'siqlar olinadi, sabab
 * majburiy. Hujjat o'chirilmaydi — server teskari yozuvlar (kassa, jurnal, balans) yozadi va holatni "bekor" qiladi.
 */
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";

export default function ReversalDialog({
  title,
  description,
  previewUrl,
  reverseUrl,
  invalidate,
  onClose,
}: {
  title: string;
  description: string;
  previewUrl: string;
  reverseUrl: string;
  invalidate: string[];
  onClose: () => void;
}) {
  const preview = useApiQuery<{ blockers: string[] }>(previewUrl);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reverse = useApiMutation(() => api.post(reverseUrl, { reason }), { invalidate });
  const blockers = preview.data?.blockers ?? [];
  const blocked = !preview.data || blockers.length > 0;

  const submit = async () => {
    setError(null);
    try {
      await reverse.mutateAsync();
      toast.success("Bekor qilindi — kassa, balans va buxgalteriya qayta hisoblandi");
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="reversal-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Undo2 className="h-4 w-4" /> {title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {preview.error && <p className="text-sm text-destructive">{errorMessage(preview.error)}</p>}
        {blockers.map((blocker) => (
          <p key={blocker} className="flex items-start gap-2 text-sm text-destructive"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {blocker}</p>
        ))}
        {!blocked && (
          <div>
            <Label htmlFor="reversal-reason">Sabab (majburiy)</Label>
            <Textarea id="reversal-reason" data-testid="reversal-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Yopish</Button>
          <Button variant="destructive" data-testid="reversal-confirm" disabled={blocked || reason.trim().length < 3 || reverse.isPending} onClick={() => void submit()}>
            Bekor qilish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

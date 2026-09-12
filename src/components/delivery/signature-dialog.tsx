/**
 * Mijoz imzosi: barmoq yoki stilus bilan chiziladi (oq fonda PNG), imzo qo'ygan shaxs ismi majburiy.
 * Server faylni baytlardan PNG ekanini tekshiradi.
 */
import { useCallback, useRef, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { Eraser, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";

type Props = { busy: boolean; onClose: () => void; onSubmit: (signerName: string, pngBase64: string) => void };

export default function SignatureDialog({ busy, onClose, onSubmit }: Props) {
  const { t } = useTranslation("delivery");
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);
  const [signer, setSigner] = useState("");

  const paintBackground = useCallback((element: HTMLCanvasElement) => {
    const context = element.getContext("2d");
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, element.width, element.height);
    const ratio = element.width / Math.max(1, element.clientWidth);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111827";
    context.fillStyle = "#111827";
  }, []);

  const setup = useCallback(
    (element: HTMLCanvasElement | null) => {
      canvas.current = element;
      if (!element) return;
      const ratio = window.devicePixelRatio || 1;
      element.width = Math.max(1, Math.round(element.clientWidth * ratio));
      element.height = Math.max(1, Math.round(element.clientHeight * ratio));
      paintBackground(element);
    },
    [paintBackground],
  );

  const pointOf = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = event.currentTarget.clientWidth / Math.max(1, rect.width);
    return { x: (event.clientX - rect.left) * scale, y: (event.clientY - rect.top) * scale };
  };

  const handleDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const point = pointOf(event);
    last.current = point;
    const context = event.currentTarget.getContext("2d");
    context?.beginPath();
    context?.arc(point.x, point.y, 1.2, 0, Math.PI * 2);
    context?.fill();
    setEmpty(false);
  };

  const handleMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const point = pointOf(event);
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    context.beginPath();
    context.moveTo(last.current.x, last.current.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    last.current = point;
  };

  const handleUp = () => {
    drawing.current = false;
    last.current = null;
  };

  const clear = () => {
    if (canvas.current) paintBackground(canvas.current);
    setEmpty(true);
  };

  const submit = () => {
    if (!canvas.current || empty || signer.trim().length < 2) return;
    const data = canvas.current.toDataURL("image/png").split(",")[1] ?? "";
    onSubmit(signer.trim(), data);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("signature.title")}</DialogTitle>
          <DialogDescription>{t("signature.hint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <canvas
            ref={setup}
            aria-label={t("signature.title")}
            className="h-52 w-full touch-none rounded-xl border-2 border-dashed border-border bg-white"
            onPointerDown={handleDown}
            onPointerMove={handleMove}
            onPointerUp={handleUp}
            onPointerCancel={handleUp}
            onPointerLeave={handleUp}
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{empty ? t("signature.empty") : ""}</p>
            <Button type="button" variant="ghost" size="sm" onClick={clear}>
              <Eraser className="mr-1.5 h-4 w-4" /> {t("signature.clear")}
            </Button>
          </div>
          <div className="space-y-1">
            <Label htmlFor="signature-signer">{t("signature.signer")} *</Label>
            <Input id="signature-signer" maxLength={200} value={signer} onChange={(e) => setSigner(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="secondary" className="h-12" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button className="h-12" disabled={busy || empty || signer.trim().length < 2} onClick={submit}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("signature.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

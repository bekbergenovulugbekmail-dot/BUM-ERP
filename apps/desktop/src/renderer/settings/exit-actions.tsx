/**
 * Kassadan chiqish yo'llari: dasturni to'liq yopish va qurilmani kompaniyadan uzish (boshqa kompaniyaga ulash uchun).
 * Uzish yuborilmagan yoki rad etilgan amal, ochiq smena bo'lsa rad etiladi (main jarayon) — ma'lumot yo'qolmaydi.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import type { AppStatus } from "../../shared/kassa-api.js";
import { call, errorText } from "../kassa.ts";

export default function ExitActions({ status, onStatus }: { status: AppStatus; onStatus: (status: AppStatus) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const unpair = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await call("device:unpair");
      onStatus(result.status);
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {confirming ? (
        <div className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p>
            Qurilma «{status.company?.name}» kompaniyasidan uziladi: shu kassadagi kassirlar, mahsulotlar va lokal tarix o'chiriladi
            (hammasi serverda saqlangan). Printer va tarozi sozlamalari qoladi. Keyin boshqa kompaniyaga ulash mumkin.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Bekor qilish
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void unpair()}>
              {busy ? "Uzilmoqda…" : "Qurilmani uzish"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void call("app:quit").catch(() => undefined)}>
            Dasturni yopish
          </Button>
          <Button
            variant="ghost"
            className="text-destructive"
            onClick={() => {
              setMessage(null);
              setConfirming(true);
            }}
          >
            Qurilmani uzish
          </Button>
        </div>
      )}
      {message && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</p>}
    </div>
  );
}

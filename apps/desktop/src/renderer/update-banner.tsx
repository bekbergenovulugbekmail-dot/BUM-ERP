/**
 * YANGILANISH (egasi qarori 2026-09-28: "yangilanish bor — yangilaysizmi?" deb o'zi so'rasin, qo'lda yuklash shart emas).
 *
 * Oqim: kassir kirgach 20 soniyadan keyin va har 6 soatda server so'raladi → yangi versiya bo'lsa o'rnatuvchi
 * FONDA o'zi yuklab olinadi (uzilsa keyingi tekshiruvda o'sha joydan davom etadi) → tayyor bo'lgach kassirdan
 * bitta savol: "Hozir yangilaysizmi?" [Yangilash] / [Keyinroq]. Majburiy versiyada "Keyinroq" yo'q.
 *
 * Savdo o'rtasida ilova o'zi qayta ishga tushmaydi — o'rnatish faqat kassir tasdiqlagach.
 * Tekshiruv va yuklash xatosi jim yutiladi: internet yo'qligi kassa ishiga xalaqit bermasligi kerak.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { UpdateInfo } from "../shared/kassa-api.ts";
import { call } from "./kassa.ts";

/** Ishga tushgandan keyin qancha kutib tekshiriladi — kassa ochilishi sekinlashmasin. */
const FIRST_DELAY_MS = 20_000;
/** Keyingi tekshiruvlar oralig'i. */
const INTERVAL_MS = 6 * 60 * 60 * 1000;

export default function UpdateBanner({ cashierId }: { cashierId: string | null }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  /** Bir vaqtda bitta yuklash (tekshiruv taymeri yuklash ustidan qayta boshlamasin). */
  const busy = useRef(false);

  const check = useCallback(() => {
    // Tekshiruv kassir kirgandagina ishlaydi (server qurilma tokenini so'raydi)
    call("update:check").then(
      (next) => setInfo(next),
      () => undefined, // internet yo'q — jim o'tkazamiz
    );
  }, []);

  useEffect(() => {
    if (!cashierId) return;
    const first = setTimeout(check, FIRST_DELAY_MS);
    const timer = setInterval(check, INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [cashierId, check]);

  // Yangi versiya bor va hali yuklanmagan — kassirdan so'ramasdan fonda yuklab olamiz (u faqat o'rnatishni tasdiqlaydi)
  useEffect(() => {
    if (!info?.available || info.downloaded || busy.current) return;
    busy.current = true;
    setDownloading(true);
    call("update:download").then(
      (next) => setInfo(next),
      (err: unknown) => setError(err instanceof Error ? err.message : "Yangilanishni yuklab bo'lmadi"),
    ).finally(() => {
      busy.current = false;
      setDownloading(false);
    });
  }, [info]);

  if (!info?.available || (hidden && !info.mandatory)) return null;

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      await call("update:install");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Yangilashda xatolik");
      setInstalling(false);
    }
  };

  // Yuklanmaguncha — kichik xabar; tayyor bo'lgach — savol oynasi
  if (!info.downloaded) {
    return (
      <div
        data-testid="update-downloading"
        className="fixed inset-x-0 bottom-0 z-50 flex items-center gap-3 border-t border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
      >
        <span className="font-semibold">Yangi versiya {info.latest} tayyorlanmoqda…</span>
        {downloading && <span className="text-amber-800/80">yuklanmoqda</span>}
        {error && <span className="text-red-700">{error}</span>}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="update-prompt">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl">
        <h2 className="text-lg font-bold">Yangilanish bor</h2>
        <p className="mt-2 text-sm">
          Yangi versiya <span className="font-semibold">{info.latest}</span> yuklab olindi (hozirgisi {info.current}).
          {info.mandatory ? " Bu majburiy yangilanish." : " Hozir yangilaysizmi?"}
        </p>
        {info.notes && <p className="mt-2 text-sm text-muted-foreground">{info.notes}</p>}
        <p className="mt-2 text-xs text-muted-foreground">Yangilashda kassa yopilib, qayta ochiladi — avval chekni yakunlang.</p>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          {!info.mandatory && (
            <button type="button" className="rounded-md border border-border px-3 py-2 text-sm" disabled={installing} onClick={() => setHidden(true)}>
              Keyinroq
            </button>
          )}
          <button
            type="button"
            data-testid="update-install"
            className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            disabled={installing}
            onClick={() => void install()}
          >
            {installing ? "O'rnatilmoqda…" : "Yangilash"}
          </button>
        </div>
      </div>
    </div>
  );
}

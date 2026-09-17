/**
 * Yangi versiya haqida xabar. Kassa ochilganda (kassir kirgach) va har 6 soatda server so'raladi.
 *
 * Yuklab olish va o'rnatish — kassirning tanlovi: savdo o'rtasida ilova o'zi qayta ishga tushmaydi.
 * Majburiy versiyada banner yopilmaydi (faqat yangilash yo'li qoladi).
 * Tekshiruv xatosi jim yutiladi — internet yo'qligi kassa ishiga xalaqit bermasligi kerak.
 */
import { useCallback, useEffect, useState } from "react";
import type { UpdateInfo } from "../shared/kassa-api.ts";
import { call } from "./kassa.ts";

/** Ishga tushgandan keyin qancha kutib tekshiriladi — kassa ochilishi sekinlashmasin. */
const FIRST_DELAY_MS = 20_000;
/** Keyingi tekshiruvlar oralig'i. */
const INTERVAL_MS = 6 * 60 * 60 * 1000;

export default function UpdateBanner({ cashierId }: { cashierId: string | null }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState<"download" | "install" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

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

  if (!info?.available || hidden) return null;

  const run = async (kind: "download" | "install") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "install") await call("update:install");
      else setInfo(await call("update:download"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Yangilashda xatolik");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      data-testid="update-banner"
      className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center gap-3 border-t border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      <span className="font-semibold">
        Yangi versiya: {info.latest}
        {info.mandatory && " — majburiy"}
      </span>
      {info.notes && <span className="text-amber-800/80">{info.notes}</span>}
      {error && <span className="text-red-700">{error}</span>}

      <div className="ml-auto flex items-center gap-2">
        {info.downloaded ? (
          <button
            type="button"
            className="rounded-md bg-amber-600 px-3 py-1 font-semibold text-white disabled:opacity-60"
            disabled={busy !== null}
            onClick={() => void run("install")}
          >
            {busy === "install" ? "O'rnatilmoqda..." : "Yangilash va qayta ishga tushirish"}
          </button>
        ) : (
          <button
            type="button"
            className="rounded-md bg-amber-600 px-3 py-1 font-semibold text-white disabled:opacity-60"
            disabled={busy !== null}
            onClick={() => void run("download")}
          >
            {busy === "download"
              ? "Yuklanmoqda..."
              : info.partialBytes > 0
                ? "Yuklashni davom ettirish"
                : "Yuklab olish"}
          </button>
        )}
        {!info.mandatory && (
          <button
            type="button"
            className="rounded-md border border-amber-400 px-3 py-1"
            onClick={() => setHidden(true)}
          >
            Keyinroq
          </button>
        )}
      </div>
    </div>
  );
}

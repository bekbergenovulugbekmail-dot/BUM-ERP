/**
 * Android ilovasidagi yangilanish xabari.
 *
 * Ilova production saytini ochadi, shuning uchun web qismi deploy bilan darhol yangilanadi. Lekin
 * NATIV qism (ruxsatlar, GPS xizmati, klaviatura sozlamalari, ikonka) faqat yangi APK bilan keladi —
 * shuning uchun bu yerda oxirgi e'lon qilingan APK versiyasi tekshiriladi va foydalanuvchiga
 * "yuklab oling" deb aytiladi. Avtomatik o'rnatilmaydi: Android baribir foydalanuvchidan so'raydi.
 *
 * Brauzerda hech narsa ko'rsatilmaydi (faqat `Capacitor` ichida).
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { api } from "@/lib/api.ts";
import { hasNativePlugin, isNativeApp } from "@/lib/native/platform.ts";
import { compareVersions } from "@/lib/version.ts";

const DISMISSED_KEY = "bum:app-update-dismissed";
/** Ilova ochilganda va har 6 soatda bir tekshiriladi. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type Release = {
  version: string;
  notes: string | null;
  minVersion: string | null;
  size: number;
  downloadUrl: string;
};

/** Ilovaning joriy versiyasi (nativ qobiqdan). Brauzerda `null`. */
async function installedVersion(): Promise<string | null> {
  if (!hasNativePlugin("App")) return null;
  try {
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    return info.version || null;
  } catch {
    return null;
  }
}

export default function AppUpdateBanner() {
  const [release, setRelease] = useState<Release | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;

    const check = async () => {
      const version = await installedVersion();
      if (!version || cancelled) return;
      try {
        const { release: latest } = await api.get<{ release: Release | null }>("/api/public/app-release");
        if (cancelled || !latest) return;
        setCurrent(version);
        setRelease(compareVersions(version, latest.version) < 0 ? latest : null);
      } catch {
        // Internet yo'q yoki server javob bermadi — keyingi tekshiruvda qayta urinamiz
      }
    };

    void check();
    const timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!release || !current) return null;
  // Majburiy yangilanish: bu versiyadan eskisi bilan ishlashga ruxsat berilmagan — xabarni yopib bo'lmaydi
  const required = Boolean(release.minVersion && compareVersions(current, release.minVersion) < 0);
  const hidden = dismissed || (!required && localStorage.getItem(DISMISSED_KEY) === release.version);
  if (hidden) return null;

  const megabytes = (release.size / 1024 / 1024).toFixed(1);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        className="fixed inset-x-3 bottom-20 z-50 rounded-2xl border border-border bg-card p-4 shadow-lg wide:inset-x-auto wide:right-4 wide:bottom-4 wide:w-96"
        data-testid="app-update-banner"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Download className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              Ilovaning yangi versiyasi: {release.version}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Sizda {current} · {megabytes} MB
              {required ? " · yangilash majburiy" : ""}
            </p>
            {release.notes && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{release.notes}</p>}
            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => {
                  // Android yuklab oluvchisi ochiladi; fayl yuklangach o'rnatish o'zi taklif qilinadi
                  window.open(release.downloadUrl, "_blank");
                }}
              >
                <Download className="mr-1 h-4 w-4" /> Yuklab olish
              </Button>
              {!required && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    localStorage.setItem(DISMISSED_KEY, release.version);
                    setDismissed(true);
                  }}
                >
                  Keyinroq
                </Button>
              )}
            </div>
          </div>
          {!required && (
            <button
              type="button"
              aria-label="Yopish"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => {
                localStorage.setItem(DISMISSED_KEY, release.version);
                setDismissed(true);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

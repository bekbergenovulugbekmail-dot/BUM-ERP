/**
 * PWAInstallBanner — shows an install prompt for Chrome/Edge (beforeinstallprompt)
 * and instructions for iOS/Safari. Appears as a floating banner at the bottom.
 * Hides automatically when running inside the Hercules App Builder iframe.
 */
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Download, X, Share, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "erp_pwa_dismissed";

export default function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [visible, setVisible] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Never show inside the App Builder iframe
    if (window.self !== window.top) return;

    // Already dismissed?
    if (localStorage.getItem(DISMISSED_KEY)) return;

    // Already installed as PWA?
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setInstalled(true);
      return;
    }

    const isIOS =
      /iphone|ipad|ipod/i.test(navigator.userAgent) &&
      !(window.navigator as { standalone?: boolean }).standalone;

    if (isIOS) {
      // Show iOS guide after a short delay
      const t = setTimeout(() => setVisible(true), 3000);
      return () => clearTimeout(t);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setInstalled(true);
    }
    setVisible(false);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setVisible(false);
    localStorage.setItem(DISMISSED_KEY, "1");
  };

  const isIOS =
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !(window.navigator as { standalone?: boolean }).standalone;

  if (installed || !visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: "spring", damping: 22, stiffness: 280 }}
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4"
      >
        <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-4 py-3 bg-primary/5 border-b border-border flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-semibold flex-1">
              BUM ERP — Ilovani o'rnating
            </span>
            <button
              onClick={handleDismiss}
              className="p-1 rounded-lg hover:bg-muted transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>

          <div className="px-4 py-3">
            {isIOS ? (
              <div className="space-y-2.5">
                <p className="text-xs text-muted-foreground">
                  Bu ilovani qurilmangizga qo'shish uchun:
                </p>
                <div className="space-y-1.5">
                  {[
                    { step: "1", text: "Pastdagi", icon: <Share className="h-3.5 w-3.5 inline mx-0.5 text-primary" />, suffix: "tugmasini bosing" },
                    { step: "2", text: '"Bosh ekranga qo\'shish" ni tanlang' },
                    { step: "3", text: '"Qo\'shish" ni bosing' },
                  ].map((s) => (
                    <div key={s.step} className="flex items-center gap-2 text-xs">
                      <span className="h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shrink-0">
                        {s.step}
                      </span>
                      <span className="text-foreground">
                        {s.text} {s.icon} {s.suffix}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground leading-snug">
                  Tezroq ishlash va oflayn kirish uchun ilovani qurilmangizga o'rnating.
                </p>
                <Button size="sm" className="shrink-0" onClick={handleInstall}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  O'rnatish
                </Button>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

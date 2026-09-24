/**
 * "Yangi versiya chiqdi — yangilash" xabari. Brauzerda ham, Android ilovasida ham bir xil:
 * ikkalasi ham o'sha web build'ni ishlatadi, shuning uchun eskirib qolishi ham bir xil.
 *
 * APK xabaridan (`app-update-banner.tsx`) FARQI: u NATIV qobiqning yangi versiyasini (ruxsatlar,
 * GPS xizmati, ikonka) taklif qiladi va yuklab olishni so'raydi; bu esa shu yerda, bir bosishda
 * hal bo'ladigan web build'i haqida.
 */
import { AnimatePresence, motion } from "motion/react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { useBuildVersion } from "@/hooks/use-build-version.ts";

export default function NewBuildBanner() {
  const { stale, reload } = useBuildVersion();
  if (!stale) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        className="fixed inset-x-3 bottom-20 z-50 rounded-2xl border border-border bg-card p-4 shadow-lg wide:inset-x-auto wide:right-4 wide:bottom-4 wide:w-96"
        data-testid="new-build-banner"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <RefreshCw className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Dasturning yangi versiyasi tayyor</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Yangilanishlar ko'rinishi uchun qayta yuklang</p>
          </div>
          <Button size="sm" className="shrink-0" onClick={reload}>
            Yangilash
          </Button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

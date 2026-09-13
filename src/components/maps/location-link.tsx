/**
 * Nuqtani xaritada ko'rsatish: telefonda — navigator/xarita ilovasi (`geo:` / Apple Maps), kompyuterda — ilova ichidagi
 * xarita oynasi (boshqa saytga o'tkazilmaydi) va u yerdan Google Maps / Yandex yo'nalishi.
 */
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Navigation } from "lucide-react";
import MapView from "@/components/map-view.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { isMobileDevice, mapAppUrl } from "@/lib/maps/index.ts";
import { googleDirectionsUrls, yandexRouteUrl } from "@/lib/maps/navigation.ts";

type Props = {
  latitude: number | string;
  longitude: number | string;
  label: string;
  children: ReactNode;
  /** `button` — kichik shaffof tugma, `link` — matn havolasi. */
  appearance?: "button" | "link";
};

const LINK_CLASS = "inline-flex items-center gap-1 text-primary hover:underline";

export default function LocationLink({ latitude, longitude, label, children, appearance = "button" }: Props) {
  const { t } = useTranslation("map");
  const [open, setOpen] = useState(false);
  const point = { latitude: Number(latitude), longitude: Number(longitude) };

  if (isMobileDevice()) {
    const href = mapAppUrl(point.latitude, point.longitude, label);
    return appearance === "link" ? (
      <a className={LINK_CLASS} href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ) : (
      <Button asChild size="sm" variant="ghost">
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      </Button>
    );
  }

  return (
    <>
      {appearance === "link" ? (
        <button type="button" className={LINK_CLASS} onClick={() => setOpen(true)}>
          {children}
        </button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          {children}
        </Button>
      )}
      {open && (
        <Dialog open onOpenChange={(value) => !value && setOpen(false)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{label}</DialogTitle>
              <DialogDescription className="tabular-nums">
                {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}
              </DialogDescription>
            </DialogHeader>
            <MapView markers={[{ id: "point", ...point, label }]} className="h-[420px] w-full" />
            <DialogFooter className="flex-wrap gap-2">
              <Button asChild variant="secondary">
                <a href={googleDirectionsUrls(null, [point])[0]} target="_blank" rel="noreferrer">
                  <Navigation className="mr-1.5 h-4 w-4" /> {t("google")}
                </a>
              </Button>
              <Button asChild variant="secondary">
                <a href={yandexRouteUrl(null, [point])} target="_blank" rel="noreferrer">
                  <Navigation className="mr-1.5 h-4 w-4" /> {t("yandex")}
                </a>
              </Button>
              <Button onClick={() => setOpen(false)}>{t("close")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

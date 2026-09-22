/**
 * FAQAT KAMERA — rasmni ilova ichida olish oynasi.
 *
 * Nega kerak: `<input type="file" capture="environment">` faqat MASLAHAT. Android WebView (Capacitor)
 * va ayrim brauzerlarda u baribir fayl tanlagichni ochadi — agent galereyadan eski rasmni tanlab
 * yuborishi mumkin edi. Do'kon vitrinasi va polka rasmi esa AYNAN o'sha yerda olinishi kerak
 * (server rasm koordinatasini geofence bilan tekshiradi).
 *
 * Shuning uchun rasm `getUserMedia` orqali ilovaning o'zida olinadi: galereya varianti umuman yo'q.
 * Kamera ishga tushmasa — aniq xato ko'rsatiladi (jim galereyaga tushib ketmaydi).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, Check, Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";

type Props = {
  /** Oyna sarlavhasi — qaysi rasm olinayotgani ("Vitrina rasmi"). */
  title: string;
  /** Qo'shimcha izoh (masalan "Do'kon peshtaxtasi ko'rinsin"). */
  hint?: string;
  /** Olingan rasm — JPEG fayl. */
  onCapture: (file: File) => void | Promise<void>;
  onClose: () => void;
  /** Yuborish davom etayotganini ko'rsatish (tashqi mutatsiya). */
  busy?: boolean;
};

/** Rasmning uzun tomoni — server 3 MB gacha qabul qiladi, bu o'lcham ~400 KB beradi. */
const MAX_SIDE = 1600;
const QUALITY = 0.85;

type Status = "starting" | "live" | "review" | "error";

export default function CameraCapture({ title, hint, onCapture, onClose, busy = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);
  /** Old/orqa kamera — ba'zi qurilmalarda orqa kamera ishlamasa almashtirish kerak. */
  const [facing, setFacing] = useState<"environment" | "user">("environment");

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    stop();
    setStatus("starting");
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Bu qurilmada kamera mavjud emas.");
      setStatus("error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus("live");
    } catch (err) {
      const name = (err as Error).name;
      setError(
        name === "NotAllowedError"
          ? "Kameraga ruxsat berilmadi. Qurilma sozlamalarida ilovaga kamera ruxsatini bering."
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "Kamera topilmadi."
            : "Kamera ishga tushmadi. Qayta urinib ko'ring.",
      );
      setStatus("error");
    }
  }, [facing, stop]);

  useEffect(() => {
    // Tashqi tizim (kamera oqimi) bilan sinxronlash — effektning aynan vazifasi
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void start();
    return stop;
  }, [start, stop]);

  // Ko'rib chiqish uchun yaratilgan havola oqib ketmasin
  useEffect(() => () => {
    if (shot) URL.revokeObjectURL(shot.url);
  }, [shot]);

  /** Escape bilan yopish — Android "orqaga" tugmasi ochiq oynaga aynan shu tugmani yuboradi. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Kadrni olish: video → kanvas → JPEG fayl (uzun tomoni `MAX_SIDE` gacha kichraytiriladi). */
  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("Rasm olinmadi — qayta urinib ko'ring.");
          setStatus("error");
          return;
        }
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
        setShot({ file, url: URL.createObjectURL(file) });
        setStatus("review");
        stop();
      },
      "image/jpeg",
      QUALITY,
    );
  };

  const retake = () => {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
    void start();
  };

  const confirm = async () => {
    if (!shot) return;
    await onCapture(shot.file);
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex items-center justify-between gap-2 px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          {hint && <p className="truncate text-xs text-white/60">{hint}</p>}
        </div>
        <div className="flex items-center gap-1">
          {status === "live" && (
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/10"
              aria-label="Kamerani almashtirish"
              data-testid="camera-flip"
              onClick={() => setFacing((current) => (current === "environment" ? "user" : "environment"))}
            >
              <RotateCcw className="h-5 w-5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" aria-label="Yopish" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden bg-black">
        {/* Jonli ko'rinish — rasm shu yerdan olinadi */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          data-testid="camera-preview"
          className={status === "live" ? "h-full w-full object-cover" : "hidden"}
        />

        {status === "review" && shot && (
          <img src={shot.url} alt="Olingan rasm" data-testid="camera-shot" className="h-full w-full object-contain" />
        )}

        {status === "starting" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-white/70">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Kamera ishga tushmoqda...</p>
          </div>
        )}

        {status === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-white">
            <AlertTriangle className="h-10 w-10 text-amber-400" />
            <p className="text-sm" data-testid="camera-error">{error}</p>
            <Button variant="secondary" onClick={() => void start()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Qayta urinish
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-4 px-6 py-6">
        {status === "live" && (
          <button
            type="button"
            onClick={capture}
            aria-label="Rasmga olish"
            data-testid="camera-shutter"
            className="flex h-18 w-18 items-center justify-center rounded-full border-4 border-white/80 bg-white/10 transition-transform active:scale-95"
          >
            <Camera className="h-8 w-8 text-white" />
          </button>
        )}

        {status === "review" && (
          <>
            <Button variant="secondary" className="h-12 flex-1" onClick={retake} disabled={busy} data-testid="camera-retake">
              <RotateCcw className="mr-2 h-4 w-4" /> Qayta olish
            </Button>
            <Button className="h-12 flex-1" onClick={() => void confirm()} disabled={busy} data-testid="camera-confirm">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Yuborish
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

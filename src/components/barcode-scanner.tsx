/**
 * BarcodeScanner modal — uses native BarcodeDetector API (Chrome/Edge) or
 * a textarea fallback for manual entry and USB HID scanners.
 *
 * NOTE: Camera scanning via BarcodeDetector doesn't work inside iframes
 * (app builder preview iframe). It works fine in the published app.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Camera, Keyboard, RefreshCw, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { cn } from "@/lib/utils.ts";

type Props = {
  onScan: (barcode: string) => void;
  onClose: () => void;
  title?: string;
  hint?: string;
};

type Mode = "camera" | "manual";

// Check for BarcodeDetector API support
const isBarcodeDetectorSupported =
  typeof window !== "undefined" && "BarcodeDetector" in window;

type BarcodeDetectorType = {
  detect: (image: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
};

declare const BarcodeDetector: new (options: { formats: string[] }) => BarcodeDetectorType;

export default function BarcodeScanner({ onScan, onClose, title = "Barkod skanerlash", hint }: Props) {
  const [mode, setMode] = useState<Mode>(isBarcodeDetectorSupported ? "camera" : "manual");
  const [manualCode, setManualCode] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorType | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastScanTime = useRef(0);
  const manualRef = useRef<HTMLInputElement>(null);

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);

      // Init detector
      if (!detectorRef.current) {
        detectorRef.current = new BarcodeDetector({
          formats: [
            "ean_13", "ean_8", "code_128", "code_39", "code_93",
            "qr_code", "data_matrix", "upc_a", "upc_e",
          ],
        });
      }

      const scan = async () => {
        if (!videoRef.current || !detectorRef.current) return;
        try {
          const barcodes = await detectorRef.current.detect(videoRef.current);
          const now = Date.now();
          if (barcodes.length > 0 && now - lastScanTime.current > 1500) {
            lastScanTime.current = now;
            const val = barcodes[0].rawValue;
            setLastResult(val);
            onScan(val);
          }
        } catch {
          // detection failure is normal for frames without barcodes
        }
        rafRef.current = requestAnimationFrame(scan);
      };

      rafRef.current = requestAnimationFrame(scan);
    } catch (err) {
      const name = (err as Error).name;
      if (name === "NotAllowedError") setCameraError("Kamera ruxsati rad etildi. Brauzer sozlamalarida kamera ruxsatini bering.");
      else if (name === "NotFoundError") setCameraError("Qurilmada kamera topilmadi.");
      else setCameraError("Kamera ishga tushmadi. Qo'lda kiritish rejimini ishlating.");
      setMode("manual");
    }
  }, [onScan]);

  // Start camera when mode = camera
  useEffect(() => {
    if (mode === "camera") {
      startCamera();
    } else {
      stopCamera();
      setTimeout(() => manualRef.current?.focus(), 100);
    }
    return stopCamera;
  }, [mode, startCamera, stopCamera]);

  const handleManualSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const code = manualCode.trim();
    if (code.length >= 3) {
      setLastResult(code);
      onScan(code);
      setManualCode("");
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black"
          onClick={onClose}
        />
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: "spring", damping: 20, stiffness: 300 }}
          className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <ScanLine className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">{title}</span>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Mode tabs */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setMode("camera")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors cursor-pointer",
                mode === "camera"
                  ? "text-primary border-b-2 border-primary bg-primary/5"
                  : "text-muted-foreground hover:text-foreground"
              )}
              disabled={!isBarcodeDetectorSupported}
            >
              <Camera className="h-3.5 w-3.5" />
              Kamera
              {!isBarcodeDetectorSupported && (
                <span className="text-[10px] text-muted-foreground">(qo'llab-quvvatlanmaydi)</span>
              )}
            </button>
            <button
              onClick={() => setMode("manual")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors cursor-pointer",
                mode === "manual"
                  ? "text-primary border-b-2 border-primary bg-primary/5"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Keyboard className="h-3.5 w-3.5" />
              Qo'lda / HID skaner
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            {mode === "camera" ? (
              <div className="space-y-3">
                {/* Camera viewport */}
                <div className="relative aspect-[4/3] bg-black rounded-xl overflow-hidden">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  {/* Scan line animation */}
                  {scanning && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      {/* Corner guides */}
                      <div className="absolute top-8 left-8 w-8 h-8 border-t-2 border-l-2 border-primary rounded-tl" />
                      <div className="absolute top-8 right-8 w-8 h-8 border-t-2 border-r-2 border-primary rounded-tr" />
                      <div className="absolute bottom-8 left-8 w-8 h-8 border-b-2 border-l-2 border-primary rounded-bl" />
                      <div className="absolute bottom-8 right-8 w-8 h-8 border-b-2 border-r-2 border-primary rounded-br" />
                      {/* Animated scan line */}
                      <motion.div
                        className="absolute left-10 right-10 h-0.5 bg-primary/70"
                        animate={{ top: ["30%", "70%", "30%"] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      />
                    </div>
                  )}
                  {!scanning && !cameraError && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
                    </div>
                  )}
                  {cameraError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4 bg-black/80">
                      <Camera className="h-10 w-10 text-muted-foreground mb-2" />
                      <p className="text-sm text-white">{cameraError}</p>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="flex-1"
                    onClick={scanning ? stopCamera : startCamera}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />
                    {scanning ? "To'xtatish" : "Qayta urinish"}
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleManualSubmit} className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  USB/Bluetooth barkod skanerini ishlatib skanerlang yoki qo'lda raqam kiriting.
                  Skaner avtomatik ravishda Enter bosadi.
                </p>
                <div className="flex gap-2">
                  <Input
                    ref={manualRef}
                    className="flex-1 font-mono text-base h-11"
                    placeholder="0000000000000"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    autoFocus
                  />
                  <Button type="submit" disabled={manualCode.trim().length < 3}>
                    Yuborish
                  </Button>
                </div>
              </form>
            )}

            {/* Last result */}
            {lastResult && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 bg-primary/10 border border-primary/20 rounded-xl px-3 py-2.5"
              >
                <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                  <ScanLine className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Topildi</p>
                  <p className="font-mono font-bold text-sm">{lastResult}</p>
                </div>
              </motion.div>
            )}

            {hint && (
              <p className="text-xs text-muted-foreground text-center">{hint}</p>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

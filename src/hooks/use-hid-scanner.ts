/**
 * useHIDScanner — detects rapid keystroke sequences from USB/Bluetooth
 * barcode scanners. Scanners type characters very fast (< 50ms between keys)
 * and end with Enter. This hook accumulates them and fires onScan.
 */
import { useEffect, useRef, useCallback } from "react";

type Options = {
  onScan: (barcode: string) => void;
  /** Min characters for a valid scan */
  minLength?: number;
  /** Max ms between keystrokes to be considered part of a scan */
  maxKeyInterval?: number;
  /** Whether to capture even when an input is focused */
  captureInInput?: boolean;
};

export function useHIDScanner({
  onScan,
  minLength = 3,
  maxKeyInterval = 60,
  captureInInput = false,
}: Options) {
  const bufferRef = useRef<string>("");
  const lastKeyTime = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    const code = bufferRef.current.trim();
    bufferRef.current = "";
    if (code.length >= minLength) {
      onScan(code);
    }
  }, [onScan, minLength]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      // By default, ignore when typing in an input/textarea
      if (!captureInInput && (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")) {
        return;
      }

      const now = Date.now();
      const gap = now - lastKeyTime.current;
      lastKeyTime.current = now;

      // Enter terminates the scan
      if (e.key === "Enter") {
        if (timerRef.current) clearTimeout(timerRef.current);
        flush();
        return;
      }

      // If gap is too large, reset buffer
      if (bufferRef.current && gap > maxKeyInterval) {
        bufferRef.current = "";
      }

      // Only accumulate printable characters
      if (e.key.length === 1) {
        bufferRef.current += e.key;
      }

      // Auto-flush timeout in case scanner doesn't send Enter
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, maxKeyInterval + 50);
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [flush, maxKeyInterval, captureInInput]);
}

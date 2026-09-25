/**
 * Bekor qilish / qaytarish (Ctrl+Z / Ctrl+Y) — dizayner holati tarixi.
 *
 * Qoidalar:
 *  - sichqoncha bilan SURISH bitta qadam: harakat boshlanganda `checkpoint()`, harakat davomida
 *    `set(..., { record: false })` — har piksel tarixga yozilmaydi;
 *  - maydonga yozish ketma-ketligi (`key` bir xil, 1 soniya ichida) — bitta qadam;
 *  - tarix 100 qadam bilan cheklanadi.
 */
import { useCallback, useMemo, useRef, useState } from "react";

const LIMIT = 100;
const COALESCE_MS = 1000;

type State<T> = { present: T | null; past: T[]; future: T[] };

export function useHistory<T>() {
  const [state, setState] = useState<State<T>>({ present: null, past: [], future: [] });
  /** Oxirgi yozuv kaliti — ketma-ket yozishni bitta qadamga birlashtirish uchun. */
  const last = useRef<{ key: string; at: number } | null>(null);

  /** Tarixni tozalab yangi holat (shablon yuklanganda). */
  const reset = useCallback((value: T | null) => {
    last.current = null;
    setState({ present: value, past: [], future: [] });
  }, []);

  const set = useCallback((update: T | ((current: T) => T), options: { record?: boolean; key?: string } = {}) => {
    const record = options.record ?? true;
    const now = Date.now();
    const merge = record && options.key !== undefined && last.current?.key === options.key && now - last.current.at < COALESCE_MS;
    last.current = record && options.key !== undefined ? { key: options.key, at: now } : record ? null : last.current;
    setState((current) => {
      if (current.present === null) return current;
      const next = typeof update === "function" ? (update as (value: T) => T)(current.present) : update;
      if (next === current.present) return current;
      if (!record || merge) return { ...current, present: next, future: record ? [] : current.future };
      return { present: next, past: [...current.past.slice(-(LIMIT - 1)), current.present], future: [] };
    });
  }, []);

  /** Joriy holatni tarixga yozadi (sichqoncha bilan surish boshlanganda). */
  const checkpoint = useCallback(() => {
    last.current = null;
    setState((current) =>
      current.present === null ? current : { present: current.present, past: [...current.past.slice(-(LIMIT - 1)), current.present], future: [] },
    );
  }, []);

  const undo = useCallback(() => {
    last.current = null;
    setState((current) => {
      if (current.past.length === 0 || current.present === null) return current;
      const previous = current.past[current.past.length - 1]!;
      return { present: previous, past: current.past.slice(0, -1), future: [current.present, ...current.future] };
    });
  }, []);

  const redo = useCallback(() => {
    last.current = null;
    setState((current) => {
      if (current.future.length === 0 || current.present === null) return current;
      const [next, ...rest] = current.future;
      return { present: next!, past: [...current.past, current.present], future: rest };
    });
  }, []);

  // Barqaror obyekt: effektlar har chizishda qayta ishga tushmasin
  return useMemo(() => ({
    present: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    reset,
    set,
    checkpoint,
    undo,
    redo,
  }), [state, reset, set, checkpoint, undo, redo]);
}

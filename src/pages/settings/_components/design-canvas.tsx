/**
 * VIZUAL DIZAYNER — A4 varaq ustida elementlarni sichqoncha bilan surish va kattalashtirish.
 *
 * Koordinatalar MILLIMETRDA saqlanadi; piksel faqat chizishda (`px = mm × PX_PER_MM × zoom`).
 * Sichqoncha siljishi ham shu ko'paytmaga bo'linadi — shuning uchun 50% va 200% zoomda
 * element bir xil mm joyga tushadi va PDF dagi joy bilan mos keladi.
 *
 * Element ko'rinishi — HAQIQIY PDF rasmi (`useElementSprites`): bu yerda HTML bilan
 * "o'xshatilgan" nusxa chizilmaydi.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { pageSizeMm, type DocumentElement, type DocumentTemplateSchema } from "@bum/shared";
import { boxOf, isHorizontalLine, layoutShifts } from "@/lib/pdf/template-free.ts";
import { cn } from "@/lib/utils.ts";
import {
  HANDLES, PX_PER_MM, boundsOf, clampDelta, intersects, resizeRect, round, snapMove,
  type Guide, type Handle, type Rect,
} from "../_lib/canvas-geometry.ts";
import type { Sprite } from "../_lib/element-sprites.ts";
import { ELEMENT_LABELS } from "../_lib/document-designer.ts";

const RULER = 22;
const PAD = 28;

export type CanvasGrid = { show: boolean; snap: boolean; size: number; outlines: boolean };

type Props = {
  schema: DocumentTemplateSchema;
  /** Qatlam tartibida (pastdan yuqoriga). */
  elements: DocumentElement[];
  sprites: Map<string, Sprite>;
  selection: string[];
  zoom: number;
  grid: CanvasGrid;
  readOnly: boolean;
  onSelect: (ids: string[]) => void;
  /** Sichqoncha harakati boshlandi — tarixga bitta qadam yoziladi. */
  onBeginChange: () => void;
  /** Harakat davomida (tarixga yozilmaydi). */
  onLiveChange: (patches: Record<string, Partial<DocumentElement>>) => void;
  onZoom: (zoom: number) => void;
  onEditText: (id: string) => void;
};

type Interaction =
  | { kind: "move"; startX: number; startY: number; starts: Map<string, Rect>; moved: boolean; targets: { x: number[]; y: number[] } }
  | { kind: "resize"; id: string; handle: Handle; start: Rect; startX: number; startY: number; moved: boolean; lock: "always" | "default" | "shift"; min: { w: number; h: number } }
  | { kind: "marquee"; origin: { x: number; y: number }; additive: boolean; base: string[] };

const CURSORS: Record<Handle, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
};

/** Qaysi tutqichlar ko'rinadi: chiziqda faqat uchlari, qolganida sakkiztasi. */
function handlesFor(element: DocumentElement, box: Rect): Handle[] {
  if (element.type === "line") return isHorizontalLine(box) ? ["w", "e"] : ["n", "s"];
  return HANDLES;
}

/** Nisbat: QR har doim kvadrat; rasm — qulf yoqilgan bo'lsa; qolganlari — Shift bilan. */
function lockMode(element: DocumentElement): "always" | "default" | "shift" {
  if (element.type === "qr") return "always";
  if (element.type === "image") return element.lockRatio === false ? "shift" : "default";
  return "shift";
}

function minSize(element: DocumentElement): { w: number; h: number } {
  if (element.type === "itemsTable") return { w: 20, h: 8 };
  if (element.type === "line") return { w: 1, h: 1 };
  if (element.type === "qr" || element.type === "barcode") return { w: 8, h: 6 };
  return { w: 3, h: 2 };
}

/** Chizg'ich: har 1 mm (yaqinlashtirilganda), 5 mm va 10 mm (raqam bilan). */
function Ruler({ axis, length, px, highlight }: { axis: "x" | "y"; length: number; px: number; highlight: [number, number] | null }) {
  const size = length * px + PAD * 2;
  const labelStep = px * 10 >= 28 ? 10 : px * 10 >= 14 ? 20 : 50;
  const ticks: ReactNode[] = [];
  for (let mm = 0; mm <= length; mm += 1) {
    const major = mm % 10 === 0;
    const middle = mm % 5 === 0;
    if (!major && !middle && px < 3) continue;
    if (!major && px < 1.5) continue;
    const at = PAD + mm * px;
    const tick = major ? 10 : middle ? 6 : 3;
    ticks.push(
      axis === "x"
        ? <line key={mm} x1={at} x2={at} y1={RULER} y2={RULER - tick} stroke="currentColor" strokeWidth={0.6} />
        : <line key={mm} y1={at} y2={at} x1={RULER} x2={RULER - tick} stroke="currentColor" strokeWidth={0.6} />,
    );
    if (mm % labelStep === 0) {
      ticks.push(
        axis === "x"
          ? <text key={`t${mm}`} x={at + 2} y={9} fontSize={8.5} fill="currentColor">{mm}</text>
          : <text key={`t${mm}`} x={2} y={at - 2} fontSize={8.5} fill="currentColor" transform={`rotate(-90 9 ${at - 2})`}>{mm}</text>,
      );
    }
  }
  return (
    <svg width={axis === "x" ? size : RULER} height={axis === "x" ? RULER : size} className="block text-muted-foreground" aria-hidden>
      {highlight && (axis === "x"
        ? <rect x={PAD + highlight[0] * px} width={Math.max(1, (highlight[1] - highlight[0]) * px)} y={0} height={RULER} className="fill-primary/15" />
        : <rect y={PAD + highlight[0] * px} height={Math.max(1, (highlight[1] - highlight[0]) * px)} x={0} width={RULER} className="fill-primary/15" />)}
      {ticks}
    </svg>
  );
}

export default function DesignCanvas({
  schema, elements, sprites, selection, zoom, grid, readOnly,
  onSelect, onBeginChange, onLiveChange, onZoom, onEditText,
}: Props) {
  const page = pageSizeMm(schema.page);
  const px = PX_PER_MM * zoom;
  const pageRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<Interaction | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  // Jadval namunada qutisidan uzun bo'lsa ostidagilar suriladi — PDF dagi kabi
  const natural = useMemo(() => {
    const result: Record<string, number> = {};
    for (const element of elements) {
      const sprite = sprites.get(element.id);
      if (element.type === "itemsTable" && sprite) result[element.id] = sprite.natural;
    }
    return result;
  }, [elements, sprites]);
  const displayed = useMemo(() => {
    const shifts = layoutShifts(elements.map((element) => { const box = boxOf(element); return { id: element.id, y: box.y, h: box.h }; }), natural);
    return new Map(elements.map((element) => {
      const box = boxOf(element);
      const rect: Rect = {
        x: box.x,
        y: box.y + (shifts[element.id] ?? 0),
        w: box.w,
        h: element.type === "itemsTable" ? Math.max(box.h, natural[element.id] ?? 0) : box.h,
      };
      return [element.id, rect] as const;
    }));
  }, [elements, natural]);

  const selectedSet = new Set(selection);
  const selectedRects = elements.filter((element) => selectedSet.has(element.id)).map((element) => displayed.get(element.id)!);
  const selectionBounds = selectedRects.length > 0 ? boundsOf(selectedRects) : null;

  // Ctrl + g'ildirak — zoom (brauzer sahifani kattalashtirmasin)
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const next = Math.min(2, Math.max(0.25, Math.round((zoom - Math.sign(event.deltaY) * 0.1) * 100) / 100));
      if (next !== zoom) onZoom(next);
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, [zoom, onZoom]);

  /** Sichqoncha nuqtasi — sahifadagi mm. */
  const toMm = (clientX: number, clientY: number) => {
    const rect = pageRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left) / px, y: (clientY - rect.top) / px };
  };

  const listen = () => {
    const onMove = (event: PointerEvent) => {
      const current = interaction.current;
      if (!current) return;
      if (current.kind === "marquee") {
        const at = toMm(event.clientX, event.clientY);
        const rect = {
          x: Math.min(at.x, current.origin.x), y: Math.min(at.y, current.origin.y),
          w: Math.abs(at.x - current.origin.x), h: Math.abs(at.y - current.origin.y),
        };
        setMarquee(rect);
        const hit = elements.filter((element) => intersects(rect, displayed.get(element.id)!)).map((element) => element.id);
        onSelect(current.additive ? [...new Set([...current.base, ...hit])] : hit);
        return;
      }
      const dxPx = event.clientX - current.startX;
      const dyPx = event.clientY - current.startY;
      if (!current.moved) {
        // 3 px dan kichik harakat — oddiy bosish (tanlash), surish emas
        if (Math.hypot(dxPx, dyPx) < 3) return;
        current.moved = true;
        onBeginChange();
      }
      const snapOn = grid.snap && !event.altKey;
      if (current.kind === "move") {
        const group = boundsOf([...current.starts.values()]);
        let { dx, dy } = { dx: dxPx / px, dy: dyPx / px };
        if (snapOn) {
          const snapped = snapMove(group, dx, dy, current.targets, { threshold: 6 / px, grid: grid.size });
          ({ dx, dy } = snapped);
          setGuides(snapped.guides);
        } else {
          setGuides([]);
        }
        ({ dx, dy } = clampDelta(group, dx, dy, page));
        const patches: Record<string, Partial<DocumentElement>> = {};
        for (const [id, start] of current.starts) patches[id] = { x: round(start.x + dx), y: round(start.y + dy) };
        onLiveChange(patches);
        return;
      }
      const lock = current.lock === "always" || (current.lock === "default" ? !event.shiftKey : event.shiftKey);
      const next = resizeRect(current.start, current.handle, dxPx / px, dyPx / px, {
        lockRatio: lock, min: current.min, page, grid: snapOn ? grid.size : 0,
      });
      onLiveChange({ [current.id]: { x: next.x, y: next.y, width: next.w, height: next.h } });
    };
    const onUp = () => {
      interaction.current = null;
      setGuides([]);
      setMarquee(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  /** Yopishish nishonlari: sahifa chekkasi va o'rtasi, chekka chiziqlari, boshqa elementlar. */
  const snapTargets = (moving: Set<string>) => {
    const { margins } = schema.page;
    const x = [0, page.width / 2, page.width, margins.left, page.width - margins.right];
    const y = [0, page.height / 2, page.height, margins.top, page.height - margins.bottom];
    for (const element of elements) {
      if (moving.has(element.id)) continue;
      const rect = boxOf(element);
      x.push(rect.x, rect.x + rect.w / 2, rect.x + rect.w);
      y.push(rect.y, rect.y + rect.h / 2, rect.y + rect.h);
    }
    return { x, y };
  };

  const startMove = (event: ReactPointerEvent, element: DocumentElement) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    pageRef.current?.focus({ preventScroll: true });
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    let next = selection;
    if (additive) next = selectedSet.has(element.id) ? selection.filter((id) => id !== element.id) : [...selection, element.id];
    else if (!selectedSet.has(element.id)) next = [element.id];
    if (next !== selection) onSelect(next);
    if (readOnly || !next.includes(element.id)) return;
    const moving = new Set(next);
    interaction.current = {
      kind: "move",
      startX: event.clientX,
      startY: event.clientY,
      starts: new Map(elements.filter((item) => moving.has(item.id)).map((item) => [item.id, boxOf(item)])),
      moved: false,
      targets: snapTargets(moving),
    };
    listen();
  };

  const startResize = (event: ReactPointerEvent, element: DocumentElement, handle: Handle) => {
    if (event.button !== 0 || readOnly) return;
    event.stopPropagation();
    event.preventDefault();
    interaction.current = {
      kind: "resize", id: element.id, handle, start: boxOf(element),
      startX: event.clientX, startY: event.clientY, moved: false,
      lock: lockMode(element), min: minSize(element),
    };
    listen();
  };

  const startMarquee = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    pageRef.current?.focus({ preventScroll: true });
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    if (!additive) onSelect([]);
    if (!pageRef.current) return;
    interaction.current = { kind: "marquee", origin: toMm(event.clientX, event.clientY), additive, base: additive ? selection : [] };
    listen();
  };

  const single = selection.length === 1 ? elements.find((element) => element.id === selection[0]) : undefined;
  const { margins } = schema.page;

  return (
    <div
      ref={scrollerRef}
      data-testid="design-scroller"
      className="relative h-[72vh] overflow-auto rounded-lg border border-border bg-[#e4e6eb] dark:bg-zinc-800"
    >
      <div
        className="grid w-max"
        style={{ gridTemplateColumns: `${RULER}px ${page.width * px + PAD * 2}px`, gridTemplateRows: `${RULER}px ${page.height * px + PAD * 2}px` }}
      >
        <div data-ruler className="sticky left-0 top-0 z-30 border-b border-r border-border bg-background" />
        <div data-ruler className="sticky top-0 z-20 border-b border-border bg-background">
          <Ruler axis="x" length={page.width} px={px} highlight={selectionBounds ? [selectionBounds.x, selectionBounds.x + selectionBounds.w] : null} />
        </div>
        <div data-ruler className="sticky left-0 z-20 border-r border-border bg-background">
          <Ruler axis="y" length={page.height} px={px} highlight={selectionBounds ? [selectionBounds.y, selectionBounds.y + selectionBounds.h] : null} />
        </div>
        <div style={{ padding: PAD }} onPointerDown={startMarquee}>
          <div
            ref={pageRef}
            tabIndex={-1}
            data-testid="design-page"
            data-px-per-mm={px}
            className="relative select-none bg-white shadow-[0_2px_12px_rgba(0,0,0,0.18)] outline-none"
            style={{ width: page.width * px, height: page.height * px }}
            onPointerMove={(event) => { if (pageRef.current) setPointer(toMm(event.clientX, event.clientY)); }}
            onPointerLeave={() => setPointer(null)}
          >
            {/* Katak — faqat dizaynerda, PDF ga tushmaydi */}
            {grid.show && (
              <div
                data-editor-overlay
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage: "linear-gradient(to right, rgba(59,130,246,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(59,130,246,0.12) 1px, transparent 1px)",
                  backgroundSize: `${grid.size * px}px ${grid.size * px}px`,
                }}
              />
            )}
            {/* Sahifa chekkalari va A4 yarmi (ikki nakladnoy bitta varaqda) */}
            <div
              data-editor-overlay
              className="pointer-events-none absolute border border-dashed border-sky-400/40"
              style={{ left: margins.left * px, top: margins.top * px, right: margins.right * px, bottom: margins.bottom * px }}
            />
            <div data-editor-overlay className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-amber-500/40" style={{ top: (page.height / 2) * px }}>
              <span className="absolute right-1 top-0.5 text-[9px] text-amber-600/70">A4 yarmi</span>
            </div>

            {elements.map((element, order) => {
              const rect = displayed.get(element.id)!;
              const sprite = sprites.get(element.id);
              const selected = selectedSet.has(element.id);
              const box = boxOf(element);
              const sx = sprite ? box.w / sprite.boxW : 1;
              const sy = sprite ? box.h / sprite.boxH : 1;
              return (
                <div
                  key={element.id}
                  data-testid="canvas-element"
                  data-id={element.id}
                  data-type={element.type}
                  data-selected={selected ? "true" : undefined}
                  aria-label={`${ELEMENT_LABELS[element.type]}${element.label ? `: ${element.label}` : ""}`}
                  className={cn(
                    "group absolute",
                    readOnly ? "cursor-default" : "cursor-move",
                    grid.outlines && !selected && "outline outline-1 -outline-offset-1 outline-dashed outline-slate-300/70",
                    !selected && "hover:outline hover:outline-1 hover:outline-sky-500",
                  )}
                  style={{ left: rect.x * px, top: rect.y * px, width: rect.w * px, height: rect.h * px, zIndex: order + 1 }}
                  onPointerDown={(event) => startMove(event, element)}
                  onDoubleClick={() => onEditText(element.id)}
                >
                  {sprite ? (
                    <img
                      src={sprite.url}
                      alt=""
                      draggable={false}
                      className="pointer-events-none absolute max-w-none"
                      style={{
                        left: -sprite.bleed * px * sx,
                        top: -sprite.bleed * px * sy,
                        width: sprite.widthMm * px * sx,
                        height: sprite.heightMm * px * sy,
                      }}
                    />
                  ) : (
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden text-[9px] text-slate-400">
                      {ELEMENT_LABELS[element.type]}
                    </span>
                  )}
                </div>
              );
            })}

            {/* Tanlov ramkasi va tutqichlar — elementlardan yuqorida */}
            {elements.filter((element) => selectedSet.has(element.id)).map((element) => {
              const rect = displayed.get(element.id)!;
              return (
                <div
                  key={`sel-${element.id}`}
                  data-testid="selection-box"
                  className="pointer-events-none absolute outline outline-2 outline-primary"
                  style={{ left: rect.x * px, top: rect.y * px, width: rect.w * px, height: rect.h * px, zIndex: 10_000 }}
                >
                  {single?.id === element.id && !readOnly && handlesFor(element, rect).map((handle) => (
                    <span
                      key={handle}
                      data-testid={`handle-${handle}`}
                      className="pointer-events-auto absolute h-[9px] w-[9px] rounded-[2px] border-[1.5px] border-primary bg-white"
                      style={{
                        cursor: CURSORS[handle],
                        left: handle.includes("w") ? -5 : handle.includes("e") ? "calc(100% - 4px)" : "calc(50% - 4.5px)",
                        top: handle.startsWith("n") ? -5 : handle.startsWith("s") ? "calc(100% - 4px)" : "calc(50% - 4.5px)",
                      }}
                      onPointerDown={(event) => startResize(event, element, handle)}
                    />
                  ))}
                </div>
              );
            })}

            {guides.map((guide, index) => (
              <div
                key={index}
                className="pointer-events-none absolute bg-fuchsia-500"
                style={guide.axis === "x"
                  ? { left: guide.at * px, top: 0, width: 1, height: "100%", zIndex: 10_001 }
                  : { top: guide.at * px, left: 0, height: 1, width: "100%", zIndex: 10_001 }}
              />
            ))}
            {marquee && (
              <div
                className="pointer-events-none absolute border border-sky-500 bg-sky-500/10"
                style={{ left: marquee.x * px, top: marquee.y * px, width: marquee.w * px, height: marquee.h * px, zIndex: 10_002 }}
              />
            )}
          </div>
        </div>
      </div>
      {pointer && (
        <div className="pointer-events-none sticky bottom-1 left-full mr-1 w-max rounded bg-background/90 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground shadow" data-testid="pointer-mm">
          {pointer.x.toFixed(1)} × {pointer.y.toFixed(1)} mm
        </div>
      )}
    </div>
  );
}

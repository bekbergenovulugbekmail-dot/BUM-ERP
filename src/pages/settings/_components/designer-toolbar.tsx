/**
 * Dizayner asboblar paneli: element qo'shish, bekor qilish/qaytarish, tekislash, qatlam,
 * zoom va katak. Hamma tugma sichqoncha bilan ishlashga QO'SHIMCHA — asosiy usul varaqda
 * surish va burchakdan tortish.
 */
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, ArrowDownToLine, ArrowUpToLine,
  Barcode, Bold, BringToFront, ChevronDown, CopyPlus, Grid3x3, Hash, Image, Italic, Magnet, Minus, Plus, QrCode,
  Redo2, RectangleHorizontal, Scan, SendToBack, Signature, Sigma, Table, Trash2, Type, Undo2, Variable,
} from "lucide-react";
import type { ReactNode } from "react";
import type { DocumentElement, ElementType } from "@bum/shared";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { cn } from "@/lib/utils.ts";
import { GRID_SIZES, ZOOM_LEVELS, type AlignMode, type LayerOp } from "../_lib/canvas-geometry.ts";
import { GROUP_LABELS, type FieldCatalog } from "../_lib/document-designer.ts";
import type { CanvasGrid } from "./design-canvas.tsx";

export type InsertKind = ElementType | "vline";

function Tool({
  label, onClick, disabled, active, children, testId,
}: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode; testId?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-testid={testId}
          disabled={disabled}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-foreground/80 transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-35",
            active && "bg-primary/10 text-primary",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const Divider = () => <span className="mx-1 h-6 w-px bg-border" />;

const INSERTS: { kind: InsertKind; label: string; icon: ReactNode }[] = [
  { kind: "text", label: "Matn", icon: <Type className="h-4 w-4" /> },
  { kind: "image", label: "Rasm / logotip", icon: <Image className="h-4 w-4" /> },
  { kind: "qr", label: "QR kod", icon: <QrCode className="h-4 w-4" /> },
  { kind: "barcode", label: "Shtrix-kod", icon: <Barcode className="h-4 w-4" /> },
  { kind: "itemsTable", label: "Mahsulot jadvali", icon: <Table className="h-4 w-4" /> },
  { kind: "totals", label: "Jami bloki", icon: <Sigma className="h-4 w-4" /> },
  { kind: "signatures", label: "Imzo bloki", icon: <Signature className="h-4 w-4" /> },
  { kind: "rect", label: "To'rtburchak", icon: <RectangleHorizontal className="h-4 w-4" /> },
  { kind: "line", label: "Gorizontal chiziq", icon: <Minus className="h-4 w-4" /> },
  { kind: "vline", label: "Vertikal chiziq", icon: <Minus className="h-4 w-4 rotate-90" /> },
  { kind: "pageNumber", label: "Sahifa raqami", icon: <Hash className="h-4 w-4" /> },
];

export default function DesignerToolbar({
  catalog, readOnly, selection, textElement, canUndo, canRedo, zoom, grid,
  onInsert, onInsertField, onUndo, onRedo, onDuplicate, onDelete, onAlign, onDistribute, onLayer,
  onZoom, onGrid, onStyle,
}: {
  catalog: FieldCatalog | undefined;
  readOnly: boolean;
  selection: string[];
  /** Tanlangan yagona matn elementi — shrift boshqaruvi uchun. */
  textElement: DocumentElement | null;
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  grid: CanvasGrid;
  onInsert: (kind: InsertKind) => void;
  onInsertField: (path: string, label: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: "horizontal" | "vertical") => void;
  onLayer: (op: LayerOp) => void;
  onZoom: (zoom: number) => void;
  onGrid: (grid: CanvasGrid) => void;
  onStyle: (style: NonNullable<DocumentElement["style"]>) => void;
}) {
  const any = selection.length > 0;
  const many = selection.length > 1;
  const groups = new Map<string, FieldCatalog["fields"]>();
  for (const field of catalog?.fields ?? []) groups.set(field.group, [...(groups.get(field.group) ?? []), field]);
  const fontSize = textElement?.style?.fontSize ?? (textElement?.type === "text" ? 10 : 9);

  return (
    <div className="space-y-1.5 rounded-xl border border-border bg-background p-1.5" data-testid="designer-toolbar">
      <div className="flex flex-wrap items-center gap-0.5">
        {!readOnly && (
          <>
            {INSERTS.slice(0, 1).map((item) => (
              <Tool key={item.kind} label={`${item.label} qo'shish`} testId={`add-${item.kind}`} onClick={() => onInsert(item.kind)}>
                {item.icon}
              </Tool>
            ))}
            {/* Dinamik maydon: {{customer.name}} va boshqalar — ro'yxatdan bitta bosishda */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" data-testid="add-field"
                  className="inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-xs text-foreground/80 hover:bg-accent">
                  <Variable className="h-4 w-4" /> Maydon <ChevronDown className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-[60vh] w-64 overflow-y-auto">
                {[...groups.entries()].map(([group, fields], index) => (
                  <div key={group}>
                    {index > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel className="text-[10px] text-muted-foreground">{GROUP_LABELS[group] ?? group}</DropdownMenuLabel>
                    {fields.map((field) => (
                      <DropdownMenuItem key={field.path} data-testid={`add-field-${field.path}`}
                        onSelect={() => onInsertField(field.path, field.label)}>
                        <span className="flex-1">{field.label}</span>
                        <code className="text-[9px] text-muted-foreground">{`{{${field.path}}}`}</code>
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {INSERTS.slice(1).map((item) => (
              <Tool key={item.kind} label={`${item.label} qo'shish`} testId={`add-${item.kind}`} onClick={() => onInsert(item.kind)}>
                {item.icon}
              </Tool>
            ))}
            <Divider />
            <Tool label="Bekor qilish (Ctrl+Z)" testId="undo" disabled={!canUndo} onClick={onUndo}><Undo2 className="h-4 w-4" /></Tool>
            <Tool label="Qayta bajarish (Ctrl+Y)" testId="redo" disabled={!canRedo} onClick={onRedo}><Redo2 className="h-4 w-4" /></Tool>
            <Divider />
            <Tool label="Nusxalash (Ctrl+D)" testId="duplicate" disabled={!any} onClick={onDuplicate}><CopyPlus className="h-4 w-4" /></Tool>
            <Tool label="O'chirish (Delete)" testId="delete" disabled={!any} onClick={onDelete}><Trash2 className="h-4 w-4 text-destructive" /></Tool>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-0.5">
        {!readOnly && (
          <>
            <Tool label={many ? "Chapga tekislash" : "Sahifada chapga"} testId="align-left" disabled={!any} onClick={() => onAlign("left")}><AlignStartVertical className="h-4 w-4" /></Tool>
            <Tool label={many ? "Markazga (gorizontal)" : "Sahifa markaziga (gorizontal)"} testId="align-center" disabled={!any} onClick={() => onAlign("center")}><AlignCenterVertical className="h-4 w-4" /></Tool>
            <Tool label={many ? "O'ngga tekislash" : "Sahifada o'ngga"} testId="align-right" disabled={!any} onClick={() => onAlign("right")}><AlignEndVertical className="h-4 w-4" /></Tool>
            <Tool label={many ? "Tepaga tekislash" : "Sahifa tepasiga"} testId="align-top" disabled={!any} onClick={() => onAlign("top")}><AlignStartHorizontal className="h-4 w-4" /></Tool>
            <Tool label={many ? "O'rtaga (vertikal)" : "Sahifa o'rtasiga (vertikal)"} testId="align-middle" disabled={!any} onClick={() => onAlign("middle")}><AlignCenterHorizontal className="h-4 w-4" /></Tool>
            <Tool label={many ? "Pastga tekislash" : "Sahifa pastiga"} testId="align-bottom" disabled={!any} onClick={() => onAlign("bottom")}><AlignEndHorizontal className="h-4 w-4" /></Tool>
            <Tool label="Gorizontal teng taqsimlash (3+)" testId="distribute-h" disabled={selection.length < 3} onClick={() => onDistribute("horizontal")}><AlignHorizontalDistributeCenter className="h-4 w-4" /></Tool>
            <Tool label="Vertikal teng taqsimlash (3+)" testId="distribute-v" disabled={selection.length < 3} onClick={() => onDistribute("vertical")}><AlignVerticalDistributeCenter className="h-4 w-4" /></Tool>
            <Divider />
            <Tool label="Eng yuqoriga (oldinga)" testId="layer-front" disabled={!any} onClick={() => onLayer("front")}><BringToFront className="h-4 w-4" /></Tool>
            <Tool label="Bir qatlam yuqoriga" testId="layer-forward" disabled={!any} onClick={() => onLayer("forward")}><ArrowUpToLine className="h-4 w-4" /></Tool>
            <Tool label="Bir qatlam pastga" testId="layer-backward" disabled={!any} onClick={() => onLayer("backward")}><ArrowDownToLine className="h-4 w-4" /></Tool>
            <Tool label="Eng pastga (orqaga)" testId="layer-back" disabled={!any} onClick={() => onLayer("back")}><SendToBack className="h-4 w-4" /></Tool>
            {textElement && (
              <>
                <Divider />
                {/* Shrift — quti o'lchamidan ALOHIDA: qutini cho'zish harfni kattalashtirmaydi */}
                <Tool label="Shriftni kichraytirish" testId="font-smaller" onClick={() => onStyle({ ...textElement.style, fontSize: Math.max(5, fontSize - 1) })}>
                  <span className="text-[11px] font-semibold">A−</span>
                </Tool>
                <Input
                  type="number" min={5} max={48} step={0.5} aria-label="Shrift o'lchami (pt)" data-testid="toolbar-font-size"
                  className="h-8 w-14 px-1.5 text-xs"
                  value={fontSize}
                  onChange={(event) => {
                    const value = event.target.valueAsNumber;
                    if (Number.isFinite(value)) onStyle({ ...textElement.style, fontSize: Math.min(48, Math.max(5, value)) });
                  }}
                />
                <Tool label="Shriftni kattalashtirish" testId="font-larger" onClick={() => onStyle({ ...textElement.style, fontSize: Math.min(48, fontSize + 1) })}>
                  <span className="text-[13px] font-semibold">A+</span>
                </Tool>
                <Tool label="Qalin" testId="font-bold" active={textElement.style?.bold === true}
                  onClick={() => onStyle({ ...textElement.style, bold: !textElement.style?.bold })}><Bold className="h-4 w-4" /></Tool>
                <Tool label="Qiya" testId="font-italic" active={textElement.style?.italic === true}
                  onClick={() => onStyle({ ...textElement.style, italic: !textElement.style?.italic })}><Italic className="h-4 w-4" /></Tool>
              </>
            )}
            <Divider />
          </>
        )}
        <Tool label="Kichraytirish" testId="zoom-out" disabled={zoom <= ZOOM_LEVELS[0]}
          onClick={() => onZoom([...ZOOM_LEVELS].reverse().find((level) => level < zoom - 0.001) ?? ZOOM_LEVELS[0])}><Minus className="h-4 w-4" /></Tool>
        <Select value={String(zoom)} onValueChange={(value) => onZoom(Number(value))}>
          <SelectTrigger className="h-8 w-[84px] text-xs" data-testid="zoom-select" aria-label="Zoom"><SelectValue>{Math.round(zoom * 100)}%</SelectValue></SelectTrigger>
          <SelectContent>
            {ZOOM_LEVELS.map((level) => <SelectItem key={level} value={String(level)}>{Math.round(level * 100)}%</SelectItem>)}
          </SelectContent>
        </Select>
        <Tool label="Kattalashtirish" testId="zoom-in" disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
          onClick={() => onZoom(ZOOM_LEVELS.find((level) => level > zoom + 0.001) ?? 2)}><Plus className="h-4 w-4" /></Tool>
        <Divider />
        <Tool label="Katakni ko'rsatish" testId="grid-toggle" active={grid.show} onClick={() => onGrid({ ...grid, show: !grid.show })}><Grid3x3 className="h-4 w-4" /></Tool>
        <Tool label="Yopishish (katak va boshqa elementlarga). Alt — vaqtincha o'chadi" testId="snap-toggle" active={grid.snap}
          onClick={() => onGrid({ ...grid, snap: !grid.snap })}><Magnet className="h-4 w-4" /></Tool>
        <Select value={String(grid.size)} onValueChange={(value) => onGrid({ ...grid, size: Number(value) })}>
          <SelectTrigger className="h-8 w-[82px] text-xs" data-testid="grid-size" aria-label="Katak o'lchami"><SelectValue>{grid.size} mm</SelectValue></SelectTrigger>
          <SelectContent>
            {GRID_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size} mm</SelectItem>)}
          </SelectContent>
        </Select>
        <Tool label="Element chegaralarini ko'rsatish" testId="outline-toggle" active={grid.outlines}
          onClick={() => onGrid({ ...grid, outlines: !grid.outlines })}><Scan className="h-4 w-4" /></Tool>
      </div>
    </div>
  );
}


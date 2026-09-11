/**
 * BarcodeLabelPrint — generates printable product labels
 * with QR code and EAN-style barcode using jsbarcode + qrcode.
 * Opens a print-optimised page in a new tab.
 */
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { X, Printer, Download, Plus, Minus, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { cn } from "@/lib/utils.ts";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";

type Product = {
  _id: string;
  name: string;
  sku: string;
  barcode?: string;
  salesPrice: number;
};

type Props = {
  product: Product;
  onClose: () => void;
};

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n)) + " so'm";

export default function BarcodeLabelPrint({ product, onClose }: Props) {
  const [qty, setQty] = useState(1);
  const [showPrice, setShowPrice] = useState(true);
  const [labelType, setLabelType] = useState<"barcode" | "qr" | "both">("both");
  const barcodeCanvasRef = useRef<HTMLCanvasElement>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const [barcodeDataUrl, setBarcodeDataUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const code = product.barcode ?? product.sku;

  // Render barcode
  useEffect(() => {
    if (barcodeCanvasRef.current && (labelType === "barcode" || labelType === "both")) {
      try {
        JsBarcode(barcodeCanvasRef.current, code, {
          format: "CODE128",
          width: 2,
          height: 50,
          displayValue: true,
          fontSize: 11,
          margin: 8,
          background: "#ffffff",
          lineColor: "#000000",
        });
        setBarcodeDataUrl(barcodeCanvasRef.current.toDataURL("image/png"));
      } catch {
        setBarcodeDataUrl(null);
      }
    }
  }, [code, labelType]);

  // Render QR
  useEffect(() => {
    if (labelType === "qr" || labelType === "both") {
      QRCode.toDataURL(code, {
        width: 120,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      })
        .then((url) => setQrDataUrl(url))
        .catch(() => setQrDataUrl(null));
    }
  }, [code, labelType]);

  const handlePrint = () => {
    const labels = Array.from({ length: qty }, (_, i) => i);
    const labelHtml = labels.map(() => `
      <div class="label">
        <p class="name">${product.name}</p>
        <p class="sku">${product.sku}</p>
        ${(labelType === "qr" || labelType === "both") && qrDataUrl
          ? `<img class="qr" src="${qrDataUrl}" alt="QR" />`
          : ""
        }
        ${(labelType === "barcode" || labelType === "both") && barcodeDataUrl
          ? `<img class="barcode" src="${barcodeDataUrl}" alt="Barcode" />`
          : ""
        }
        ${showPrice ? `<p class="price">${fmt(product.salesPrice)}</p>` : ""}
      </div>
    `).join("");

    const win = window.open("", "_blank", "width=800,height=600");
    if (!win) { window.alert("Pop-up bloklangan. Brauzer sozlamalarida ruxsat bering."); return; }

    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <title>Mahsulot yorliqlari — ${product.name}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; }
          .labels { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px; }
          .label {
            width: 200px;
            border: 1px solid #ccc;
            border-radius: 6px;
            padding: 8px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            page-break-inside: avoid;
            background: #fff;
          }
          .name { font-size: 11px; font-weight: 600; text-align: center; max-width: 180px; word-break: break-word; }
          .sku { font-size: 9px; color: #666; font-family: monospace; }
          .barcode { max-width: 180px; height: auto; }
          .qr { width: 80px; height: 80px; }
          .price { font-size: 14px; font-weight: 700; color: #333; margin-top: 2px; }
          @media print {
            @page { margin: 8mm; }
            body { margin: 0; }
          }
        </style>
      </head>
      <body>
        <div class="labels">${labelHtml}</div>
        <script>window.onload = () => window.print();</${"script"}>
      </body>
      </html>
    `);
    win.document.close();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 20, stiffness: 300 }}
        className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <QrCode className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Yorliq chop etish</span>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-4 space-y-4">
          {/* Product info */}
          <div className="bg-muted/40 rounded-xl px-3 py-2.5">
            <p className="font-semibold text-sm truncate">{product.name}</p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{product.sku}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Kod: {code}</p>
          </div>

          {/* Label type */}
          <div>
            <Label className="text-xs mb-2 block">Yorliq turi</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["barcode", "qr", "both"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setLabelType(t)}
                  className={cn(
                    "text-xs px-2 py-1.5 rounded-lg border transition-colors cursor-pointer",
                    labelType === t
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-border hover:bg-accent"
                  )}
                >
                  {t === "barcode" ? "Barkod" : t === "qr" ? "QR kod" : "Ikkalasi"}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="bg-white rounded-xl border border-border p-4 flex flex-col items-center gap-2 min-h-[120px]">
            <p className="font-semibold text-xs text-black text-center">{product.name}</p>
            <p className="text-[10px] text-gray-500 font-mono">{product.sku}</p>
            <div className="flex gap-3 items-center justify-center flex-wrap">
              {(labelType === "qr" || labelType === "both") && qrDataUrl && (
                <img src={qrDataUrl} alt="QR" className="w-16 h-16" />
              )}
              {(labelType === "barcode" || labelType === "both") && (
                <canvas ref={barcodeCanvasRef} className="max-w-[150px] h-auto" />
              )}
            </div>
            {showPrice && (
              <p className="font-bold text-sm text-black">{fmt(product.salesPrice)}</p>
            )}
          </div>

          {/* Options */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Nusxa soni</Label>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="icon" className="h-8 w-8 shrink-0"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}>
                  <Minus className="h-3 w-3" />
                </Button>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  className="h-8 text-center text-sm"
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                />
                <Button variant="secondary" size="icon" className="h-8 w-8 shrink-0"
                  onClick={() => setQty((q) => Math.min(100, q + 1))}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPrice}
                  onChange={(e) => setShowPrice(e.target.checked)}
                  className="rounded"
                />
                <span className="text-xs">Narxni ko'rsatish</span>
              </label>
            </div>
          </div>

          <Button className="w-full" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            {qty} ta yorliq chop etish
          </Button>
        </div>

        {/* Hidden canvas for QR (not actually rendered in DOM if both) */}
        <canvas ref={qrCanvasRef} className="hidden" />
      </motion.div>
    </motion.div>
  );
}

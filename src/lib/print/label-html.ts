/**
 * Mahsulot etiketkalari — HTML satr: termal rulon (har etiketka alohida sahifa) yoki A4 varaq (ustunlar).
 * Shtrix-kod — JsBarcode (CODE128) SVG, QR — `qrcode` matritsasidan SVG: chop etishda aniq chiziqlar.
 * Sozlamalardagi ko'rinish va chop etish bir manbadan.
 */
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import type { LabelTemplate } from "@bum/shared";

export type LabelProduct = { id: string; name: string; sku: string; barcode: string | null; salesPrice: number };
export type LabelItem = { product: LabelProduct; quantity: number };

const FONT_PX: Record<LabelTemplate["fontSize"], { name: number; price: number; small: number }> = {
  sm: { name: 8.5, price: 12, small: 7 },
  md: { name: 10, price: 15, small: 8 },
  lg: { name: 12, price: 19, small: 9 },
};

const MM_TO_PX = 96 / 25.4;

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
const money = (n: number) => `${new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 2 }).format(n)} so'm`;

/** Etiketkadagi kod: shtrix-kod, bo'lmasa SKU. */
export const labelCode = (product: LabelProduct) => product.barcode?.trim() || product.sku;

export function toLabelProduct(
  product: {
    id: string;
    name: string;
    sku: string;
    barcode?: string | null;
    salesPrice: string | number;
    salesCurrency?: string | null;
  },
  /** Narxi boshqa valyutada bo'lsa — etiketkada asosiy valyutada (kassadagi narx). */
  toBase?: (amount: string | number, currency: string | null | undefined) => number,
): LabelProduct {
  const price = toBase ? toBase(product.salesPrice, product.salesCurrency) : Number(product.salesPrice);
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode ?? null,
    salesPrice: Number.isFinite(price) ? price : 0,
  };
}

export const SAMPLE_LABEL_PRODUCT: LabelProduct = {
  id: "sample",
  name: "Coca-Cola 1.5 l",
  sku: "1001",
  barcode: "4780001234567",
  salesPrice: 14_000,
};

function barcodeSvg(code: string): string | null {
  try {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svg, code, {
      format: "CODE128",
      width: 2,
      height: 60,
      margin: 0,
      displayValue: false,
      background: "#ffffff",
      lineColor: "#000000",
    });
    // Etiketka o'lchamiga cho'ziladi — chiziqlar nisbati saqlanadi
    svg.setAttribute("preserveAspectRatio", "none");
    return svg.outerHTML;
  } catch {
    // CODE128 lotin bo'lmagan belgilarni qabul qilmaydi — kod matn bilan chiqadi
    return null;
  }
}

function qrSvg(code: string): string | null {
  try {
    const qr = QRCode.create(code, { errorCorrectionLevel: "M" });
    const size = qr.modules.size;
    let path = "";
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (qr.modules.get(row, col)) path += `M${col} ${row}h1v1h-1z`;
      }
    }
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${size + 2} ${size + 2}" shape-rendering="crispEdges">` +
      `<path d="${path}" fill="#000"/></svg>`
    );
  } catch {
    return null;
  }
}

function labelHtml(product: LabelProduct, t: LabelTemplate, companyName: string) {
  const code = labelCode(product);
  const svg = t.codeType === "barcode" ? barcodeSvg(code) : t.codeType === "qr" ? qrSvg(code) : null;

  const info: string[] = [];
  if (t.showCompanyName && companyName) info.push(`<div class="company">${escapeHtml(companyName)}</div>`);
  if (t.showName) info.push(`<div class="name">${escapeHtml(product.name)}</div>`);
  if (t.showPrice) info.push(`<div class="price">${escapeHtml(money(product.salesPrice))}</div>`);

  const codeText = t.codeType !== "none" && t.showCodeText ? `<div class="small">${escapeHtml(code)}</div>` : "";
  const skuText = t.showSku && !(codeText && code === product.sku) ? `<div class="small">SKU ${escapeHtml(product.sku)}</div>` : "";
  const codeBlock =
    t.codeType === "none" ? "" : `<div class="code">${svg ?? `<span class="code-fallback">${escapeHtml(code)}</span>`}</div>`;

  // QR — chapda kvadrat, matn o'ngda; shtrix-kod — pastda to'liq kenglikda
  if (t.codeType === "qr") {
    return `<div class="label row-layout">${codeBlock}<div class="info">${info.join("")}${codeText}${skuText}</div></div>`;
  }
  return `<div class="label">${info.join("")}${codeBlock}${codeText}${skuText}</div>`;
}

function previewZoom(t: LabelTemplate, widthPx: number) {
  const contentMm = t.layout === "a4" ? t.columns * t.widthMm + (t.columns - 1) * t.gapMm : t.widthMm;
  const zoom = (widthPx - 24) / (contentMm * MM_TO_PX);
  return Math.max(0.3, Math.min(3, zoom)).toFixed(2);
}

function labelsCss(t: LabelTemplate, previewWidthPx?: number) {
  const f = FONT_PX[t.fontSize];
  const roll = t.layout === "roll";
  return `
@page { ${roll ? `size: ${t.widthMm}mm ${t.heightMm}mm; margin: 0;` : "size: A4; margin: 8mm;"} }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; }
body { font-family: Arial, "Helvetica Neue", sans-serif; color: #000;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { ${roll ? "" : `display: grid; grid-template-columns: repeat(${t.columns}, ${t.widthMm}mm); gap: ${t.gapMm}mm;`} }
.label { width: ${t.widthMm}mm; height: ${t.heightMm}mm; padding: 1mm 1.5mm; overflow: hidden;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.4mm; text-align: center;
  ${t.showBorder ? "outline: 0.2mm dashed #888; outline-offset: -0.1mm;" : ""}
  ${roll ? "break-after: page; page-break-after: always;" : "break-inside: avoid; page-break-inside: avoid;"} }
.label:last-child { break-after: auto; page-break-after: auto; }
.company { font-size: ${f.small}px; text-transform: uppercase; letter-spacing: 0.3px; line-height: 1.1; }
.name { font-size: ${f.name}px; font-weight: 600; line-height: 1.15; max-height: 2.3em; overflow: hidden; overflow-wrap: anywhere; }
.price { font-size: ${f.price}px; font-weight: 800; line-height: 1.1; white-space: nowrap; }
.small { font-size: ${f.small}px; line-height: 1.1; letter-spacing: 0.4px; }
.code { width: 100%; flex: 1 1 0; min-height: 3mm; display: flex; align-items: stretch; justify-content: center; }
.code svg { width: 100%; height: 100%; display: block; }
.code-fallback { font-size: ${f.name}px; font-family: monospace; align-self: center; }
.row-layout { flex-direction: row; gap: 1.5mm; }
.row-layout .code { flex: 0 0 auto; width: auto; height: 100%; aspect-ratio: 1 / 1; }
.row-layout .info { flex: 1 1 0; min-width: 0; height: 100%; display: flex; flex-direction: column;
  justify-content: center; gap: 0.4mm; text-align: left; }
@media screen {
  body { background: transparent; padding: 12px; }
  .label { background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25); ${roll ? "margin: 0 auto 10px;" : ""} }
  ${previewWidthPx ? `.sheet { zoom: ${previewZoom(t, previewWidthPx)}; ${roll ? "" : "width: max-content; margin: 0 auto;"} }` : ""}
}`;
}

export function buildLabelsHtml(
  items: LabelItem[],
  template: LabelTemplate,
  options: { companyName?: string; previewWidthPx?: number } = {},
): string {
  const labels: string[] = [];
  for (const { product, quantity } of items) {
    if (quantity <= 0) continue;
    const html = labelHtml(product, template, options.companyName ?? "");
    for (let i = 0; i < quantity; i++) labels.push(html);
  }
  return (
    `<!doctype html><html><head><meta charset="utf-8" /><title>Etiketkalar</title>` +
    `<style>${labelsCss(template, options.previewWidthPx)}</style></head>` +
    `<body><div class="sheet">${labels.join("")}</div></body></html>`
  );
}

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CUSTOM_THEME } from "../../../packages/shared/src/pos-appearance.ts";
import { DEFAULT_HOTKEYS } from "../src/shared/hotkeys.ts";
import type { AppStatus, DevicePrefs, PosProduct } from "../src/shared/kassa-api.ts";
import type { SaleCalc } from "../src/shared/sale-calc.ts";
import App from "../src/renderer/app.tsx";
import { PaymentProgress } from "../src/renderer/pos/payment-progress.tsx";
import { PosSidebar } from "../src/renderer/pos/pos-sidebar.tsx";
import { CategoryChips, ProductCard } from "../src/renderer/pos/product-grid.tsx";
import { applyAppearance } from "../src/renderer/settings/appearance.ts";
import { PosThemePreview } from "../src/renderer/settings/theme-preview.tsx";

/**
 * Kassa ko'rinishi (renderer, jsdom): mavzu qo'llash, jonli ko'rinish, kassa ekrani komponentlari va eng muhimi — mavzu
 * almashganda hamda boshqa bo'limga o'tib qaytganda savat, aralash to'lov va skaner holati saqlanishi. Ma'lumotlar — main
 * jarayon o'rniga soxta `window.bumKassa` (haqiqiy Electron oynasi emas).
 */

// ─── jsdom to'ldirmalari (Radix menyu, tizim mavzusi) ───
let systemDark = false;
const mediaListeners = new Set<() => void>();
function setSystemDark(value: boolean) {
  systemDark = value;
  for (const listener of mediaListeners) listener();
}

beforeEach(() => {
  systemDark = false;
  mediaListeners.clear();
  window.matchMedia = ((media: string) => ({
    get matches() {
      return media.includes("dark") ? systemDark : false;
    },
    media,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  const root = document.documentElement;
  root.removeAttribute("data-theme");
  root.removeAttribute("data-density");
  root.removeAttribute("style");
  root.className = "";
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ─── Soxta ma'lumotlar ───
const product = (patch: Partial<PosProduct> = {}): PosProduct => ({
  id: "p1",
  name: "Coca-Cola 1L",
  sku: "COLA",
  barcode: "4780001",
  categoryId: null,
  baseUnitId: "unit-d",
  unitName: "dona",
  salesPrice: "12000",
  salesCurrency: null,
  price: "12000",
  regularPrice: "12000",
  promo: null,
  taxRate: "0",
  taxIncluded: true,
  stock: "10",
  minStock: "3",
  imageVersion: null,
  isWeighted: false,
  pluCode: null,
  ...patch,
});

const basePrefs = (patch: Partial<DevicePrefs> = {}): DevicePrefs => ({
  language: "uz-Latn",
  theme: "snow",
  themeSource: "cashier",
  themeLock: null,
  companyTheme: "system",
  cashierTheme: "snow",
  customTheme: null,
  density: "comfortable",
  fontScale: "normal",
  productView: "cards",
  hotkeys: { ...DEFAULT_HOTKEYS },
  blockNegativeStock: false,
  defaultPaymentMethod: "cash",
  enabledPaymentMethods: ["cash", "card", "bank", "transfer"],
  syncIntervalSec: 30,
  autoLockMinutes: 0,
  printerName: null,
  paperWidth: 80,
  autoPrint: false,
  drawer: { mode: "none" },
  openDrawerOnCash: false,
  labelPrinterName: null,
  ...patch,
});

function installBridge(options: { prefs?: Partial<DevicePrefs> } = {}) {
  const sync = { state: "idle" as const, lastSyncAt: "2026-09-12T08:00:00.000Z", pending: 0, rejected: 0, lastError: null };
  const status = {
    appVersion: "0.4.0",
    registered: true,
    apiUrl: "https://bum-erp.uz",
    device: { id: "d1", code: "K1", name: "Kassa 1", warehouseId: "w1", warehouseName: "Asosiy ombor" },
    company: { id: "c1", name: "Test do'kon", currency: "UZS" },
    cashier: { userId: "u1", name: "Kassir Ali", phone: "+998901112233", permissions: ["pos.use"] },
    shift: { id: "s1", cashierId: "u1", cashierName: "Kassir Ali", openedAt: "2026-09-12T07:00:00.000Z", openingCash: "0", totals: { sales: "0", cash: "0", card: "0", returns: "0", receipts: 0 } },
    counts: { products: 1, customers: 0, cashiers: 1, pending: 0, rejected: 0 },
    sync,
  } as unknown as AppStatus;
  let prefs = basePrefs(options.prefs);
  const calls: { channel: string; input: unknown }[] = [];
  const handlers: Record<string, (input: unknown) => unknown> = {
    "app:status": () => status,
    "device:prefs": () => prefs,
    "device:save-prefs": (input) => {
      const next = input as DevicePrefs;
      if (prefs.themeLock !== null && next.theme !== prefs.theme) throw { code: "FORBIDDEN", message: "Mavzu kompaniya tomonidan qulflangan" };
      prefs = { ...next, cashierTheme: next.theme, themeSource: "cashier" };
      return prefs;
    },
    "pos:context": () => ({ baseCurrency: "UZS", currencies: [], cashback: null, receipt: null, labels: null, company: null, permissions: ["pos.use"] }),
    "pos:quick-sale": () => ({ configured: true, products: [product()], categories: [] }),
    "pos:categories": () => [],
    "pos:products": () => [product()],
    "pos:product-by-code": (input) => ((input as { code: string }).code === "4780001" ? product() : null),
    "device:printers": () => [],
    "settings:overview": () => ({ permissions: ["pos.use"], sync, currencies: [], baseCurrency: "UZS", cashiers: [], warehouses: [] }),
  };
  window.bumKassa = {
    invoke: (async (channel: string, input?: unknown) => {
      calls.push({ channel, input });
      const handler = handlers[channel];
      if (!handler) return { ok: true, data: [] };
      try {
        return { ok: true, data: handler(input) };
      } catch (error) {
        return { ok: false, error };
      }
    }) as unknown as typeof window.bumKassa.invoke,
    onSyncStatus: () => () => undefined,
  };
  return { calls, currentPrefs: () => prefs };
}

const digits = (element: Element | null) => (element?.textContent ?? "").replace(/\D/g, "");

/** Skaner: belgilar juda tez + Enter (useHIDScanner). */
function scan(code: string) {
  for (const key of code) fireEvent.keyDown(document.body, { key });
  fireEvent.keyDown(document.body, { key: "Enter" });
}

async function openPosWithTwoColas() {
  render(<App />);
  fireEvent.click(await screen.findByText("Kassa (POS)"));
  const card = await screen.findByTitle("Coca-Cola 1L — savatga +1");
  fireEvent.click(card);
  fireEvent.click(card);
  await waitFor(() => expect((document.getElementById("cart-qty-0") as HTMLInputElement | null)?.value).toBe("2"));
  await waitFor(() => expect(digits(screen.getByTestId("pos-total"))).toBe("24000"));
}

describe("Kassa mavzu tizimi — renderer", () => {
  it("applyAppearance: data-theme, qorong'i klass, zichlik, shrift; Windows rejimi kuzatiladi; maxsus mavzu tokenlari tozalanadi", () => {
    const root = document.documentElement;
    applyAppearance({ theme: "system", density: "touch", fontScale: "normal", customTheme: null }, root);
    expect(root.dataset.theme).toBe("snow");
    expect(root.dataset.density).toBe("touch");
    expect(root.classList.contains("dark")).toBe(false);

    setSystemDark(true);
    expect(root.dataset.theme).toBe("midnight");
    expect(root.classList.contains("dark")).toBe(true);

    applyAppearance({ theme: "custom", density: "comfortable", fontScale: "xlarge", customTheme: DEFAULT_CUSTOM_THEME }, root);
    expect(root.dataset.theme).toBe("custom");
    expect(root.style.getPropertyValue("--primary")).not.toBe("");
    expect(root.style.fontSize).toBe("125%");
    // Tizim rejimi o'zgarsa ham maxsus mavzu qoladi (eski tinglovchi olib tashlangan)
    setSystemDark(false);
    expect(root.dataset.theme).toBe("custom");

    applyAppearance({ theme: "high-contrast", density: "comfortable", fontScale: "normal", customTheme: DEFAULT_CUSTOM_THEME }, root);
    expect(root.dataset.theme).toBe("high-contrast");
    expect(root.style.getPropertyValue("--primary")).toBe("");
    expect(root.classList.contains("dark")).toBe(true);
    // Yuqori kontrast — shrift kamida "Katta"
    expect(root.style.fontSize).toBe("112.5%");

    applyAppearance({ theme: "ocean", density: "compact", fontScale: "large", customTheme: null }, root);
    expect(root.dataset.theme).toBe("ocean");
    expect(root.dataset.density).toBe("compact");
    expect(root.style.fontSize).toBe("112.5%");
  });

  it("jonli ko'rinish: faqat o'z blokiga mavzu beradi (butun ilovaga emas), kassa elementlari bor", () => {
    render(<PosThemePreview theme="neon" />);
    const preview = screen.getByTestId("pos-theme-preview");
    expect(preview.getAttribute("data-theme")).toBe("neon");
    expect(preview.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(within(preview).getByText("JAMI")).toBeTruthy();
    cleanup();

    render(<PosThemePreview theme="custom" custom={DEFAULT_CUSTOM_THEME} />);
    const custom = screen.getByTestId("pos-theme-preview");
    expect(custom.getAttribute("data-theme")).toBe("custom");
    expect(custom.style.getPropertyValue("--primary")).not.toBe("");
  });

  it("yon panel: ruxsati yo'q bo'limlar ko'rinmaydi (RBAC), tugmalar tab va bo'limga o'tkazadi", () => {
    const onTab = vi.fn();
    const onNavigate = vi.fn();
    const { rerender } = render(<PosSidebar permissions={["pos.use"]} activeTab="quick" onTab={onTab} onNavigate={onNavigate} />);
    for (const hidden of ["Xarid", "Ombor", "Hisobotlar"]) expect(screen.queryByRole("button", { name: hidden })).toBeNull();
    for (const shown of ["Bosh sahifa", "Tezkor sotuv", "Sotuv", "Sotuv tarixi", "Kassa hisobi", "Mijozlar", "Sozlamalar"]) expect(screen.getByRole("button", { name: shown })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tezkor sotuv" }).getAttribute("aria-current")).toBe("page");

    rerender(<PosSidebar permissions={["pos.use", "purchase.create", "warehouse.view", "analytics.view"]} activeTab="all" onTab={onTab} onNavigate={onNavigate} />);
    for (const shown of ["Xarid", "Ombor", "Hisobotlar"]) expect(screen.getByRole("button", { name: shown })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tezkor sotuv" }));
    fireEvent.click(screen.getByRole("button", { name: "Ombor" }));
    expect(onTab).toHaveBeenCalledWith("quick");
    expect(onNavigate).toHaveBeenCalledWith("warehouse");
  });

  it("to'lov progressi: aralash to'lov ulushlari va \"a + b + c = jami\" yozuvi", () => {
    const calc = {
      due: 100_000_000n,
      paid: 100_000_000n,
      payments: [
        { method: "cash", tendered: 30_000_000n, paid: 30_000_000n },
        { method: "card", tendered: 40_000_000n, paid: 40_000_000n },
        { method: "bank", tendered: 30_000_000n, paid: 30_000_000n },
      ],
    } as unknown as SaleCalc;
    render(<PaymentProgress calc={calc} base="UZS" />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect([...bar.children].map((part) => (part as HTMLElement).style.width)).toEqual(["30%", "40%", "30%"]);
    const legend = bar.nextElementSibling!.textContent!;
    expect(legend).toMatch(/Naqd.*\+.*Karta.*\+.*Bank.*=/);
    expect(legend).toContain("to'liq");
  });

  it("mahsulot kartasi: bosish — savatga, uzoq bosish — batafsil (savatga qo'shmaydi), qoldiq holati matn bilan", () => {
    const onAdd = vi.fn();
    const onDetails = vi.fn();
    render(<ProductCard product={product({ stock: "2", minStock: "3", promo: { endsAt: null } })} base="UZS" discountPercent={5} inCart={0} onAdd={onAdd} onDetails={onDetails} />);
    expect(screen.getByText(/^Kam · 2/)).toBeTruthy();
    expect(screen.getByText("Aksiya")).toBeTruthy();
    expect(screen.getByText(/Chegirma/)).toBeTruthy();

    const button = screen.getByTitle("Coca-Cola 1L — savatga +1");
    fireEvent.click(button);
    expect(onAdd).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    fireEvent.pointerDown(button, { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onDetails).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(button, { pointerType: "touch" });
    fireEvent.click(button);
    expect(onAdd).toHaveBeenCalledTimes(1);

    // Qisqa bosish (sensorli) — batafsil ochilmaydi, savatga qo'shiladi
    fireEvent.pointerDown(button, { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.pointerUp(button, { pointerType: "touch" });
    fireEvent.click(button);
    expect(onDetails).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    cleanup();

    render(<ProductCard product={product({ stock: "0" })} base="UZS" discountPercent={0} inCart={0} onAdd={onAdd} onDetails={onDetails} />);
    expect(screen.getByText(/^Tugagan · 0/)).toBeTruthy();
  });

  it("kategoriya tablari: ← → bilan tanlanadi", () => {
    const onPick = vi.fn();
    render(
      <CategoryChips
        categories={[
          { id: "c1", name: "Ichimliklar", products: 3 },
          { id: "c2", name: "Shirinliklar", products: 2 },
        ]}
        active="c1"
        onPick={onPick}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    fireEvent.keyDown(tabs[1]!, { key: "ArrowRight" });
    fireEvent.keyDown(tabs[1]!, { key: "ArrowLeft" });
    expect(onPick.mock.calls).toEqual([["c2"], [null]]);
  });
});

describe("Kassa holati saqlanishi (regressiya)", () => {
  it("Sozlamalar → Tashqi ko'rinish: jonli ko'rinish ilovaga tegmaydi, Qo'llash — saqlaydi va darhol qo'llaydi; savat, aralash to'lov saqlanadi", async () => {
    const bridge = installBridge();
    await openPosWithTwoColas();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("snow"));
    fireEvent.change(document.getElementById("pay-cash")!, { target: { value: "10000" } });
    fireEvent.change(document.getElementById("pay-card")!, { target: { value: "4000" } });

    fireEvent.click(screen.getByRole("button", { name: "Sozlamalar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Tashqi ko'rinish" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Ocean Blue/ }));
    // Jonli ko'rinish — faqat namunada
    expect(document.documentElement.dataset.theme).toBe("snow");
    expect(screen.getAllByTestId("pos-theme-preview").some((preview) => preview.getAttribute("data-theme") === "ocean")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Qo'llash" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("ocean"));
    expect(bridge.calls.some((item) => item.channel === "device:save-prefs" && (item.input as DevicePrefs).theme === "ocean")).toBe(true);
    // Kassa ekrani yashirin, lekin o'chirilmagan
    expect(document.getElementById("pos-search")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "← Bosh sahifa" }));
    fireEvent.click(await screen.findByText("Kassa (POS)"));
    expect((document.getElementById("cart-qty-0") as HTMLInputElement).value).toBe("2");
    expect((document.getElementById("pay-cash") as HTMLInputElement).value).toBe("10000");
    expect((document.getElementById("pay-card") as HTMLInputElement).value).toBe("4000");
    expect(digits(screen.getByTestId("pos-total"))).toBe("24000");
    // Mavzu qayta yuklashsiz: kassa ma'lumotlari qayta so'ralmagan (bitta kontekst so'rovi)
    expect(bridge.calls.filter((item) => item.channel === "pos:context")).toHaveLength(1);
  });

  it("kassa yashirin paytda skaner kodi savatga tushmaydi; qaytgach ishlaydi", async () => {
    const bridge = installBridge();
    await openPosWithTwoColas();
    fireEvent.click(screen.getByRole("button", { name: "Bosh sahifa" }));
    await screen.findByText("Kassa (POS)");
    scan("4780001");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bridge.calls.some((item) => item.channel === "pos:product-by-code")).toBe(false);

    fireEvent.click(screen.getByText("Kassa (POS)"));
    scan("4780001");
    await waitFor(() => expect((document.getElementById("cart-qty-0") as HTMLInputElement).value).toBe("3"));
  });

  it("Menyu → Mavzu: kassa ekranidan darhol almashadi, savat saqlanadi; kompaniya qulflagan bo'lsa o'chiq", async () => {
    installBridge();
    await openPosWithTwoColas();
    fireEvent.keyDown(screen.getByRole("button", { name: /Menyu/ }), { key: "Enter" });
    const trigger = await screen.findByRole("menuitem", { name: /Mavzu/ });
    fireEvent.keyDown(trigger, { key: "ArrowRight" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Neon Night/ }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("neon"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect((document.getElementById("cart-qty-0") as HTMLInputElement).value).toBe("2");
    cleanup();

    installBridge({ prefs: { theme: "classic", themeSource: "company-lock", themeLock: "classic", cashierTheme: null } });
    render(<App />);
    fireEvent.click(await screen.findByText("Kassa (POS)"));
    await screen.findByTitle("Coca-Cola 1L — savatga +1");
    fireEvent.keyDown(screen.getByRole("button", { name: /Menyu/ }), { key: "Enter" });
    const locked = await screen.findByRole("menuitem", { name: /Mavzu/ });
    expect(locked.getAttribute("aria-disabled")).toBe("true");
    expect(locked.textContent).toContain("kompaniya qulflagan");
  });
});

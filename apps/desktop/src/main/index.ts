/**
 * BUM POS KASSA — Electron main jarayoni.
 *  - Oyna: contextIsolation, sandbox, nodeIntegration yo'q; renderer faqat `window.bumKassa` (preload) orqali.
 *  - Lokal baza: foydalanuvchi papkasida `bum-kassa.sqlite`; qurilma tokeni Windows shifrlashi (safeStorage) bilan.
 *  - Chek chop etish: yashirin oynada HTML → tanlangan printerga dialogsiz (termal qog'oz kengligi, balandlik mazmun bo'yicha).
 *  - Tashqi havolalar va yangi oynalar bloklanadi.
 */
import { app, BrowserWindow, ipcMain, Menu, protocol, safeStorage, shell } from "electron";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { KassaChannel, KassaChannels } from "../shared/kassa-api.js";
import { openLocalDb } from "./local-db.js";
import { LocalStore } from "./local-store.js";
import { KassaService, toKassaError, type AppUpdater, type ReceiptPrinter, type TokenVault } from "./kassa-service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let quitting = false;

// Sinov va ishlab chiqish: alohida foydalanuvchi papkasi — o'rnatilgan kassa bilan "bitta nusxa" qulfi va bazasi to'qnashmasin
if (process.env.KASSA_USER_DATA && !app.isPackaged) app.setPath("userData", process.env.KASSA_USER_DATA);

/** Printer drayveri javob bermasa yashirin chop etish oynasi abadiy qolib, ilova yopilishini to'sib qo'yardi. */
const PRINT_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

// Mahsulot rasmlari: renderer `bum-image://product/<id>?v=<versiya>` — main keshdan yoki serverdan beradi (disk yo'li va
// token renderer'ga ochilmaydi). Ilova tayyor bo'lishidan oldin ro'yxatdan o'tadi.
protocol.registerSchemesAsPrivileged([{ scheme: "bum-image", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const PRODUCT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tokenVault(store: LocalStore): TokenVault {
  return {
    save(token) {
      if (safeStorage.isEncryptionAvailable()) {
        store.setMeta("deviceToken", { encrypted: true, value: safeStorage.encryptString(token).toString("base64") });
      } else {
        store.setMeta("deviceToken", { encrypted: false, value: token });
      }
    },
    load() {
      const saved = store.getMeta<{ encrypted: boolean; value: string }>("deviceToken");
      if (!saved) return null;
      return saved.encrypted ? safeStorage.decryptString(Buffer.from(saved.value, "base64")) : saved.value;
    },
    clear() {
      store.deleteMeta("deviceToken");
    },
  };
}

/** Chek HTML'i uchun CSP: tashqi resurs va sahifa skripti yuklanmaydi (balandlikni main jarayon o'lchaydi — CSP ta'sir qilmaydi). */
const PRINT_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">`;

function withPrintCsp(html: string): string {
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (tag) => `${tag}${PRINT_CSP}`) : `${PRINT_CSP}${html}`;
}

const EXTERNAL_HOSTS = ["bum-erp.uz", "up.railway.app", "google.com", "yandex.uz", "yandex.ru", "openstreetmap.org"];

/** Tashqi havola: faqat https va ro'yxatdagi domen (yoki uning subdomeni). */
export function isAllowedExternalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  return EXTERNAL_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

/** Yashirin chop etish oynasi hech qayerga o'tmaydi va yangi oyna ochmaydi. */
function lockPrintWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
}

const receiptPrinter: ReceiptPrinter = {
  async list() {
    const printers = (await mainWindow?.webContents.getPrintersAsync()) ?? [];
    return printers.map((printer) => ({ name: printer.name, displayName: printer.displayName || printer.name }));
  },
  async print(html, prefs) {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    lockPrintWindow(win);
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(withPrintCsp(html))}`);
      const heightPx = Number(await win.webContents.executeJavaScript("document.documentElement.scrollHeight", true)) || 600;
      // px → mikron (96 dpi); pastda qirqish uchun zaxira
      const heightMicrons = Math.max(Math.ceil(((heightPx * 25.4) / 96) * 1000) + 8000, 30_000);
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          win.webContents.print(
            {
              silent: true,
              printBackground: true,
              ...(prefs.printerName ? { deviceName: prefs.printerName } : {}),
              margins: { marginType: "none" },
              pageSize: { width: prefs.paperWidth * 1000, height: heightMicrons },
            },
            (success, reason) => (success ? resolve() : reject(new Error(reason || "Chop etilmadi"))),
          );
        }),
        PRINT_TIMEOUT_MS,
        "Printer javob bermadi",
      );
    } finally {
      win.destroy();
    }
  },
  async printLabels(html, options) {
    // Ko'p etiketka (shtrix-kod SVG) data: URL chegarasidan katta bo'lishi mumkin — vaqtinchalik fayl orqali
    const file = path.join(app.getPath("temp"), `bum-labels-${randomUUID()}.html`);
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
    lockPrintWindow(win);
    try {
      await writeFile(file, html, "utf8");
      await win.loadFile(file);
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          win.webContents.print(
            {
              silent: true,
              printBackground: true,
              ...(options.printerName ? { deviceName: options.printerName } : {}),
              ...(options.layout === "roll"
                ? { margins: { marginType: "none" as const }, pageSize: { width: Math.round(options.widthMm * 1000), height: Math.round(options.heightMm * 1000) } }
                : { pageSize: "A4" as const }),
            },
            (success, reason) => (success ? resolve() : reject(new Error(reason || "Chop etilmadi"))),
          );
        }),
        PRINT_TIMEOUT_MS,
        "Printer javob bermadi",
      );
    } finally {
      win.destroy();
      await rm(file, { force: true });
    }
  },
};

/** NSIS o'rnatuvchi alohida jarayonda; ilova yopiladi (lokal baza foydalanuvchi papkasida saqlanadi). */
const updater: AppUpdater = {
  async install(file) {
    spawn(file, [], { detached: true, stdio: "ignore" }).unref();
    setTimeout(() => app.quit(), 500);
  },
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    title: "BUM POS KASSA",
    autoHideMenuBar: true,
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload: path.join(here, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Tizim brauzerida faqat ma'lum saytlar ochiladi (BUM ERP, xarita navigatorlari) — ixtiyoriy havola emas
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  const devUrl = process.env.KASSA_RENDERER_URL;
  if (devUrl && !app.isPackaged) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(path.join(here, "../renderer/index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
    // Asosiy oyna yopildi — ilova to'liq chiqadi (yashirin chop etish oynasi qolgan bo'lsa ham jarayon osilib qolmaydi)
    app.quit();
  });
}

function registerIpc(service: KassaService) {
  const handlers: { [C in KassaChannel]: (input: KassaChannels[C]["input"]) => KassaChannels[C]["output"] | Promise<KassaChannels[C]["output"]> } = {
    "app:status": () => service.status(),
    "app:quit": () => {
      // Javob renderer'ga qaytgach yopiladi
      setImmediate(() => app.quit());
    },
    "device:unpair": () => service.unpair(),
    "setup:options": (input) => service.setupOptions(input),
    "setup:register": (input) => service.register(input),
    "cashier:list": () => service.cashiers(),
    "cashier:first-login": (input) => service.firstLogin(input),
    "cashier:unlock": (input) => service.unlock(input),
    "cashier:logout": () => service.logout(),
    "cashier:change-pin": (input) => service.changePin(input),
    "settings:overview": () => service.settingsOverview(),
    "settings:currency-rate": (input) => service.updateCurrencyRate(input),
    "settings:currency-history": (input) => service.currencyHistory(input),
    "update:check": () => service.checkUpdate(),
    "update:download": () => service.downloadUpdate(),
    "update:install": () => service.installUpdate(),
    "sync:run": () => service.syncNow(),
    "sync:rejected": () => service.rejected(),
    "sync:unsynced": () => service.unsynced(),
    "sync:retry": (input) => service.retry(input),
    "sync:discard": (input) => service.discard(input),
    "shift:open": (input) => service.openShift(input),
    "shift:close": (input) => service.closeShift(input),
    "pos:context": () => service.posContext(),
    "pos:products": (input) => service.products(input),
    "pos:categories": () => service.posCategories(),
    "pos:quick-sale": (input) => service.quickSale(input),
    "scale:list": () => service.scaleList(),
    "scale:save": (input) => service.scaleSave(input),
    "scale:remove": (input) => service.scaleRemove(input),
    "scale:test": (input) => service.scaleTest(input),
    "scale:read-weight": (input) => service.scaleReadWeight(input),
    "scale:full-sync": (input) => service.scaleFullSync(input),
    "scale:process": (input) => service.scaleProcess(input),
    "scale:queue": (input) => service.scaleQueue(input),
    "scale:retry": (input) => service.scaleRetry(input),
    "scale:reconcile": (input) => service.scaleReconcile(input),
    "scale:barcode": () => service.scaleBarcode(),
    "scale:save-barcode": (input) => service.scaleSaveBarcode(input),
    "pos:product-by-code": (input) => service.productByCode(input),
    "pos:products-by-ids": (input) => service.productsByIds(input),
    "pos:customers": (input) => service.customers(input),
    "pos:customer-create": (input) => service.createCustomer(input),
    "ref:customers": (input) => service.referenceCustomers(input),
    "ref:customer-update": (input) => service.updateCustomer(input),
    "ref:suppliers": (input) => service.referenceSuppliers(input),
    "ref:supplier-update": (input) => service.updateSupplier(input),
    "ref:prices": (input) => service.priceList(input),
    "ref:price-update": (input) => service.updatePrices(input),
    "pos:complete-sale": (input) => service.completeSale(input),
    "pos:sales": (input) => service.sales(input),
    "pos:hold": (input) => service.hold(input),
    "pos:held": () => service.held(),
    "pos:held-take": (input) => service.takeHeld(input),
    "pos:held-delete": (input) => service.deleteHeld(input),
    "pos:find-receipt": (input) => service.findReceipt(input),
    "pos:return": (input) => service.returnItems(input),
    "cash:report": (input) => service.shiftReport(input),
    "cash:movement": (input) => service.cashMovement(input),
    "cash:movements": () => service.cashMovements(),
    "cash:customer-payment": (input) => service.customerPayment(input),
    "cash:customer-payments": () => service.customerPayments(),
    "cash:shifts": (input) => service.shiftHistory(input),
    "history:sales": (input) => service.historySales(input),
    "history:returns": (input) => service.historyReturns(input),
    "history:server": (input) => service.historyServer(input),
    "purchase:suppliers": (input) => service.suppliers(input),
    "purchase:supplier-create": (input) => service.createSupplier(input),
    "purchase:products": (input) => service.purchaseProducts(input),
    "purchase:product-by-code": (input) => service.purchaseProductByCode(input),
    "purchase:complete": (input) => service.completePurchase(input),
    "purchase:list": (input) => service.purchases(input),
    "purchase:find": (input) => service.findPurchase(input),
    "purchase:return": (input) => service.returnPurchase(input),
    "purchase:returns": (input) => service.purchaseReturns(input),
    "purchase:supplier-payment": (input) => service.supplierPayment(input),
    "stock:list": (input) => service.stockList(input),
    "stock:warehouses": () => service.stockWarehouses(),
    "stock:products": (input) => service.stockProducts(input),
    "stock:product-by-code": (input) => service.stockProductByCode(input),
    "stock:writeoff": (input) => service.writeOff(input),
    "stock:transfer": (input) => service.transfer(input),
    "stock:documents": (input) => service.stockDocuments(input),
    "stock:movements": (input) => service.stockMovements(input),
    "stock:elsewhere": (input) => service.stockElsewhere(input),
    "count:draft": () => service.countDraft(),
    "count:set": (input) => service.countSet(input),
    "count:remove": (input) => service.countRemove(input),
    "count:cancel": () => service.countCancel(),
    "count:complete": (input) => service.countComplete(input),
    "analytics:report": (input) => service.analyticsReport(input),
    "device:prefs": () => service.prefs(),
    "device:save-prefs": (input) => service.savePrefs(input),
    "device:printers": () => service.printers(),
    "device:print": (input) => service.print(input),
    "device:print-labels": (input) => service.printLabels(input),
    "device:open-drawer": () => service.openDrawer(),
  };
  for (const [channel, handler] of Object.entries(handlers) as [KassaChannel, (input: unknown) => unknown][]) {
    ipcMain.handle(`kassa:${channel}`, async (event, input: unknown) => {
      // Faqat ilovaning o'z oynasidan
      if (event.sender !== mainWindow?.webContents) return { ok: false, error: { code: "FORBIDDEN", message: "Ruxsat yo'q" } };
      try {
        return { ok: true, data: await handler(input ?? {}) };
      } catch (error) {
        return { ok: false, error: toKassaError(error) };
      }
    });
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (quitting || !app.isReady()) return;
    // Oyna yo'q (yopilgan) bo'lsa — qayta ochiladi, aks holda qayta ishga tushirish hech narsa ko'rsatmay qolardi
    if (!mainWindow) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    // Standart menyu tezkor tugmalari (F11, Ctrl+R) kassa tugmalarini egallamasin
    Menu.setApplicationMenu(null);
    const store = new LocalStore(openLocalDb(path.join(app.getPath("userData"), "bum-kassa.sqlite")));
    const service = new KassaService(store, tokenVault(store), {
      appVersion: app.getVersion(),
      platform: process.platform,
      onSyncStatus: (status) => mainWindow?.webContents.send("kassa:sync-status", status),
      printer: receiptPrinter,
      updater,
      downloadDir: app.getPath("temp"),
      imageDir: path.join(app.getPath("userData"), "product-images"),
    });
    protocol.handle("bum-image", async (request) => {
      const url = new URL(request.url);
      const productId = url.pathname.replace(/^\/+/, "");
      if (url.hostname !== "product" || !PRODUCT_ID.test(productId)) return new Response(null, { status: 400 });
      const image = await service.productImage({ productId }).catch(() => null);
      return image
        ? new Response(new Uint8Array(image.data), { headers: { "content-type": image.contentType, "cache-control": "private, max-age=3600" } })
        : new Response(null, { status: 404 });
    });
    registerIpc(service);
    createWindow();
    service.start();

    app.on("before-quit", () => {
      if (quitting) return;
      quitting = true;
      service.shutdown();
      // Osilib qolgan yashirin (chop etish) oynalar chiqishni to'smasin; baribir chiqmasa — 5 soniyadan keyin majburan
      for (const win of BrowserWindow.getAllWindows()) if (win !== mainWindow) win.destroy();
      setTimeout(() => app.exit(0), 5_000).unref();
    });
  });

  app.on("window-all-closed", () => app.quit());
}

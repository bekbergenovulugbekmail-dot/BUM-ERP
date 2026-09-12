/**
 * BUM POS KASSA — Electron main jarayoni.
 *  - Oyna: contextIsolation, sandbox, nodeIntegration yo'q; renderer faqat `window.bumKassa` (preload) orqali.
 *  - Lokal baza: foydalanuvchi papkasida `bum-kassa.sqlite`; qurilma tokeni Windows shifrlashi (safeStorage) bilan.
 *  - Chek chop etish: yashirin oynada HTML → tanlangan printerga dialogsiz (termal qog'oz kengligi, balandlik mazmun bo'yicha).
 *  - Tashqi havolalar va yangi oynalar bloklanadi.
 */
import { app, BrowserWindow, ipcMain, Menu, safeStorage, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { KassaChannel, KassaChannels } from "../shared/kassa-api.js";
import { openLocalDb } from "./local-db.js";
import { LocalStore } from "./local-store.js";
import { KassaService, toKassaError, type ReceiptPrinter, type TokenVault } from "./kassa-service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;

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

const receiptPrinter: ReceiptPrinter = {
  async list() {
    const printers = (await mainWindow?.webContents.getPrintersAsync()) ?? [];
    return printers.map((printer) => ({ name: printer.name, displayName: printer.displayName || printer.name }));
  },
  async print(html, prefs) {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const heightPx = Number(await win.webContents.executeJavaScript("document.documentElement.scrollHeight", true)) || 600;
      // px → mikron (96 dpi); pastda qirqish uchun zaxira
      const heightMicrons = Math.max(Math.ceil(((heightPx * 25.4) / 96) * 1000) + 8000, 30_000);
      await new Promise<void>((resolve, reject) => {
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
      });
    } finally {
      win.destroy();
    }
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
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  const devUrl = process.env.KASSA_RENDERER_URL;
  if (devUrl && !app.isPackaged) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(path.join(here, "../renderer/index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpc(service: KassaService) {
  const handlers: { [C in KassaChannel]: (input: KassaChannels[C]["input"]) => KassaChannels[C]["output"] | Promise<KassaChannels[C]["output"]> } = {
    "app:status": () => service.status(),
    "setup:options": (input) => service.setupOptions(input),
    "setup:register": (input) => service.register(input),
    "cashier:list": () => service.cashiers(),
    "cashier:first-login": (input) => service.firstLogin(input),
    "cashier:unlock": (input) => service.unlock(input),
    "cashier:logout": () => service.logout(),
    "sync:run": () => service.syncNow(),
    "sync:rejected": () => service.rejected(),
    "sync:unsynced": () => service.unsynced(),
    "sync:retry": (input) => service.retry(input),
    "sync:discard": (input) => service.discard(input),
    "shift:open": (input) => service.openShift(input),
    "shift:close": (input) => service.closeShift(input),
    "pos:context": () => service.posContext(),
    "pos:products": (input) => service.products(input),
    "pos:product-by-code": (input) => service.productByCode(input),
    "pos:customers": (input) => service.customers(input),
    "pos:customer-create": (input) => service.createCustomer(input),
    "pos:complete-sale": (input) => service.completeSale(input),
    "pos:sales": (input) => service.sales(input),
    "pos:hold": (input) => service.hold(input),
    "pos:held": () => service.held(),
    "pos:held-take": (input) => service.takeHeld(input),
    "pos:held-delete": (input) => service.deleteHeld(input),
    "pos:find-receipt": (input) => service.findReceipt(input),
    "pos:return": (input) => service.returnItems(input),
    "device:prefs": () => service.prefs(),
    "device:save-prefs": (input) => service.savePrefs(input),
    "device:printers": () => service.printers(),
    "device:print": (input) => service.print(input),
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
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
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
    });
    registerIpc(service);
    createWindow();
    service.start();

    app.on("before-quit", () => service.stop());
  });

  app.on("window-all-closed", () => app.quit());
}

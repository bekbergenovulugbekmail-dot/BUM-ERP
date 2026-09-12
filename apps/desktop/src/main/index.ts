/**
 * BUM POS KASSA — Electron main jarayoni.
 *  - Oyna: contextIsolation, sandbox, nodeIntegration yo'q; renderer faqat `window.bumKassa` (preload) orqali.
 *  - Lokal baza: foydalanuvchi papkasida `bum-kassa.sqlite`; qurilma tokeni Windows shifrlashi (safeStorage) bilan.
 *  - Tashqi havolalar va yangi oynalar bloklanadi.
 */
import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { KassaChannel, KassaChannels } from "../shared/kassa-api.js";
import { openLocalDb } from "./local-db.js";
import { LocalStore } from "./local-store.js";
import { KassaService, toKassaError, type TokenVault } from "./kassa-service.js";

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
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
    "shift:open": (input) => service.openShift(input),
    "shift:close": (input) => service.closeShift(input),
  };
  for (const [channel, handler] of Object.entries(handlers) as [KassaChannel, (input: unknown) => unknown][]) {
    ipcMain.handle(`kassa:${channel}`, async (event, input: unknown) => {
      // Faqat ilovaning o'z oynasidan
      if (event.sender !== mainWindow?.webContents) return { ok: false, error: { code: "FORBIDDEN", message: "Ruxsat yo'q" } };
      try {
        return { ok: true, data: await handler(input) };
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
    const store = new LocalStore(openLocalDb(path.join(app.getPath("userData"), "bum-kassa.sqlite")));
    const service = new KassaService(store, tokenVault(store), {
      appVersion: app.getVersion(),
      platform: process.platform,
      onSyncStatus: (status) => mainWindow?.webContents.send("kassa:sync-status", status),
    });
    registerIpc(service);
    createWindow();
    service.start();

    app.on("before-quit", () => service.stop());
  });

  app.on("window-all-closed", () => app.quit());
}

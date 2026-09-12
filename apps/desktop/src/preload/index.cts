/**
 * Preload (CommonJS, sandbox): renderer'ga faqat `window.bumKassa` — `kassa:*` IPC kanallari va sinxron holati.
 * Node API'lari, fayl tizimi va token renderer'ga ochilmaydi.
 */
import electron = require("electron");

type IpcRendererEvent = import("electron").IpcRendererEvent;
const { contextBridge, ipcRenderer } = electron;

const CHANNELS = new Set([
  "app:status",
  "setup:options",
  "setup:register",
  "cashier:list",
  "cashier:first-login",
  "cashier:unlock",
  "cashier:logout",
  "cashier:change-pin",
  "settings:overview",
  "settings:currency-rate",
  "settings:currency-history",
  "update:check",
  "update:download",
  "update:install",
  "sync:run",
  "sync:rejected",
  "sync:unsynced",
  "sync:retry",
  "sync:discard",
  "shift:open",
  "shift:close",
  "pos:context",
  "pos:products",
  "pos:categories",
  "pos:quick-sale",
  "pos:product-by-code",
  "pos:products-by-ids",
  "pos:customers",
  "pos:customer-create",
  "ref:customers",
  "ref:customer-update",
  "ref:suppliers",
  "ref:supplier-update",
  "ref:prices",
  "ref:price-update",
  "pos:complete-sale",
  "pos:sales",
  "pos:hold",
  "pos:held",
  "pos:held-take",
  "pos:held-delete",
  "pos:find-receipt",
  "pos:return",
  "cash:report",
  "cash:movement",
  "cash:movements",
  "cash:customer-payment",
  "cash:customer-payments",
  "cash:shifts",
  "history:sales",
  "history:returns",
  "history:server",
  "purchase:suppliers",
  "purchase:supplier-create",
  "purchase:products",
  "purchase:product-by-code",
  "purchase:complete",
  "purchase:list",
  "purchase:find",
  "purchase:return",
  "purchase:returns",
  "purchase:supplier-payment",
  "stock:list",
  "stock:warehouses",
  "stock:products",
  "stock:product-by-code",
  "stock:writeoff",
  "stock:transfer",
  "stock:documents",
  "stock:movements",
  "stock:elsewhere",
  "count:draft",
  "count:set",
  "count:remove",
  "count:cancel",
  "count:complete",
  "analytics:report",
  "device:prefs",
  "device:save-prefs",
  "device:printers",
  "device:print",
  "device:print-labels",
  "device:open-drawer",
]);

contextBridge.exposeInMainWorld("bumKassa", {
  invoke(channel: string, input?: unknown) {
    if (!CHANNELS.has(channel)) return Promise.resolve({ ok: false, error: { code: "BAD_REQUEST", message: "Noma'lum kanal" } });
    return ipcRenderer.invoke(`kassa:${channel}`, input);
  },
  onSyncStatus(listener: (status: unknown) => void) {
    const handler = (_event: IpcRendererEvent, status: unknown) => listener(status);
    ipcRenderer.on("kassa:sync-status", handler);
    return () => {
      ipcRenderer.removeListener("kassa:sync-status", handler);
    };
  },
});

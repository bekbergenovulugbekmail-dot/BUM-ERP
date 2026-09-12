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
  "sync:run",
  "sync:rejected",
  "shift:open",
  "shift:close",
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

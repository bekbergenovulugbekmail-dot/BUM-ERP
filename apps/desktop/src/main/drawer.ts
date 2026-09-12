/**
 * Pul qutisi (cash drawer): ESC/POS impulsi chek printeri orqali.
 *  - `driver` — printer drayveri chop etishda o'zi ochadi (drayver sozlamasi), ilova hech narsa yubormaydi
 *  - `tcp`    — tarmoq printeri (odatda 9100-port, RAW)
 *  - `share`  — Windows'da ulashilgan printer (`\\kompyuter\ulashma_nomi`), RAW bayt fayl sifatida yoziladi
 * Shell ishlatilmaydi; host va ulashma nomi qat'iy tekshiriladi.
 */
import { writeFile } from "node:fs/promises";
import net from "node:net";

export type DrawerMode = "none" | "driver" | "tcp" | "share";
export type DrawerPrefs = { mode: DrawerMode; host?: string; port?: number; share?: string };

/** ESC p m t1 t2 — 0-pin, 50 ms / 500 ms. */
export const DRAWER_PULSE = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);

const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const SHARE = /^[A-Za-z0-9_.-][A-Za-z0-9 _.-]{0,62}$/;

export function validateDrawerPrefs(prefs: DrawerPrefs): string | null {
  if (prefs.mode === "tcp") {
    if (!prefs.host || !HOST.test(prefs.host)) return "Printer manzili noto'g'ri";
    if (prefs.port !== undefined && (!Number.isInteger(prefs.port) || prefs.port < 1 || prefs.port > 65535)) return "Port noto'g'ri";
  }
  if (prefs.mode === "share") {
    if (!prefs.share || !SHARE.test(prefs.share)) return "Ulashilgan printer nomi noto'g'ri";
    if (prefs.host && !HOST.test(prefs.host)) return "Kompyuter nomi noto'g'ri";
  }
  return null;
}

export async function kickDrawer(prefs: DrawerPrefs, timeoutMs = 3000): Promise<void> {
  const invalid = validateDrawerPrefs(prefs);
  if (invalid) throw new Error(invalid);
  if (prefs.mode === "none" || prefs.mode === "driver") return;
  if (prefs.mode === "share") {
    await writeFile(`\\\\${prefs.host || "localhost"}\\${prefs.share}`, DRAWER_PULSE);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host: prefs.host!, port: prefs.port ?? 9100 });
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error("Printer javob bermadi")));
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.end(DRAWER_PULSE, () => resolve());
    });
  });
}

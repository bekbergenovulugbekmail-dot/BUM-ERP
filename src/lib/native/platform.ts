/**
 * Android ilova (Capacitor) ichida ishlayaptimi. Ilova production web manzilini ochadi (`apps/mobile`), shuning uchun
 * web kodi bitta: brauzerda native imkoniyatlar o'rniga odatiy Web API ishlatiladi.
 */
import { Capacitor } from "@capacitor/core";

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/** Plagin ilovaga o'rnatilganmi (eski APK'da bo'lmasligi mumkin — web yo'liga qaytiladi). */
export const hasNativePlugin = (name: string): boolean => isNativeApp() && Capacitor.isPluginAvailable(name);

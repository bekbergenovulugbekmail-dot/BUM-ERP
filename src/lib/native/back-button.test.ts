/**
 * Android "orqaga" tugmasi mantig'i. Haqiqiy qurilma yo'q — plagin va DOM taqlid qilinadi,
 * shuning uchun bu yerda TARTIB tekshiriladi: ochiq oyna → tarix → ikki marta bosib chiqish.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const listeners: ((event: { canGoBack: boolean }) => void)[] = [];
const exitApp = vi.fn();

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (_name: string, handler: (event: { canGoBack: boolean }) => void) => {
      listeners.push(handler);
      return Promise.resolve({ remove: () => Promise.resolve() });
    },
    exitApp: () => {
      exitApp();
      return Promise.resolve();
    },
  },
}));

let pluginAvailable = true;
vi.mock("./platform.ts", () => ({
  isNativeApp: () => pluginAvailable,
  hasNativePlugin: () => pluginAvailable,
}));

const { listenAndroidBack } = await import("./back-button.ts");

/** Listener ro'yxatdan o'tishini kutadi (dinamik `import()` mikrovazifadan kechroq tugaydi). */
async function waitForListener() {
  for (let i = 0; i < 100 && listeners.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Tugma bosilishini taqlid qiladi. */
async function pressBack(canGoBack: boolean) {
  await waitForListener();
  for (const handler of listeners) handler({ canGoBack });
}

describe("Android orqaga tugmasi", () => {
  beforeEach(() => {
    listeners.length = 0;
    exitApp.mockClear();
    pluginAvailable = true;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("plagin yo'q eski APK'da hech narsa qilmaydi", async () => {
    pluginAvailable = false;
    const stop = listenAndroidBack({ onConfirmExit: () => undefined });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(listeners).toHaveLength(0);
    stop();
  });

  it("ochiq oyna bo'lsa — avval oyna yopiladi, tarixga tegilmaydi", async () => {
    document.body.innerHTML = '<div role="dialog" data-state="open"></div>';
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const keys: string[] = [];
    document.addEventListener("keydown", (event) => keys.push(event.key));

    const stop = listenAndroidBack({ onConfirmExit: () => undefined });
    await pressBack(true);

    expect(keys).toContain("Escape");
    expect(back).not.toHaveBeenCalled();
    expect(exitApp).not.toHaveBeenCalled();
    back.mockRestore();
    stop();
  });

  it("tarix bor bo'lsa — oldingi sahifaga qaytadi, ilovadan chiqmaydi", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const stop = listenAndroidBack({ onConfirmExit: () => undefined });
    await pressBack(true);

    expect(back).toHaveBeenCalledTimes(1);
    expect(exitApp).not.toHaveBeenCalled();
    back.mockRestore();
    stop();
  });

  it("kamera kabi to'liq ekranli oyna ham avval yopiladi", async () => {
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const keys: string[] = [];
    document.addEventListener("keydown", (event) => keys.push(event.key));

    const stop = listenAndroidBack({ onConfirmExit: () => undefined });
    await pressBack(true);

    expect(keys).toContain("Escape");
    expect(back, "oyna ochiq ekan sahifa almashmaydi").not.toHaveBeenCalled();
    back.mockRestore();
    stop();
  });

  it("qaytadigan joy qolmasa — tarixga tegilmaydi, chiqish taklif qilinadi", async () => {
    // `history.length` sessiya davomida o'sadi, lekin `canGoBack` false: bu holatda
    // `history.back()` hech narsa qilmasdi va foydalanuvchi ilovadan chiqa olmasdi
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    vi.spyOn(window.history, "length", "get").mockReturnValue(9);
    const warnings: string[] = [];

    const stop = listenAndroidBack({ onConfirmExit: (message) => warnings.push(message) });
    await pressBack(false);

    expect(back).not.toHaveBeenCalled();
    expect(warnings, "ogohlantirish chiqadi").toHaveLength(1);
    expect(exitApp).not.toHaveBeenCalled();
    back.mockRestore();
    stop();
  });

  it("bosh sahifada: birinchi bosish ogohlantiradi, ikkinchisi chiqaradi", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    vi.spyOn(window.history, "length", "get").mockReturnValue(1);
    const warnings: string[] = [];

    const stop = listenAndroidBack({ onConfirmExit: (message) => warnings.push(message) });
    await pressBack(false);
    expect(warnings).toHaveLength(1);
    expect(exitApp).not.toHaveBeenCalled();

    await pressBack(false);
    expect(exitApp).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    back.mockRestore();
    stop();
  });
});

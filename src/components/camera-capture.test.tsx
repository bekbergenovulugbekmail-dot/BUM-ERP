/**
 * Rasm olish oynasi: FAQAT kamera ochilishi kerak.
 *
 * Regressiya: `<input type="file" capture="environment">` ishlatilardi — u faqat maslahat bo'lgani
 * uchun Android WebView'da galereya ochilib ketardi va agent do'konda emas, uydan eski rasm
 * yuborishi mumkin edi.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CameraCapture from "./camera-capture.tsx";

const stopTrack = vi.fn();
let getUserMedia: ReturnType<typeof vi.fn>;

/** Kamera oqimi o'rniga soxta MediaStream. */
const fakeStream = () => ({ getTracks: () => [{ stop: stopTrack }] }) as unknown as MediaStream;

beforeEach(() => {
  stopTrack.mockClear();
  getUserMedia = vi.fn().mockResolvedValue(fakeStream());
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });

  // jsdom `play` va kadr o'lchamini bilmaydi — kadr olish uchun kerak
  Object.defineProperty(HTMLMediaElement.prototype, "play", { value: vi.fn().mockResolvedValue(undefined), configurable: true });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { value: 1280, configurable: true });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { value: 720, configurable: true });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => ({ drawImage: vi.fn() }), configurable: true });
  Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
    value: (callback: BlobCallback) => callback(new Blob(["x"], { type: "image/jpeg" })),
    configurable: true,
  });
  URL.createObjectURL = vi.fn(() => "blob:shot");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Rasm olish oynasi", () => {
  it("ochilganda KAMERA so'raladi — orqa kamera bilan", async () => {
    render(<CameraCapture title="Vitrina rasmi" onCapture={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    expect(getUserMedia.mock.calls[0]![0]).toMatchObject({
      video: expect.objectContaining({ facingMode: { ideal: "environment" } }),
      audio: false,
    });
  });

  it("galereya ochadigan fayl tanlagich umuman yo'q", async () => {
    const { container } = render(<CameraCapture title="Polka rasmi" onCapture={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("camera-shutter")).toBeTruthy());
    expect(container.querySelector('input[type="file"]'), "fayl tanlagich bo'lmasligi kerak").toBeNull();
  });

  it("tugma bosilganda kadr olinadi va ko'rib chiqish chiqadi", async () => {
    const onCapture = vi.fn();
    render(<CameraCapture title="Vitrina rasmi" onCapture={onCapture} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("camera-shutter")).toBeTruthy());

    fireEvent.click(screen.getByTestId("camera-shutter"));
    await waitFor(() => expect(screen.getByTestId("camera-shot")).toBeTruthy());
    // Kadr olingach oqim to'xtaydi (kamera bo'shaydi)
    expect(stopTrack).toHaveBeenCalled();
    expect(onCapture, "hali yuborilmadi — avval ko'rib chiqiladi").not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("camera-confirm"));
    await waitFor(() => expect(onCapture).toHaveBeenCalled());
    const file = onCapture.mock.calls[0]![0] as File;
    expect(file.type).toBe("image/jpeg");
  });

  it("qayta olish kamerani yana yoqadi", async () => {
    render(<CameraCapture title="Vitrina rasmi" onCapture={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("camera-shutter")).toBeTruthy());
    fireEvent.click(screen.getByTestId("camera-shutter"));
    await waitFor(() => expect(screen.getByTestId("camera-retake")).toBeTruthy());

    fireEvent.click(screen.getByTestId("camera-retake"));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
  });

  it("ruxsat berilmasa aniq xato — galereyaga tushib ketmaydi", async () => {
    const denied = new Error("denied");
    denied.name = "NotAllowedError";
    getUserMedia.mockRejectedValueOnce(denied);

    const { container } = render(<CameraCapture title="Vitrina rasmi" onCapture={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("camera-error")).toBeTruthy());
    expect(screen.getByTestId("camera-error").textContent).toContain("ruxsat");
    expect(container.querySelector('input[type="file"]'), "zaxira sifatida galereya taklif qilinmaydi").toBeNull();
    expect(screen.queryByTestId("camera-shutter"), "xato holatida tugma yo'q").toBeNull();
  });

  it("yopilganda kamera oqimi to'xtaydi", async () => {
    const { unmount } = render(<CameraCapture title="Vitrina rasmi" onCapture={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    unmount();
    expect(stopTrack, "kamera bo'shatilmasa qurilmada yonib qolardi").toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
/**
 * Yangilanish oqimi (egasi qarori): kassir hech nima qilmaydi — o'rnatuvchi fonda yuklanadi,
 * tayyor bo'lgach ilova "Yangilanish bor · hozir yangilaysizmi?" deb so'raydi.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateInfo } from "../src/shared/kassa-api.js";
import UpdateBanner from "../src/renderer/update-banner.tsx";

const info = (overrides: Partial<UpdateInfo> = {}): UpdateInfo => ({
  configured: true,
  available: true,
  mandatory: false,
  current: "0.4.7",
  latest: "0.5.0",
  notes: null,
  downloaded: false,
  partialBytes: 0,
  ...overrides,
});

const calls = vi.hoisted(() => ({ list: [] as string[], check: null as UpdateInfo | null, download: null as UpdateInfo | null }));
vi.mock("../src/renderer/kassa.ts", () => ({
  call: (channel: string) => {
    calls.list.push(channel);
    if (channel === "update:check") return Promise.resolve(calls.check);
    if (channel === "update:download") return Promise.resolve(calls.download);
    return Promise.resolve(undefined);
  },
  errorText: (err: unknown) => String(err),
}));

beforeEach(() => {
  calls.list = [];
  calls.check = info();
  calls.download = info({ downloaded: true });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Kassa yangilanishi", () => {
  it("fonda yuklab olinadi va tayyor bo'lgach so'raydi; 'Yangilash' o'rnatadi", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<UpdateBanner cashierId="u1" />);
    // Kassa ochilishi sekinlashmasin — tekshiruv biroz kutib boshlanadi
    expect(calls.list).toEqual([]);
    await vi.advanceTimersByTimeAsync(20_000);

    // Kassir hech nima bosmaydi: avval "tayyorlanmoqda", keyin savol oynasi
    await waitFor(() => expect(calls.list).toContain("update:download"));
    await waitFor(() => expect(screen.getByTestId("update-prompt")).toBeTruthy());
    expect(screen.getByTestId("update-prompt").textContent).toContain("0.5.0");

    await user.click(screen.getByTestId("update-install"));
    await waitFor(() => expect(calls.list).toContain("update:install"));
  });

  it("majburiy bo'lmagan yangilanishni 'Keyinroq' bilan yopish mumkin, majburiysini — yo'q", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = render(<UpdateBanner cashierId="u1" />);
    await vi.advanceTimersByTimeAsync(20_000);
    await waitFor(() => expect(screen.getByTestId("update-prompt")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Keyinroq" }));
    expect(screen.queryByTestId("update-prompt")).toBeNull();
    unmount();

    calls.check = info({ mandatory: true });
    calls.download = info({ mandatory: true, downloaded: true });
    render(<UpdateBanner cashierId="u1" />);
    await vi.advanceTimersByTimeAsync(20_000);
    await waitFor(() => expect(screen.getByTestId("update-prompt")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Keyinroq" })).toBeNull();
  });
});

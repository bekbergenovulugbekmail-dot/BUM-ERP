import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, UNAUTHENTICATED_EVENT, api, apiUrl, errorMessage } from "./api.ts";

const fetchMock = vi.fn<typeof fetch>();

function respond(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("api mijozi", () => {
  it("cookie bilan yuboradi, bo'sh parametrlarni tashlaydi va JSON qaytaradi", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { products: [{ id: "p1" }] }));

    const result = await api.get<{ products: { id: string }[] }>("/api/catalog/products", {
      search: "olma",
      categoryId: undefined,
      brandId: null,
      cursor: "",
      limit: 8,
    });

    expect(result.products[0]!.id).toBe("p1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/catalog/products?search=olma&limit=8");
    expect(init).toMatchObject({ method: "GET", credentials: "include" });
    expect(apiUrl("/api/x")).toBe("/api/x");
  });

  it("POST tanasini JSON qilib yuboradi, 204 javobi null", async () => {
    fetchMock.mockResolvedValueOnce(respond(204));

    await expect(api.post("/api/notifications/read-all")).resolves.toBeNull();
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.body).toBe("{}");
    expect(init.headers).toEqual({ "content-type": "application/json" });
  });

  it("xato javobini ApiError ga aylantiradi", async () => {
    fetchMock.mockResolvedValueOnce(respond(409, { code: "CONFLICT", message: "SKU band" }));

    const error = await api.post("/api/catalog/products", { sku: "A1" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "CONFLICT", message: "SKU band" });
    expect(errorMessage(error)).toBe("SKU band");
    expect(errorMessage("kutilmagan", "Zaxira xabar")).toBe("Zaxira xabar");
  });

  it("himoyalangan so'rovdagi 401 sessiya tugaganini bildiradi, /api/auth/* dagisi — yo'q", async () => {
    const listener = vi.fn();
    window.addEventListener(UNAUTHENTICATED_EVENT, listener);
    try {
      fetchMock.mockResolvedValueOnce(respond(401, { code: "UNAUTHENTICATED", message: "Tizimga kiring" }));
      await expect(api.get("/api/sales/orders")).rejects.toMatchObject({ status: 401 });
      expect(listener).toHaveBeenCalledTimes(1);

      fetchMock.mockResolvedValueOnce(respond(401, { code: "UNAUTHENTICATED", message: "Parol noto'g'ri" }));
      await expect(api.post("/api/auth/login", {})).rejects.toMatchObject({ message: "Parol noto'g'ri" });
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(UNAUTHENTICATED_EVENT, listener);
    }
  });

  it("tarmoq xatosi va JSON bo'lmagan xato javobi tushunarli xabar beradi", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(api.get("/api/company")).rejects.toMatchObject({ status: 0, code: "NETWORK" });

    fetchMock.mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(api.get("/api/company")).rejects.toMatchObject({ status: 502, code: "INTERNAL", message: "Xatolik yuz berdi" });
  });
});

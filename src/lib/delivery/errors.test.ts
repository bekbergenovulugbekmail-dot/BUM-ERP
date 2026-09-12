import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { ApiError } from "@/lib/api.ts";
import { deliveryErrorMessage, isNetworkError } from "./errors.ts";

const t = ((key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key)) as unknown as TFunction<"delivery">;

describe("dostavka xatolari", () => {
  it("geofence — masofa va radius bilan", () => {
    const error = new ApiError(403, "FORBIDDEN", "Mijoz manziliga yaqinlashing", { reason: "geofence", distanceMeters: 201, radiusMeters: 200 });
    expect(deliveryErrorMessage(error, t)).toBe('error.geofence {"distance":201,"radius":200}');
  });

  it("OTP noto'g'ri — qolgan urinishlar", () => {
    const error = new ApiError(400, "BAD_REQUEST", "OTP kod noto'g'ri", { reason: "otp_invalid", attemptsLeft: 3 });
    expect(deliveryErrorMessage(error, t)).toBe('error.otp_invalid {"count":3}');
  });

  it("to'lov farqi — kutilgan, yig'ilgan, farq", () => {
    const error = new ApiError(400, "BAD_REQUEST", "", {
      reason: "payment_mismatch",
      expectedAmount: "500000.00",
      collectedAmount: "480000.00",
      mismatchAmount: "20000.00",
    });
    expect(deliveryErrorMessage(error, t)).toBe('error.payment_mismatch {"expected":"500000.00","collected":"480000.00","mismatch":"20000.00"}');
  });

  it("ma'lum sabab kodlari tarjima kalitiga", () => {
    for (const reason of ["low_accuracy", "stale", "work_session_required", "photo_required", "otp_expired", "offline_too_old", "open_tasks"]) {
      expect(deliveryErrorMessage(new ApiError(400, "BAD_REQUEST", "server", { reason }), t)).toBe(`error.${reason}`);
    }
  });

  it("noma'lum sabab — server xabari", () => {
    expect(deliveryErrorMessage(new ApiError(409, "CONFLICT", "Server xabari", { reason: "boshqa" }), t)).toBe("Server xabari");
    expect(deliveryErrorMessage(new ApiError(500, "INTERNAL", "Xatolik"), t)).toBe("Xatolik");
  });

  it("tarmoq va GPS ruxsati", () => {
    expect(isNetworkError(new ApiError(0, "NETWORK", ""))).toBe(true);
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new ApiError(503, "INTERNAL", ""))).toBe(false);
    expect(deliveryErrorMessage(new ApiError(0, "NETWORK", ""), t)).toBe("error.network");
    expect(deliveryErrorMessage(new ApiError(0, "LOCATION_DENIED", ""), t)).toBe("error.location_denied");
    expect(deliveryErrorMessage(new ApiError(0, "LOCATION_UNAVAILABLE", ""), t)).toBe("error.location_unavailable");
  });
});

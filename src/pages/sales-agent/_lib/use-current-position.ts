/**
 * Agentning joriy joylashuvi (brauzer Geolocation API, bir marta; qayta so'rash — `request`).
 * Faqat masofani ko'rsatish uchun — masofa va geofence serverda hisoblanadi.
 */
import { useCallback, useEffect, useState } from "react";

export type PositionStatus = "locating" | "ready" | "denied" | "unavailable";

export type CurrentPosition = {
  status: PositionStatus;
  point: { latitude: number; longitude: number } | null;
  /** Aniqlik radiusi, metr. */
  accuracy: number | null;
};

const OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 };

const supported = () => typeof navigator !== "undefined" && "geolocation" in navigator;

export function useCurrentPosition() {
  const [state, setState] = useState<CurrentPosition>(() => ({
    status: supported() ? "locating" : "unavailable",
    point: null,
    accuracy: null,
  }));

  const locate = useCallback(() => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setState({
          status: "ready",
          point: { latitude: position.coords.latitude, longitude: position.coords.longitude },
          accuracy: position.coords.accuracy,
        }),
      (error) =>
        setState({ status: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable", point: null, accuracy: null }),
      OPTIONS,
    );
  }, []);

  useEffect(() => {
    if (supported()) locate();
  }, [locate]);

  const request = useCallback(() => {
    if (!supported()) return;
    setState((previous) => ({ ...previous, status: "locating" }));
    locate();
  }, [locate]);

  return { ...state, request };
}

/** API so'rovi parametrlari: joy aniqlangan bo'lsa `lat`/`lng`. */
export function originParams(position: CurrentPosition) {
  return position.point ? { lat: position.point.latitude, lng: position.point.longitude } : undefined;
}

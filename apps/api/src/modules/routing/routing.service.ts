/**
 * Marshrut rejasi: nuqtalar (do'konlar) uchun eng qisqa yo'l tartibi, har oraliq masofasi/vaqti va yo'l chizig'i.
 *
 * Yo'l bo'yicha masofa — bepul ochiq manbali OSRM (`ROUTING_OSRM_URL`, standart — OSRM loyihasining ommaviy serveri;
 * o'z serveringizni ko'tarish mumkin, "off" — o'chiq). OSRM'ga faqat koordinatalar yuboriladi (nom, telefon — yo'q).
 * OSRM javob bermasa yoki o'chiq bo'lsa — to'g'ri chiziq masofasi × shahar koeffitsienti (tartib baribir hisoblanadi).
 * Pullik xarita API'si ishlatilmaydi.
 */
import { env } from "../../env.js";
import { distanceMeters, type GeoPoint } from "../../shared/geo.js";
import { solveOpenPath, type DistanceMatrix } from "../../shared/route-optimizer.js";

export type RouteStop = GeoPoint & { id: string };

export type PlannedStop = {
  id: string;
  /** Tashrif tartibi (1 dan). */
  position: number;
  latitude: number;
  longitude: number;
  /** Oldingi nuqtadan (yoki boshlang'ich joydan) masofa va vaqt. */
  legMeters: number;
  legSeconds: number;
};

export type RoutePlan = {
  /** `road` — yo'l tarmog'i bo'yicha (OSRM), `straight` — to'g'ri chiziq × koeffitsient (taxminiy). */
  source: "road" | "straight";
  origin: GeoPoint | null;
  stops: PlannedStop[];
  totalMeters: number;
  totalSeconds: number;
  /** Yo'l chizig'i [kenglik, uzunlik] — faqat `road` da. */
  geometry: [number, number][] | null;
};

/** OSRM ommaviy serverining bir so'rovdagi nuqta chegarasi. */
export const ROUTING_MAX_POINTS = 100;
/** Shahar ko'chalarida yo'l to'g'ri chiziqdan taxminan shuncha uzun. */
const STRAIGHT_ROAD_FACTOR = 1.3;
/** Taxminiy o'rtacha tezlik (shahar, yuk mashinasi), m/s ≈ 30 km/soat. */
const STRAIGHT_SPEED_MPS = 30_000 / 3600;

type OsrmTable = { code: string; distances?: (number | null)[][]; durations?: (number | null)[][] };
type OsrmRoute = {
  code: string;
  routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: { distance: number; duration: number }[] }[];
};

/** Testlarda almashtiriladi (tarmoqsiz). */
export const routingProvider: { osrmUrl: string | null; timeoutMs: number; fetch: typeof fetch } = {
  osrmUrl: env.NODE_ENV === "test" || env.ROUTING_OSRM_URL === "off" ? null : env.ROUTING_OSRM_URL.replace(/\/+$/, ""),
  timeoutMs: 8000,
  fetch: (...args) => globalThis.fetch(...args),
};

const coordinates = (points: GeoPoint[]) => points.map((point) => `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`).join(";");

async function osrm<T extends { code: string }>(path: string): Promise<T | null> {
  if (!routingProvider.osrmUrl) return null;
  try {
    const response = await routingProvider.fetch(`${routingProvider.osrmUrl}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(routingProvider.timeoutMs),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as T;
    return body.code === "Ok" ? body : null;
  } catch {
    return null;
  }
}

function straightMatrix(points: GeoPoint[]): number[][] {
  return points.map((a) => points.map((b) => distanceMeters(a, b) * STRAIGHT_ROAD_FACTOR));
}

/** Masofa matritsasi (metr): OSRM `table`; yetib bo'lmaydigan juftlik — to'g'ri chiziq bilan to'ldiriladi. */
async function distanceMatrix(points: GeoPoint[]): Promise<{ matrix: number[][]; road: boolean }> {
  const straight = straightMatrix(points);
  if (points.length < 2 || points.length > ROUTING_MAX_POINTS) return { matrix: straight, road: false };
  const table = await osrm<OsrmTable>(`/table/v1/driving/${coordinates(points)}?annotations=distance`);
  const distances = table?.distances;
  if (!distances || distances.length !== points.length) return { matrix: straight, road: false };
  const matrix = distances.map((row, i) => points.map((_, j) => (i === j ? 0 : (row?.[j] ?? straight[i]![j]!))));
  return { matrix, road: true };
}

/**
 * Eng qisqa yo'l bo'yicha tashrif tartibi. `origin` — boshlang'ich joy (yetkazuvchi hozir turgan joy) yoki `null`
 * (boshlanish ham tanlanadi). `optimize: false` — berilgan tartib saqlanadi, faqat masofa va chiziq hisoblanadi.
 */
export async function planRoute(origin: GeoPoint | null, stops: RouteStop[], options: { optimize?: boolean } = {}): Promise<RoutePlan> {
  if (stops.length === 0) return { source: "straight", origin, stops: [], totalMeters: 0, totalSeconds: 0, geometry: null };
  const points: GeoPoint[] = origin ? [origin, ...stops] : [...stops];
  const offset = origin ? 1 : 0;

  let orderIdx: number[];
  let road = false;
  if (options.optimize === false) {
    orderIdx = points.map((_, i) => i);
  } else {
    const { matrix, road: fromRoad } = await distanceMatrix(points);
    road = fromRoad;
    orderIdx = solveOpenPath(matrix as DistanceMatrix, { start: origin ? 0 : null });
  }
  const ordered = orderIdx.map((i) => points[i]!);

  const route = ordered.length >= 2 && ordered.length <= ROUTING_MAX_POINTS
    ? await osrm<OsrmRoute>(`/route/v1/driving/${coordinates(ordered)}?overview=full&geometries=geojson&steps=false`)
    : null;
  const best = route?.routes?.[0];
  const legs = best && best.legs.length === ordered.length - 1 ? best.legs : null;

  const plannedStops: PlannedStop[] = [];
  let totalMeters = 0;
  let totalSeconds = 0;
  orderIdx.forEach((pointIdx, position) => {
    if (pointIdx < offset) return;
    const stop = stops[pointIdx - offset]!;
    const leg = position === 0 ? null : legs ? legs[position - 1]! : null;
    const legMeters = position === 0 ? 0 : leg ? leg.distance : distanceMeters(ordered[position - 1]!, stop) * STRAIGHT_ROAD_FACTOR;
    const legSeconds = position === 0 ? 0 : leg ? leg.duration : legMeters / STRAIGHT_SPEED_MPS;
    totalMeters += legMeters;
    totalSeconds += legSeconds;
    plannedStops.push({
      id: stop.id,
      position: plannedStops.length + 1,
      latitude: stop.latitude,
      longitude: stop.longitude,
      legMeters: Math.round(legMeters),
      legSeconds: Math.round(legSeconds),
    });
  });

  return {
    source: legs ? "road" : road ? "road" : "straight",
    origin,
    stops: plannedStops,
    totalMeters: Math.round(totalMeters),
    totalSeconds: Math.round(totalSeconds),
    geometry: legs && best ? best.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]) : null,
  };
}

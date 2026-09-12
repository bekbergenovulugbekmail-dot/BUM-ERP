/**
 * Server bilan aloqa (faqat main jarayonda — token renderer'ga chiqmaydi).
 * Tarmoq xatosi yoki vaqt tugashi — `OfflineError` (navbat saqlanadi, keyinroq qayta urinish).
 */
import type {
  AnalyticsReport,
  CashierRecord,
  CompanyInfo,
  DeviceInfo,
  PullCursors,
  PullResponse,
  PushResult,
  RemoteMovement,
  RemotePurchase,
  RemoteReceipt,
  RemoteSale,
  RemoteUpdate,
  RemoteWarehouseStock,
  WireOperation,
} from "../shared/sync-types.js";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class OfflineError extends Error {
  constructor(message = "Server bilan aloqa yo'q") {
    super(message);
    this.name = "OfflineError";
  }
}

export type SetupOptions = {
  companies: { id: string; name: string }[];
  company: { id: string; name: string } | null;
  warehouses: { id: string; name: string; code: string; isDefault: boolean }[];
};

export type Registration = { token: string; device: DeviceInfo & { isActive: boolean }; company: CompanyInfo };

export type ApiClient = ReturnType<typeof createApiClient>;

type ErrorBody = { code?: string; message?: string; details?: unknown };

function parseBody(raw: string): ErrorBody | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ErrorBody;
  } catch {
    return null;
  }
}

export function createApiClient(options: {
  baseUrl: string;
  token?: string | null;
  appVersion: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;

  async function request<T>(method: "GET" | "POST", path: string, body?: unknown, withToken = true): Promise<T> {
    const headers: Record<string, string> = { "x-app-version": options.appVersion };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (withToken && options.token) headers.authorization = `Bearer ${options.token}`;
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, options.baseUrl), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new OfflineError();
    }
    const raw = await response.text();
    const json = parseBody(raw);
    if (!response.ok) {
      // Proksi/serverga yetib bo'lmadi (502–504) — tarmoq muammosi sifatida
      if (response.status >= 502 && response.status <= 504) throw new OfflineError();
      throw new ApiError(response.status, json?.code ?? "HTTP_ERROR", json?.message ?? `HTTP ${response.status}`, json?.details);
    }
    return json as T;
  }

  const credentials = (phone: string, password: string) => ({ phone, password });

  return {
    setupOptions: (input: { phone: string; password: string; companyId?: string }) =>
      request<SetupOptions>("POST", "/api/pos-device/setup/options", { ...credentials(input.phone, input.password), ...(input.companyId ? { companyId: input.companyId } : {}) }, false),
    // Server sxemasi qat'iy — faqat ruxsat etilgan maydonlar (ortiqchasi, masalan apiUrl, 400 beradi)
    setupRegister: (input: { phone: string; password: string; companyId?: string; warehouseId: string; name: string; platform: string }) =>
      request<Registration>(
        "POST",
        "/api/pos-device/setup/register",
        {
          ...credentials(input.phone, input.password),
          ...(input.companyId ? { companyId: input.companyId } : {}),
          warehouseId: input.warehouseId,
          name: input.name,
          platform: input.platform,
          appVersion: options.appVersion,
        },
        false,
      ),
    session: () => request<{ device: DeviceInfo; company: CompanyInfo; serverTime: string }>("GET", "/api/pos-device/session"),
    cashierLogin: (phone: string, password: string) =>
      request<{ cashier: Omit<CashierRecord, "userId" | "active"> & { id: string } }>("POST", "/api/pos-device/cashiers/login", credentials(phone, password)),
    pull: (cursors: PullCursors, limit?: number, configHash?: string) =>
      request<PullResponse>("POST", "/api/pos-device/pull", { cursors, ...(limit ? { limit } : {}), ...(configHash ? { configHash } : {}) }),
    push: (ops: WireOperation[]) => request<{ results: PushResult[] }>("POST", "/api/pos-device/push", { ops }),
    receipt: (number: string) => request<{ receipt: RemoteReceipt }>("GET", `/api/pos-device/receipts/${encodeURIComponent(number)}`),
    purchase: (number: string) => request<{ purchase: RemotePurchase }>("GET", `/api/pos-device/purchases/${encodeURIComponent(number)}`),
    sales: (query: { from?: string; to?: string; limit?: number; cursor?: string }) =>
      request<{ sales: RemoteSale[]; nextCursor: string | null }>("GET", `/api/pos-device/sales?${searchParams(query)}`),
    movements: (query: { productId?: string; type?: string; limit?: number; cursor?: string }) =>
      request<{ movements: RemoteMovement[]; nextCursor: string | null }>("GET", `/api/pos-device/movements?${searchParams(query)}`),
    productStock: (productId: string) => request<{ stock: RemoteWarehouseStock[] }>("GET", `/api/pos-device/stock/${encodeURIComponent(productId)}`),
    /** Joriy versiya `x-app-version` sarlavhasida ketadi. */
    appUpdate: () => request<{ update: RemoteUpdate }>("GET", "/api/pos-device/app-update"),
    /** Kassir ruxsati (`analytics.view`) serverda tekshiriladi. */
    analytics: (query: { from: string; to: string; cashierId: string }) =>
      request<Omit<AnalyticsReport, "source">>("GET", `/api/pos-device/analytics?${searchParams(query)}`),
  };
}

function searchParams(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
  return params.toString();
}

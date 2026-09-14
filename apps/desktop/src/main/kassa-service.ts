/**
 * Kassa ilovasining asosiy xizmati (main jarayon): qurilmani ro'yxatdan o'tkazish, kassir kirishi va PIN, sinxron,
 * smena, chek (offline), qaytarish, kechiktirilgan cheklar, printer va pul qutisi. Renderer faqat IPC orqali shu
 * metodlarni chaqiradi; token va lokal baza renderer'ga chiqmaydi.
 *
 * Chek qurilmada yakunlanadi (internet shart emas): hisob serverdagi bilan bir xil (`sale-calc`), raqam qurilma kodi
 * bilan (`K01-000123`), navbatga `sale.complete` bo'lib tushadi. Qoldiq yetmasa ham sotiladi (server nomuvofiqlik
 * sifatida qayd etadi) — kassir ekranda ogohlantirishni ko'radi.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { DEFAULT_HOTKEYS, HOTKEY_ACTIONS, HOTKEY_PATTERN } from "../shared/hotkeys.js";
import { isPosDensity, isPosFontScale, normalizePosTheme, parseCustomTheme, resolvePosTheme } from "../shared/themes.js";
import type {
  AppStatus,
  CartLineInput,
  CountDraft,
  CurrencyHistory,
  CurrencyRow,
  CustomerInput,
  DevicePrefs,
  DocumentSync,
  HeldCart,
  HotkeyAction,
  LabelPrintInput,
  HeldReceipt,
  LocalCashMovement,
  LocalCustomerPayment,
  LocalPurchase,
  LocalPurchaseReturn,
  LocalReturn,
  LocalSale,
  LocalShift,
  LocalStockDocument,
  LocalSupplierPayment,
  MovementPage,
  MovementRow,
  PosCategory,
  PosContext,
  PosCustomer,
  PosProduct,
  PosSupplier,
  QuickSaleView,
  PriceInput,
  PriceRow,
  PurchaseInput,
  PurchaseProduct,
  PurchaseReturnInput,
  RejectedOperation,
  ReturnableReceipt,
  ReturnablePurchase,
  ReturnInput,
  SaleInput,
  SettingsOverview,
  ShiftReport,
  ShiftTotals,
  StockDocumentKind,
  StockFilter,
  StockLineInput,
  StockList,
  StockRow,
  StockWarehouse,
  SupplierInput,
  UnsyncedOperation,
  UpdateInfo,
} from "../shared/kassa-api.js";
import { CUSTOMER_FIELDS, PRICE_FIELDS, SUPPLIER_FIELDS } from "../shared/sync-types.js";
import { computeLine, fromMinor, mulDivRound, rescale, toMinor } from "../shared/money.js";
import {
  activePromoPrice,
  computeSale,
  estimateCashback,
  listPrice,
  promoDateOf,
  unitFactor,
  type CalcConversion,
  type CalcProduct,
} from "../shared/sale-calc.js";
import type {
  AmountLine,
  AnalyticsReport,
  BalanceGroup,
  CashierRecord,
  CashMovementKind,
  CashMovementPayload,
  CategoryStat,
  ProductStat,
  CompanyInfo,
  CustomerField,
  CustomerPayload,
  CustomerPaymentPayload,
  CustomerUpdatePayload,
  DeviceInfo,
  FieldChange,
  PartyType,
  PaymentMethod,
  PriceField,
  ProductPricesPayload,
  CurrencyRatePayload,
  SupplierField,
  SupplierUpdatePayload,
  PosConfig,
  PurchasePayload,
  PurchaseReturnPayload,
  RefundMethod,
  RemotePurchase,
  RemoteReceipt,
  RemoteUpdate,
  RemoteWarehouseStock,
  ReturnPayload,
  SalePayload,
  StockCountPayload,
  StockTransferPayload,
  StockWriteoffPayload,
  SupplierPaymentPayload,
  SyncOperationType,
  SyncStatus,
} from "../shared/sync-types.js";
import { ApiError, OfflineError, createApiClient, type ApiClient } from "./api-client.js";
import { kickDrawer, validateDrawerPrefs } from "./drawer.js";
import type { LocalStore, OutboxOp, StockDelta, StoredDocument } from "./local-store.js";
import { PIN_PATTERN, checkPin, hashPin } from "./pin.js";
import { SyncEngine } from "./sync-engine.js";
import { parseWeightBarcode, type WeightBarcodeFormat } from "../shared/scale-barcode.js";
import type { ScaleConfigInput, ScaleQueueStatus } from "../shared/scale-types.js";
import { ScaleService, type ScaleCatalogItem } from "./scale/scale-service.js";
import { ScaleError, killActiveSerialProcesses } from "./scale/transports.js";

export class KassaError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "KassaError";
    this.code = code;
    this.details = details;
  }
}

const MONEY = /^\d{1,16}(\.\d{1,2})?$/;
const QTY = /^\d{1,14}(\.\d{1,4})?$/;
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;
const PAYMENT_METHODS: PaymentMethod[] = ["cash", "card", "bank", "transfer"];
/** Bitta chekdagi to'lov qismlari chegarasi — server bilan bir xil (`MAX_PAYMENT_PARTS`). */
const MAX_PAYMENT_PARTS = 8;
const REFUND_METHODS: RefundMethod[] = ["cash", "card", "bank", "balance"];

export type TokenVault = { save(token: string): void; load(): string | null; clear(): void };

/** Chop etish (Electron) — testlarda berilmaydi. */
export type ReceiptPrinter = {
  list(): Promise<{ name: string; displayName: string }[]>;
  print(html: string, prefs: DevicePrefs): Promise<void>;
  /** Etiketkalar: rulon — har sahifa etiketka o'lchamida, A4 — varaq. */
  printLabels(html: string, options: { printerName: string | null; layout: "roll" | "a4"; widthMm: number; heightMm: number }): Promise<void>;
};

/** Yangilanish o'rnatuvchisini ishga tushirish (Electron) — testlarda berilmaydi. */
export type AppUpdater = { install(file: string): Promise<void> };

export const DEFAULT_PREFS: DevicePrefs = {
  language: "uz-Latn",
  theme: "system",
  themeSource: "system",
  themeLock: null,
  companyTheme: null,
  cashierTheme: null,
  customTheme: null,
  density: "comfortable",
  fontScale: "normal",
  productView: "cards",
  hotkeys: { ...DEFAULT_HOTKEYS },
  blockNegativeStock: false,
  defaultPaymentMethod: "cash",
  enabledPaymentMethods: ["cash", "card", "bank", "transfer"],
  syncIntervalSec: 30,
  autoLockMinutes: 0,
  printerName: null,
  paperWidth: 80,
  autoPrint: true,
  drawer: { mode: "none" },
  openDrawerOnCash: false,
  labelPrinterName: null,
};

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

const LABEL_MM = { min: 10, max: 300 };
const MAX_LABELS_HTML = 30_000_000;

type ProductRow = CalcProduct & {
  sku: string;
  barcode: string | null;
  isActive: boolean;
  isSaleable: boolean;
  imageKey?: string | null;
  isWeighted?: boolean;
  pluCode?: number | null;
  minStock?: string;
};
type CategoryRow = { id: string; name: string; parentId: string | null; sortOrder?: number; isActive: boolean };
/** Kassirning ko'rinish tanlovi (qurilmada, kassir bo'yicha): mavzu, zichlik, shrift. */
type CashierPrefs = { theme?: string; density?: string; fontScale?: string };

const IMAGE_EXTENSIONS = [
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
] as const;
/** Rasm kaliti o'zgarsa (almashtirilgan) — boshqa versiya: renderer manzili va disk keshi yangilanadi. */
const imageVersionOf = (key: string | null | undefined) => (key ? createHash("sha256").update(key).digest("hex").slice(0, 16) : null);
/** Pull'dan kelgan (yoki kassada o'zgartirilgan) valyuta. */
type LocalCurrencyRow = {
  id: string;
  code: string;
  rate: string;
  rateDate?: string | null;
  isActive: boolean;
  source?: "manual" | "cbu";
  updatedAt?: string | null;
  updatedByName?: string | null;
};
type CustomerRow = {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
  discountPercent: string;
  creditLimit: string;
  totalDebt: string;
  balance: string;
  cashbackBalance: string;
  isActive: boolean;
  address?: string | null;
  taxId?: string | null;
  partyType?: PartyType;
  email?: string | null;
  contactName?: string | null;
  bankAccount?: string | null;
  bankMfo?: string | null;
  notes?: string | null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PARTY_TEXT_LIMITS: Record<string, number> = {
  name: 200,
  phone: 20,
  email: 255,
  address: 1000,
  taxId: 32,
  contactName: 200,
  contactPerson: 200,
  bankAccount: 64,
  bankMfo: 16,
  notes: 2000,
};
const PARTY_FIELD_LABELS: Record<string, string> = {
  phone: "Telefon",
  email: "Email",
  address: "Manzil",
  taxId: "STIR",
  contactName: "Mas'ul shaxs",
  contactPerson: "Mas'ul shaxs",
  bankAccount: "Hisob raqami",
  bankMfo: "MFO",
  notes: "Izoh",
};
const PRICE_LABELS: Record<PriceField, string> = {
  salesPrice: "Sotuv narxi",
  wholesalePrice: "Ulgurji narx",
  retailPrice: "Chakana narx",
  promoPrice: "Aksiya narxi",
  promoPriceEnd: "Aksiya muddati",
  purchasePrice: "Xarid narxi",
};

/** Mijoz/ta'minotchi maydoni: bo'sh — null (nomdan tashqari), uzunlik, telefon va email formati. */
function partyValue(field: string, raw: unknown): string | null {
  if (field === "partyType") {
    if (raw !== "individual" && raw !== "legal") throw new KassaError("BAD_REQUEST", "Shaxs turi noto'g'ri");
    return raw;
  }
  const text = raw == null ? "" : String(raw).trim();
  if (field === "name") {
    if (text.length === 0 || text.length > 200) throw new KassaError("BAD_REQUEST", "Nomi 1–200 belgi");
    return text;
  }
  if (text.length === 0) return null;
  if (text.length > (PARTY_TEXT_LIMITS[field] ?? 200)) throw new KassaError("BAD_REQUEST", `${PARTY_FIELD_LABELS[field] ?? field}: juda uzun`);
  if (field === "phone" && text.replace(/\D/g, "").length < 9) throw new KassaError("BAD_REQUEST", "Telefon raqami noto'g'ri");
  if (field === "email" && !EMAIL.test(text)) throw new KassaError("BAD_REQUEST", "Email noto'g'ri");
  return text;
}

/** Kiritilgan maydonlar (undefined — o'zgarmaydi) tozalangan holda. */
function partyInput<F extends string>(input: object, fields: readonly F[]): Partial<Record<F, string | null>> {
  const source = input as Record<string, unknown>;
  const values: Partial<Record<F, string | null>> = {};
  for (const field of fields) if (source[field] !== undefined) values[field] = partyValue(field, source[field]);
  return values;
}

/** Qurilmadagi qiymatdan farq qilgan maydonlar: `from` — qurilma ko'rgan, `to` — yangi. */
function fieldChanges<F extends string>(current: object, next: Partial<Record<F, string | null>>): Partial<Record<F, FieldChange>> {
  const source = current as Record<string, unknown>;
  const changes: Partial<Record<F, FieldChange>> = {};
  for (const [field, to] of Object.entries(next) as [F, string | null][]) {
    const raw = source[field];
    const from = raw == null || raw === "" ? null : String(raw);
    if (from !== to) changes[field] = { from, to };
  }
  return changes;
}

const withoutNulls = (values: Record<string, string | null | undefined>) => Object.fromEntries(Object.entries(values).filter(([, value]) => value != null));

const EMPTY_TOTALS: ShiftTotals = { sales: "0.00", cash: "0.00", card: "0.00", bank: "0.00", returns: "0.00", receipts: 0, cashIn: "0.00", cashOut: "0.00" };

export const CASH_KINDS: Record<CashMovementKind, { type: "in" | "out"; label: string }> = {
  collection: { type: "out", label: "Inkassatsiya" },
  change_fund: { type: "in", label: "Almashtirish puli" },
  expense: { type: "out", label: "Kassadan xarajat" },
  other_in: { type: "in", label: "Boshqa kirim" },
  other_out: { type: "out", label: "Boshqa chiqim" },
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Naqd",
  card: "Karta",
  bank: "Bank",
  transfer: "O'tkazma",
  balance: "Mijoz balansidan",
  cashback: "Keshbekdan",
  debt: "Qarzga",
  change_to_balance: "Qaytim balansga (naqd)",
};

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type SupplierRow = {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
  totalDebt: string;
  isActive: boolean;
  currency?: string;
  partyType?: PartyType;
  contactPerson?: string | null;
  email?: string | null;
  address?: string | null;
  taxId?: string | null;
  bankAccount?: string | null;
  bankMfo?: string | null;
  notes?: string | null;
};
type PriceProductRow = ProductRow & {
  wholesalePrice?: string | null;
  retailPrice?: string | null;
  promoPrice?: string | null;
  promoPriceEnd?: string | null;
  purchasePrice?: string | null;
  purchaseCurrency?: string | null;
};
type PurchaseProductRow = ProductRow & {
  isPurchaseable: boolean;
  purchasePrice: string;
  purchaseCurrency: string | null;
  trackBatch?: boolean;
  trackExpiry?: boolean;
};

type StockProductRow = ProductRow & { minStock?: string };
type RawCountDraft = { id: string; startedAt: string; lines: { productId: string; counted: string }[] };

const STOCK_DOCS: Record<StockDocumentKind, { op: SyncOperationType; prefix: string }> = {
  writeoff: { op: "stock.writeoff", prefix: "W" },
  transfer: { op: "stock.transfer", prefix: "T" },
  count: { op: "stock.count", prefix: "I" },
};
const STOCK_KINDS = Object.keys(STOCK_DOCS) as StockDocumentKind[];
const STOCK_FILTERS: StockFilter[] = ["all", "positive", "low", "zero", "negative"];
const MOVEMENT_TYPES = ["receive", "issue", "transfer_out", "transfer_in", "adjust", "writeoff", "return_in", "return_out", "count"];
const MAX_COUNT_LINES = 5000;

const pad6 = (value: number) => String(value).padStart(6, "0");
const addMoney = (a: string, b: bigint) => fromMinor(toMinor(a) + b);
const note = (value: unknown) => (value ? String(value).trim().slice(0, 500) || null : null);

const pad2 = (value: number) => String(value).padStart(2, "0");
/** Qurilma vaqt mintaqasidagi sana (YYYY-MM-DD). */
const localDay = (iso: string) => {
  const at = new Date(iso);
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
};
/** Ulush, % (2 kasr, ishorali). */
function percentOf(part: bigint, whole: bigint): string | null {
  if (whole <= 0n) return null;
  const value = mulDivRound(part < 0n ? -part : part, 10_000n, whole);
  return fromMinor(part < 0n ? -value : value);
}
function balanceGroup(rows: { id: string; name: string; phone: string | null; amount: bigint }[]): BalanceGroup {
  const sorted = rows.filter((row) => row.amount > 0n).sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  return {
    total: fromMinor(sorted.reduce((sum, row) => sum + row.amount, 0n)),
    count: sorted.length,
    top: sorted.slice(0, 10).map((row) => ({ id: row.id, name: row.name, phone: row.phone, amount: fromMinor(row.amount) })),
  };
}
const amountLines = (entries: [string, string, bigint][]): AmountLine[] =>
  entries.filter(([, , amount]) => amount !== 0n).map(([key, label, amount]) => ({ key, label, amount: fromMinor(amount) }));

/** O'rtacha tannarxdagi qiymat (tiyin, miqdor ishorasi bilan): miqdor (4 kasr) × tannarx (4 kasr). */
function costValue(costs: Map<string, string>, productId: string, quantity: bigint): bigint {
  const cost = costs.get(productId);
  if (!cost) return 0n;
  const value = rescale((quantity < 0n ? -quantity : quantity) * toMinor(cost, 4), 8, 2);
  return quantity < 0n ? -value : value;
}

function documentSync<T>(stored: StoredDocument<T>): DocumentSync {
  const conflicts = stored.result?.conflicts;
  return {
    state: stored.state,
    error: stored.error?.message ?? null,
    conflicts: Array.isArray(conflicts) ? conflicts.map(String) : [],
  };
}

export class KassaService {
  private api: ApiClient | null = null;
  /** Tarozilar: sozlama, og'irlik, PLU sinxron navbati (internetsiz ham — tarozi LAN yoki COM'da). */
  readonly scales: ScaleService;
  private engine: SyncEngine | null = null;
  private cashier: CashierRecord | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private intervalMs = 0;

  constructor(
    private readonly store: LocalStore,
    private readonly vault: TokenVault,
    private readonly options: {
      appVersion: string;
      platform: string;
      fetchImpl?: typeof fetch;
      onSyncStatus?: (status: SyncStatus) => void;
      printer?: ReceiptPrinter;
      updater?: AppUpdater;
      /** Yangilanish o'rnatuvchisi yuklanadigan papka (standart — tizim vaqtinchalik papkasi). */
      downloadDir?: string;
      /** Mahsulot rasmlari keshi (yo'q bo'lsa rasmlar ko'rsatilmaydi — o'rniga belgi). */
      imageDir?: string;
    },
  ) {
    this.scales = new ScaleService(store, {
      product: (productId) => {
        const row = this.store.product<ProductRow>(productId);
        return row ? this.toScaleItem(row, this.baseCurrency(), this.rates()) : null;
      },
      weighted: () => {
        const base = this.baseCurrency();
        const rates = this.rates();
        return this.store.weightedProducts<ProductRow>().map((row) => this.toScaleItem(row, base, rates));
      },
    });
    this.connect();
  }

  // ─── Holat ───────────────────────────────────────────────────────────────

  status(): AppStatus {
    // Kassir ruxsatlari pull'da yangilanadi — ekranga eskirgan nusxa berilmasin
    if (this.cashier) this.cashier = this.store.cashier(this.cashier.userId) ?? this.cashier;
    const counts = this.store.counts();
    return {
      appVersion: this.options.appVersion,
      registered: this.api !== null,
      apiUrl: this.store.getMeta<string>("apiUrl"),
      device: this.store.getMeta<DeviceInfo>("device"),
      company: this.store.getMeta<CompanyInfo>("company"),
      cashier: this.cashier,
      shift: this.store.getMeta<LocalShift>("shift"),
      counts,
      sync: this.engine?.status() ?? { state: "idle", lastSyncAt: null, pending: counts.pending, rejected: counts.rejected, lastError: null },
    };
  }

  private connect() {
    const apiUrl = this.store.getMeta<string>("apiUrl");
    const token = this.vault.load();
    if (!apiUrl || !token) return;
    this.api = createApiClient({ baseUrl: apiUrl, token, appVersion: this.options.appVersion, fetchImpl: this.options.fetchImpl });
    this.engine = new SyncEngine(this.store, this.api, (status) => {
      this.options.onSyncStatus?.(status);
      // Har sinxron siklidan keyin (offline bo'lsa ham): o'zgargan mahsulotlar tarozi navbatiga, vaqti kelganlari yuboriladi
      if (status.state !== "syncing") this.flushScaleChanges();
    });
  }

  /** Davriy sinxron (qurilma sozlamasi, standart 30 soniya); ilova yopilganda `stop`. */
  start(intervalMs = this.prefs().syncIntervalSec * 1000) {
    this.stop();
    this.intervalMs = intervalMs;
    this.engine?.schedule();
    this.timer = setInterval(() => void this.engine?.sync(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ─── Ro'yxatdan o'tkazish ───────────────────────────────────────────────

  /** Server manzili → origin. Sxemasiz kiritilsa (`www.bum-erp.uz`) — https; yo'l va so'rov qismi tashlanadi. */
  private static apiOrigin(raw: string): string {
    const text = String(raw ?? "").trim();
    let url: URL;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
      throw new KassaError("BAD_REQUEST", "Server manzili noto'g'ri");
    }
    if (!url.hostname.includes(".") && url.hostname !== "localhost") throw new KassaError("BAD_REQUEST", "Server manzili noto'g'ri");
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new KassaError("BAD_REQUEST", "Server manzili https bo'lishi kerak");
    }
    return url.origin;
  }

  private setupClient(apiUrl: string) {
    return createApiClient({ baseUrl: KassaService.apiOrigin(apiUrl), appVersion: this.options.appVersion, fetchImpl: this.options.fetchImpl });
  }

  async setupOptions(input: { apiUrl: string; phone: string; password: string; companyId?: string }) {
    return this.setupClient(input.apiUrl).setupOptions(input);
  }

  async register(input: { apiUrl: string; phone: string; password: string; companyId?: string; warehouseId: string; name: string }): Promise<AppStatus> {
    if (this.api) throw new KassaError("CONFLICT", "Qurilma allaqachon ro'yxatdan o'tgan");
    const client = this.setupClient(input.apiUrl);
    const registration = await client.setupRegister({ ...input, platform: this.options.platform });
    this.vault.save(registration.token);
    this.store.setMeta("apiUrl", KassaService.apiOrigin(input.apiUrl));
    this.store.setMeta("device", registration.device);
    this.store.setMeta("company", registration.company);
    this.connect();
    await this.engine!.sync();
    return this.status();
  }

  // ─── Kassir ─────────────────────────────────────────────────────────────

  cashiers(): (CashierRecord & { hasPin: boolean })[] {
    return this.store
      .cashiers()
      .filter((cashier) => cashier.active)
      .map((cashier) => ({ ...cashier, hasPin: this.store.pinState(cashier.userId) !== null }));
  }

  /** Birinchi kirish (onlayn): server telefon + parolni tekshiradi, kassir shu qurilma uchun PIN o'rnatadi. */
  async firstLogin(input: { phone: string; password: string; pin: string }): Promise<AppStatus> {
    if (!this.api) throw new KassaError("NOT_REGISTERED", "Qurilma ro'yxatdan o'tmagan");
    if (!PIN_PATTERN.test(input.pin)) throw new KassaError("BAD_REQUEST", "PIN 4–8 raqamdan iborat bo'lsin");
    const { cashier } = await this.api.cashierLogin(input.phone, input.password);
    const record: CashierRecord = { ...cashier, userId: cashier.id, active: true };
    this.store.saveCashier(record);
    this.store.setPinHash(record.userId, await hashPin(input.pin));
    this.cashier = record;
    return this.status();
  }

  /** Offline almashish: lokal PIN; server o'chirgan kassir (pull'dan keyin `active: false`) kira olmaydi. */
  async unlock(input: { userId: string; pin: string }): Promise<AppStatus> {
    const record = this.store.cashier(input.userId);
    if (!record || !record.active) throw new KassaError("FORBIDDEN", "Kassir bu qurilmada ishlay olmaydi");
    const check = await checkPin(this.store, input.userId, input.pin);
    if (!check.ok) {
      const message =
        check.reason === "locked" ? "Ko'p xato urinish — PIN vaqtincha bloklandi" : check.reason === "not_set" ? "Avval onlayn kirib PIN o'rnating" : "PIN noto'g'ri";
      throw new KassaError(check.reason === "locked" ? "PIN_LOCKED" : "PIN_INVALID", message, check.ok ? undefined : { lockedUntil: check.lockedUntil });
    }
    this.cashier = record;
    return this.status();
  }

  logout(): AppStatus {
    this.cashier = null;
    return this.status();
  }

  /**
   * Qurilmani kompaniyadan uzish (boshqa kompaniyaga ulash yoki kassani topshirish). Ma'lumot yo'qolmasligi uchun
   * yuborilmagan yoki rad etilgan amal, ochiq smena bo'lsa — rad. Server imkon bo'lsa qurilmani o'chiradi (token bekor);
   * internet bo'lmasa ham lokal token va kompaniya ma'lumotlari o'chiriladi (serverdagi yozuvni web'dan o'chirish mumkin).
   */
  async unpair(): Promise<{ status: AppStatus; serverRevoked: boolean }> {
    if (!this.api) throw new KassaError("NOT_REGISTERED", "Qurilma ro'yxatdan o'tmagan");
    // Kassir chiqariladi — kutish paytida yangi sotuv yoki amal navbatga tushmasin
    this.cashier = null;
    this.stop();
    await this.engine?.whenIdle();

    const counts = this.store.counts();
    if (counts.pending > 0) {
      this.start(this.intervalMs || undefined);
      throw new KassaError("CONFLICT", `Serverga yuborilmagan ${counts.pending} ta amal bor — avval internetga ulanib sinxronlang`);
    }
    if (counts.rejected > 0) {
      this.start(this.intervalMs || undefined);
      throw new KassaError("CONFLICT", `Rad etilgan ${counts.rejected} ta amal bor — avval ularni ko'rib chiqing (qayta yuborish yoki bekor qilish)`);
    }
    if (this.store.getMeta<LocalShift>("shift")) {
      this.start(this.intervalMs || undefined);
      throw new KassaError("CONFLICT", "Smena ochiq — avval smenani yoping");
    }

    let serverRevoked = false;
    try {
      await this.api.unregister();
      serverRevoked = true;
    } catch (error) {
      // 401 — server qurilmani allaqachon o'chirgan; internet yo'q yoki boshqa server xatosi — lokal uzish baribir bajariladi
      if (error instanceof ApiError) serverRevoked = error.status === 401;
      else if (!(error instanceof OfflineError)) throw error;
    }

    this.vault.clear();
    this.store.resetCompanyData();
    this.api = null;
    this.engine = null;
    return { status: this.status(), serverRevoked };
  }

  /**
   * Ilova yopilishida: davriy sinxron to'xtaydi, tarozi (COM) jarayonlari yopiladi, lokal baza yopiladi. Sinxron sikli
   * ketayotgan bo'lsa baza ochiq qoldiriladi — jarayon chiqishi uni yopadi (har yozuv tranzaksiyada saqlangan).
   */
  shutdown(): void {
    this.stop();
    killActiveSerialProcesses();
    if (this.engine?.busy) return;
    try {
      this.store.db.close();
    } catch {
      // Baza allaqachon yopilgan
    }
  }

  /** Kassir kirgan va ruxsati bor; ruxsatlar oxirgi pull'dagi yozuvdan (server o'zgartirsa — darhol kuchga kiradi). */
  private requireCashier(permission = "pos.use"): CashierRecord {
    if (!this.cashier) throw new KassaError("UNAUTHENTICATED", "Kassir kirmagan");
    const fresh = this.store.cashier(this.cashier.userId);
    if (fresh) this.cashier = fresh;
    if (!this.cashier.active) throw new KassaError("FORBIDDEN", "Kassir bu qurilmada ishlay olmaydi");
    if (!this.cashier.permissions.includes(permission)) throw new KassaError("FORBIDDEN", `Ruxsat yo'q: ${permission}`);
    return this.cashier;
  }

  // ─── Sinxron ────────────────────────────────────────────────────────────

  async syncNow(): Promise<AppStatus> {
    if (!this.engine) throw new KassaError("NOT_REGISTERED", "Qurilma ro'yxatdan o'tmagan");
    await this.engine.syncFresh();
    return this.status();
  }

  rejected(): RejectedOperation[] {
    return this.store.rejectedOps().map((op) => ({ opId: op.opId, type: op.type, createdAt: op.createdAt, error: op.error }));
  }

  unsynced(): UnsyncedOperation[] {
    this.requireCashier();
    const warehouses = new Map(this.store.records<{ id: string; name: string }>("warehouses").map((row) => [row.id, row.name]));
    return this.store.unsyncedOps().map((op) => ({
      opId: op.opId,
      type: op.type,
      createdAt: op.createdAt,
      status: op.status === "rejected" ? "rejected" : "pending",
      attempts: op.attempts,
      error: op.error,
      number: op.number,
      total: op.total,
      label: this.operationLabel(op, warehouses),
    }));
  }

  private operationLabel(op: OutboxOp, warehouses: Map<string, string>): string | null {
    switch (op.type) {
      case "customer.create":
      case "supplier.create":
        return String(op.payload.name ?? "");
      case "cash.movement":
        return CASH_KINDS[op.payload.kind as CashMovementKind]?.label ?? null;
      case "customer.payment":
        return op.payload.purpose === "debt" ? "qarz to'lovi" : "balansga kirim";
      case "supplier.payment":
        return "ta'minotchiga to'lov";
      case "stock.writeoff":
        return op.payload.reason ? String(op.payload.reason) : null;
      case "stock.transfer":
        return `→ ${warehouses.get(String(op.payload.toWarehouseId)) ?? "boshqa ombor"}`;
      case "stock.count":
        return `${Array.isArray(op.payload.items) ? op.payload.items.length : 0} mahsulot`;
      case "customer.update":
        return this.store.customer<CustomerRow>(String(op.payload.customerId))?.name ?? null;
      case "supplier.update":
        return this.store.supplier<SupplierRow>(String(op.payload.supplierId))?.name ?? null;
      case "product.prices":
        return this.store.product<ProductRow>(String(op.payload.productId))?.name ?? null;
      case "currency.rate":
        return `${String(op.payload.code)}: ${String(op.payload.from)} → ${String(op.payload.to)}`;
      default:
        return null;
    }
  }

  retry(input: { opId: string }): AppStatus {
    this.requireCashier();
    if (!this.store.retryOp(input.opId)) throw new KassaError("NOT_FOUND", "Rad etilgan amal topilmadi");
    this.engine?.schedule();
    return this.status();
  }

  /** Rad etilgan chekni bekor qilish — rahbar ruxsati (`sales.approve`): chek serverda yo'q bo'lib qoladi. */
  discard(input: { opId: string }): AppStatus {
    this.requireCashier("sales.approve");
    if (!this.store.discardOp(input.opId)) throw new KassaError("NOT_FOUND", "Rad etilgan amal topilmadi");
    return this.status();
  }

  // ─── Smena (offline) ────────────────────────────────────────────────────

  openShift(input: { openingCash: string }): AppStatus {
    const cashier = this.requireCashier();
    if (!MONEY.test(input.openingCash)) throw new KassaError("BAD_REQUEST", "Boshlang'ich naqd summasi noto'g'ri");
    if (this.store.getMeta<LocalShift>("shift")) throw new KassaError("CONFLICT", "Smena allaqachon ochiq");
    const shift: LocalShift = {
      id: randomUUID(),
      cashierId: cashier.userId,
      cashierName: cashier.name,
      openedAt: new Date().toISOString(),
      openingCash: input.openingCash,
      totals: { ...EMPTY_TOTALS },
    };
    this.store.inTransaction(() => {
      this.store.enqueue({ type: "shift.open", cashierId: cashier.userId, payload: { shiftId: shift.id, openingCash: input.openingCash } }, new Date(shift.openedAt));
      this.store.setMeta("shift", shift);
    });
    this.engine?.schedule();
    return this.status();
  }

  closeShift(input: { closingCash: string }): AppStatus {
    const cashier = this.requireCashier();
    if (!MONEY.test(input.closingCash)) throw new KassaError("BAD_REQUEST", "Kassadagi naqd summasi noto'g'ri");
    const shift = this.store.getMeta<LocalShift>("shift");
    if (!shift) throw new KassaError("CONFLICT", "Ochiq smena yo'q");
    this.assertShiftOperator(shift, cashier);
    if (this.store.heldReceipts().length > 0) throw new KassaError("CONFLICT", "Kechiktirilgan cheklar bor — avval yakunlang yoki o'chiring");
    const closedAt = new Date();
    // Z-hisobot: yopilish lahzasidagi qurilma hujjatlaridan (smena tarixida qoladi, qayta chop etiladi)
    const report = this.buildReport(shift, closedAt.toISOString(), fromMinor(toMinor(input.closingCash)));
    this.store.inTransaction(() => {
      this.store.enqueue({ type: "shift.close", cashierId: cashier.userId, payload: { shiftId: shift.id, closingCash: input.closingCash } }, closedAt);
      this.store.saveShiftHistory({ id: shift.id, openedAt: shift.openedAt, closedAt: report.shift.closedAt!, data: report });
      this.store.deleteMeta("shift");
    });
    this.engine?.schedule();
    return this.status();
  }

  private assertShiftOperator(shift: LocalShift, cashier: CashierRecord) {
    if (shift.cashierId !== cashier.userId && !cashier.permissions.includes("sales.approve")) {
      throw new KassaError("FORBIDDEN", `Smena ${shift.cashierName ?? "boshqa kassir"}ga tegishli — o'sha kassir yoki rahbar ishlaydi`);
    }
  }

  private requireShift(cashier: CashierRecord): LocalShift {
    const shift = this.store.getMeta<LocalShift>("shift");
    if (!shift) throw new KassaError("CONFLICT", "Avval smena oching");
    this.assertShiftOperator(shift, cashier);
    return shift;
  }

  // ─── Katalog va mijozlar ────────────────────────────────────────────────

  private config(): PosConfig | null {
    return this.store.getMeta<PosConfig>("config");
  }

  private baseCurrency(): string {
    return this.store.getMeta<CompanyInfo>("company")?.currency ?? this.config()?.company.currency ?? "UZS";
  }

  /** Faol qo'shimcha valyutalar kurslari (asosiy valyutada). */
  private rates(): Record<string, string> {
    const base = this.baseCurrency();
    const rates: Record<string, string> = {};
    for (const row of this.store.records<{ code: string; rate: string; isActive: boolean }>("currencies")) {
      if (row.isActive && row.code !== base) rates[row.code] = row.rate;
    }
    return rates;
  }

  private unitNames(): Map<string, string> {
    return new Map(this.store.records<{ id: string; shortName: string }>("units").map((unit) => [unit.id, unit.shortName]));
  }

  posContext(): PosContext {
    const cashier = this.requireCashier();
    const config = this.config();
    return {
      baseCurrency: this.baseCurrency(),
      currencies: Object.entries(this.rates()).map(([code, rate]) => ({ code, rate })),
      cashback: config?.cashback ?? null,
      receipt: config?.receipt ?? null,
      labels: config?.labels ?? null,
      company: config?.company ?? null,
      permissions: cashier.permissions,
      terminals: (config?.terminals ?? []).map(({ id, name, network }) => ({ id, name, network })),
      bankAccounts: (config?.bankAccounts ?? []).map(({ id, name, bankName }) => ({ id, name, bankName })),
    };
  }

  private toPosProducts(rows: ProductRow[]): PosProduct[] {
    const stock = this.store.stockMap(rows.map((row) => row.id));
    const units = this.unitNames();
    const base = this.baseCurrency();
    const rates = this.rates();
    const today = promoDateOf();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      barcode: row.barcode,
      categoryId: row.categoryId,
      baseUnitId: row.baseUnitId,
      unitName: units.get(row.baseUnitId) ?? "",
      salesPrice: row.salesPrice,
      salesCurrency: row.salesCurrency,
      price: listPrice(row, "1", base, rates, today),
      regularPrice: listPrice(row, "1", base, rates),
      promo: activePromoPrice(row, today) === null ? null : { endsAt: row.promoPriceEnd ?? null },
      taxRate: row.taxRate,
      taxIncluded: row.taxIncluded,
      stock: fromMinor(stock.get(row.id) ?? 0n, 4),
      minStock: typeof row.minStock === "string" ? row.minStock : "0",
      imageVersion: imageVersionOf(row.imageKey),
      isWeighted: row.isWeighted === true,
      pluCode: typeof row.pluCode === "number" ? row.pluCode : null,
    }));
  }

  products(input: { query: string; limit?: number; offset?: number; categoryId?: string | null }): PosProduct[] {
    this.requireCashier();
    const limit = Math.min(Math.max(Number(input.limit) || 60, 1), 1000);
    const categoryIds = input.categoryId ? this.categoryTree().withChildren(String(input.categoryId)) : undefined;
    return this.toPosProducts(this.store.searchProducts(String(input.query ?? ""), limit, { categoryIds, offset: input.offset }) as ProductRow[]);
  }

  /** Kategoriyalar daraxti: ichki kategoriyalar bilan to'plam va yuqori darajadagi ota (tsiklga chidamli). */
  private categoryTree() {
    const rows = this.store.records<CategoryRow>("categories");
    const byId = new Map(rows.map((row) => [row.id, row]));
    const children = new Map<string, string[]>();
    for (const row of rows) if (row.parentId) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id]);
    return {
      byId,
      withChildren(categoryId: string): string[] {
        const result = new Set([categoryId]);
        const queue = [categoryId];
        while (queue.length > 0) {
          for (const child of children.get(queue.shift()!) ?? []) {
            if (!result.has(child)) {
              result.add(child);
              queue.push(child);
            }
          }
        }
        return [...result];
      },
      rootOf(categoryId: string): CategoryRow | null {
        let current = byId.get(categoryId) ?? null;
        const seen = new Set<string>();
        while (current?.parentId && byId.has(current.parentId) && !seen.has(current.id)) {
          seen.add(current.id);
          current = byId.get(current.parentId)!;
        }
        return current;
      },
    };
  }

  /** Kategoriya tablari: mahsulot soni bo'yicha yuqori darajadagi faol kategoriyalar (ichki kategoriyalari qo'shiladi). */
  private categoryTabs(counts: Iterable<[string | null, number]>): PosCategory[] {
    const tree = this.categoryTree();
    const totals = new Map<string, number>();
    for (const [categoryId, count] of counts) {
      const root = categoryId ? tree.rootOf(categoryId) : null;
      if (root?.isActive) totals.set(root.id, (totals.get(root.id) ?? 0) + count);
    }
    return [...totals]
      .map(([id, products]) => ({ row: tree.byId.get(id)!, products }))
      .sort((a, b) => (a.row.sortOrder ?? 0) - (b.row.sortOrder ?? 0) || a.row.name.localeCompare(b.row.name))
      .map(({ row, products }) => ({ id: row.id, name: row.name, products }));
  }

  posCategories(): PosCategory[] {
    this.requireCashier();
    return this.categoryTabs(this.store.saleableCountsByCategory());
  }

  /**
   * Tezkor sotuv: kompaniya tanlagan mahsulotlar (tartibi bilan; pull config — offline ham). Sotilmaydigan yoki o'chirilgan
   * mahsulot ko'rsatilmaydi; kategoriya va qidiruv shu ro'yxat ichida.
   */
  quickSale(input: { categoryId?: string | null; query?: string }): QuickSaleView {
    this.requireCashier();
    const ids = this.config()?.quickSale?.productIds ?? [];
    const rows: ProductRow[] = [];
    for (const id of ids) {
      const row = this.store.product<ProductRow>(id);
      if (row?.isActive && row.isSaleable) rows.push(row);
    }
    const all = this.toPosProducts(rows);
    const counts = new Map<string | null, number>();
    for (const product of all) counts.set(product.categoryId, (counts.get(product.categoryId) ?? 0) + 1);
    const allowed = input.categoryId ? new Set(this.categoryTree().withChildren(String(input.categoryId))) : null;
    const needle = String(input.query ?? "").trim().toLowerCase();
    const products = all.filter(
      (product) =>
        (!allowed || (product.categoryId !== null && allowed.has(product.categoryId))) &&
        (!needle || product.name.toLowerCase().includes(needle) || product.sku.toLowerCase() === needle || product.barcode === needle),
    );
    return { configured: ids.length > 0, products, categories: this.categoryTabs(counts) };
  }

  private readonly imageMisses = new Map<string, number>();

  /**
   * Mahsulot rasmi: diskdagi kesh (rasm versiyasi bo'yicha), bo'lmasa serverdan yuklab keshlanadi. Rasm yo'q, internet yo'q
   * va keshda yo'q — null (renderer belgi ko'rsatadi). Topilmagan rasm 10 daqiqa, xato — 1 daqiqa qayta so'ralmaydi.
   */
  async productImage(input: { productId: string }): Promise<{ data: Buffer; contentType: string } | null> {
    const dir = this.options.imageDir;
    const product = this.store.product<ProductRow>(String(input.productId));
    const version = imageVersionOf(product?.imageKey);
    if (!dir || !product || !version) return null;
    const base = path.join(dir, `${product.id}-${version}`);
    for (const [ext, contentType] of IMAGE_EXTENSIONS) {
      try {
        return { data: await readFile(`${base}.${ext}`), contentType };
      } catch {
        // keyingi kengaytma
      }
    }
    const missKey = `${product.id}:${version}`;
    if ((this.imageMisses.get(missKey) ?? 0) > Date.now() || !this.api) return null;
    try {
      const image = await this.api.productImage(product.id);
      if (!image) {
        this.imageMisses.set(missKey, Date.now() + 10 * 60_000);
        return null;
      }
      const ext = IMAGE_EXTENSIONS.find(([, contentType]) => contentType === image.contentType)?.[0];
      if (!ext) return null;
      await mkdir(dir, { recursive: true });
      // Shu mahsulotning eski versiyalari o'chiriladi; yozish vaqtinchalik fayl orqali (yarim fayl keshda qolmasin)
      for (const name of await readdir(dir)) if (name.startsWith(`${product.id}-`)) await rm(path.join(dir, name), { force: true });
      await writeFile(`${base}.${ext}.tmp`, image.data);
      await rename(`${base}.${ext}.tmp`, `${base}.${ext}`);
      return image;
    } catch {
      this.imageMisses.set(missKey, Date.now() + 60_000);
      return null;
    }
  }

  /** Etiketka va hujjatlardan qo'shish uchun: berilgan ID'lardagi faol mahsulotlar (tartib saqlanadi). */
  productsByIds(input: { ids: string[] }): PosProduct[] {
    this.requireCashier();
    if (!Array.isArray(input.ids) || input.ids.length > 2000) throw new KassaError("BAD_REQUEST", "Mahsulotlar ro'yxati noto'g'ri");
    const rows: ProductRow[] = [];
    for (const id of new Set(input.ids.map(String))) {
      const row = this.store.product<ProductRow>(id);
      if (row?.isActive) rows.push(row);
    }
    return this.toPosProducts(rows);
  }

  productByCode(input: { code: string }): PosProduct | null {
    this.requireCashier();
    const code = String(input.code ?? "");
    const row = this.store.productByCode<ProductRow>(code);
    if (row) return this.toPosProducts([row])[0]!;
    // Tarozi etiketkasi (EAN-13, 2x prefiks, nazorat raqami): PLU bo'yicha mahsulot, miqdor — etiketkadagi og'irlik
    const label = parseWeightBarcode(code.trim(), this.scales.barcodeFormat());
    const weighed = label ? this.store.productByPlu<ProductRow>(label.plu) : null;
    return weighed && label ? { ...this.toPosProducts([weighed])[0]!, scannedQuantity: label.quantity } : null;
  }

  // ─── Tarozilar ──────────────────────────────────────────────────────────

  /** Tarozi uchun mahsulot: 1 kg narxi asosiy valyutada (bugungi aksiya bilan), sotiladigan faol bo'lsa — aktiv. */
  private toScaleItem(row: ProductRow, base: string, rates: Record<string, string>): ScaleCatalogItem {
    return {
      productId: row.id,
      name: row.name,
      plu: typeof row.pluCode === "number" ? row.pluCode : null,
      price: listPrice(row, "1", base, rates, promoDateOf()),
      weighted: row.isWeighted === true,
      active: row.isActive && row.isSaleable,
    };
  }

  /** O'zgargan mahsulotlar tarozi navbatiga; vaqti kelgan yozuvlar fonda yuboriladi. Tarozi xatosi kassani to'xtatmaydi. */
  private flushScaleChanges(): void {
    const changed = this.store.takeChangedProducts();
    try {
      if (changed.length > 0) this.scales.enqueueProducts(changed);
    } catch {
      // sozlama buzilgan bo'lsa ham sinxron davom etadi — xato navbat oynasida ko'rinadi
    }
    void this.scales.processQueue().catch(() => undefined);
  }

  private async scaleCall<T>(action: () => T | Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof ScaleError) throw new KassaError(error.code, error.message);
      throw error;
    }
  }

  scaleList() {
    this.requireCashier("scale.view");
    return this.scales.list();
  }

  scaleSave(input: ScaleConfigInput) {
    this.requireCashier("scale.manage");
    return this.scaleCall(() => this.scales.save(input));
  }

  scaleRemove(input: { id: string }) {
    this.requireCashier("scale.manage");
    return this.scaleCall(() => this.scales.remove(String(input.id ?? "")));
  }

  scaleTest(input: { id: string }) {
    this.requireCashier("scale.view");
    return this.scaleCall(() => this.scales.test(String(input.id ?? "")));
  }

  /** Sotuv uchun og'irlik — kassada ishlaydigan har kassir. */
  scaleReadWeight(input: { id?: string }) {
    this.requireCashier();
    return this.scaleCall(() => this.scales.readWeight(input.id ? String(input.id) : undefined));
  }

  scaleFullSync(input: { id: string }) {
    this.requireCashier("scale.sync");
    return this.scaleCall(async () => {
      const run = await this.scales.fullSync(String(input.id ?? ""));
      void this.scales.processQueue(String(input.id)).catch(() => undefined);
      return run;
    });
  }

  scaleProcess(input: { id?: string }) {
    this.requireCashier("scale.sync");
    return this.scaleCall(() => this.scales.processQueue(input.id ? String(input.id) : undefined));
  }

  scaleQueue(input: { id: string; status?: ScaleQueueStatus }) {
    this.requireCashier("scale.view");
    const status = (["PENDING", "PROCESSING", "SUCCESS", "FAILED"] as const).find((value) => value === input.status);
    return this.scaleCall(() => this.scales.queue(String(input.id ?? ""), { status }));
  }

  scaleRetry(input: { id: string; itemIds?: number[] }) {
    this.requireCashier("scale.sync");
    return this.scaleCall(() => {
      const retried = this.scales.retry(String(input.id ?? ""), Array.isArray(input.itemIds) ? input.itemIds.map(Number) : undefined);
      void this.scales.processQueue(String(input.id)).catch(() => undefined);
      return retried;
    });
  }

  scaleReconcile(input: { id: string }) {
    this.requireCashier("scale.view");
    return this.scaleCall(() => this.scales.reconcile(String(input.id ?? "")));
  }

  scaleBarcode(): WeightBarcodeFormat {
    this.requireCashier();
    return this.scales.barcodeFormat();
  }

  scaleSaveBarcode(input: WeightBarcodeFormat): WeightBarcodeFormat {
    this.requireCashier("scale.manage");
    return this.scales.saveBarcodeFormat(input);
  }

  private toPosCustomer(row: CustomerRow, pending: Set<string>): PosCustomer {
    return {
      id: row.id,
      name: row.name,
      code: row.code ?? null,
      phone: row.phone ?? null,
      contactName: row.contactName ?? null,
      partyType: row.partyType ?? "individual",
      email: row.email ?? null,
      address: row.address ?? null,
      taxId: row.taxId ?? null,
      bankAccount: row.bankAccount ?? null,
      bankMfo: row.bankMfo ?? null,
      notes: row.notes ?? null,
      discountPercent: row.discountPercent,
      creditLimit: row.creditLimit,
      totalDebt: row.totalDebt,
      balance: row.balance,
      cashbackBalance: row.cashbackBalance,
      isActive: row.isActive,
      pending: pending.has(row.id),
    };
  }

  customers(input: { query: string }): PosCustomer[] {
    this.requireCashier();
    const pending = this.store.pendingCustomerIds();
    return this.store.searchCustomers<CustomerRow>(String(input.query ?? "")).map((row) => this.toPosCustomer(row, pending));
  }

  /** Ma'lumotlar bo'limi: mijozlar ro'yxati (jismoniy/yuridik filtri bilan). */
  referenceCustomers(input: { query: string; partyType?: PartyType; limit?: number }): PosCustomer[] {
    this.requireCashier();
    const pending = this.store.pendingCustomerIds();
    const limit = Math.min(Math.max(Number(input.limit) || 500, 1), 5000);
    return this.store
      .searchCustomers<CustomerRow>(String(input.query ?? ""), limit)
      .map((row) => this.toPosCustomer(row, pending))
      .filter((customer) => !input.partyType || customer.partyType === input.partyType);
  }

  /**
   * Mijozni tahrirlash (`crm.manage`, web bilan bir xil) — offline. Serverga faqat o'zgargan maydonlar qurilma ko'rgan
   * qiymati bilan boradi: orada web'da o'zgargan maydon ustiga yozilmaydi.
   */
  updateCustomer(input: { customerId: string } & Partial<CustomerInput>): PosCustomer {
    const cashier = this.requireCashierWith("crm.manage");
    const row = this.store.customer<CustomerRow>(String(input.customerId ?? ""));
    if (!row) throw new KassaError("NOT_FOUND", "Mijoz topilmadi");
    const values = partyInput(input, CUSTOMER_FIELDS);
    const changes = fieldChanges<CustomerField>({ ...row, partyType: row.partyType ?? "individual" }, values);
    const pending = this.store.pendingCustomerIds();
    if (Object.keys(changes).length === 0) return this.toPosCustomer(row, pending);
    const updated: CustomerRow = { ...row, ...values } as CustomerRow;
    this.store.inTransaction(() => {
      const payload: CustomerUpdatePayload = { customerId: row.id, changes };
      this.store.enqueue({ type: "customer.update", cashierId: cashier.userId, payload });
      this.store.saveCustomer(updated);
    });
    this.engine?.schedule();
    return this.toPosCustomer(updated, pending);
  }

  createCustomer(input: CustomerInput): PosCustomer {
    const cashier = this.requireCashier();
    const values = partyInput({ ...input, name: input.name ?? "" }, CUSTOMER_FIELDS);
    const name = values.name!;
    const phone = values.phone ?? null;
    if (phone) {
      const digits = phone.replace(/\D/g, "").slice(-9);
      const same = this.store.searchCustomers<CustomerRow>(digits, 5).find((row) => (row.phone ?? "").replace(/\D/g, "").endsWith(digits));
      if (same) throw new KassaError("CONFLICT", `Bu telefon raqamli mijoz bor: ${same.name}`);
    }
    const row: CustomerRow = {
      id: randomUUID(),
      name,
      code: null,
      phone,
      discountPercent: "0",
      creditLimit: "0",
      totalDebt: "0",
      balance: "0",
      cashbackBalance: "0",
      isActive: true,
      address: values.address ?? null,
      taxId: values.taxId ?? null,
      partyType: (values.partyType as PartyType | undefined) ?? "individual",
      email: values.email ?? null,
      contactName: values.contactName ?? null,
      bankAccount: values.bankAccount ?? null,
      bankMfo: values.bankMfo ?? null,
      notes: values.notes ?? null,
    };
    this.store.inTransaction(() => {
      // Standart qiymatlar yuborilmaydi (bo'sh maydon va jismoniy shaxs)
      const payload: CustomerPayload = {
        customerId: row.id,
        name,
        phone,
        ...withoutNulls({ email: row.email, address: row.address, taxId: row.taxId, contactName: row.contactName, bankAccount: row.bankAccount, bankMfo: row.bankMfo, notes: row.notes }),
        ...(row.partyType === "legal" ? { partyType: "legal" as const } : {}),
      };
      this.store.enqueue({ type: "customer.create", cashierId: cashier.userId, payload });
      this.store.saveCustomer(row);
    });
    this.engine?.schedule();
    return this.toPosCustomer(row, new Set([row.id]));
  }

  // ─── Chek ───────────────────────────────────────────────────────────────

  /** Savat qatorlari: mahsulot, birlik koeffitsienti, narx (o'zgartirish — `sales.edit`), zaxira ta'siri. */
  private prepareLines(lines: CartLineInput[], cashier: CashierRecord, customerDiscount: string) {
    if (!Array.isArray(lines) || lines.length === 0) throw new KassaError("BAD_REQUEST", "Savatcha bo'sh");
    if (lines.length > 500) throw new KassaError("BAD_REQUEST", "Chekda ko'pi bilan 500 qator");
    const base = this.baseCurrency();
    const rates = this.rates();
    const conversions = this.store.records<CalcConversion>("unitConversions");
    const units = this.unitNames();
    const canEdit = cashier.permissions.includes("sales.edit");
    const stockDeltas = new Map<string, bigint>();

    const prepared = lines.map((line) => {
      const quantity = String(line.quantity ?? "");
      if (!QTY.test(quantity) || toMinor(quantity, 4) <= 0n) throw new KassaError("BAD_REQUEST", "Miqdor noto'g'ri");
      const product = this.store.product<ProductRow>(String(line.productId));
      if (!product || !product.isActive || !product.isSaleable) throw new KassaError("BAD_REQUEST", `${product?.name ?? "Mahsulot"}: sotilmaydi`);
      const factor = unitFactor(product, String(line.unitId), conversions);
      if (!factor) throw new KassaError("BAD_REQUEST", `${product.name}: bu o'lchov birligidan asosiy birlikka konversiya yo'q`);
      // Aksiya narxi sotuv kunida (server offline chekni ham shu sana bilan tekshiradi)
      const list = listPrice(product, factor, base, rates, promoDateOf());
      if (list === null) throw new KassaError("BAD_REQUEST", `${product.salesCurrency} valyutasi yoqilmagan — narxni hisoblab bo'lmaydi`);
      const unitPrice = line.unitPrice ?? list;
      const discountPercent = line.discountPercent ?? customerDiscount;
      if (!QTY.test(unitPrice)) throw new KassaError("BAD_REQUEST", `${product.name}: narx noto'g'ri`);
      if (!PERCENT.test(discountPercent) || toMinor(discountPercent) > 10_000n) throw new KassaError("BAD_REQUEST", `${product.name}: chegirma 0–100%`);
      const changed = toMinor(unitPrice, 4) !== toMinor(list, 4) || toMinor(discountPercent) !== toMinor(customerDiscount);
      if (changed && !canEdit) throw new KassaError("FORBIDDEN", "Narx yoki chegirmani o'zgartirish uchun ruxsat yo'q: sales.edit");
      const baseQty = rescale(toMinor(quantity, 4) * toMinor(factor, 4), 8, 4);
      stockDeltas.set(product.id, (stockDeltas.get(product.id) ?? 0n) + baseQty);
      return { id: randomUUID(), product, unitId: String(line.unitId), unitName: units.get(String(line.unitId)) ?? "", quantity, unitPrice, discountPercent };
    });
    return { prepared, stockDeltas, base, rates };
  }

  completeSale(input: SaleInput): LocalSale {
    const cashier = this.requireCashier();
    const shift = this.requireShift(cashier);
    const device = this.store.getMeta<DeviceInfo>("device");
    if (!device) throw new KassaError("NOT_REGISTERED", "Qurilma ro'yxatdan o'tmagan");
    // Aralash to'lov: naqd, karta (terminal bo'yicha), bank (har qism bir marta, summa null — qoldiq); har usul shu kassada yoqilgan bo'lsin
    const mixed = Array.isArray(input.payments) && input.payments.length > 0;
    if (mixed && input.payments!.length > MAX_PAYMENT_PARTS) throw new KassaError("BAD_REQUEST", "To'lov qismlari juda ko'p");
    const methods = mixed ? input.payments!.map((part) => part.method) : [input.paymentMethod];
    const prefs = this.prefs();
    for (const method of methods) {
      if (!PAYMENT_METHODS.includes(method) || (mixed && method === ("transfer" as PaymentMethod))) throw new KassaError("BAD_REQUEST", "To'lov usuli noto'g'ri");
      if (!prefs.enabledPaymentMethods.includes(method)) {
        throw new KassaError("BAD_REQUEST", `${METHOD_LABELS[method] ?? method} to'lovi bu kassada o'chirilgan (Sozlamalar → To'lov)`);
      }
    }
    if (mixed && input.payments!.some((part) => part.amount !== null && !MONEY.test(String(part.amount)))) {
      throw new KassaError("BAD_REQUEST", "To'lov summasi noto'g'ri");
    }
    // Terminal — serverdan sinxronlangan faol ro'yxatda va faqat kartada; pul serverda terminal bog'langan bank hisobiga
    const terminals = new Map((this.config()?.terminals ?? []).map((terminal) => [terminal.id, terminal]));
    const bankAccounts = new Map((this.config()?.bankAccounts ?? []).map((account) => [account.id, account]));
    for (const part of mixed ? input.payments! : []) {
      if (part.terminalId) {
        if (part.method !== "card") throw new KassaError("BAD_REQUEST", "Terminal faqat karta to'lovida tanlanadi");
        if (!terminals.has(String(part.terminalId))) throw new KassaError("BAD_REQUEST", "Terminal topilmadi yoki faol emas — sinxronlashni kuting");
      }
      if (part.cashAccountId) {
        if (part.method !== "bank") throw new KassaError("BAD_REQUEST", "Bank hisobi faqat bank to'lovida tanlanadi");
        if (!bankAccounts.has(String(part.cashAccountId))) throw new KassaError("BAD_REQUEST", "Bank hisobi kassada yo'q — sinxronlashni kuting");
      }
    }

    let customer: CustomerRow | null = null;
    if (input.customerId) {
      customer = this.store.customer<CustomerRow>(String(input.customerId));
      if (!customer) throw new KassaError("BAD_REQUEST", "Mijoz topilmadi");
      if (!customer.isActive) throw new KassaError("BAD_REQUEST", "Mijoz faol emas");
    }
    const { prepared, stockDeltas, base, rates } = this.prepareLines(input.lines, cashier, customer?.discountPercent ?? "0");
    // Sozlama bo'yicha qoldiqsiz sotuv taqiqlangan (standart — ogohlantirib sotiladi, server nomuvofiqlik qayd etadi)
    if (prefs.blockNegativeStock) {
      const visible = this.store.stockMap([...stockDeltas.keys()]);
      for (const [productId, needed] of stockDeltas) {
        const have = visible.get(productId) ?? 0n;
        if (needed > have) {
          const name = prepared.find((line) => line.product.id === productId)?.product.name ?? "Mahsulot";
          throw new KassaError("STOCK_SHORTAGE", `${name}: qoldiq yetmaydi (bor ${fromMinor(have > 0n ? have : 0n, 4)})`);
        }
      }
    }
    const saleCurrencies = [...new Set((input.saleCurrencies ?? []).map(String))];
    for (const code of saleCurrencies) {
      if (code !== base && !rates[code]) throw new KassaError("BAD_REQUEST", `${code} valyutasi yoqilmagan`);
    }
    const config = this.config();
    const calc = computeSale({
      lines: prepared.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
        taxRate: line.product.taxRate,
        taxIncluded: line.product.taxIncluded,
        salesCurrency: line.product.salesCurrency,
      })),
      baseCurrency: base,
      rates,
      saleCurrencies: saleCurrencies.length > 0 ? saleCurrencies : [base],
      customer: customer ? { balance: customer.balance, cashbackBalance: customer.cashbackBalance } : null,
      cashback: config?.cashback ?? null,
      paymentMethod: input.paymentMethod,
      amountPaid: input.amountPaid,
      ...(mixed
        ? {
            payments: input.payments!.map((part) => ({
              method: part.method,
              amount: part.amount === null ? null : String(part.amount),
              terminalId: part.terminalId ? String(part.terminalId) : null,
              cashAccountId: part.cashAccountId ? String(part.cashAccountId) : null,
            })),
          }
        : {}),
      cashbackAmount: input.cashbackAmount,
      balanceAmount: input.balanceAmount,
      changeToBalance: !!input.changeToBalance,
      currencyPayments: (input.currencyPayments ?? []).map((part) => ({ currency: String(part.currency), amount: part.amount, method: part.method === "card" ? "card" : "cash" })),
    });
    if (calc.errors.length > 0) throw new KassaError("BAD_REQUEST", calc.errors[0]!, { errors: calc.errors });
    // Chekning asosiy usuli (hisobot va pul qutisi uchun) — eng katta qism
    const primaryMethod = mixed
      ? ([...calc.payments].sort((a, b) => (b.paid > a.paid ? 1 : b.paid < a.paid ? -1 : 0))[0]?.method ?? input.paymentMethod)
      : input.paymentMethod;
    const sentParts = calc.payments.filter((part) => part.tendered > 0n);

    const currencyMode = calc.buckets.length > 1 || !calc.hasBaseBucket;
    const usedRates: Record<string, string> = {};
    for (const line of calc.lines) if (line.currency !== base) usedRates[line.currency] = line.rate;
    for (const line of prepared) if (line.product.salesCurrency && line.product.salesCurrency !== base) usedRates[line.product.salesCurrency] = rates[line.product.salesCurrency]!;

    const categories = new Map(this.store.records<{ id: string; parentId: string | null }>("categories").map((row) => [row.id, row.parentId]));
    const earned =
      customer && config?.cashback
        ? estimateCashback(
            config.cashback,
            calc.lines.map((line, index) => ({ productId: prepared[index]!.product.id, lineTotal: line.lineTotal })),
            calc.total,
            calc.paid + calc.balanceUsed + calc.foreignPaidBase,
            (productId) => prepared.find((line) => line.product.id === productId)?.product.categoryId ?? null,
            (categoryId) => categories.get(categoryId) ?? null,
          )
        : 0n;

    const now = new Date();
    const saleId = randomUUID();
    const doc = this.store.inTransaction(() => {
      const number = `${device.code}-${String(this.store.nextSequence("sale")).padStart(6, "0")}`;
      const payload: SalePayload = {
        saleId,
        shiftId: shift.id,
        number,
        customerId: customer?.id ?? null,
        items: prepared.map((line) => ({
          id: line.id,
          productId: line.product.id,
          unitId: line.unitId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
        })),
        paymentMethod: primaryMethod,
        amountPaid: fromMinor(calc.tendered),
        ...(mixed && sentParts.length > 0
          ? {
              payments: sentParts.map((part) => ({
                method: part.method as "cash" | "card" | "bank",
                amount: fromMinor(part.tendered),
                ...(part.terminalId ? { terminalId: part.terminalId } : {}),
                ...(part.cashAccountId ? { cashAccountId: part.cashAccountId } : {}),
              })),
            }
          : {}),
        ...(calc.cashbackUsed > 0n ? { cashbackAmount: fromMinor(calc.cashbackUsed) } : {}),
        ...(calc.balanceUsed > 0n ? { balanceAmount: fromMinor(calc.balanceUsed) } : {}),
        ...(calc.changeKept > 0n ? { changeToBalance: true } : {}),
        ...(currencyMode
          ? {
              saleCurrencies: calc.buckets.map((bucket) => bucket.currency),
              currencyPayments: calc.foreign.map((part) => ({ currency: part.currency, amount: fromMinor(part.tendered), method: part.method })),
            }
          : {}),
        ...(Object.keys(usedRates).length > 0 ? { rates: usedRates } : {}),
        ...(input.notes ? { notes: String(input.notes).slice(0, 500) } : {}),
      };
      const op = this.store.enqueue({ type: "sale.complete", cashierId: cashier.userId, payload }, now);

      const sale: LocalSale = {
        id: saleId,
        number,
        shiftId: shift.id,
        cashierId: cashier.userId,
        cashierName: cashier.name,
        customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone } : null,
        createdAt: now.toISOString(),
        lines: prepared.map((line, index) => ({
          id: line.id,
          productId: line.product.id,
          name: line.product.name,
          sku: line.product.sku,
          unitId: line.unitId,
          unitName: line.unitName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          lineTotal: fromMinor(calc.lines[index]!.lineTotal),
          currency: calc.lines[index]!.currency === base ? null : calc.lines[index]!.currency,
          currencyTotal: fromMinor(calc.lines[index]!.currencyTotal),
        })),
        subtotal: fromMinor(calc.subtotal),
        tax: fromMinor(calc.tax),
        discount: fromMinor(calc.discount),
        total: fromMinor(calc.total),
        paymentMethod: primaryMethod,
        payments: calc.payments.map((part) => {
          const terminal = part.terminalId ? terminals.get(part.terminalId) : undefined;
          const account = part.cashAccountId ? bankAccounts.get(part.cashAccountId) : undefined;
          return {
            method: part.method,
            tendered: fromMinor(part.tendered),
            paid: fromMinor(part.paid),
            // Chekda terminal va bank hisobi nomi — keyin o'zgartirilsa ham tarixda qoladi
            ...(terminal ? { terminal: { id: terminal.id, name: terminal.name, network: terminal.network } } : {}),
            ...(account ? { account: { id: account.id, name: account.name } } : {}),
          };
        }),
        tendered: fromMinor(calc.tendered),
        paid: fromMinor(calc.paid),
        change: fromMinor(calc.change - calc.changeKept),
        changeToBalance: fromMinor(calc.changeKept),
        debt: fromMinor(calc.debt),
        balanceUsed: fromMinor(calc.balanceUsed),
        cashbackUsed: fromMinor(calc.cashbackUsed),
        cashbackEarned: fromMinor(earned),
        currencyTotals: currencyMode
          ? calc.buckets.map((bucket) => {
              const part = calc.foreign.find((item) => item.currency === bucket.currency);
              return part
                ? { currency: bucket.currency, total: fromMinor(part.total), paid: fromMinor(part.paid), change: fromMinor(part.change) }
                : { currency: bucket.currency, total: fromMinor(bucket.total), paid: fromMinor(calc.paid), change: fromMinor(calc.change) };
            })
          : [],
        customerAfter: customer
          ? {
              totalDebt: fromMinor(toMinor(customer.totalDebt) + calc.debt),
              balance: fromMinor(toMinor(customer.balance) - calc.balanceUsed + calc.changeKept),
              cashbackBalance: fromMinor(toMinor(customer.cashbackBalance) - calc.cashbackUsed + earned),
            }
          : null,
        sync: { state: "pending", error: null, conflicts: [] },
      };
      const deltas: StockDelta[] = [...stockDeltas].map(([productId, quantity]) => ({ productId, quantity: fromMinor(-quantity, 4) }));
      this.store.insertSale({
        id: saleId,
        number,
        opId: op.opId,
        shiftId: shift.id,
        cashierId: cashier.userId,
        customerId: customer?.id ?? null,
        total: sale.total,
        createdAt: sale.createdAt,
        doc: sale,
        stockDeltas: deltas,
      });

      // Qurilmadagi mijoz holati — keyingi offline chekda eski balans ikkinchi marta ishlatilmasin
      if (customer && sale.customerAfter) {
        this.store.saveCustomer({ ...customer, ...sale.customerAfter });
      }
      // Smena yig'indilari (kassa hisobi)
      const totals = shift.totals ?? { ...EMPTY_TOTALS };
      const paidBy = (...kinds: PaymentMethod[]) => calc.payments.reduce((sum, part) => sum + (kinds.includes(part.method) ? part.paid : 0n), 0n);
      this.store.setMeta("shift", {
        ...shift,
        totals: {
          ...totals,
          sales: addMoney(totals.sales, calc.total),
          cash: addMoney(totals.cash, calc.cashPaid + calc.changeKept),
          card: addMoney(totals.card, paidBy("card")),
          bank: addMoney(totals.bank ?? "0.00", paidBy("bank", "transfer")),
          returns: totals.returns,
          receipts: totals.receipts + 1,
        },
      } satisfies LocalShift);
      return sale;
    });

    this.engine?.schedule();
    return doc;
  }

  sales(input: { limit?: number; shiftOnly?: boolean }): LocalSale[] {
    this.requireCashier();
    const shift = this.store.getMeta<LocalShift>("shift");
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 1000);
    return this.store
      .sales<LocalSale>({ limit, ...(input.shiftOnly && shift ? { shiftId: shift.id } : {}) })
      .map((stored) => ({ ...stored.doc, sync: documentSync(stored) }));
  }

  // ─── Kechiktirilgan cheklar ─────────────────────────────────────────────

  private cartTotal(cart: HeldCart): string {
    try {
      const cashier = this.requireCashier();
      const customer = cart.customerId ? this.store.customer<CustomerRow>(cart.customerId) : null;
      const { prepared, base, rates } = this.prepareLines(cart.lines, { ...cashier, permissions: [...cashier.permissions, "sales.edit"] }, customer?.discountPercent ?? "0");
      const calc = computeSale({
        lines: prepared.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          taxRate: line.product.taxRate,
          taxIncluded: line.product.taxIncluded,
          salesCurrency: line.product.salesCurrency,
        })),
        baseCurrency: base,
        rates,
        saleCurrencies: [base],
        customer: null,
        cashback: null,
        paymentMethod: "cash",
        amountPaid: null,
        cashbackAmount: null,
        balanceAmount: null,
        changeToBalance: false,
        currencyPayments: [],
      });
      return fromMinor(calc.total);
    } catch {
      return "0.00";
    }
  }

  hold(input: { label?: string; cart: HeldCart }): HeldReceipt {
    const cashier = this.requireCashier();
    if (!input.cart || !Array.isArray(input.cart.lines) || input.cart.lines.length === 0) throw new KassaError("BAD_REQUEST", "Savatcha bo'sh");
    const cart: HeldCart = {
      customerId: input.cart.customerId ?? null,
      lines: input.cart.lines.slice(0, 500),
      saleCurrencies: Array.isArray(input.cart.saleCurrencies) ? input.cart.saleCurrencies.map(String) : [],
      ...(input.cart.display ? { display: input.cart.display } : {}),
    };
    const held: HeldReceipt = {
      id: randomUUID(),
      label: String(input.label ?? "").trim().slice(0, 60) || `Chek ${new Date().toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}`,
      total: this.cartTotal(cart),
      createdAt: new Date().toISOString(),
      cashierId: cashier.userId,
      cart,
    };
    this.store.holdReceipt({ id: held.id, cashierId: held.cashierId, label: held.label, total: held.total, createdAt: held.createdAt, data: held.cart });
    return held;
  }

  held(): HeldReceipt[] {
    this.requireCashier();
    return this.store.heldReceipts<HeldCart>().map((row) => ({ id: row.id, label: row.label, total: row.total, createdAt: row.createdAt, cashierId: row.cashierId, cart: row.data }));
  }

  takeHeld(input: { id: string }): HeldReceipt {
    this.requireCashier();
    const held = this.held().find((row) => row.id === input.id);
    if (!held) throw new KassaError("NOT_FOUND", "Kechiktirilgan chek topilmadi");
    this.store.deleteHeld(held.id);
    return held;
  }

  deleteHeld(input: { id: string }): void {
    this.requireCashier();
    if (!this.store.deleteHeld(String(input.id))) throw new KassaError("NOT_FOUND", "Kechiktirilgan chek topilmadi");
  }

  // ─── Qaytarish ──────────────────────────────────────────────────────────

  /** Qurilmadagi (sinxron bo'lmagan ham) qaytarishlar: qator bo'yicha miqdor va summa. */
  private localReturned(orderId: string) {
    const returned = new Map<string, { quantity: bigint; value: bigint }>();
    for (const stored of this.store.returnsForOrder<LocalReturn>(orderId)) {
      if (stored.state === "rejected") continue;
      for (const line of stored.doc.lines) {
        const current = returned.get(line.orderItemId) ?? { quantity: 0n, value: 0n };
        returned.set(line.orderItemId, { quantity: current.quantity + toMinor(line.quantity, 4), value: current.value + toMinor(line.lineTotal) });
      }
    }
    return returned;
  }

  /** Naqd/karta/bank bo'yicha qolgan qaytariladigan pul: berilgan qismlar − qaytarishlarda shu usulda qaytgani. */
  private static refundableAfter(parts: { method: string; amount: string }[], returns: { state: string; doc: LocalReturn }[]) {
    const left = new Map<RefundMethod, bigint>();
    for (const part of parts) {
      const key = part.method === "transfer" ? "bank" : part.method;
      if (key === "cash" || key === "card" || key === "bank") left.set(key, (left.get(key) ?? 0n) + toMinor(part.amount));
    }
    for (const stored of returns) {
      if (stored.state === "rejected") continue;
      const refunds = stored.doc.refunds?.length ? stored.doc.refunds : [{ method: stored.doc.refundMethod, amount: stored.doc.refundEstimate }];
      for (const part of refunds) if (left.has(part.method)) left.set(part.method, left.get(part.method)! - toMinor(part.amount));
    }
    return [...left].map(([method, amount]) => ({ method, amount: fromMinor(amount > 0n ? amount : 0n) }));
  }

  async findReceipt(input: { number: string }): Promise<ReturnableReceipt> {
    this.requireCashier();
    const number = String(input.number ?? "").trim().toUpperCase();
    if (!number) throw new KassaError("BAD_REQUEST", "Chek raqamini kiriting");

    const local = this.store.saleByNumber<LocalSale>(number);
    if (local) {
      const returned = this.localReturned(local.doc.id);
      // Usullar bo'yicha qolgan qaytariladigan pul: chek to'lovlari − shu kassaning oldingi qaytarishlari
      const paidParts = local.doc.payments?.length
        ? local.doc.payments.map((part) => ({ method: part.method, amount: part.paid }))
        : [{ method: local.doc.paymentMethod, amount: local.doc.paid }];
      const refundable = KassaService.refundableAfter(paidParts, this.store.returnsForOrder<LocalReturn>(local.doc.id));
      return {
        source: "local",
        orderId: local.doc.id,
        number: local.doc.number,
        createdAt: local.doc.createdAt,
        status: local.state === "rejected" || local.state === "discarded" ? local.state : "completed",
        customer: local.doc.customer ? { id: local.doc.customer.id, name: local.doc.customer.name } : null,
        total: local.doc.total,
        paid: fromMinor(toMinor(local.doc.paid) + toMinor(local.doc.balanceUsed) + toMinor(local.doc.cashbackUsed)),
        refundable,
        lines: local.doc.lines.map((line) => ({
          id: line.id,
          productId: line.productId,
          name: line.name,
          unitId: line.unitId,
          unitName: line.unitName,
          quantity: line.quantity,
          returned: fromMinor(returned.get(line.id)?.quantity ?? 0n, 4),
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
        })),
      };
    }

    if (!this.api) throw new KassaError("NOT_REGISTERED", "Qurilma ro'yxatdan o'tmagan");
    let receipt: RemoteReceipt;
    try {
      receipt = (await this.api.receipt(number)).receipt;
    } catch (error) {
      if (error instanceof OfflineError) throw new KassaError("OFFLINE", "Chek bu kassada yo'q — boshqa kassa chekini qaytarish uchun internet kerak");
      throw error;
    }
    // Server `returned_qty` ga shu kassaning hali yetib bormagan qaytarishlari qo'shiladi
    const pendingReturns = this.store.returnsForOrder<LocalReturn>(receipt.id).filter((stored) => stored.state === "pending");
    const pending = new Map<string, bigint>();
    for (const stored of pendingReturns) {
      for (const line of stored.doc.lines) pending.set(line.orderItemId, (pending.get(line.orderItemId) ?? 0n) + toMinor(line.quantity, 4));
    }
    return {
      source: "server",
      orderId: receipt.id,
      number: receipt.number,
      createdAt: receipt.createdAt,
      status: receipt.status,
      customer: receipt.customerId ? { id: receipt.customerId, name: receipt.customerName ?? "" } : null,
      total: receipt.totalAmount,
      paid: receipt.paidAmount,
      // Server qaytargani (eski server — bo'sh) minus shu kassaning hali yuborilmagan qaytarishlari
      refundable: receipt.refundable ? KassaService.refundableAfter(receipt.refundable, pendingReturns) : [],
      lines: receipt.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.productName,
        unitId: item.unitId,
        unitName: item.unitName,
        quantity: item.quantity,
        returned: fromMinor(toMinor(item.returnedQty, 4) + (pending.get(item.id) ?? 0n), 4),
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
    };
  }

  async returnItems(input: ReturnInput): Promise<LocalReturn> {
    const cashier = this.requireCashier("sales.refund");
    const shift = this.requireShift(cashier);
    const device = this.store.getMeta<DeviceInfo>("device");
    if (!device) throw new KassaError("NOT_REGISTERED", "Qurilma ro'yxatdan o'tmagan");
    const refundInput = Array.isArray(input.refunds) ? input.refunds.map((part) => ({ method: part.method, amount: String(part.amount ?? "") })) : [];
    if (!REFUND_METHODS.includes(input.refundMethod) || refundInput.some((part) => !REFUND_METHODS.includes(part.method) || !MONEY.test(part.amount))) {
      throw new KassaError("BAD_REQUEST", "Pul qaytarish usuli noto'g'ri");
    }
    if (new Set(refundInput.map((part) => part.method)).size !== refundInput.length) throw new KassaError("BAD_REQUEST", "Qaytarish usuli takrorlangan");
    const receipt = await this.findReceipt({ number: input.number });
    if (receipt.status === "rejected" || receipt.status === "discarded") throw new KassaError("CONFLICT", "Chek serverga yozilmagan — qaytarib bo'lmaydi");
    if (receipt.source === "server" && receipt.status !== "shipped" && receipt.status !== "delivered") {
      throw new KassaError("CONFLICT", "Faqat yakunlangan chekdagi mahsulot qaytariladi");
    }
    const usesBalance = refundInput.length > 0 ? refundInput.some((part) => part.method === "balance") : input.refundMethod === "balance";
    if (usesBalance && !receipt.customer) throw new KassaError("BAD_REQUEST", "Balansga qaytarish uchun chekda mijoz bo'lishi kerak");
    if (!Array.isArray(input.items) || input.items.length === 0) throw new KassaError("BAD_REQUEST", "Qaytariladigan mahsulotni tanlang");

    const lineById = new Map(receipt.lines.map((line) => [line.id, line]));
    const localValues = receipt.source === "local" ? this.localReturned(receipt.orderId) : new Map<string, { quantity: bigint; value: bigint }>();
    const conversions = this.store.records<CalcConversion>("unitConversions");
    const seen = new Set<string>();
    const stockDeltas: StockDelta[] = [];
    const lines = input.items.map((item) => {
      const line = lineById.get(String(item.orderItemId));
      if (!line || seen.has(line.id)) throw new KassaError("BAD_REQUEST", "Chekda bunday mahsulot qatori yo'q");
      seen.add(line.id);
      const qty = String(item.quantity ?? "");
      if (!QTY.test(qty) || toMinor(qty, 4) <= 0n) throw new KassaError("BAD_REQUEST", `${line.name}: miqdor noto'g'ri`);
      const quantity = toMinor(line.quantity, 4);
      const remaining = quantity - toMinor(line.returned, 4);
      const requested = toMinor(qty, 4);
      if (requested > remaining) throw new KassaError("BAD_REQUEST", `${line.name}: qaytarish miqdori qolganidan ko'p (qolgan ${fromMinor(remaining, 4)})`);
      const before = localValues.get(line.id)?.value ?? 0n;
      const value = requested === remaining && receipt.source === "local" ? toMinor(line.lineTotal) - before : mulDivRound(toMinor(line.lineTotal), requested, quantity);
      const product = this.store.product<ProductRow>(line.productId);
      const factor = product ? unitFactor(product, line.unitId, conversions) : null;
      if (factor) stockDeltas.push({ productId: line.productId, quantity: fromMinor(rescale(requested * toMinor(factor, 4), 8, 4), 4) });
      return { orderItemId: line.id, name: line.name, quantity: qty, lineTotal: fromMinor(value > 0n ? value : 0n) };
    });
    const total = lines.reduce((sum, line) => sum + toMinor(line.lineTotal), 0n);
    // Taxminiy qaytadigan pul: to'langani qaytarishdan keyingi chek summasidan oshgan qismi
    const returnedBefore = receipt.lines.reduce((sum, line) => sum + mulDivRound(toMinor(line.lineTotal), toMinor(line.returned, 4), toMinor(line.quantity, 4)), 0n);
    const netAfter = toMinor(receipt.total) - returnedBefore - total;
    const paid = toMinor(receipt.paid);
    const refundable = paid > netAfter ? paid - netAfter : 0n;
    const refundEstimate = total < refundable ? total : refundable;
    // Taqsimot (aralash to'lovli chek): yig'indisi qaytadigan pulga teng, har usul chekda shu usulda to'langanidan oshmaydi
    const refundParts = refundInput.map((part) => ({ method: part.method, amount: toMinor(part.amount) })).filter((part) => part.amount > 0n);
    if (refundParts.length > 0) {
      const sum = refundParts.reduce((acc, part) => acc + part.amount, 0n);
      if (sum !== refundEstimate) throw new KassaError("BAD_REQUEST", `Qaytariladigan pul ${fromMinor(refundEstimate)} — taqsimot yig'indisi ${fromMinor(sum)}`);
      if (receipt.refundable.length > 0) {
        for (const part of refundParts) {
          if (part.method === "balance") continue;
          const left = toMinor(receipt.refundable.find((row) => row.method === part.method)?.amount ?? "0");
          if (part.amount > left) {
            throw new KassaError("BAD_REQUEST", `${METHOD_LABELS[part.method] ?? part.method}: ko'pi bilan ${fromMinor(left)} qaytariladi (chekda shu usulda to'langan)`);
          }
        }
      }
    }
    const refundMethod = refundParts.length > 0 ? [...refundParts].sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))[0]!.method : input.refundMethod;
    const refundsDoc = refundParts.map((part) => ({ method: part.method, amount: fromMinor(part.amount) }));
    const refundedBy = (method: RefundMethod) =>
      refundParts.length > 0 ? refundParts.reduce((acc, part) => acc + (part.method === method ? part.amount : 0n), 0n) : input.refundMethod === method ? refundEstimate : 0n;

    const now = new Date();
    const returnId = randomUUID();
    const doc = this.store.inTransaction(() => {
      const number = `${device.code}-Q${String(this.store.nextSequence("return")).padStart(6, "0")}`;
      const payload: ReturnPayload = {
        returnId,
        orderId: receipt.orderId,
        shiftId: shift.id,
        number,
        items: lines.map((line) => ({ orderItemId: line.orderItemId, quantity: line.quantity })),
        refundMethod,
        ...(refundsDoc.length > 0 ? { refunds: refundsDoc } : {}),
        reason: input.reason ? String(input.reason).slice(0, 500) : null,
      };
      const op = this.store.enqueue({ type: "sale.return", cashierId: cashier.userId, payload }, now);
      const localReturn: LocalReturn = {
        id: returnId,
        number,
        orderId: receipt.orderId,
        orderNumber: receipt.number,
        shiftId: shift.id,
        cashierName: cashier.name,
        customer: receipt.customer,
        createdAt: now.toISOString(),
        lines,
        total: fromMinor(total),
        refundMethod,
        ...(refundsDoc.length > 0 ? { refunds: refundsDoc } : {}),
        refundEstimate: fromMinor(refundEstimate),
        reason: payload.reason ?? null,
        sync: { state: "pending", error: null, conflicts: [] },
      };
      this.store.insertReturn({
        id: returnId,
        number,
        opId: op.opId,
        orderId: receipt.orderId,
        shiftId: shift.id,
        cashierId: cashier.userId,
        total: localReturn.total,
        createdAt: localReturn.createdAt,
        doc: localReturn,
        stockDeltas,
      });
      const totals = shift.totals ?? { ...EMPTY_TOTALS };
      this.store.setMeta("shift", {
        ...shift,
        totals: {
          ...totals,
          returns: addMoney(totals.returns, total),
          cash: addMoney(totals.cash, -refundedBy("cash")),
          card: addMoney(totals.card, -refundedBy("card")),
          bank: addMoney(totals.bank ?? "0.00", -refundedBy("bank")),
        },
      } satisfies LocalShift);
      return localReturn;
    });
    this.engine?.schedule();
    return doc;
  }

  // ─── Kassa bo'limi: naqd harakatlari, mijoz to'lovlari, hisobotlar ──────

  /** Inkassatsiya, almashtirish puli, kassadan xarajat (`pos.cash.expense`), boshqa kirim/chiqim — offline. */
  cashMovement(input: { kind: CashMovementKind; amount: string; category?: string | null; notes?: string | null }): LocalCashMovement {
    const cashier = this.requireCashier();
    const shift = this.requireShift(cashier);
    const kind = CASH_KINDS[input.kind];
    if (!kind) throw new KassaError("BAD_REQUEST", "Harakat turi noto'g'ri");
    const amount = String(input.amount ?? "");
    if (!MONEY.test(amount) || toMinor(amount) <= 0n) throw new KassaError("BAD_REQUEST", "Summa noto'g'ri");
    if (input.kind === "expense" && !cashier.permissions.includes("pos.cash.expense") && !cashier.permissions.includes("finance.manage")) {
      throw new KassaError("FORBIDDEN", "Ruxsat yo'q: pos.cash.expense");
    }
    const category = input.kind === "expense" ? String(input.category ?? "").trim().slice(0, 64) || "kassa" : null;
    const notes = input.notes ? String(input.notes).trim().slice(0, 500) || null : null;
    const now = new Date();
    const movement: LocalCashMovement = {
      id: randomUUID(),
      shiftId: shift.id,
      kind: input.kind,
      type: kind.type,
      amount: fromMinor(toMinor(amount)),
      category,
      notes,
      cashierName: cashier.name,
      createdAt: now.toISOString(),
      sync: { state: "pending", error: null, conflicts: [] },
    };
    this.store.inTransaction(() => {
      const payload: CashMovementPayload = {
        movementId: movement.id,
        shiftId: shift.id,
        kind: input.kind,
        amount: movement.amount,
        ...(category ? { category } : {}),
        ...(notes ? { notes } : {}),
      };
      const op = this.store.enqueue({ type: "cash.movement", cashierId: cashier.userId, payload }, now);
      this.store.insertCashMovement({
        id: movement.id,
        opId: op.opId,
        shiftId: shift.id,
        cashierId: cashier.userId,
        kind: input.kind,
        amount: movement.amount,
        createdAt: movement.createdAt,
        doc: movement,
      });
      const totals = { ...EMPTY_TOTALS, ...shift.totals };
      const delta = toMinor(movement.amount);
      this.store.setMeta("shift", {
        ...shift,
        totals: kind.type === "in" ? { ...totals, cashIn: addMoney(totals.cashIn!, delta) } : { ...totals, cashOut: addMoney(totals.cashOut!, delta) },
      } satisfies LocalShift);
    });
    this.engine?.schedule();
    return movement;
  }

  cashMovements(): LocalCashMovement[] {
    this.requireCashier();
    const shift = this.store.getMeta<LocalShift>("shift");
    if (!shift) return [];
    return this.store.cashMovements<LocalCashMovement>({ limit: 1000, shiftId: shift.id }).map((stored) => ({ ...stored.doc, sync: documentSync(stored) }));
  }

  /** Mijoz qarzini to'lash yoki balansini to'ldirish (naqd/karta). Qarzdan ortig'i balansga — server ham shunday. */
  customerPayment(input: { customerId: string; purpose: "deposit" | "debt"; amount: string; method: "cash" | "card"; notes?: string | null }): LocalCustomerPayment {
    const cashier = this.requireCashier();
    const shift = this.requireShift(cashier);
    if (input.purpose !== "deposit" && input.purpose !== "debt") throw new KassaError("BAD_REQUEST", "To'lov maqsadi noto'g'ri");
    if (input.method !== "cash" && input.method !== "card") throw new KassaError("BAD_REQUEST", "To'lov usuli noto'g'ri");
    const amount = String(input.amount ?? "");
    if (!MONEY.test(amount) || toMinor(amount) <= 0n) throw new KassaError("BAD_REQUEST", "Summa noto'g'ri");
    const customer = this.store.customer<CustomerRow>(String(input.customerId));
    if (!customer) throw new KassaError("BAD_REQUEST", "Mijoz topilmadi");

    const minor = toMinor(amount);
    const debt = toMinor(customer.totalDebt) > 0n ? toMinor(customer.totalDebt) : 0n;
    const toDebt = input.purpose === "debt" ? (minor < debt ? minor : debt) : 0n;
    const customerAfter = {
      totalDebt: fromMinor(toMinor(customer.totalDebt) - toDebt),
      balance: fromMinor(toMinor(customer.balance) + minor - toDebt),
    };
    const notes = input.notes ? String(input.notes).trim().slice(0, 500) || null : null;
    const now = new Date();
    const payment: LocalCustomerPayment = {
      id: randomUUID(),
      shiftId: shift.id,
      customer: { id: customer.id, name: customer.name, phone: customer.phone },
      purpose: input.purpose,
      method: input.method,
      amount: fromMinor(minor),
      cashierName: cashier.name,
      createdAt: now.toISOString(),
      customerAfter,
      sync: { state: "pending", error: null, conflicts: [] },
    };
    this.store.inTransaction(() => {
      const payload: CustomerPaymentPayload = {
        paymentId: payment.id,
        shiftId: shift.id,
        customerId: customer.id,
        purpose: input.purpose,
        amount: payment.amount,
        method: input.method,
        ...(notes ? { notes } : {}),
      };
      const op = this.store.enqueue({ type: "customer.payment", cashierId: cashier.userId, payload }, now);
      this.store.insertCustomerPayment({
        id: payment.id,
        opId: op.opId,
        shiftId: shift.id,
        cashierId: cashier.userId,
        customerId: customer.id,
        amount: payment.amount,
        createdAt: payment.createdAt,
        doc: payment,
      });
      this.store.saveCustomer({ ...customer, ...customerAfter });
      const totals = { ...EMPTY_TOTALS, ...shift.totals };
      this.store.setMeta("shift", {
        ...shift,
        totals: input.method === "cash" ? { ...totals, cash: addMoney(totals.cash, minor) } : { ...totals, card: addMoney(totals.card, minor) },
      } satisfies LocalShift);
    });
    this.engine?.schedule();
    return payment;
  }

  customerPayments(): LocalCustomerPayment[] {
    this.requireCashier();
    const shift = this.store.getMeta<LocalShift>("shift");
    if (!shift) return [];
    return this.store.customerPayments<LocalCustomerPayment>({ limit: 1000, shiftId: shift.id }).map((stored) => ({ ...stored.doc, sync: documentSync(stored) }));
  }

  /** Smena hisoboti qurilmadagi hujjatlardan: tushum turi, qaytarishlar, mijoz to'lovlari, naqd harakatlari, kassirlar. */
  private buildReport(shift: LocalShift, closedAt: string | null, closingCash: string | null): ShiftReport {
    const alive = <T>(rows: StoredDocument<T>[]) => rows.filter((row) => row.state !== "discarded");
    const sales = alive(this.store.sales<LocalSale>({ limit: 1_000_000, shiftId: shift.id }));
    const returns = alive(this.store.returns<LocalReturn>({ limit: 1_000_000, shiftId: shift.id }));
    const movements = alive(this.store.cashMovements<LocalCashMovement>({ limit: 1_000_000, shiftId: shift.id }));
    const payments = alive(this.store.customerPayments<LocalCustomerPayment>({ limit: 1_000_000, shiftId: shift.id }));
    const purchases = alive(this.store.purchases<LocalPurchase>({ limit: 1_000_000, shiftId: shift.id }));
    const purchaseReturns = alive(this.store.purchaseReturns<LocalPurchaseReturn>({ limit: 1_000_000, shiftId: shift.id }));
    const supplierPayments = alive(this.store.supplierPayments<LocalSupplierPayment>({ limit: 1_000_000, shiftId: shift.id }));
    const supplierCash = { payments: 0, paidCash: 0n, paidCard: 0n, refunds: 0, refundCash: 0n, refundCard: 0n };
    const paidOut = (payment: { amount: string; method: "cash" | "card" }) => {
      supplierCash.payments += 1;
      if (payment.method === "cash") supplierCash.paidCash += toMinor(payment.amount);
      else supplierCash.paidCard += toMinor(payment.amount);
    };
    for (const { doc } of purchases) if (doc.payment) paidOut(doc.payment);
    for (const { doc } of supplierPayments) paidOut(doc);
    for (const { doc } of purchaseReturns) {
      if (!doc.refund) continue;
      supplierCash.refunds += 1;
      if (doc.refund.method === "cash") supplierCash.refundCash += toMinor(doc.refund.amount);
      else supplierCash.refundCard += toMinor(doc.refund.amount);
    }
    const base = this.baseCurrency();
    const device = this.store.getMeta<DeviceInfo>("device");

    const methods = new Map<string, bigint>();
    const add = (key: string, value: bigint) => {
      if (value !== 0n) methods.set(key, (methods.get(key) ?? 0n) + value);
    };
    const cashiers = new Map<string, { receipts: number; total: bigint }>();
    let salesTotal = 0n;
    let tax = 0n;
    let discount = 0n;
    let cashFromSales = 0n;
    for (const { doc } of sales) {
      salesTotal += toMinor(doc.total);
      tax += toMinor(doc.tax);
      discount += toMinor(doc.discount);
      if (doc.payments?.length) {
        // Aralash to'lov: har usul o'z qatorida; kassadagi naqd — naqd qismi va balansga qolgan qaytim
        for (const part of doc.payments) add(part.method, toMinor(part.paid));
        const cashPart = doc.payments.find((part) => part.method === "cash");
        if (cashPart) cashFromSales += toMinor(cashPart.paid) + toMinor(doc.changeToBalance);
      } else {
        add(doc.paymentMethod, toMinor(doc.paid));
        if (doc.paymentMethod === "cash") cashFromSales += toMinor(doc.paid) + toMinor(doc.changeToBalance);
      }
      add("balance", toMinor(doc.balanceUsed));
      add("cashback", toMinor(doc.cashbackUsed));
      add("debt", toMinor(doc.debt));
      add("change_to_balance", toMinor(doc.changeToBalance));
      for (const part of doc.currencyTotals) {
        if (part.currency !== base) add(`fx:${part.currency}`, toMinor(part.paid));
      }
      const name = doc.cashierName ?? "—";
      const current = cashiers.get(name) ?? { receipts: 0, total: 0n };
      cashiers.set(name, { receipts: current.receipts + 1, total: current.total + toMinor(doc.total) });
    }

    const refunds = { total: 0n, cash: 0n, card: 0n, bank: 0n, balance: 0n };
    for (const { doc } of returns) {
      refunds.total += toMinor(doc.total);
      if (doc.refunds?.length) for (const part of doc.refunds) refunds[part.method] += toMinor(part.amount);
      else refunds[doc.refundMethod] += toMinor(doc.refundEstimate);
    }
    const paid = { debtCash: 0n, debtCard: 0n, depositCash: 0n, depositCard: 0n };
    for (const { doc } of payments) {
      const key = `${doc.purpose}${doc.method === "cash" ? "Cash" : "Card"}` as keyof typeof paid;
      paid[key] += toMinor(doc.amount);
    }
    const byKind = new Map<CashMovementKind, { count: number; amount: bigint }>();
    let cashIn = 0n;
    let cashOut = 0n;
    for (const { doc } of movements) {
      const current = byKind.get(doc.kind) ?? { count: 0, amount: 0n };
      byKind.set(doc.kind, { count: current.count + 1, amount: current.amount + toMinor(doc.amount) });
      if (doc.type === "in") cashIn += toMinor(doc.amount);
      else cashOut += toMinor(doc.amount);
    }

    const expected =
      toMinor(shift.openingCash) +
      cashFromSales +
      paid.debtCash +
      paid.depositCash -
      refunds.cash +
      cashIn -
      cashOut -
      supplierCash.paidCash +
      supplierCash.refundCash;
    const unsynced = [...sales, ...returns, ...movements, ...payments, ...purchases, ...purchaseReturns, ...supplierPayments].filter(
      (row) => row.state === "pending" || row.state === "rejected",
    ).length;
    return {
      shift: {
        id: shift.id,
        cashierName: shift.cashierName,
        openedAt: shift.openedAt,
        closedAt,
        openingCash: fromMinor(toMinor(shift.openingCash)),
        closingCash,
      },
      device: device ? { code: device.code, name: device.name, warehouseName: device.warehouseName } : null,
      receipts: sales.length,
      salesTotal: fromMinor(salesTotal),
      tax: fromMinor(tax),
      discount: fromMinor(discount),
      byMethod: [...methods].map(([key, amount]) => ({
        key,
        label: key.startsWith("fx:") ? `${key.slice(3)} (valyutada)` : (METHOD_LABELS[key] ?? key),
        amount: fromMinor(amount),
      })),
      returns: {
        count: returns.length,
        total: fromMinor(refunds.total),
        cash: fromMinor(refunds.cash),
        card: fromMinor(refunds.card),
        bank: fromMinor(refunds.bank),
        balance: fromMinor(refunds.balance),
      },
      customerPayments: {
        count: payments.length,
        debtCash: fromMinor(paid.debtCash),
        debtCard: fromMinor(paid.debtCard),
        depositCash: fromMinor(paid.depositCash),
        depositCard: fromMinor(paid.depositCard),
      },
      cashMovements: [...byKind].map(([kind, row]) => ({ kind, label: CASH_KINDS[kind].label, count: row.count, amount: fromMinor(row.amount) })),
      cashIn: fromMinor(cashIn),
      cashOut: fromMinor(cashOut),
      expectedCash: fromMinor(expected),
      difference: closingCash === null ? null : fromMinor(toMinor(closingCash) - expected),
      cashiers: [...cashiers].map(([name, row]) => ({ name, receipts: row.receipts, total: fromMinor(row.total) })),
      suppliers: {
        payments: supplierCash.payments,
        paidCash: fromMinor(supplierCash.paidCash),
        paidCard: fromMinor(supplierCash.paidCard),
        refunds: supplierCash.refunds,
        refundCash: fromMinor(supplierCash.refundCash),
        refundCard: fromMinor(supplierCash.refundCard),
      },
      unsynced,
    };
  }

  /** X-hisobot (joriy smena) yoki yopilgan smena Z-hisoboti. */
  shiftReport(input: { shiftId?: string }): ShiftReport {
    this.requireCashier();
    const current = this.store.getMeta<LocalShift>("shift");
    if (input.shiftId && input.shiftId !== current?.id) {
      const closed = this.store.shiftHistory<ShiftReport>(1000).find((row) => row.shift.id === input.shiftId);
      if (!closed) throw new KassaError("NOT_FOUND", "Smena topilmadi");
      return closed;
    }
    if (!current) throw new KassaError("CONFLICT", "Ochiq smena yo'q");
    return this.buildReport(current, null, null);
  }

  shiftHistory(input: { limit?: number }): ShiftReport[] {
    this.requireCashier();
    return this.store.shiftHistory<ShiftReport>(Math.min(Math.max(input.limit ?? 30, 1), 500));
  }

  private historyRange(input: { from?: string; to?: string; limit?: number }) {
    if (input.from && !ISO_TIME.test(input.from)) throw new KassaError("BAD_REQUEST", "Sana noto'g'ri");
    if (input.to && !ISO_TIME.test(input.to)) throw new KassaError("BAD_REQUEST", "Sana noto'g'ri");
    return { limit: Math.min(Math.max(input.limit ?? 500, 1), 5000), ...(input.from ? { from: input.from } : {}), ...(input.to ? { to: input.to } : {}) };
  }

  historySales(input: { from?: string; to?: string; limit?: number }): LocalSale[] {
    this.requireCashier();
    return this.store.sales<LocalSale>(this.historyRange(input)).map((stored) => ({ ...stored.doc, sync: documentSync(stored) }));
  }

  historyReturns(input: { from?: string; to?: string; limit?: number }): LocalReturn[] {
    this.requireCashier();
    return this.store.returns<LocalReturn>(this.historyRange(input)).map((stored) => ({ ...stored.doc, sync: documentSync(stored) }));
  }

  /** Serverdagi tarix: qurilma omboridagi barcha kassalar va web (internet kerak). */
  async historyServer(input: { from?: string; to?: string; cursor?: string }) {
    this.requireCashier();
    if (!this.api) throw new KassaError("NOT_REGISTERED", "Qurilma ro'yxatdan o'tmagan");
    if ((input.from && !ISO_DATE.test(input.from)) || (input.to && !ISO_DATE.test(input.to))) throw new KassaError("BAD_REQUEST", "Sana noto'g'ri");
    try {
      return await this.api.sales({ from: input.from, to: input.to, cursor: input.cursor ? String(input.cursor).slice(0, 500) : undefined, limit: 100 });
    } catch (error) {
      if (error instanceof OfflineError) throw new KassaError("OFFLINE", "Serverdagi tarix uchun internet kerak");
      throw error;
    }
  }

  // ─── Xarid: ta'minotchilar, kassada xarid, qaytarish, to'lov ─────────────

  private requireCashierWith(...permissions: string[]): CashierRecord {
    const cashier = this.requireCashier();
    const missing = permissions.find((permission) => !cashier.permissions.includes(permission));
    if (missing) throw new KassaError("FORBIDDEN", `Ruxsat yo'q: ${missing}`);
    return cashier;
  }

  private toPosSupplier(row: SupplierRow, pending: Set<string>): PosSupplier {
    return {
      id: row.id,
      name: row.name,
      code: row.code ?? null,
      phone: row.phone ?? null,
      contactPerson: row.contactPerson ?? null,
      partyType: row.partyType ?? "legal",
      email: row.email ?? null,
      address: row.address ?? null,
      taxId: row.taxId ?? null,
      bankAccount: row.bankAccount ?? null,
      bankMfo: row.bankMfo ?? null,
      notes: row.notes ?? null,
      totalDebt: row.totalDebt ?? "0.00",
      isActive: row.isActive,
      pending: pending.has(row.id),
    };
  }

  suppliers(input: { query: string }): PosSupplier[] {
    this.requireCashierWith("purchase.create");
    const pending = this.store.pendingSupplierIds();
    return this.store.searchSuppliers<SupplierRow>(String(input.query ?? "")).map((row) => this.toPosSupplier(row, pending));
  }

  /** Ma'lumotlar bo'limi: ta'minotchilar (`purchase.view` yoki `purchase.create`). */
  referenceSuppliers(input: { query: string; partyType?: PartyType; limit?: number }): PosSupplier[] {
    const cashier = this.requireCashier();
    if (!cashier.permissions.includes("purchase.view") && !cashier.permissions.includes("purchase.create")) {
      throw new KassaError("FORBIDDEN", "Ruxsat yo'q: purchase.view");
    }
    const pending = this.store.pendingSupplierIds();
    const limit = Math.min(Math.max(Number(input.limit) || 500, 1), 5000);
    return this.store
      .searchSuppliers<SupplierRow>(String(input.query ?? ""), limit)
      .map((row) => this.toPosSupplier(row, pending))
      .filter((supplier) => !input.partyType || supplier.partyType === input.partyType);
  }

  /** Ta'minotchini tahrirlash (`purchase.edit`) — offline, faqat o'zgargan maydonlar (mijoz tahriri kabi). */
  updateSupplier(input: { supplierId: string } & Partial<SupplierInput>): PosSupplier {
    const cashier = this.requireCashierWith("purchase.edit");
    const row = this.store.supplier<SupplierRow>(String(input.supplierId ?? ""));
    if (!row) throw new KassaError("NOT_FOUND", "Ta'minotchi topilmadi");
    const values = partyInput(input, SUPPLIER_FIELDS);
    const changes = fieldChanges<SupplierField>({ ...row, partyType: row.partyType ?? "legal" }, values);
    const pending = this.store.pendingSupplierIds();
    if (Object.keys(changes).length === 0) return this.toPosSupplier(row, pending);
    const updated: SupplierRow = { ...row, ...values } as SupplierRow;
    this.store.inTransaction(() => {
      const payload: SupplierUpdatePayload = { supplierId: row.id, changes };
      this.store.enqueue({ type: "supplier.update", cashierId: cashier.userId, payload });
      this.store.saveSupplier(updated);
    });
    this.engine?.schedule();
    return this.toPosSupplier(updated, pending);
  }

  createSupplier(input: SupplierInput): PosSupplier {
    const cashier = this.requireCashierWith("purchase.create");
    const values = partyInput({ ...input, name: input.name ?? "" }, SUPPLIER_FIELDS);
    const row: SupplierRow = {
      id: randomUUID(),
      name: values.name!,
      code: null,
      phone: values.phone ?? null,
      totalDebt: "0.00",
      isActive: true,
      currency: this.baseCurrency(),
      partyType: (values.partyType as PartyType | undefined) ?? "legal",
      contactPerson: values.contactPerson ?? null,
      email: values.email ?? null,
      address: values.address ?? null,
      taxId: values.taxId ?? null,
      bankAccount: values.bankAccount ?? null,
      bankMfo: values.bankMfo ?? null,
      notes: values.notes ?? null,
    };
    this.store.inTransaction(() => {
      const payload = {
        supplierId: row.id,
        name: row.name,
        phone: row.phone,
        ...withoutNulls({ email: row.email, address: row.address, taxId: row.taxId, contactPerson: row.contactPerson, bankAccount: row.bankAccount, bankMfo: row.bankMfo, notes: row.notes }),
        ...(row.partyType === "individual" ? { partyType: "individual" as const } : {}),
      };
      this.store.enqueue({ type: "supplier.create", cashierId: cashier.userId, payload });
      this.store.saveSupplier(row);
    });
    this.engine?.schedule();
    return this.toPosSupplier(row, new Set([row.id]));
  }

  // ─── Ma'lumotlar: narxlar ───────────────────────────────────────────────

  private toPriceRows(rows: PriceProductRow[], cashier: CashierRecord): PriceRow[] {
    const stock = this.store.stockMap(rows.map((row) => row.id));
    const units = this.unitNames();
    const pending = this.store.pendingPayloadIds("product.prices", "productId");
    const showPurchase = cashier.permissions.includes("products.edit") || cashier.permissions.includes("purchase.create");
    return rows.map((row) => ({
      productId: row.id,
      name: row.name,
      sku: row.sku,
      barcode: row.barcode ?? null,
      unitName: units.get(row.baseUnitId) ?? "",
      stock: fromMinor(stock.get(row.id) ?? 0n, 4),
      salesPrice: row.salesPrice,
      salesCurrency: row.salesCurrency ?? null,
      wholesalePrice: row.wholesalePrice ?? null,
      retailPrice: row.retailPrice ?? null,
      promoPrice: row.promoPrice ?? null,
      promoPriceEnd: row.promoPriceEnd ?? null,
      purchasePrice: showPurchase ? (row.purchasePrice ?? "0.0000") : null,
      purchaseCurrency: row.purchaseCurrency ?? null,
      pending: pending.has(row.id),
    }));
  }

  priceList(input: { query: string; limit?: number }): PriceRow[] {
    const cashier = this.requireCashierWith("products.view");
    const limit = Math.min(Math.max(Number(input.limit) || 300, 1), 2000);
    return this.toPriceRows(this.store.searchProducts(String(input.query ?? ""), limit, { saleableOnly: false }) as PriceProductRow[], cashier);
  }

  /**
   * Narxlarni o'zgartirish (`products.edit`) — offline: kassada darhol amal qiladi (chek shu narxda), serverga faqat
   * o'zgargan narxlar qurilma ko'rgan qiymati bilan boradi.
   */
  updatePrices(input: PriceInput): PriceRow {
    const cashier = this.requireCashierWith("products.view", "products.edit");
    const row = this.store.product<PriceProductRow>(String(input.productId ?? ""));
    if (!row) throw new KassaError("NOT_FOUND", "Mahsulot topilmadi");
    const source = input as Record<string, unknown>;
    const next: Partial<Record<PriceField, string | null>> = {};
    for (const field of PRICE_FIELDS) {
      const raw = source[field];
      if (raw === undefined) continue;
      if (field === "promoPriceEnd") {
        const value = raw ? String(raw) : null;
        if (value && !ISO_DATE.test(value)) throw new KassaError("BAD_REQUEST", `${PRICE_LABELS[field]} noto'g'ri`);
        next[field] = value;
        continue;
      }
      if (raw === null || raw === "") {
        if (field === "salesPrice" || field === "purchasePrice") throw new KassaError("BAD_REQUEST", `${PRICE_LABELS[field]} kiritilishi shart`);
        next[field] = null;
        continue;
      }
      const text = String(raw);
      if (!QTY.test(text)) throw new KassaError("BAD_REQUEST", `${PRICE_LABELS[field]} noto'g'ri`);
      next[field] = fromMinor(toMinor(text, 4), 4);
    }
    if (next.purchasePrice !== undefined && !cashier.permissions.includes("products.edit")) throw new KassaError("FORBIDDEN", "Ruxsat yo'q: products.edit");

    // Taqqoslash 4 kasrli ko'rinishda (serverdan "10000.0000" keladi)
    const current: Record<string, string | null> = {};
    for (const field of PRICE_FIELDS) {
      const value = row[field as keyof PriceProductRow] as string | null | undefined;
      current[field] = value == null ? null : field === "promoPriceEnd" ? value : fromMinor(toMinor(value, 4), 4);
    }
    const changes = fieldChanges<PriceField>(current, next);
    if (Object.keys(changes).length === 0) return this.toPriceRows([row], cashier)[0]!;
    const updated = { ...row, ...next } as PriceProductRow;
    this.store.inTransaction(() => {
      const payload: ProductPricesPayload = { productId: row.id, changes };
      this.store.enqueue({ type: "product.prices", cashierId: cashier.userId, payload });
      this.store.saveProduct(updated);
    });
    this.engine?.schedule();
    return this.toPriceRows([updated], cashier)[0]!;
  }

  // ─── Valyuta kurslari ───────────────────────────────────────────────────

  private toCurrencyRows(rows: LocalCurrencyRow[]): CurrencyRow[] {
    const pending = this.store.pendingPayloadIds("currency.rate", "code");
    return rows.map((row) => ({
      code: row.code,
      rate: row.rate,
      rateDate: row.rateDate ?? null,
      isActive: row.isActive,
      source: row.source ?? null,
      updatedAt: row.updatedAt ?? null,
      updatedByName: row.updatedByName ?? null,
      pending: pending.has(row.code),
    }));
  }

  /**
   * Kursni kassadan o'zgartirish (`currency_rates.manage`): lokal kurs darhol yangi — keyingi cheklar shu kurs bilan;
   * serverga `currency.rate` ko'rgan va yangi kurs bilan (orada serverda o'zgargan bo'lsa — server kursi qoladi,
   * nomuvofiqlik). Eski cheklar o'z kursini saqlaydi.
   */
  updateCurrencyRate(input: { code: string; rate: string }): CurrencyRow {
    const cashier = this.requireCashierWith("currency_rates.view", "currency_rates.manage");
    const code = String(input.code ?? "").trim().toUpperCase();
    const rate = String(input.rate ?? "").trim();
    if (!QTY.test(rate) || toMinor(rate, 4) <= 0n) throw new KassaError("BAD_REQUEST", "Kurs musbat son bo'lsin (4 kasrgacha)");
    if (code === this.baseCurrency()) throw new KassaError("BAD_REQUEST", `${code} — asosiy valyuta, kursi doim 1`);
    const row = this.store.records<LocalCurrencyRow>("currencies").find((item) => item.code === code);
    if (!row) throw new KassaError("NOT_FOUND", `${code} valyutasi yo'q`);
    if (!row.isActive) throw new KassaError("BAD_REQUEST", `${code} valyutasi o'chirilgan`);
    const next = fromMinor(toMinor(rate, 4), 4);
    if (toMinor(row.rate, 4) === toMinor(next, 4)) return this.toCurrencyRows([row])[0]!;
    const now = new Date();
    const updated: LocalCurrencyRow = { ...row, rate: next, source: "manual", rateDate: now.toISOString().slice(0, 10), updatedAt: now.toISOString(), updatedByName: cashier.name };
    this.store.inTransaction(() => {
      const payload: CurrencyRatePayload = { code, from: row.rate, to: next };
      this.store.enqueue({ type: "currency.rate", cashierId: cashier.userId, payload }, now);
      this.store.saveCurrency(updated);
    });
    this.engine?.schedule();
    return this.toCurrencyRows([updated])[0]!;
  }

  /** Kurs o'zgarishlari: server tarixi (internet bilan) va kassadagi hali yuborilmaganlari. */
  async currencyHistory(input: { code?: string }): Promise<CurrencyHistory> {
    const cashier = this.requireCashierWith("currency_rates.view");
    const code = input?.code ? String(input.code).trim().toUpperCase() : undefined;
    const pending = this.store
      .pendingOps(1000)
      .filter((op) => op.type === "currency.rate" && (!code || op.payload.code === code))
      .map((op) => ({ code: String(op.payload.code), from: String(op.payload.from), to: String(op.payload.to), createdAt: op.createdAt }));
    if (!this.api) return { online: false, history: [], pending };
    try {
      const { history } = await this.api.currencyHistory(cashier.userId, code);
      return { online: true, history, pending };
    } catch (error) {
      if (error instanceof OfflineError) return { online: false, history: [], pending };
      throw error;
    }
  }

  private toPurchaseProducts(rows: PurchaseProductRow[]): PurchaseProduct[] {
    const byId = new Map(rows.map((row) => [row.id, row]));
    return this.toPosProducts(rows).map((product) => {
      const row = byId.get(product.id)!;
      return {
        ...product,
        purchasePrice: row.purchasePrice ?? "0",
        purchaseCurrency: row.purchaseCurrency ?? null,
        trackBatch: !!row.trackBatch,
        trackExpiry: !!row.trackExpiry,
      };
    });
  }

  purchaseProducts(input: { query: string }): PurchaseProduct[] {
    this.requireCashierWith("purchase.create");
    const rows = (this.store.searchProducts(String(input.query ?? ""), 80, { saleableOnly: false }) as PurchaseProductRow[]).filter((row) => row.isPurchaseable !== false);
    return this.toPurchaseProducts(rows);
  }

  purchaseProductByCode(input: { code: string }): PurchaseProduct | null {
    this.requireCashierWith("purchase.create");
    const row = this.store.productByCode<PurchaseProductRow>(String(input.code ?? ""), false);
    return row && row.isPurchaseable !== false ? this.toPurchaseProducts([row])[0]! : null;
  }

  /**
   * Kassada xarid: ta'minotchidan tovar keldi (offline). Serverda tasdiqlangan va to'liq qabul qilingan xarid bo'lib
   * yoziladi (zaxira, tannarx, ta'minotchi qarzi, jurnal). Darhol to'lov — smenadan (`purchase.approve`).
   */
  completePurchase(input: PurchaseInput): LocalPurchase {
    const cashier = this.requireCashierWith("purchase.create", "warehouse.receive");
    const device = this.store.getMeta<DeviceInfo>("device");
    if (!device) throw new KassaError("NOT_REGISTERED", "Qurilma ro'yxatdan o'tmagan");
    const supplier = this.store.supplier<SupplierRow>(String(input.supplierId ?? ""));
    if (!supplier) throw new KassaError("BAD_REQUEST", "Ta'minotchi topilmadi");
    if (!supplier.isActive) throw new KassaError("BAD_REQUEST", "Ta'minotchi faol emas");
    if (!Array.isArray(input.lines) || input.lines.length === 0) throw new KassaError("BAD_REQUEST", "Xaridda kamida bitta mahsulot bo'lishi kerak");
    if (input.lines.length > 500) throw new KassaError("BAD_REQUEST", "Xaridda ko'pi bilan 500 qator");

    const base = this.baseCurrency();
    const rates = this.rates();
    const conversions = this.store.records<CalcConversion>("unitConversions");
    const units = this.unitNames();
    const stockDeltas = new Map<string, bigint>();
    const currencyTotals = new Map<string, bigint>();
    let total = 0n;
    const lines = input.lines.map((line) => {
      const quantity = String(line.quantity ?? "");
      const unitPrice = String(line.unitPrice ?? "");
      const product = this.store.product<PurchaseProductRow>(String(line.productId));
      if (!product || !product.isActive || product.isPurchaseable === false) throw new KassaError("BAD_REQUEST", `${product?.name ?? "Mahsulot"}: xarid qilinmaydi`);
      if (!QTY.test(quantity) || toMinor(quantity, 4) <= 0n) throw new KassaError("BAD_REQUEST", `${product.name}: miqdor noto'g'ri`);
      if (!QTY.test(unitPrice)) throw new KassaError("BAD_REQUEST", `${product.name}: narx noto'g'ri`);
      const factor = unitFactor(product, String(line.unitId), conversions);
      if (!factor) throw new KassaError("BAD_REQUEST", `${product.name}: bu o'lchov birligidan asosiy birlikka konversiya yo'q`);
      const currency = line.currency && line.currency !== base ? String(line.currency) : null;
      if (currency && !rates[currency]) throw new KassaError("BAD_REQUEST", `${currency} valyutasi yoqilmagan`);
      const salesPrice = line.salesPrice ? String(line.salesPrice) : null;
      if (salesPrice !== null && !QTY.test(salesPrice)) throw new KassaError("BAD_REQUEST", `${product.name}: sotuv narxi noto'g'ri`);
      const batchNumber = line.batchNumber ? String(line.batchNumber).trim().slice(0, 64) : null;
      const expiryDate = line.expiryDate ? String(line.expiryDate) : null;
      if (expiryDate && !ISO_DATE.test(expiryDate)) throw new KassaError("BAD_REQUEST", `${product.name}: yaroqlilik muddati noto'g'ri`);
      if (product.trackBatch && !batchNumber) throw new KassaError("BAD_REQUEST", `${product.name}: partiya raqami kiritilishi shart`);
      if (product.trackExpiry && !expiryDate) throw new KassaError("BAD_REQUEST", `${product.name}: yaroqlilik muddati kiritilishi shart`);

      // Ta'minotchi narxi soliqsiz, qator valyutasida; asosiy valyutadagi qiymat qurilmadagi kurs bilan (server ham shu kursda)
      const lineTotal = computeLine({ quantity, unitPrice }).lineTotal;
      const baseTotal = currency ? rescale(lineTotal * toMinor(rates[currency]!, 4), 6, 2) : lineTotal;
      currencyTotals.set(currency ?? base, (currencyTotals.get(currency ?? base) ?? 0n) + lineTotal);
      total += baseTotal;
      const baseQty = rescale(toMinor(quantity, 4) * toMinor(factor, 4), 8, 4);
      stockDeltas.set(product.id, (stockDeltas.get(product.id) ?? 0n) + baseQty);
      return {
        id: randomUUID(),
        product,
        unitId: String(line.unitId),
        unitName: units.get(String(line.unitId)) ?? "",
        quantity,
        unitPrice,
        currency,
        lineTotal,
        baseTotal,
        salesPrice,
        batchNumber,
        expiryDate,
      };
    });

    let payment: { amount: string; method: "cash" | "card" } | null = null;
    let shift = this.store.getMeta<LocalShift>("shift");
    if (input.payment) {
      this.requireCashierWith("purchase.approve");
      shift = this.requireShift(cashier);
      const amount = String(input.payment.amount ?? "");
      if (!MONEY.test(amount) || toMinor(amount) <= 0n) throw new KassaError("BAD_REQUEST", "To'lov summasi noto'g'ri");
      if (input.payment.method !== "cash" && input.payment.method !== "card") throw new KassaError("BAD_REQUEST", "To'lov usuli noto'g'ri");
      const baseBucket = currencyTotals.get(base) ?? 0n;
      if (toMinor(amount) > baseBucket) {
        throw new KassaError("BAD_REQUEST", `Darhol to'lov ${base} dagi qatorlar summasidan oshmasin (${fromMinor(baseBucket)}) — valyutadagi qismini keyin to'lang`);
      }
      payment = { amount: fromMinor(toMinor(amount)), method: input.payment.method };
    }
    const notes = input.notes ? String(input.notes).trim().slice(0, 500) || null : null;
    const usedRates: Record<string, string> = {};
    for (const line of lines) if (line.currency) usedRates[line.currency] = rates[line.currency]!;

    const now = new Date();
    const purchaseId = randomUUID();
    const doc = this.store.inTransaction(() => {
      const number = `${device.code}-P${pad6(this.store.nextSequence("purchase"))}`;
      const payload: PurchasePayload = {
        purchaseId,
        number,
        supplierId: supplier.id,
        items: lines.map((line) => ({
          id: line.id,
          productId: line.product.id,
          unitId: line.unitId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          ...(line.currency ? { currency: line.currency } : {}),
          ...(line.salesPrice ? { salesPrice: line.salesPrice } : {}),
          ...(line.batchNumber ? { batchNumber: line.batchNumber } : {}),
          ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}),
        })),
        ...(Object.keys(usedRates).length > 0 ? { rates: usedRates } : {}),
        ...(notes ? { notes } : {}),
        ...(payment && shift ? { payment: { shiftId: shift.id, ...payment } } : {}),
      };
      const op = this.store.enqueue({ type: "purchase.complete", cashierId: cashier.userId, payload }, now);
      const purchase: LocalPurchase = {
        id: purchaseId,
        number,
        supplier: { id: supplier.id, name: supplier.name },
        shiftId: shift?.id ?? null,
        cashierName: cashier.name,
        createdAt: now.toISOString(),
        lines: lines.map((line) => ({
          id: line.id,
          productId: line.product.id,
          name: line.product.name,
          sku: line.product.sku,
          unitId: line.unitId,
          unitName: line.unitName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          currency: line.currency,
          lineTotal: fromMinor(line.lineTotal),
          baseTotal: fromMinor(line.baseTotal),
          salesPrice: line.salesPrice,
        })),
        total: fromMinor(total),
        currencyTotals: [...currencyTotals].map(([currency, amount]) => ({ currency, total: fromMinor(amount) })),
        payment,
        notes,
        sync: { state: "pending", error: null, conflicts: [] },
      };
      this.store.insertPurchase({
        id: purchaseId,
        number,
        opId: op.opId,
        shiftId: shift?.id ?? null,
        cashierId: cashier.userId,
        supplierId: supplier.id,
        total: purchase.total,
        createdAt: purchase.createdAt,
        doc: purchase,
        stockDeltas: [...stockDeltas].map(([productId, quantity]) => ({ productId, quantity: fromMinor(quantity, 4) })),
      });
      this.store.saveSupplier({ ...supplier, totalDebt: fromMinor(toMinor(supplier.totalDebt ?? "0") + total - (payment ? toMinor(payment.amount) : 0n)) });
      if (payment?.method === "cash" && shift) {
        const totals = { ...EMPTY_TOTALS, ...shift.totals };
        this.store.setMeta("shift", { ...shift, totals: { ...totals, cashOut: addMoney(totals.cashOut!, toMinor(payment.amount)) } } satisfies LocalShift);
      }
      return purchase;
    });
    this.engine?.schedule();
    return doc;
  }

  purchases(input: { from?: string; to?: string; limit?: number }): LocalPurchase[] {
    this.requireCashierWith("purchase.create");
    return this.store.purchases<LocalPurchase>(this.historyRange(input)).map((stored) => ({ ...stored.doc, sync: documentSync(stored) }));
  }

  purchaseReturns(input: { from?: string; to?: string; limit?: number }): LocalPurchaseReturn[] {
    this.requireCashierWith("purchase.create");
    return this.store.purchaseReturns<LocalPurchaseReturn>(this.historyRange(input)).map((stored) => ({ ...stored.doc, sync: documentSync(stored) }));
  }

  private localPurchaseReturned(orderId: string, onlyPending: boolean) {
    const returned = new Map<string, bigint>();
    for (const stored of this.store.purchaseReturnsForOrder<LocalPurchaseReturn>(orderId)) {
      if (stored.state === "rejected" || (onlyPending && stored.state !== "pending")) continue;
      for (const line of stored.doc.lines) returned.set(line.orderItemId, (returned.get(line.orderItemId) ?? 0n) + toMinor(line.quantity, 4));
    }
    return returned;
  }

  async findPurchase(input: { number: string }): Promise<ReturnablePurchase> {
    this.requireCashierWith("purchase.create");
    const number = String(input.number ?? "").trim().toUpperCase();
    if (!number) throw new KassaError("BAD_REQUEST", "Xarid raqamini kiriting");
    const local = this.store.purchaseByNumber<LocalPurchase>(number);
    if (local) {
      const returned = this.localPurchaseReturned(local.doc.id, false);
      return {
        source: "local",
        orderId: local.doc.id,
        number: local.doc.number,
        createdAt: local.doc.createdAt,
        status: local.state === "rejected" || local.state === "discarded" ? local.state : "received",
        supplier: local.doc.supplier,
        lines: local.doc.lines.map((line) => ({
          id: line.id,
          productId: line.productId,
          name: line.name,
          unitId: line.unitId,
          unitName: line.unitName,
          quantity: line.quantity,
          returned: fromMinor(returned.get(line.id) ?? 0n, 4),
          unitPrice: line.unitPrice,
          lineTotal: line.baseTotal,
          currency: null,
        })),
      };
    }
    if (!this.api) throw new KassaError("NOT_REGISTERED", "Qurilma ro'yxatdan o'tmagan");
    let purchase: RemotePurchase;
    try {
      purchase = (await this.api.purchase(number)).purchase;
    } catch (error) {
      if (error instanceof OfflineError) throw new KassaError("OFFLINE", "Xarid bu kassada yo'q — boshqa xaridni qaytarish uchun internet kerak");
      throw error;
    }
    const pending = this.localPurchaseReturned(purchase.id, true);
    return {
      source: "server",
      orderId: purchase.id,
      number: purchase.number,
      createdAt: purchase.createdAt,
      status: purchase.status,
      supplier: { id: purchase.supplierId, name: purchase.supplierName },
      lines: purchase.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.productName,
        unitId: item.unitId,
        unitName: item.unitName,
        quantity: item.receivedQty,
        returned: fromMinor(toMinor(item.returnedQty, 4) + (pending.get(item.id) ?? 0n), 4),
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        currency: item.currency,
      })),
    };
  }

  /** Ta'minotchiga qaytarish (`purchase.return`): zaxira kamayadi, ta'minotchi qarzi kamayadi; pul qaytsa — kassaga. */
  async returnPurchase(input: PurchaseReturnInput): Promise<LocalPurchaseReturn> {
    const cashier = this.requireCashierWith("purchase.return");
    const device = this.store.getMeta<DeviceInfo>("device");
    if (!device) throw new KassaError("NOT_REGISTERED", "Qurilma ro'yxatdan o'tmagan");
    const purchase = await this.findPurchase({ number: input.number });
    if (purchase.status === "rejected" || purchase.status === "discarded") throw new KassaError("CONFLICT", "Xarid serverga yozilmagan — qaytarib bo'lmaydi");
    if (!Array.isArray(input.items) || input.items.length === 0) throw new KassaError("BAD_REQUEST", "Qaytariladigan mahsulotni tanlang");

    const lineById = new Map(purchase.lines.map((line) => [line.id, line]));
    const conversions = this.store.records<CalcConversion>("unitConversions");
    const seen = new Set<string>();
    const stockDeltas: { productId: string; quantity: string }[] = [];
    const lines = input.items.map((item) => {
      const line = lineById.get(String(item.orderItemId));
      if (!line || seen.has(line.id)) throw new KassaError("BAD_REQUEST", "Xaridda bunday mahsulot qatori yo'q");
      seen.add(line.id);
      const qty = String(item.quantity ?? "");
      if (!QTY.test(qty) || toMinor(qty, 4) <= 0n) throw new KassaError("BAD_REQUEST", `${line.name}: miqdor noto'g'ri`);
      const quantity = toMinor(line.quantity, 4);
      const remaining = quantity - toMinor(line.returned, 4);
      const requested = toMinor(qty, 4);
      if (requested > remaining) throw new KassaError("BAD_REQUEST", `${line.name}: qaytarish miqdori qolganidan ko'p (qolgan ${fromMinor(remaining, 4)})`);
      const product = this.store.product<PurchaseProductRow>(line.productId);
      const factor = product ? unitFactor(product, line.unitId, conversions) : null;
      if (factor) stockDeltas.push({ productId: line.productId, quantity: fromMinor(-rescale(requested * toMinor(factor, 4), 8, 4), 4) });
      return { orderItemId: line.id, name: line.name, quantity: qty, lineTotal: fromMinor(quantity > 0n ? mulDivRound(toMinor(line.lineTotal), requested, quantity) : 0n) };
    });
    const total = lines.reduce((sum, line) => sum + toMinor(line.lineTotal), 0n);

    let refund: { amount: string; method: "cash" | "card" } | null = null;
    let shift = this.store.getMeta<LocalShift>("shift");
    if (input.refund) {
      shift = this.requireShift(cashier);
      const amount = String(input.refund.amount ?? "");
      if (!MONEY.test(amount) || toMinor(amount) <= 0n) throw new KassaError("BAD_REQUEST", "Qaytgan pul summasi noto'g'ri");
      if (input.refund.method !== "cash" && input.refund.method !== "card") throw new KassaError("BAD_REQUEST", "Pul usuli noto'g'ri");
      refund = { amount: fromMinor(toMinor(amount)), method: input.refund.method };
    }
    const reason = input.reason ? String(input.reason).trim().slice(0, 500) || null : null;

    const now = new Date();
    const returnId = randomUUID();
    const doc = this.store.inTransaction(() => {
      const number = `${device.code}-R${pad6(this.store.nextSequence("purchase_return"))}`;
      const payload: PurchaseReturnPayload = {
        returnId,
        number,
        orderId: purchase.orderId,
        items: lines.map((line) => ({ orderItemId: line.orderItemId, quantity: line.quantity })),
        ...(reason ? { reason } : {}),
        ...(refund && shift ? { refund: { shiftId: shift.id, ...refund } } : {}),
      };
      const op = this.store.enqueue({ type: "purchase.return", cashierId: cashier.userId, payload }, now);
      const purchaseReturn: LocalPurchaseReturn = {
        id: returnId,
        number,
        orderId: purchase.orderId,
        orderNumber: purchase.number,
        supplier: purchase.supplier,
        shiftId: shift?.id ?? null,
        cashierName: cashier.name,
        createdAt: now.toISOString(),
        lines,
        total: fromMinor(total),
        refund,
        reason,
        sync: { state: "pending", error: null, conflicts: [] },
      };
      this.store.insertPurchaseReturn({
        id: returnId,
        number,
        opId: op.opId,
        orderId: purchase.orderId,
        shiftId: shift?.id ?? null,
        cashierId: cashier.userId,
        total: purchaseReturn.total,
        createdAt: purchaseReturn.createdAt,
        doc: purchaseReturn,
        stockDeltas,
      });
      const supplier = this.store.supplier<SupplierRow>(purchase.supplier.id);
      if (supplier) {
        this.store.saveSupplier({ ...supplier, totalDebt: fromMinor(toMinor(supplier.totalDebt ?? "0") - total + (refund ? toMinor(refund.amount) : 0n)) });
      }
      if (refund?.method === "cash" && shift) {
        const totals = { ...EMPTY_TOTALS, ...shift.totals };
        this.store.setMeta("shift", { ...shift, totals: { ...totals, cashIn: addMoney(totals.cashIn!, toMinor(refund.amount)) } } satisfies LocalShift);
      }
      return purchaseReturn;
    });
    this.engine?.schedule();
    return doc;
  }

  /** Kassa smenasidan ta'minotchi qarzini to'lash (`purchase.approve`); qarzdan ortig'i serverda avans bo'ladi. */
  supplierPayment(input: { supplierId: string; amount: string; method: "cash" | "card"; notes?: string | null }): LocalSupplierPayment {
    const cashier = this.requireCashierWith("purchase.approve");
    const shift = this.requireShift(cashier);
    const supplier = this.store.supplier<SupplierRow>(String(input.supplierId ?? ""));
    if (!supplier) throw new KassaError("BAD_REQUEST", "Ta'minotchi topilmadi");
    const amount = String(input.amount ?? "");
    if (!MONEY.test(amount) || toMinor(amount) <= 0n) throw new KassaError("BAD_REQUEST", "Summa noto'g'ri");
    if (input.method !== "cash" && input.method !== "card") throw new KassaError("BAD_REQUEST", "To'lov usuli noto'g'ri");
    const notes = input.notes ? String(input.notes).trim().slice(0, 500) || null : null;
    const minor = toMinor(amount);
    const now = new Date();
    const payment: LocalSupplierPayment = {
      id: randomUUID(),
      shiftId: shift.id,
      supplier: { id: supplier.id, name: supplier.name },
      amount: fromMinor(minor),
      method: input.method,
      notes,
      cashierName: cashier.name,
      createdAt: now.toISOString(),
      supplierDebtAfter: fromMinor(toMinor(supplier.totalDebt ?? "0") - minor),
      sync: { state: "pending", error: null, conflicts: [] },
    };
    this.store.inTransaction(() => {
      const payload: SupplierPaymentPayload = {
        paymentId: payment.id,
        shiftId: shift.id,
        supplierId: supplier.id,
        amount: payment.amount,
        method: input.method,
        ...(notes ? { notes } : {}),
      };
      const op = this.store.enqueue({ type: "supplier.payment", cashierId: cashier.userId, payload }, now);
      this.store.insertSupplierPayment({
        id: payment.id,
        opId: op.opId,
        shiftId: shift.id,
        cashierId: cashier.userId,
        supplierId: supplier.id,
        amount: payment.amount,
        createdAt: payment.createdAt,
        doc: payment,
      });
      this.store.saveSupplier({ ...supplier, totalDebt: payment.supplierDebtAfter });
      if (input.method === "cash") {
        const totals = { ...EMPTY_TOTALS, ...shift.totals };
        this.store.setMeta("shift", { ...shift, totals: { ...totals, cashOut: addMoney(totals.cashOut!, minor) } } satisfies LocalShift);
      }
    });
    this.engine?.schedule();
    return payment;
  }

  // ─── Ombor: qoldiqlar, hisobdan chiqarish, ko'chirish, inventarizatsiya, harakatlar ─

  private requireDevice(): DeviceInfo {
    const device = this.store.getMeta<DeviceInfo>("device");
    if (!device) throw new KassaError("NOT_REGISTERED", "Qurilma ro'yxatdan o'tmagan");
    return device;
  }

  /**
   * Qurilma omboridagi qoldiqlar (ko'rinadigan: server + yuborilmagan hujjatlar). Tannarx va qiymat — faqat
   * `warehouse.manage` bilan. Yig'indilar filtrdan oldin, ro'yxat — filtr va chegara bilan.
   */
  stockList(input: { query: string; filter?: StockFilter; limit?: number }): StockList {
    const cashier = this.requireCashierWith("warehouse.view");
    const showCost = cashier.permissions.includes("warehouse.manage");
    const filter = STOCK_FILTERS.includes(input.filter as StockFilter) ? (input.filter as StockFilter) : "all";
    const limit = Math.min(Math.max(Number(input.limit) || 300, 1), 2000);
    const products = this.store.searchProducts(String(input.query ?? ""), 100_000, { saleableOnly: false }) as StockProductRow[];
    const stock = this.store.stockAll();
    const pending = this.store.pendingStockAll();
    const costs = showCost ? this.store.stockLevelCosts() : new Map<string, string>();
    const units = this.unitNames();
    const summary = { products: products.length, positive: 0, low: 0, zero: 0, negative: 0 };
    let totalValue = 0n;
    let matched = 0;
    const rows: StockRow[] = [];
    for (const product of products) {
      const quantity = stock.get(product.id) ?? 0n;
      const minStock = toMinor(product.minStock ?? "0", 4);
      const isLow = minStock > 0n && quantity >= 0n && quantity <= minStock;
      if (quantity > 0n) summary.positive += 1;
      else if (quantity === 0n) summary.zero += 1;
      else summary.negative += 1;
      if (isLow) summary.low += 1;
      const value = quantity > 0n ? costValue(costs, product.id, quantity) : 0n;
      totalValue += value;
      const keep =
        filter === "all" ||
        (filter === "positive" && quantity > 0n) ||
        (filter === "zero" && quantity === 0n) ||
        (filter === "negative" && quantity < 0n) ||
        (filter === "low" && isLow);
      if (!keep) continue;
      matched += 1;
      if (rows.length >= limit) continue;
      rows.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode ?? null,
        unitName: units.get(product.baseUnitId) ?? "",
        quantity: fromMinor(quantity, 4),
        pending: fromMinor(pending.get(product.id) ?? 0n, 4),
        minStock: fromMinor(minStock, 4),
        avgCost: showCost ? (costs.get(product.id) ?? "0.0000") : null,
        value: showCost ? fromMinor(value) : null,
        isLow,
      });
    }
    return { rows, summary: { ...summary, totalValue: showCost ? fromMinor(totalValue) : null }, truncated: matched > rows.length };
  }

  /** Ko'chirish uchun: kompaniyaning boshqa faol omborlari. */
  stockWarehouses(): StockWarehouse[] {
    this.requireCashierWith("warehouse.view");
    const device = this.requireDevice();
    return this.store
      .records<StockWarehouse & { isActive: boolean }>("warehouses")
      .filter((row) => row.isActive && row.id !== device.warehouseId)
      .map((row) => ({ id: row.id, name: row.name, code: row.code }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Ombor hujjatlari uchun mahsulot qidiruvi (sotilmaydigan xomashyo ham). */
  stockProducts(input: { query: string }): PosProduct[] {
    this.requireCashierWith("warehouse.view");
    return this.toPosProducts(this.store.searchProducts(String(input.query ?? ""), 80, { saleableOnly: false }) as ProductRow[]);
  }

  stockProductByCode(input: { code: string }): PosProduct | null {
    this.requireCashierWith("warehouse.view");
    const row = this.store.productByCode<ProductRow>(String(input.code ?? ""), false);
    return row ? this.toPosProducts([row])[0]! : null;
  }

  private stockLines(input: StockLineInput[] | undefined) {
    if (!Array.isArray(input) || input.length === 0) throw new KassaError("BAD_REQUEST", "Kamida bitta mahsulot tanlang");
    if (input.length > 500) throw new KassaError("BAD_REQUEST", "Hujjatda ko'pi bilan 500 qator");
    const units = this.unitNames();
    const seen = new Set<string>();
    return input.map((line) => {
      const product = this.store.product<StockProductRow>(String(line.productId ?? ""));
      if (!product || !product.isActive) throw new KassaError("BAD_REQUEST", "Mahsulot topilmadi yoki faol emas");
      if (seen.has(product.id)) throw new KassaError("BAD_REQUEST", `${product.name}: qator takrorlangan`);
      seen.add(product.id);
      const quantity = String(line.quantity ?? "");
      if (!QTY.test(quantity) || toMinor(quantity, 4) <= 0n) throw new KassaError("BAD_REQUEST", `${product.name}: miqdor noto'g'ri`);
      return { product, minor: toMinor(quantity, 4), unitName: units.get(product.baseUnitId) ?? "" };
    });
  }

  /** Ombor hujjati: raqam, navbat, lokal yozuv va ko'rinadigan qoldiq farqi — bitta tranzaksiyada. */
  private saveStockDocument(input: {
    kind: StockDocumentKind;
    cashier: CashierRecord;
    device: DeviceInfo;
    lines: LocalStockDocument["lines"];
    deltas: StockDelta[];
    value: string | null;
    toWarehouse: { id: string; name: string } | null;
    notes: string | null;
    payload: (id: string, number: string) => StockWriteoffPayload | StockTransferPayload | StockCountPayload;
    afterInsert?: () => void;
  }): LocalStockDocument {
    const now = new Date();
    const id = randomUUID();
    const doc = this.store.inTransaction(() => {
      const spec = STOCK_DOCS[input.kind];
      const number = `${input.device.code}-${spec.prefix}${pad6(this.store.nextSequence(`stock_${input.kind}`))}`;
      const op = this.store.enqueue({ type: spec.op, cashierId: input.cashier.userId, payload: input.payload(id, number) }, now);
      const document: LocalStockDocument = {
        id,
        number,
        kind: input.kind,
        cashierName: input.cashier.name,
        createdAt: now.toISOString(),
        toWarehouse: input.toWarehouse,
        lines: input.lines,
        notes: input.notes,
        value: input.value,
        sync: { state: "pending", error: null, conflicts: [] },
      };
      this.store.insertStockDocument({
        id,
        number,
        opId: op.opId,
        kind: input.kind,
        cashierId: input.cashier.userId,
        total: input.value,
        createdAt: document.createdAt,
        doc: document,
        stockDeltas: input.deltas,
      });
      input.afterInsert?.();
      return document;
    });
    this.engine?.schedule();
    return doc;
  }

  /** Hisobdan chiqarish (`warehouse.manage`): qoldiq yetmasa ham yoziladi — server nomuvofiqlik sifatida belgilaydi. */
  writeOff(input: { lines: StockLineInput[]; reason?: string | null }): LocalStockDocument {
    const cashier = this.requireCashierWith("warehouse.view", "warehouse.manage");
    const device = this.requireDevice();
    const lines = this.stockLines(input.lines);
    const reason = note(input.reason);
    const costs = this.store.stockLevelCosts();
    const value = lines.reduce((sum, line) => sum + costValue(costs, line.product.id, line.minor), 0n);
    return this.saveStockDocument({
      kind: "writeoff",
      cashier,
      device,
      lines: lines.map((line) => ({ productId: line.product.id, name: line.product.name, sku: line.product.sku, unitName: line.unitName, quantity: fromMinor(line.minor, 4) })),
      deltas: lines.map((line) => ({ productId: line.product.id, quantity: fromMinor(-line.minor, 4) })),
      value: fromMinor(value),
      toWarehouse: null,
      notes: reason,
      payload: (writeoffId, number) => ({
        writeoffId,
        number,
        items: lines.map((line) => ({ productId: line.product.id, unitId: line.product.baseUnitId, quantity: fromMinor(line.minor, 4) })),
        ...(reason ? { reason } : {}),
      }),
    });
  }

  /** Boshqa omborga ko'chirish (`warehouse.transfer`): qurilma omboridan chiqadi, qabul qiluvchida serverda kirim bo'ladi. */
  transfer(input: { toWarehouseId: string; lines: StockLineInput[]; notes?: string | null }): LocalStockDocument {
    const cashier = this.requireCashierWith("warehouse.view", "warehouse.transfer");
    const device = this.requireDevice();
    const target = this.stockWarehouses().find((row) => row.id === String(input.toWarehouseId ?? ""));
    if (!target) throw new KassaError("BAD_REQUEST", "Qabul qiluvchi ombor topilmadi");
    const lines = this.stockLines(input.lines);
    const notes = note(input.notes);
    const showCost = cashier.permissions.includes("warehouse.manage");
    const costs = this.store.stockLevelCosts();
    const value = lines.reduce((sum, line) => sum + costValue(costs, line.product.id, line.minor), 0n);
    return this.saveStockDocument({
      kind: "transfer",
      cashier,
      device,
      lines: lines.map((line) => ({ productId: line.product.id, name: line.product.name, sku: line.product.sku, unitName: line.unitName, quantity: fromMinor(line.minor, 4) })),
      deltas: lines.map((line) => ({ productId: line.product.id, quantity: fromMinor(-line.minor, 4) })),
      value: showCost ? fromMinor(value) : null,
      toWarehouse: { id: target.id, name: target.name },
      notes,
      payload: (transferId, number) => ({
        transferId,
        number,
        toWarehouseId: target.id,
        items: lines.map((line) => ({ productId: line.product.id, unitId: line.product.baseUnitId, quantity: fromMinor(line.minor, 4) })),
        ...(notes ? { notes } : {}),
      }),
    });
  }

  stockDocuments(input: { kind?: StockDocumentKind; from?: string; to?: string; limit?: number }): LocalStockDocument[] {
    this.requireCashierWith("warehouse.view");
    const kind = input.kind && STOCK_KINDS.includes(input.kind) ? input.kind : undefined;
    return this.store
      .stockDocuments<LocalStockDocument>({ ...this.historyRange(input), ...(kind ? { kind } : {}) })
      .map((stored) => ({ ...stored.doc, sync: documentSync(stored) }));
  }

  // Inventarizatsiya: sanash qoralamasi qurilmada saqlanadi (ilova yopilsa ham), kutilgan qoldiq har safar yangidan

  private toCountDraft(raw: RawCountDraft): CountDraft {
    const stock = this.store.stockMap(raw.lines.map((line) => line.productId));
    const units = this.unitNames();
    const lines: CountDraft["lines"] = [];
    for (const line of raw.lines) {
      const product = this.store.product<StockProductRow>(line.productId);
      if (!product) continue;
      const expected = stock.get(product.id) ?? 0n;
      const counted = toMinor(line.counted, 4);
      lines.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        unitName: units.get(product.baseUnitId) ?? "",
        counted: fromMinor(counted, 4),
        expected: fromMinor(expected, 4),
        difference: fromMinor(counted - expected, 4),
      });
    }
    return { id: raw.id, startedAt: raw.startedAt, lines };
  }

  countDraft(): CountDraft | null {
    this.requireCashierWith("warehouse.view", "warehouse.count");
    const raw = this.store.getMeta<RawCountDraft>("countDraft");
    return raw ? this.toCountDraft(raw) : null;
  }

  /** Sanalgan miqdor: `set` — qiymatni qo'yadi, `add` — qo'shadi (skaner har o'qishda +1). Asosiy birlikda. */
  countSet(input: { productId: string; counted: string; mode?: "set" | "add" }): CountDraft {
    this.requireCashierWith("warehouse.view", "warehouse.count");
    const product = this.store.product<StockProductRow>(String(input.productId ?? ""));
    if (!product || !product.isActive) throw new KassaError("BAD_REQUEST", "Mahsulot topilmadi yoki faol emas");
    const value = String(input.counted ?? "");
    const add = input.mode === "add";
    if (!QTY.test(value) || (add && toMinor(value, 4) <= 0n)) throw new KassaError("BAD_REQUEST", `${product.name}: miqdor noto'g'ri`);
    const raw = this.store.getMeta<RawCountDraft>("countDraft") ?? { id: randomUUID(), startedAt: new Date().toISOString(), lines: [] };
    const index = raw.lines.findIndex((line) => line.productId === product.id);
    if (index >= 0) {
      const current = toMinor(raw.lines[index]!.counted, 4);
      raw.lines[index] = { productId: product.id, counted: fromMinor(add ? current + toMinor(value, 4) : toMinor(value, 4), 4) };
    } else {
      if (raw.lines.length >= MAX_COUNT_LINES) throw new KassaError("BAD_REQUEST", `Inventarizatsiyada ko'pi bilan ${MAX_COUNT_LINES} mahsulot`);
      raw.lines.unshift({ productId: product.id, counted: fromMinor(toMinor(value, 4), 4) });
    }
    this.store.setMeta("countDraft", raw);
    return this.toCountDraft(raw);
  }

  countRemove(input: { productId: string }): CountDraft | null {
    this.requireCashierWith("warehouse.view", "warehouse.count");
    const raw = this.store.getMeta<RawCountDraft>("countDraft");
    if (!raw) return null;
    const next = { ...raw, lines: raw.lines.filter((line) => line.productId !== String(input.productId ?? "")) };
    this.store.setMeta("countDraft", next);
    return this.toCountDraft(next);
  }

  countCancel(): void {
    this.requireCashierWith("warehouse.view", "warehouse.count");
    this.store.deleteMeta("countDraft");
  }

  /**
   * Inventarizatsiyani yakunlash (`warehouse.count` + `warehouse.manage`, web'dagi qo'llash kabi). Farq — qurilmadagi
   * ko'rinadigan qoldiqqa nisbatan (darhol ko'rinadi); serverda — amal lahzasidagi server qoldig'iga nisbatan.
   * `zeroMissing` — sanalmagan, lekin qoldig'i bor mahsulotlar 0 deb yoziladi (to'liq inventarizatsiya).
   */
  countComplete(input: { notes?: string | null; zeroMissing?: boolean }): LocalStockDocument {
    const cashier = this.requireCashierWith("warehouse.view", "warehouse.count", "warehouse.manage");
    const device = this.requireDevice();
    const raw = this.store.getMeta<RawCountDraft>("countDraft");
    const counted = new Map<string, bigint>();
    for (const line of raw?.lines ?? []) {
      if (this.store.product(line.productId)) counted.set(line.productId, toMinor(line.counted, 4));
    }
    const stock = this.store.stockAll();
    if (input.zeroMissing) {
      for (const [productId, quantity] of stock) {
        if (quantity === 0n || counted.has(productId)) continue;
        if (this.store.product<StockProductRow>(productId)?.isActive) counted.set(productId, 0n);
      }
    }
    if (counted.size === 0) throw new KassaError("BAD_REQUEST", "Sanalgan mahsulot yo'q");
    if (counted.size > MAX_COUNT_LINES) throw new KassaError("BAD_REQUEST", `Inventarizatsiyada ko'pi bilan ${MAX_COUNT_LINES} mahsulot`);

    const notes = note(input.notes);
    const costs = this.store.stockLevelCosts();
    const units = this.unitNames();
    let value = 0n;
    const lines: LocalStockDocument["lines"] = [];
    const deltas: StockDelta[] = [];
    for (const [productId, quantity] of counted) {
      const product = this.store.product<StockProductRow>(productId)!;
      const expected = stock.get(productId) ?? 0n;
      const difference = quantity - expected;
      value += costValue(costs, productId, difference);
      if (difference !== 0n) deltas.push({ productId, quantity: fromMinor(difference, 4) });
      lines.push({
        productId,
        name: product.name,
        sku: product.sku,
        unitName: units.get(product.baseUnitId) ?? "",
        quantity: fromMinor(quantity, 4),
        expected: fromMinor(expected, 4),
        difference: fromMinor(difference, 4),
      });
    }
    lines.sort((a, b) => a.name.localeCompare(b.name));
    return this.saveStockDocument({
      kind: "count",
      cashier,
      device,
      lines,
      deltas,
      value: fromMinor(value),
      toWarehouse: null,
      notes,
      payload: (countId, number) => ({ countId, number, items: lines.map((line) => ({ productId: line.productId, countedQty: line.quantity })), ...(notes ? { notes } : {}) }),
      afterInsert: () => this.store.deleteMeta("countDraft"),
    });
  }

  /**
   * Mahsulot harakati: serverdagi tarix (qurilma ombori, sahifalab) va birinchi sahifada — qurilmadagi yuborilmagan
   * hujjatlar. Internet bo'lmasa — faqat qurilmadagilari (`offline: true`).
   */
  async stockMovements(input: { productId?: string; type?: string; cursor?: string }): Promise<MovementPage> {
    this.requireCashierWith("warehouse.view");
    if (!this.api) throw new KassaError("NOT_REGISTERED", "Qurilma ro'yxatdan o'tmagan");
    const productId = input.productId ? String(input.productId) : null;
    const type = input.type && MOVEMENT_TYPES.includes(input.type) ? input.type : undefined;
    const cursor = input.cursor ? String(input.cursor).slice(0, 500) : undefined;
    const units = this.unitNames();
    const names = new Map<string, { name: string; unitName: string }>();
    const describe = (id: string) => {
      let known = names.get(id);
      if (!known) {
        const product = this.store.product<ProductRow>(id);
        known = { name: product?.name ?? "—", unitName: product ? (units.get(product.baseUnitId) ?? "") : "" };
        names.set(id, known);
      }
      return known;
    };
    const pending: MovementRow[] =
      cursor || type
        ? []
        : this.store.pendingMovements(productId, 200).map((row) => ({
            id: `${row.opId}:${row.productId}`,
            source: "pending",
            type: row.type,
            productId: row.productId,
            productName: describe(row.productId).name,
            unitName: describe(row.productId).unitName,
            quantity: row.quantity,
            documentNumber: row.number,
            notes: null,
            by: null,
            occurredAt: row.createdAt,
          }));
    try {
      const page = await this.api.movements({ productId: productId ?? undefined, type, cursor, limit: 100 });
      const server: MovementRow[] = page.movements.map((row) => ({
        id: row.id,
        source: "server",
        type: row.type,
        productId: row.productId,
        productName: row.productName,
        unitName: row.unitName,
        quantity: row.quantity,
        documentNumber: row.documentNumber,
        notes: row.notes,
        by: row.performedByName,
        occurredAt: row.occurredAt,
      }));
      return { rows: [...pending, ...server], nextCursor: page.nextCursor, offline: false };
    } catch (error) {
      if (error instanceof OfflineError) return { rows: pending, nextCursor: null, offline: true };
      throw error;
    }
  }

  /** Mahsulotning boshqa omborlardagi qoldig'i (internet kerak). */
  async stockElsewhere(input: { productId: string }): Promise<RemoteWarehouseStock[]> {
    this.requireCashierWith("warehouse.view");
    if (!this.api) throw new KassaError("NOT_REGISTERED", "Qurilma ro'yxatdan o'tmagan");
    try {
      return (await this.api.productStock(String(input.productId ?? ""))).stock;
    } catch (error) {
      if (error instanceof OfflineError) throw new KassaError("OFFLINE", "Boshqa omborlar qoldig'i uchun internet kerak");
      throw error;
    }
  }

  // ─── Analitika ──────────────────────────────────────────────────────────

  /**
   * Analitika (`analytics.view`): internet bo'lsa — serverdan (qurilma omboridagi barcha kassalar va web, haqiqiy
   * tannarx, kompaniya kirim-chiqimi); bo'lmasa yoki `source: "local"` — shu kassadagi hujjatlardan (taxminiy tannarx).
   */
  async analyticsReport(input: { from: string; to: string; source?: "auto" | "local" }): Promise<AnalyticsReport> {
    const cashier = this.requireCashierWith("analytics.view");
    const from = String(input.from ?? "");
    const to = String(input.to ?? "");
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) throw new KassaError("BAD_REQUEST", "Davr noto'g'ri");
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw new KassaError("BAD_REQUEST", "Davr 366 kundan oshmasin");
    if (input.source !== "local" && this.api) {
      try {
        return { ...(await this.api.analytics({ from, to, cashierId: cashier.userId })), source: "server" };
      } catch (error) {
        if (!(error instanceof OfflineError)) throw error;
      }
    }
    return this.localAnalytics(from, to);
  }

  private localAnalytics(from: string, to: string): AnalyticsReport {
    const device = this.store.getMeta<DeviceInfo>("device");
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    const range = { from: start.toISOString(), to: end.toISOString(), limit: 100_000 };
    const live = <T>(docs: StoredDocument<T>[]) => docs.filter((doc) => doc.state !== "rejected" && doc.state !== "discarded").map((doc) => doc.doc);
    const sales = live(this.store.sales<LocalSale>(range));
    const returns = live(this.store.returns<LocalReturn>(range));
    const purchases = live(this.store.purchases<LocalPurchase>(range));
    const movements = live(this.store.cashMovements<LocalCashMovement>(range));
    const customerPayments = live(this.store.customerPayments<LocalCustomerPayment>(range));
    const supplierPayments = live(this.store.supplierPayments<LocalSupplierPayment>(range));

    const costs = this.store.stockLevelCosts();
    const conversions = this.store.records<CalcConversion>("unitConversions");
    const products = new Map<string, StockProductRow | null>();
    const productOf = (id: string) => {
      if (!products.has(id)) products.set(id, this.store.product<StockProductRow>(id));
      return products.get(id) ?? null;
    };
    const baseQty = (productId: string, unitId: string, quantity: string) => {
      const product = productOf(productId);
      const factor = product ? unitFactor(product, unitId, conversions) : null;
      return rescale(toMinor(quantity, 4) * toMinor(factor ?? "1", 4), 8, 4);
    };

    type Acc = { quantity: bigint; revenue: bigint; cogs: bigint };
    const byProduct = new Map<string, Acc>();
    const productAcc = (id: string) => {
      let acc = byProduct.get(id);
      if (!acc) byProduct.set(id, (acc = { quantity: 0n, revenue: 0n, cogs: 0n }));
      return acc;
    };
    const days = new Map<string, { revenue: bigint; returns: bigint; cogs: bigint; receipts: number }>();
    const dayAcc = (iso: string) => {
      const key = localDay(iso);
      let acc = days.get(key);
      if (!acc) days.set(key, (acc = { revenue: 0n, returns: 0n, cogs: 0n, receipts: 0 }));
      return acc;
    };
    const payments = new Map<string, bigint>();
    const addPayment = (key: string, amount: bigint) => payments.set(key, (payments.get(key) ?? 0n) + amount);
    const cashiers = new Map<string, { receipts: number; revenue: bigint }>();

    let revenue = 0n;
    let returned = 0n;
    let cogs = 0n;
    let items = 0n;
    let salesMoney = 0n;
    const saleLines = new Map<string, { productId: string; unitId: string }>();
    for (const sale of sales) {
      const total = toMinor(sale.total);
      revenue += total;
      const day = dayAcc(sale.createdAt);
      day.revenue += total;
      day.receipts += 1;
      for (const line of sale.lines) {
        saleLines.set(line.id, { productId: line.productId, unitId: line.unitId });
        const qty = baseQty(line.productId, line.unitId, line.quantity);
        const cost = costValue(costs, line.productId, qty);
        const acc = productAcc(line.productId);
        acc.quantity += qty;
        acc.revenue += toMinor(line.lineTotal);
        acc.cogs += cost;
        cogs += cost;
        items += qty;
        day.cogs += cost;
      }
      const received = toMinor(sale.tendered) - toMinor(sale.change);
      salesMoney += received;
      addPayment(sale.paymentMethod, received);
      addPayment("balance", toMinor(sale.balanceUsed));
      addPayment("cashback", toMinor(sale.cashbackUsed));
      addPayment("debt", toMinor(sale.debt));
      const name = sale.cashierName ?? "—";
      const cashierAcc = cashiers.get(name) ?? { receipts: 0, revenue: 0n };
      cashiers.set(name, { receipts: cashierAcc.receipts + 1, revenue: cashierAcc.revenue + total });
    }
    let refunds = 0n;
    for (const ret of returns) {
      const total = toMinor(ret.total);
      returned += total;
      const day = dayAcc(ret.createdAt);
      day.returns += total;
      if (ret.refundMethod !== "balance") refunds += toMinor(ret.refundEstimate);
      for (const line of ret.lines) {
        const original = saleLines.get(line.orderItemId) ?? this.store.saleById<LocalSale>(ret.orderId)?.doc.lines.find((item) => item.id === line.orderItemId);
        if (!original) continue;
        const qty = baseQty(original.productId, original.unitId, line.quantity);
        const cost = costValue(costs, original.productId, qty);
        const acc = productAcc(original.productId);
        acc.quantity -= qty;
        acc.revenue -= toMinor(line.lineTotal);
        acc.cogs -= cost;
        cogs -= cost;
        items -= qty;
        day.cogs -= cost;
      }
    }

    const netRevenue = revenue - returned;
    const grossProfit = netRevenue - cogs;
    const receipts = sales.length;
    const stock = this.store.stockAll();
    let stockValue = 0n;
    for (const [productId, quantity] of stock) if (quantity > 0n) stockValue += costValue(costs, productId, quantity);
    const expenses = movements.filter((movement) => movement.kind === "expense").reduce((sum, movement) => sum + toMinor(movement.amount), 0n);

    const customers = this.store.searchCustomers<CustomerRow>("", 100_000);
    const suppliers = this.store.searchSuppliers<SupplierRow>("", 100_000);
    const cashIn = movements.filter((movement) => movement.type === "in").reduce((sum, movement) => sum + toMinor(movement.amount), 0n);
    const cashOutOther = movements.filter((movement) => movement.type === "out" && movement.kind !== "expense").reduce((sum, movement) => sum + toMinor(movement.amount), 0n);
    const customerMoney = customerPayments.reduce((sum, payment) => sum + toMinor(payment.amount), 0n);
    const supplierMoney =
      supplierPayments.reduce((sum, payment) => sum + toMinor(payment.amount), 0n) +
      purchases.reduce((sum, purchase) => sum + (purchase.payment ? toMinor(purchase.payment.amount) : 0n), 0n);
    const income = amountLines([
      ["sales", "Savdo tushumi", salesMoney],
      ["customer_payments", "Mijozlar to'lovi", customerMoney],
      ["cash_in", "Kassaga kirim", cashIn],
    ]);
    const expense = amountLines([
      ["suppliers", "Ta'minotchilarga to'lov", supplierMoney],
      ["expenses", "Xarajatlar", expenses],
      ["refunds", "Qaytarilgan pul", refunds],
      ["cash_out", "Inkassatsiya va boshqa chiqim", cashOutOther],
    ]);
    const totalIncome = salesMoney + customerMoney + cashIn;
    const totalExpense = supplierMoney + expenses + refunds + cashOutOther;

    const top: ProductStat[] = [...byProduct.entries()]
      .sort(([, a], [, b]) => (b.revenue > a.revenue ? 1 : b.revenue < a.revenue ? -1 : 0))
      .slice(0, 20)
      .map(([productId, acc]) => {
        const product = productOf(productId);
        return {
          productId,
          name: product?.name ?? "—",
          sku: product?.sku ?? "",
          quantity: fromMinor(acc.quantity, 4),
          revenue: fromMinor(acc.revenue),
          cogs: fromMinor(acc.cogs),
          profit: fromMinor(acc.revenue - acc.cogs),
        };
      });
    const slow = [...stock.entries()]
      .filter(([productId, quantity]) => quantity > 0n && !byProduct.has(productId) && productOf(productId)?.isActive)
      .map(([productId, quantity]) => ({ productId, quantity, value: costValue(costs, productId, quantity) }))
      .sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0))
      .slice(0, 20)
      .map((row) => ({ productId: row.productId, name: productOf(row.productId)!.name, sku: productOf(row.productId)!.sku, stock: fromMinor(row.quantity, 4), value: fromMinor(row.value) }));

    const categoryNames = new Map(this.store.records<{ id: string; name: string }>("categories").map((row) => [row.id, row.name]));
    const byCategory = new Map<string, { soldQty: bigint; revenue: bigint; cogs: bigint; stockQty: bigint; stockValue: bigint }>();
    const categoryAcc = (productId: string) => {
      const key = productOf(productId)?.categoryId ?? "";
      let acc = byCategory.get(key);
      if (!acc) byCategory.set(key, (acc = { soldQty: 0n, revenue: 0n, cogs: 0n, stockQty: 0n, stockValue: 0n }));
      return acc;
    };
    for (const [productId, acc] of byProduct) {
      const category = categoryAcc(productId);
      category.soldQty += acc.quantity;
      category.revenue += acc.revenue;
      category.cogs += acc.cogs;
    }
    for (const [productId, quantity] of stock) {
      if (quantity <= 0n || !productOf(productId)) continue;
      const category = categoryAcc(productId);
      category.stockQty += quantity;
      category.stockValue += costValue(costs, productId, quantity);
    }
    const categories: CategoryStat[] = [...byCategory.entries()]
      .map(([key, acc]) => ({
        categoryId: key || null,
        name: key ? (categoryNames.get(key) ?? "—") : "Kategoriyasiz",
        soldQty: fromMinor(acc.soldQty, 4),
        revenue: fromMinor(acc.revenue),
        cogs: fromMinor(acc.cogs),
        profit: fromMinor(acc.revenue - acc.cogs),
        stockQty: fromMinor(acc.stockQty, 4),
        stockValue: fromMinor(acc.stockValue),
      }))
      .sort((a, b) => toMinor(b.stockValue ?? "0") - toMinor(a.stockValue ?? "0") > 0n ? 1 : -1);

    return {
      source: "local",
      period: { from, to },
      generatedAt: new Date().toISOString(),
      scope: `Shu kassa (${device?.code ?? "—"}) hujjatlari, serverga yuborilmaganlar ham; tannarx — joriy o'rtacha bo'yicha taxminiy`,
      kpis: {
        revenue: fromMinor(revenue),
        returns: fromMinor(returned),
        netRevenue: fromMinor(netRevenue),
        cogs: fromMinor(cogs),
        grossProfit: fromMinor(grossProfit),
        margin: percentOf(grossProfit, netRevenue),
        receipts,
        averageReceipt: fromMinor(receipts > 0 ? netRevenue / BigInt(receipts) : 0n),
        itemsSold: fromMinor(items, 4),
        purchases: fromMinor(purchases.reduce((sum, purchase) => sum + toMinor(purchase.total), 0n)),
        expenses: fromMinor(expenses),
        stockValue: fromMinor(stockValue),
        customers: customers.length,
      },
      daily: [...days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, acc]) => ({ date, revenue: fromMinor(acc.revenue), returns: fromMinor(acc.returns), profit: fromMinor(acc.revenue - acc.returns - acc.cogs), receipts: acc.receipts })),
      payments: amountLines(
        [...payments.entries()].sort(([, a], [, b]) => (b > a ? 1 : b < a ? -1 : 0)).map(([key, amount]) => [key, METHOD_LABELS[key] ?? key, amount]),
      ),
      cashiers: [...cashiers.entries()].map(([name, acc]) => ({ name, receipts: acc.receipts, revenue: fromMinor(acc.revenue) })),
      cashFlow: { income, expense, totalIncome: fromMinor(totalIncome), totalExpense: fromMinor(totalExpense), net: fromMinor(totalIncome - totalExpense) },
      receivables: balanceGroup(customers.map((row) => ({ id: row.id, name: row.name, phone: row.phone ?? null, amount: toMinor(row.totalDebt ?? "0") }))),
      customerBalances: balanceGroup(customers.map((row) => ({ id: row.id, name: row.name, phone: row.phone ?? null, amount: toMinor(row.balance ?? "0") }))),
      payables: balanceGroup(suppliers.map((row) => ({ id: row.id, name: row.name, phone: row.phone ?? null, amount: toMinor(row.totalDebt ?? "0") }))),
      supplierAdvances: balanceGroup(suppliers.map((row) => ({ id: row.id, name: row.name, phone: row.phone ?? null, amount: -toMinor(row.totalDebt ?? "0") }))),
      products: { top, slow },
      categories,
    };
  }

  // ─── Qurilma sozlamalari, printer, pul qutisi ───────────────────────────

  /**
   * Qurilma sozlamalari + ko'rinish: mavzu ustuvorligi (kompaniya qulfi → kassir tanlovi → kompaniya standarti → Windows),
   * zichlik va shrift (kassir → qurilma → maxsus mavzu standarti). Kassir tanlovi qurilmada kassir bo'yicha saqlanadi.
   */
  prefs(): DevicePrefs {
    const stored = this.store.getMeta<Partial<DevicePrefs>>("devicePrefs") ?? {};
    const base = { ...DEFAULT_PREFS, ...stored, hotkeys: { ...DEFAULT_HOTKEYS, ...(stored.hotkeys ?? {}) } };
    const appearance = this.config()?.appearance;
    const customTheme = parseCustomTheme(appearance?.custom);
    const company = appearance ? { locked: appearance.locked === true, theme: appearance.theme, custom: customTheme } : null;
    const own = this.cashier ? this.store.getMeta<CashierPrefs>(`cashierPrefs:${this.cashier.userId}`) : null;
    const resolved = resolvePosTheme({ company, cashierTheme: own?.theme ?? null });
    const themeDefaults = resolved.theme === "custom" ? customTheme : null;
    return {
      ...base,
      theme: resolved.theme,
      themeSource: resolved.source,
      themeLock: resolved.lock,
      companyTheme: company ? normalizePosTheme(company.theme, customTheme !== null) : null,
      cashierTheme: normalizePosTheme(own?.theme, customTheme !== null),
      customTheme,
      density: [own?.density, stored.density, themeDefaults?.density].find(isPosDensity) ?? "comfortable",
      fontScale: [own?.fontScale, stored.fontScale, themeDefaults?.fontScale].find(isPosFontScale) ?? "normal",
    };
  }

  savePrefs(input: DevicePrefs): DevicePrefs {
    const cashier = this.requireCashier();
    const current = this.prefs();
    const ownKey = `cashierPrefs:${cashier.userId}`;
    const own: CashierPrefs = { ...(this.store.getMeta<CashierPrefs>(ownKey) ?? {}) };
    // Mavzu — kassirniki; `cashierTheme: null` — kompaniya standartiga qaytish; kompaniya qulflagan bo'lsa o'zgarmaydi
    const requested = normalizePosTheme(input.theme, current.customTheme !== null);
    const resetTheme = input.cashierTheme === null && current.cashierTheme !== null;
    if (resetTheme || (requested !== null && requested !== current.theme)) {
      if (current.themeLock) throw new KassaError("FORBIDDEN", "Mavzu kompaniya tomonidan qulflangan");
      if (resetTheme) delete own.theme;
      else own.theme = requested!;
    }
    // Zichlik va shrift — kassirniki (faqat o'zgarganda — tanlanmagani maxsus mavzu standartiga ergashadi)
    if (isPosDensity(input.density) && input.density !== current.density) own.density = input.density;
    if (isPosFontScale(input.fontScale) && input.fontScale !== current.fontScale) own.fontScale = input.fontScale;
    this.store.setMeta(ownKey, own);
    const storedDevice = this.store.getMeta<Partial<DevicePrefs>>("devicePrefs") ?? {};
    const methods = Array.isArray(input.enabledPaymentMethods)
      ? [...new Set(input.enabledPaymentMethods.filter((method) => PAYMENT_METHODS.includes(method)))]
      : current.enabledPaymentMethods;
    if (methods.length === 0) throw new KassaError("BAD_REQUEST", "Kamida bitta to'lov usuli yoqilgan bo'lsin");
    const hotkeys = { ...current.hotkeys };
    const used = new Map<string, HotkeyAction>();
    for (const action of HOTKEY_ACTIONS) {
      const key = input.hotkeys?.[action] === undefined ? current.hotkeys[action] : String(input.hotkeys[action]);
      if (!HOTKEY_PATTERN.test(key)) throw new KassaError("BAD_REQUEST", `Tugma noto'g'ri: ${key}`);
      if (used.has(key)) throw new KassaError("BAD_REQUEST", `Tugma takrorlangan: ${key}`);
      used.set(key, action);
      hotkeys[action] = key;
    }
    const prefs = {
      language: input.language === "uz-Cyrl" || input.language === "ru" ? input.language : "uz-Latn",
      productView: input.productView === "table" ? "table" : "cards",
      hotkeys,
      blockNegativeStock: !!input.blockNegativeStock,
      enabledPaymentMethods: methods,
      defaultPaymentMethod: methods.includes(input.defaultPaymentMethod) ? input.defaultPaymentMethod : methods[0]!,
      syncIntervalSec: clampInt(input.syncIntervalSec, 10, 600, current.syncIntervalSec),
      autoLockMinutes: clampInt(input.autoLockMinutes, 0, 240, current.autoLockMinutes),
      printerName: input.printerName ? String(input.printerName).slice(0, 200) : null,
      paperWidth: input.paperWidth === 58 ? 58 : 80,
      autoPrint: !!input.autoPrint,
      openDrawerOnCash: !!input.openDrawerOnCash,
      labelPrinterName: input.labelPrinterName ? String(input.labelPrinterName).slice(0, 200) : null,
      drawer: {
        mode: ["none", "driver", "tcp", "share"].includes(input.drawer?.mode) ? input.drawer.mode : "none",
        ...(input.drawer?.host ? { host: String(input.drawer.host).trim() } : {}),
        ...(input.drawer?.port ? { port: Number(input.drawer.port) } : {}),
        ...(input.drawer?.share ? { share: String(input.drawer.share).trim() } : {}),
      },
      // Qurilma darajasidagi (eski) shrift/zichlik — kassir tanlamaganda
      ...(isPosDensity(storedDevice.density) ? { density: storedDevice.density } : {}),
      ...(isPosFontScale(storedDevice.fontScale) ? { fontScale: storedDevice.fontScale } : {}),
    } satisfies Partial<DevicePrefs>;
    const invalid = validateDrawerPrefs(prefs.drawer);
    if (invalid) throw new KassaError("BAD_REQUEST", invalid);
    this.store.setMeta("devicePrefs", prefs);
    if (this.timer && prefs.syncIntervalSec * 1000 !== this.intervalMs) this.start(prefs.syncIntervalSec * 1000);
    return this.prefs();
  }

  // ─── Sozlamalar: PIN, umumiy ma'lumotlar, yangilanish ───────────────────

  /** Joriy kassir PIN'ini almashtirish (eski PIN bilan; 5 xatodan keyin qulf — kirishdagi kabi). */
  async changePin(input: { oldPin: string; newPin: string }): Promise<void> {
    const cashier = this.requireCashier();
    const newPin = String(input.newPin ?? "");
    if (!PIN_PATTERN.test(newPin)) throw new KassaError("BAD_REQUEST", "Yangi PIN 4–8 raqamdan iborat bo'lsin");
    const check = await checkPin(this.store, cashier.userId, String(input.oldPin ?? ""));
    if (!check.ok) {
      throw check.reason === "locked" ? new KassaError("PIN_LOCKED", "PIN vaqtincha bloklangan — keyinroq urinib ko'ring") : new KassaError("PIN_INVALID", "Joriy PIN noto'g'ri");
    }
    this.store.setPinHash(cashier.userId, await hashPin(newPin));
  }

  settingsOverview(): SettingsOverview {
    const cashier = this.requireCashier();
    const config = this.config();
    const company = this.store.getMeta<CompanyInfo>("company");
    const device = this.store.getMeta<DeviceInfo>("device");
    return {
      appVersion: this.options.appVersion,
      apiUrl: this.store.getMeta<string>("apiUrl"),
      device,
      company: config?.company ?? null,
      subscription: { status: company?.status ?? null, trialEndsAt: company?.trialEndsAt ?? null },
      baseCurrency: this.baseCurrency(),
      currencies: this.toCurrencyRows(this.store.records<LocalCurrencyRow>("currencies")),
      cashback: config?.cashback ?? null,
      warehouses: this.store
        .records<{ id: string; name: string; code: string; isDefault?: boolean; isActive: boolean }>("warehouses")
        .map((row) => ({ id: row.id, name: row.name, code: row.code, isDefault: !!row.isDefault, isActive: row.isActive, current: row.id === device?.warehouseId }))
        .sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name)),
      cashiers: this.cashiers().map((row) => ({ userId: row.userId, name: row.name, phone: row.phone, role: row.role, active: row.active, hasPin: row.hasPin })),
      permissions: cashier.permissions,
      sync: this.status().sync,
    };
  }

  private savedUpdate() {
    return this.store.getMeta<{ version: string; file: string; sha256: string }>("updateFile");
  }

  private async remoteUpdate(): Promise<RemoteUpdate> {
    if (!this.api) throw new KassaError("NOT_REGISTERED", "Qurilma ro'yxatdan o'tmagan");
    try {
      return (await this.api.appUpdate()).update;
    } catch (error) {
      if (error instanceof OfflineError) throw new KassaError("OFFLINE", "Yangilanishni tekshirish uchun internet kerak");
      throw error;
    }
  }

  /** Faylni oqim bilan xeshlash (100 MB+ o'rnatuvchi xotiraga to'liq yuklanmaydi). */
  private static async hashFile(file: string) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
    return hash.digest("hex");
  }

  private static async fileMatches(file: string, sha256: string) {
    try {
      return (await KassaService.hashFile(file)) === sha256;
    } catch {
      return false;
    }
  }

  private static async fileSize(file: string) {
    return (await stat(file).catch(() => null))?.size ?? 0;
  }

  /** Uzilgan yuklab olish: qaysi reliz va qism fayl (`.part`). */
  private partialUpdate() {
    return this.store.getMeta<{ version: string; sha256: string; file: string }>("updatePartial");
  }

  private async toUpdateInfo(remote: RemoteUpdate): Promise<UpdateInfo> {
    const saved = this.savedUpdate();
    const downloaded =
      remote.available && !!saved && saved.version === remote.latest && saved.sha256 === remote.sha256 && (await KassaService.fileMatches(saved.file, saved.sha256));
    const partial = this.partialUpdate();
    const partialBytes =
      !downloaded && remote.available && partial && partial.version === remote.latest && partial.sha256 === remote.sha256 ? await KassaService.fileSize(partial.file) : 0;
    return {
      configured: remote.configured,
      available: remote.available,
      mandatory: remote.mandatory,
      current: this.options.appVersion,
      latest: remote.latest,
      notes: remote.notes,
      downloaded,
      partialBytes,
    };
  }

  async checkUpdate(): Promise<UpdateInfo> {
    this.requireCashier();
    return this.toUpdateInfo(await this.remoteUpdate());
  }

  /**
   * O'rnatuvchini yuklab olish: SHA-256 server bergan qiymatga mos kelsagina saqlanadi. Nisbiy manzil — server bazasidagi
   * reliz (API manzili bilan, qurilma tokeni bilan); tashqi manzil — faqat https, tokensiz.
   */
  async downloadUpdate(): Promise<UpdateInfo> {
    this.requireCashier();
    const remote = await this.remoteUpdate();
    if (!remote.available || !remote.url || !remote.sha256 || !remote.latest) throw new KassaError("CONFLICT", "Yangi versiya yo'q");
    const apiUrl = this.store.getMeta<string>("apiUrl");
    const token = this.vault.load();
    // "//host/..." ham "/" bilan boshlanadi, lekin boshqa hostga ketadi — token faqat aynan API origin'iga yuboriladi
    const sameOrigin = remote.url.startsWith("/") && !remote.url.startsWith("//");
    if (sameOrigin ? !apiUrl : !remote.url.startsWith("https://")) throw new KassaError("BAD_REQUEST", "Yangilanish manzili xavfsiz emas");
    const target = sameOrigin ? new URL(remote.url, apiUrl!) : new URL(remote.url);
    if (sameOrigin && target.origin !== new URL(apiUrl!).origin) throw new KassaError("BAD_REQUEST", "Yangilanish manzili xavfsiz emas");
    const info = await this.toUpdateInfo(remote);
    if (info.downloaded) return info;

    const file = path.join(this.options.downloadDir ?? tmpdir(), `BUM-POS-KASSA-Setup-${remote.latest}.exe`);
    const part = `${file}.part`;
    // Uzilgan yuklab olish faqat shu reliz (versiya va SHA-256) uchun davom etadi; boshqasining qismi o'chiriladi
    const previous = this.partialUpdate();
    if (!previous || previous.version !== remote.latest || previous.sha256 !== remote.sha256 || previous.file !== part) {
      if (previous?.file) await rm(previous.file, { force: true });
      await rm(part, { force: true });
      this.store.setMeta("updatePartial", { version: remote.latest, sha256: remote.sha256, file: part });
    }
    const offset = await KassaService.fileSize(part);
    const headers: Record<string, string> = sameOrigin && token ? { authorization: `Bearer ${token}`, "x-app-version": this.options.appVersion } : {};
    if (offset > 0) {
      headers.range = `bytes=${offset}-`;
      // ETag = SHA-256: server boshqa fayl bersa Range e'tiborsiz qolib butun fayl keladi (qismlar aralashmaydi)
      headers["if-range"] = `"${remote.sha256}"`;
    }
    let response: Response;
    try {
      response = await (this.options.fetchImpl ?? fetch)(target, { headers, signal: AbortSignal.timeout(60 * 60_000) });
    } catch {
      throw new KassaError("OFFLINE", "Yangilanishni yuklab bo'lmadi — internetni tekshiring");
    }
    if (response.status === 416 && offset > 0) {
      // Qism fayl serverdagidan uzun — boshidan
      await rm(part, { force: true });
      return this.downloadUpdate();
    }
    if ((response.status !== 200 && response.status !== 206) || !response.body) {
      throw new KassaError("DOWNLOAD_FAILED", `Yangilanish yuklanmadi (HTTP ${response.status})`);
    }
    const append = response.status === 206 && offset > 0;
    const handle = await open(part, append ? "a" : "w");
    try {
      // Har bo'lak diskka yozilgach keyingisi o'qiladi — uzilsa ham yozilgan qism saqlanadi
      for await (const chunk of Readable.fromWeb(response.body as unknown as WebReadableStream)) await handle.write(chunk as Buffer);
    } catch {
      throw new KassaError("OFFLINE", "Yuklab olish uzildi — qayta bosing, to'xtagan joyidan davom etadi");
    } finally {
      await handle.close();
    }
    if ((await KassaService.hashFile(part)) !== remote.sha256) {
      await rm(part, { force: true });
      this.store.deleteMeta("updatePartial");
      throw new KassaError("CHECKSUM_MISMATCH", "Yuklangan fayl nazorat yig'indisi mos emas — o'rnatilmaydi");
    }
    await rename(part, file);
    this.store.deleteMeta("updatePartial");
    this.store.setMeta("updateFile", { version: remote.latest, file, sha256: remote.sha256 });
    return { ...info, downloaded: true, partialBytes: 0 };
  }

  /** Yuklangan o'rnatuvchini ishga tushirish (fayl qayta tekshiriladi). Lokal baza va navbat saqlanib qoladi. */
  async installUpdate(): Promise<void> {
    this.requireCashier();
    const saved = this.savedUpdate();
    if (!saved) throw new KassaError("CONFLICT", "Avval yangilanishni yuklab oling");
    if (!(await KassaService.fileMatches(saved.file, saved.sha256))) throw new KassaError("CHECKSUM_MISMATCH", "O'rnatuvchi fayl o'zgargan yoki o'chirilgan — qayta yuklab oling");
    if (!this.options.updater) throw new KassaError("UNAVAILABLE", "O'rnatish bu muhitda mavjud emas");
    await this.options.updater.install(saved.file);
  }

  async printers() {
    return this.options.printer ? this.options.printer.list() : [];
  }

  async print(input: { html: string }): Promise<void> {
    this.requireCashier();
    const html = String(input.html ?? "");
    if (html.length === 0 || html.length > 2_000_000) throw new KassaError("BAD_REQUEST", "Chek hujjati noto'g'ri");
    if (!this.options.printer) throw new KassaError("UNAVAILABLE", "Printer mavjud emas");
    await this.options.printer.print(html, this.prefs());
  }

  /** Etiketkalar — etiketka printeriga (qurilma sozlamasi), o'lcham shablondan. */
  async printLabels(input: LabelPrintInput): Promise<void> {
    this.requireCashier();
    const html = String(input.html ?? "");
    if (html.length === 0 || html.length > MAX_LABELS_HTML) throw new KassaError("BAD_REQUEST", "Etiketka hujjati noto'g'ri");
    const widthMm = Number(input.widthMm);
    const heightMm = Number(input.heightMm);
    const inRange = (value: number) => Number.isFinite(value) && value >= LABEL_MM.min && value <= LABEL_MM.max;
    if (!inRange(widthMm) || !inRange(heightMm)) throw new KassaError("BAD_REQUEST", "Etiketka o'lchami noto'g'ri");
    if (!this.options.printer) throw new KassaError("UNAVAILABLE", "Printer mavjud emas");
    await this.options.printer.printLabels(html, { printerName: this.prefs().labelPrinterName, layout: input.layout === "a4" ? "a4" : "roll", widthMm, heightMm });
  }

  async openDrawer(): Promise<void> {
    this.requireCashier();
    try {
      await kickDrawer(this.prefs().drawer);
    } catch (error) {
      throw new KassaError("DRAWER_FAILED", `Pul qutisi ochilmadi: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** IPC javobiga aylantirish: KassaError/ApiError — xabar bilan, kutilmagan xato — umumiy. */
export function toKassaError(error: unknown): { code: string; message: string; details?: unknown } {
  if (error instanceof KassaError) return { code: error.code, message: error.message, details: error.details };
  if (error instanceof ApiError) return { code: error.code, message: error.message, details: error.details };
  if (error instanceof Error && error.name === "OfflineError") return { code: "OFFLINE", message: error.message };
  return { code: "INTERNAL", message: "Kutilmagan xato" };
}

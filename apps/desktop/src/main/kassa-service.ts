/**
 * Kassa ilovasining asosiy xizmati (main jarayon): qurilmani ro'yxatdan o'tkazish, kassir kirishi va PIN, sinxron,
 * smena, chek (offline), qaytarish, kechiktirilgan cheklar, printer va pul qutisi. Renderer faqat IPC orqali shu
 * metodlarni chaqiradi; token va lokal baza renderer'ga chiqmaydi.
 *
 * Chek qurilmada yakunlanadi (internet shart emas): hisob serverdagi bilan bir xil (`sale-calc`), raqam qurilma kodi
 * bilan (`K01-000123`), navbatga `sale.complete` bo'lib tushadi. Qoldiq yetmasa ham sotiladi (server nomuvofiqlik
 * sifatida qayd etadi) — kassir ekranda ogohlantirishni ko'radi.
 */
import { randomUUID } from "node:crypto";
import type {
  AppStatus,
  CartLineInput,
  DevicePrefs,
  DocumentSync,
  HeldCart,
  HeldReceipt,
  LocalReturn,
  LocalSale,
  LocalShift,
  PosContext,
  PosCustomer,
  PosProduct,
  RejectedOperation,
  ReturnableReceipt,
  ReturnInput,
  SaleInput,
  ShiftTotals,
  UnsyncedOperation,
} from "../shared/kassa-api.js";
import { fromMinor, mulDivRound, rescale, toMinor } from "../shared/money.js";
import { computeSale, estimateCashback, listPrice, unitFactor, type CalcConversion, type CalcProduct } from "../shared/sale-calc.js";
import type {
  CashierRecord,
  CompanyInfo,
  DeviceInfo,
  PaymentMethod,
  PosConfig,
  RefundMethod,
  RemoteReceipt,
  ReturnPayload,
  SalePayload,
  SyncStatus,
} from "../shared/sync-types.js";
import { ApiError, OfflineError, createApiClient, type ApiClient } from "./api-client.js";
import { kickDrawer, validateDrawerPrefs } from "./drawer.js";
import type { LocalStore, StockDelta, StoredDocument } from "./local-store.js";
import { PIN_PATTERN, checkPin, hashPin } from "./pin.js";
import { SyncEngine } from "./sync-engine.js";

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
const REFUND_METHODS: RefundMethod[] = ["cash", "card", "balance"];

export type TokenVault = { save(token: string): void; load(): string | null; clear(): void };

/** Chop etish (Electron) — testlarda berilmaydi. */
export type ReceiptPrinter = {
  list(): Promise<{ name: string; displayName: string }[]>;
  print(html: string, prefs: DevicePrefs): Promise<void>;
};

export const DEFAULT_PREFS: DevicePrefs = {
  printerName: null,
  paperWidth: 80,
  autoPrint: true,
  drawer: { mode: "none" },
  openDrawerOnCash: false,
};

type ProductRow = CalcProduct & { sku: string; barcode: string | null; isActive: boolean; isSaleable: boolean };
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
};

const EMPTY_TOTALS: ShiftTotals = { sales: "0.00", cash: "0.00", card: "0.00", returns: "0.00", receipts: 0 };
const addMoney = (a: string, b: bigint) => fromMinor(toMinor(a) + b);

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
  private engine: SyncEngine | null = null;
  private cashier: CashierRecord | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: LocalStore,
    private readonly vault: TokenVault,
    private readonly options: {
      appVersion: string;
      platform: string;
      fetchImpl?: typeof fetch;
      onSyncStatus?: (status: SyncStatus) => void;
      printer?: ReceiptPrinter;
    },
  ) {
    this.connect();
  }

  // ─── Holat ───────────────────────────────────────────────────────────────

  status(): AppStatus {
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
    this.engine = new SyncEngine(this.store, this.api, (status) => this.options.onSyncStatus?.(status));
  }

  /** Davriy sinxron (standart 30 soniya); ilova yopilganda `stop`. */
  start(intervalMs = 30_000) {
    this.stop();
    void this.engine?.sync();
    this.timer = setInterval(() => void this.engine?.sync(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ─── Ro'yxatdan o'tkazish ───────────────────────────────────────────────

  private setupClient(apiUrl: string) {
    let url: URL;
    try {
      url = new URL(apiUrl);
    } catch {
      throw new KassaError("BAD_REQUEST", "Server manzili noto'g'ri");
    }
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new KassaError("BAD_REQUEST", "Server manzili https bo'lishi kerak");
    }
    return createApiClient({ baseUrl: url.origin, appVersion: this.options.appVersion, fetchImpl: this.options.fetchImpl });
  }

  async setupOptions(input: { apiUrl: string; phone: string; password: string; companyId?: string }) {
    return this.setupClient(input.apiUrl).setupOptions(input);
  }

  async register(input: { apiUrl: string; phone: string; password: string; companyId?: string; warehouseId: string; name: string }): Promise<AppStatus> {
    if (this.api) throw new KassaError("CONFLICT", "Qurilma allaqachon ro'yxatdan o'tgan");
    const client = this.setupClient(input.apiUrl);
    const registration = await client.setupRegister({ ...input, platform: this.options.platform });
    this.vault.save(registration.token);
    this.store.setMeta("apiUrl", new URL(input.apiUrl).origin);
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
    await this.engine.sync();
    return this.status();
  }

  rejected(): RejectedOperation[] {
    return this.store.rejectedOps().map((op) => ({ opId: op.opId, type: op.type, createdAt: op.createdAt, error: op.error }));
  }

  unsynced(): UnsyncedOperation[] {
    this.requireCashier();
    return this.store.unsyncedOps().map((op) => ({
      opId: op.opId,
      type: op.type,
      createdAt: op.createdAt,
      status: op.status === "rejected" ? "rejected" : "pending",
      attempts: op.attempts,
      error: op.error,
      number: op.number,
      total: op.total,
      label: op.type === "customer.create" ? String(op.payload.name ?? "") : op.type.startsWith("shift.") ? String(op.payload.shiftId ?? "") : null,
    }));
  }

  retry(input: { opId: string }): AppStatus {
    this.requireCashier();
    if (!this.store.retryOp(input.opId)) throw new KassaError("NOT_FOUND", "Rad etilgan amal topilmadi");
    void this.engine?.sync();
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
    void this.engine?.sync();
    return this.status();
  }

  closeShift(input: { closingCash: string }): AppStatus {
    const cashier = this.requireCashier();
    if (!MONEY.test(input.closingCash)) throw new KassaError("BAD_REQUEST", "Kassadagi naqd summasi noto'g'ri");
    const shift = this.store.getMeta<LocalShift>("shift");
    if (!shift) throw new KassaError("CONFLICT", "Ochiq smena yo'q");
    this.assertShiftOperator(shift, cashier);
    if (this.store.heldReceipts().length > 0) throw new KassaError("CONFLICT", "Kechiktirilgan cheklar bor — avval yakunlang yoki o'chiring");
    this.store.inTransaction(() => {
      this.store.enqueue({ type: "shift.close", cashierId: cashier.userId, payload: { shiftId: shift.id, closingCash: input.closingCash } });
      this.store.deleteMeta("shift");
    });
    void this.engine?.sync();
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
      company: config?.company ?? null,
      permissions: cashier.permissions,
    };
  }

  private toPosProducts(rows: ProductRow[]): PosProduct[] {
    const stock = this.store.stockMap(rows.map((row) => row.id));
    const units = this.unitNames();
    const base = this.baseCurrency();
    const rates = this.rates();
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
      price: listPrice(row, "1", base, rates),
      taxRate: row.taxRate,
      taxIncluded: row.taxIncluded,
      stock: fromMinor(stock.get(row.id) ?? 0n, 4),
    }));
  }

  products(input: { query: string; limit?: number }): PosProduct[] {
    this.requireCashier();
    const limit = Math.min(Math.max(input.limit ?? 60, 1), 200);
    return this.toPosProducts(this.store.searchProducts(String(input.query ?? ""), limit) as ProductRow[]);
  }

  productByCode(input: { code: string }): PosProduct | null {
    this.requireCashier();
    const row = this.store.productByCode<ProductRow>(String(input.code ?? ""));
    return row ? this.toPosProducts([row])[0]! : null;
  }

  private toPosCustomer(row: CustomerRow, pending: Set<string>): PosCustomer {
    return {
      id: row.id,
      name: row.name,
      code: row.code ?? null,
      phone: row.phone ?? null,
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

  createCustomer(input: { name: string; phone?: string | null }): PosCustomer {
    const cashier = this.requireCashier();
    const name = String(input.name ?? "").trim();
    const phone = input.phone ? String(input.phone).trim() : null;
    if (name.length === 0 || name.length > 200) throw new KassaError("BAD_REQUEST", "Mijoz ismi 1–200 belgi");
    if (phone && (phone.length > 20 || phone.replace(/\D/g, "").length < 9)) throw new KassaError("BAD_REQUEST", "Telefon raqami noto'g'ri");
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
      address: null,
      taxId: null,
    };
    this.store.inTransaction(() => {
      this.store.enqueue({ type: "customer.create", cashierId: cashier.userId, payload: { customerId: row.id, name, phone } });
      this.store.saveCustomer(row);
    });
    void this.engine?.sync();
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
      const list = listPrice(product, factor, base, rates);
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
    if (!PAYMENT_METHODS.includes(input.paymentMethod)) throw new KassaError("BAD_REQUEST", "To'lov usuli noto'g'ri");

    let customer: CustomerRow | null = null;
    if (input.customerId) {
      customer = this.store.customer<CustomerRow>(String(input.customerId));
      if (!customer) throw new KassaError("BAD_REQUEST", "Mijoz topilmadi");
      if (!customer.isActive) throw new KassaError("BAD_REQUEST", "Mijoz faol emas");
    }
    const { prepared, stockDeltas, base, rates } = this.prepareLines(input.lines, cashier, customer?.discountPercent ?? "0");
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
      cashbackAmount: input.cashbackAmount,
      balanceAmount: input.balanceAmount,
      changeToBalance: !!input.changeToBalance,
      currencyPayments: (input.currencyPayments ?? []).map((part) => ({ currency: String(part.currency), amount: part.amount, method: part.method === "card" ? "card" : "cash" })),
    });
    if (calc.errors.length > 0) throw new KassaError("BAD_REQUEST", calc.errors[0]!, { errors: calc.errors });

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
        paymentMethod: input.paymentMethod,
        amountPaid: fromMinor(calc.tendered),
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
        paymentMethod: input.paymentMethod,
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
      const cashIn = input.paymentMethod === "cash" ? calc.paid + calc.changeKept : 0n;
      this.store.setMeta("shift", {
        ...shift,
        totals: {
          sales: addMoney(totals.sales, calc.total),
          cash: addMoney(totals.cash, cashIn),
          card: addMoney(totals.card, input.paymentMethod === "card" ? calc.paid : 0n),
          returns: totals.returns,
          receipts: totals.receipts + 1,
        },
      } satisfies LocalShift);
      return sale;
    });

    void this.engine?.sync();
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

  async findReceipt(input: { number: string }): Promise<ReturnableReceipt> {
    this.requireCashier();
    const number = String(input.number ?? "").trim().toUpperCase();
    if (!number) throw new KassaError("BAD_REQUEST", "Chek raqamini kiriting");

    const local = this.store.saleByNumber<LocalSale>(number);
    if (local) {
      const returned = this.localReturned(local.doc.id);
      return {
        source: "local",
        orderId: local.doc.id,
        number: local.doc.number,
        createdAt: local.doc.createdAt,
        status: local.state === "rejected" || local.state === "discarded" ? local.state : "completed",
        customer: local.doc.customer ? { id: local.doc.customer.id, name: local.doc.customer.name } : null,
        total: local.doc.total,
        paid: fromMinor(toMinor(local.doc.paid) + toMinor(local.doc.balanceUsed) + toMinor(local.doc.cashbackUsed)),
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
    if (!REFUND_METHODS.includes(input.refundMethod)) throw new KassaError("BAD_REQUEST", "Pul qaytarish usuli noto'g'ri");
    const receipt = await this.findReceipt({ number: input.number });
    if (receipt.status === "rejected" || receipt.status === "discarded") throw new KassaError("CONFLICT", "Chek serverga yozilmagan — qaytarib bo'lmaydi");
    if (receipt.source === "server" && receipt.status !== "shipped" && receipt.status !== "delivered") {
      throw new KassaError("CONFLICT", "Faqat yakunlangan chekdagi mahsulot qaytariladi");
    }
    if (input.refundMethod === "balance" && !receipt.customer) throw new KassaError("BAD_REQUEST", "Balansga qaytarish uchun chekda mijoz bo'lishi kerak");
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
        refundMethod: input.refundMethod,
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
        refundMethod: input.refundMethod,
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
          cash: addMoney(totals.cash, input.refundMethod === "cash" ? -refundEstimate : 0n),
          card: addMoney(totals.card, input.refundMethod === "card" ? -refundEstimate : 0n),
        },
      } satisfies LocalShift);
      return localReturn;
    });
    void this.engine?.sync();
    return doc;
  }

  // ─── Qurilma sozlamalari, printer, pul qutisi ───────────────────────────

  prefs(): DevicePrefs {
    return { ...DEFAULT_PREFS, ...(this.store.getMeta<Partial<DevicePrefs>>("devicePrefs") ?? {}) };
  }

  savePrefs(input: DevicePrefs): DevicePrefs {
    this.requireCashier();
    const prefs: DevicePrefs = {
      printerName: input.printerName ? String(input.printerName).slice(0, 200) : null,
      paperWidth: input.paperWidth === 58 ? 58 : 80,
      autoPrint: !!input.autoPrint,
      openDrawerOnCash: !!input.openDrawerOnCash,
      drawer: {
        mode: ["none", "driver", "tcp", "share"].includes(input.drawer?.mode) ? input.drawer.mode : "none",
        ...(input.drawer?.host ? { host: String(input.drawer.host).trim() } : {}),
        ...(input.drawer?.port ? { port: Number(input.drawer.port) } : {}),
        ...(input.drawer?.share ? { share: String(input.drawer.share).trim() } : {}),
      },
    };
    const invalid = validateDrawerPrefs(prefs.drawer);
    if (invalid) throw new KassaError("BAD_REQUEST", invalid);
    this.store.setMeta("devicePrefs", prefs);
    return prefs;
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

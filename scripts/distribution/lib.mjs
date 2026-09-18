/**
 * BUM ERP — 0→100 DISTRIBUTSIYA KOMPANIYASI SIMULYATSIYASI (server tomoni).
 *
 * Haqiqiy kompaniya kabi: kompaniya ochiladi, xodimlar, mahsulot, xarid, mijozlar, sotuv,
 * yetkazish, kassa, qaytarish, ko'chirish, hisobotlar va yakuniy buxgalteriya solishtiruvi.
 *
 * Muhim qoidalar:
 *  - YANGI funksiya qo'shilmaydi; faqat mavjud API ishlatiladi.
 *  - Xato topilsa TO'XTAMAYDI — qayd etib, keyingi oqimga o'tadi.
 *  - Production'ga tegmaydi: faqat lokal server va yangi (izolyatsiyalangan) kompaniya.
 *
 * Ishga tushirish:  node scripts/distribution-e2e.mjs
 * Natija:           e2e/.artifacts/distribution/results.json va sim-log.md
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OUT = path.join(ROOT, "e2e", ".artifacts", "distribution");
const API = process.env.SIM_API_URL ?? "http://localhost:3000";

if (existsSync(path.join(ROOT, ".env"))) process.loadEnvFile(path.join(ROOT, ".env"));
mkdirSync(OUT, { recursive: true });

// ─── Natijalarni qayd etish ──────────────────────────────────────────────────

/** @type {{section: string, name: string, status: "PASS"|"FAIL"|"PARTIAL"|"NOT VERIFIED", detail: string}[]} */
const results = [];
let currentSection = "0. Tayyorgarlik";

const section = (name) => {
  currentSection = name;
  console.log(`\n=== ${name} ===`);
};

const record = (status, name, detail = "") => {
  results.push({ section: currentSection, name, status, detail: String(detail).slice(0, 600) });
  const mark = { PASS: "ok  ", FAIL: "FAIL", PARTIAL: "PART", "NOT VERIFIED": "n/v " }[status];
  console.log(`  ${mark} ${name}${detail ? ` — ${String(detail).slice(0, 160)}` : ""}`);
};

/** Tekshiruv: xato bo'lsa ham to'xtamaydi. */
async function check(name, fn) {
  try {
    const detail = await fn();
    record("PASS", name, detail ?? "");
    return true;
  } catch (error) {
    record("FAIL", name, error?.message ?? String(error));
    return false;
  }
}

function expect(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: kutilgan ${e}, olingan ${a}`);
  return `${label} = ${a}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

/** @type {Record<string, string>} rol → cookie */
const jar = {};

async function raw(role, method, url, body, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (jar[role]) headers.cookie = jar[role];
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API}${url}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, body: json, text, headers: res.headers };
}

/** Muvaffaqiyatli javob kutiladi; aks holda xato (tekshiruv FAIL bo'ladi). */
async function call(role, method, url, body) {
  const res = await raw(role, method, url, body);
  if (res.status >= 400) throw new Error(`${method} ${url} → ${res.status} ${res.text.slice(0, 300)}`);
  return res.body;
}

async function loginAs(role, phone, password) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, password }),
  });
  if (res.status !== 200) throw new Error(`${role} kira olmadi: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  jar[role] = cookie;
  return cookie;
}

// ─── Umumiy holat ────────────────────────────────────────────────────────────

const RUN = Date.now().toString().slice(-6);
const PASSWORD = "Simulyatsiya-2026!";
const phoneFor = (n) => `+9989${String(RUN).slice(-5)}${String(n).padStart(2, "0")}`;
const money = (value) => Number(value ?? 0);
const today = () => new Date().toISOString().slice(0, 10);

const state = {
  companyId: null,
  slug: null,
  warehouses: {},
  cashAccounts: {},
  products: [],
  customers: {},
  employees: {},
  supplier: null,
  orders: {},
  units: {},
};

// ─── 1. KOMPANIYA ────────────────────────────────────────────────────────────

async function sectionCompany() {
  section("1. Kompaniya ochish (trial, obuna, modullar, tenant izolyatsiyasi)");

  await loginAs("admin", process.env.BOOTSTRAP_ADMIN_PHONE, process.env.BOOTSTRAP_ADMIN_PASSWORD);

  const owner = { phone: phoneFor(1), password: PASSWORD, name: "Distribution Egasi" };
  await check("kompaniya noldan yaratiladi", async () => {
    const created = await call("admin", "POST", "/api/platform/companies", {
      name: `BUM Distribution Demo ${RUN}`,
      owner,
    });
    state.companyId = created.company.id;
    state.slug = created.company.slug;
    return `companyId=${state.companyId} slug=${state.slug}`;
  });

  await check("egasi tizimga kiradi", async () => {
    await loginAs("owner", owner.phone, owner.password);
    const me = await call("owner", "GET", "/api/auth/me");
    assert(me.user.hasCompany, "egada kompaniya yo'q");
    return `ega=${me.user.name}`;
  });

  await check("yangi kompaniya — trial obuna va included litsenziyalar", async () => {
    const sub = await call("owner", "GET", "/api/subscription");
    assert(sub.subscription, "obuna yo'q");
    return `status=${sub.subscription.status} included=${sub.subscription.includedLicenses} tugaydi=${sub.subscription.expiresAt?.slice(0, 10)}`;
  });

  await check("modullar ro'yxati kompaniyaga ochiq", async () => {
    const modules = await call("owner", "GET", "/api/company");
    assert(Array.isArray(modules.modules) || modules.company, "kompaniya ma'lumoti yo'q");
    return `kompaniya=${modules.company?.name}`;
  });

  // Tenant izolyatsiyasi: begona kompaniya yaratamiz va uning ma'lumotiga kirishga urinamiz
  await check("tenant izolyatsiyasi: begona kompaniya ma'lumoti ko'rinmaydi", async () => {
    const strangerOwner = { phone: phoneFor(90), password: PASSWORD, name: "Begona ega" };
    const stranger = await call("admin", "POST", "/api/platform/companies", {
      name: `Begona kompaniya ${RUN}`,
      owner: strangerOwner,
    });
    await loginAs("stranger", strangerOwner.phone, strangerOwner.password);
    const customer = await call("stranger", "POST", "/api/sales/customers", { name: "Begona mijoz" });
    state.foreign = { companyId: stranger.company.id, customerId: customer.customer.id, phone: strangerOwner.phone };
    const seen = await raw("owner", "GET", `/api/sales/customers/${customer.customer.id}`);
    assert(seen.status === 404 || seen.status === 403, `begona mijoz ko'rindi: ${seen.status}`);
    return `begona mijozga kirish → ${seen.status}`;
  });

  // Litsenziya: simulyatsiyada 12 xodim kerak — platforma admini shartnoma bo'yicha beradi
  await check("platforma admini litsenziya limitini kelishuv bo'yicha oshiradi", async () => {
    await call("admin", "PUT", `/api/platform/companies/${state.companyId}/subscription`, { includedLicenses: 15 });
    const sub = await call("owner", "GET", "/api/subscription");
    return expect(sub.subscription.includedLicenses, 15, "includedLicenses");
  });
}

// ─── 2. XODIMLAR ─────────────────────────────────────────────────────────────

const ROLES = [
  ["manager", "Menejer", "Direktor"],
  // TOPILMA: tizimda alohida "Marketolog" roli yo'q — eng yaqini "Savdo menejeri" (promotions.manage)
  ["marketer", "Marketolog (Savdo menejeri roli bilan)", "Savdo menejeri"],
  ["supervisor", "Supervayzer", "Supervayzer"],
  ["agent1", "Sotuv agenti 1", "Sotuv agenti"],
  ["agent2", "Sotuv agenti 2", "Sotuv agenti"],
  ["cashier", "Kassir", "Kassir"],
  ["warehouse", "Ombor menejeri", "Ombor menejeri"],
  ["courier1", "Yetkazuvchi 1", "Dostavka agenti"],
  ["courier2", "Yetkazuvchi 2", "Dostavka agenti"],
  ["accountant", "Buxgalter", "Buxgalter"],
];

async function sectionEmployees() {
  section("2. Xodimlar (Xodim ≠ Foydalanuvchi ≠ Litsenziya)");

  const roles = await call("owner", "GET", "/api/company/roles").catch(() => null);
  const available = new Set((roles?.roles ?? []).map((r) => r.name));
  record("PASS", "mavjud rollar", [...available].join(", ") || "ro'yxat olinmadi");

  let index = 10;
  for (const [key, name, role] of ROLES) {
    index += 1;
    const phone = phoneFor(index);
    await check(`xodim: ${name} (${role})`, async () => {
      if (!available.has(role)) throw new Error(`rol mavjud emas: ${role}`);
      const created = await call("owner", "POST", "/api/company/employees", {
        name,
        phone,
        password: PASSWORD,
        role,
      });
      state.employees[key] = { ...created.employee, phone, role, name };
      await loginAs(key, phone, PASSWORD);
      return `id=${created.employee.id}`;
    });
  }

  await check("BEPUL xodim: foydalanuvchi ham, litsenziya ham yaratilmaydi", async () => {
    const before = await call("owner", "GET", "/api/subscription/licenses");
    const created = await call("owner", "POST", "/api/company/employees", {
      name: "Ishchi (dasturga kirmaydi)",
      phone: phoneFor(60),
      role: "Kassir",
      softwareAccess: false,
    });
    const after = await call("owner", "GET", "/api/subscription/licenses");
    assert(
      (after.licenses?.length ?? 0) === (before.licenses?.length ?? 0),
      `litsenziya soni o'zgardi: ${before.licenses?.length} → ${after.licenses?.length}`,
    );
    const login = await raw("none", "POST", "/api/auth/login", { phone: phoneFor(60), password: PASSWORD });
    assert(login.status === 401, `dasturga kirmaydigan xodim kira oldi: ${login.status}`);
    state.employees.free = created.employee;
    return `HR kartochka=${created.employee.id}, login=${login.status}`;
  });

  await check("dasturli xodimda litsenziya bor", async () => {
    const licenses = await call("owner", "GET", "/api/subscription/licenses");
    const active = (licenses.licenses ?? []).filter((l) => l.status === "active");
    assert(active.length >= ROLES.length, `faol litsenziya kam: ${active.length}`);
    return `faol litsenziya=${active.length}`;
  });

  await check("menyu ko'rinishi: agent ERP bo'limlarini ko'rmaydi", async () => {
    const forbidden = await raw("agent1", "GET", "/api/finance/cash-accounts");
    const allowed = await raw("agent1", "GET", "/api/sales-agent/dashboard");
    assert(forbidden.status === 403, `agent moliyani ko'rdi: ${forbidden.status}`);
    assert(allowed.status === 200, `agent ish joyi ochilmadi: ${allowed.status}`);
    return `moliya=${forbidden.status}, agent ish joyi=${allowed.status}`;
  });

  await check("kassir kadrlar va auditga kira olmaydi", async () => {
    const hr = await raw("cashier", "GET", "/api/hr/employees");
    const audit = await raw("cashier", "GET", "/api/company/audit-logs");
    assert(hr.status === 403, `kassir HR ko'rdi: ${hr.status}`);
    assert(audit.status === 403 || audit.status === 404, `kassir audit ko'rdi: ${audit.status}`);
    return `hr=${hr.status}, audit=${audit.status}`;
  });
}

// ─── 3. OMBOR, BANK, TERMINAL ────────────────────────────────────────────────

async function sectionInfrastructure() {
  section("3. Omborlar, bank hisoblari va terminallar");

  await check("omborlar: Asosiy va Filial", async () => {
    const list = await call("owner", "GET", "/api/inventory/warehouses");
    state.warehouses.main = list.warehouses[0].id;
    const branch = await call("owner", "POST", "/api/inventory/warehouses", { name: "Filial ombori", code: `BR${RUN}` });
    state.warehouses.branch = branch.warehouse.id;
    return `main=${state.warehouses.main} branch=${state.warehouses.branch}`;
  });

  await check("bank hisoblari: X Bank UZS va Y Bank UZS", async () => {
    const x = await call("owner", "POST", "/api/finance/cash-accounts", { name: "X Bank UZS", type: "bank", bankName: "X Bank" });
    const y = await call("owner", "POST", "/api/finance/cash-accounts", { name: "Y Bank UZS", type: "bank", bankName: "Y Bank" });
    state.cashAccounts.xbank = x.cashAccount.id;
    state.cashAccounts.ybank = y.cashAccount.id;
    return `X=${x.cashAccount.id} Y=${y.cashAccount.id}`;
  });

  await check("terminallar: UZCARD #01 → X Bank, HUMO #01 → Y Bank", async () => {
    const uzcard = await call("owner", "POST", "/api/finance/cash-accounts", {
      name: "UZCARD #01",
      type: "card",
      showInPos: true,
      settlesToCashAccountId: state.cashAccounts.xbank,
      settlementCommissionPercent: "0.5",
    });
    const humo = await call("owner", "POST", "/api/finance/cash-accounts", {
      name: "HUMO #01",
      type: "card",
      showInPos: true,
      settlesToCashAccountId: state.cashAccounts.ybank,
      settlementCommissionPercent: "0.7",
    });
    state.cashAccounts.uzcard = uzcard.cashAccount.id;
    state.cashAccounts.humo = humo.cashAccount.id;
    // Terminal — alohida obyekt: to'lovlarda aynan terminal ko'rsatiladi
    const uzcardTerminal = await call("owner", "POST", "/api/finance/terminals", {
      name: "UZCARD #01",
      network: "uzcard",
      cashAccountId: uzcard.cashAccount.id,
      showInPos: true,
    });
    const humoTerminal = await call("owner", "POST", "/api/finance/terminals", {
      name: "HUMO #01",
      network: "humo",
      cashAccountId: humo.cashAccount.id,
      showInPos: true,
    });
    state.terminals = { uzcard: uzcardTerminal.terminal.id, humo: humoTerminal.terminal.id };
    return `UZCARD terminal=${state.terminals.uzcard} HUMO terminal=${state.terminals.humo}`;
  });

  await check("asosiy kassa mavjud (naqd)", async () => {
    const list = await call("owner", "GET", "/api/finance/cash-accounts");
    const main = list.cashAccounts.find((a) => a.isDefault);
    assert(main, "asosiy kassa topilmadi");
    state.cashAccounts.main = main.id;
    return `${main.name} (${main.type})`;
  });

  await check("ta'sischi kassaga boshlang'ich kapital kiritadi (5 000 000)", async () => {
    const purposes = await call("owner", "GET", "/api/finance/accounts?type=income");
    const purpose = purposes.accounts.find((a) => a.isActive);
    assert(purpose, "daromad moddasi topilmadi");
    await call("owner", "POST", "/api/finance/cash-transactions", {
      cashAccountId: state.cashAccounts.main,
      type: "in",
      amount: "5000000",
      description: "Ta'sischi kapitali",
      category: "other",
      counterAccountId: purpose.id,
      txDate: today(),
    });
    const after = await call("owner", "GET", "/api/finance/cash-accounts");
    return `kassa qoldig'i=${after.cashAccounts.find((a) => a.id === state.cashAccounts.main)?.balance}`;
  });
}

// ─── 4. KATALOG ──────────────────────────────────────────────────────────────

async function sectionCatalog() {
  section("4. Katalog: kategoriya, brend, o'lchov, 10 ta mahsulot");

  await check("o'lchov birliklari mavjud", async () => {
    const units = await call("owner", "GET", "/api/catalog/units");
    const piece = units.units.find((u) => u.shortName === "d") ?? units.units[0];
    state.units.piece = piece.id;
    return `${units.units.length} ta birlik, dona=${piece.id}`;
  });

  await check("kategoriya va brend", async () => {
    const category = await call("owner", "POST", "/api/catalog/categories", { name: "Ichimliklar" });
    const brand = await call("owner", "POST", "/api/catalog/brands", { name: "Demo Brend" });
    state.categoryId = category.category.id;
    state.brandId = brand.brand.id;
    return `kategoriya=${category.category.id} brend=${brand.brand.id}`;
  });

  await check("10 ta mahsulot (SKU, barkod, narx)", async () => {
    for (let i = 1; i <= 10; i += 1) {
      const created = await call("owner", "POST", "/api/catalog/products", {
        name: `Mahsulot ${i}`,
        sku: `SKU-${RUN}-${i}`,
        barcode: `200${RUN}${String(i).padStart(3, "0")}`,
        baseUnitId: state.units.piece,
        categoryId: state.categoryId,
        brandId: state.brandId,
        salesPrice: String(1000 * i),
        taxRate: "0",
      });
      state.products.push({ id: created.product.id, name: created.product.name, price: 1000 * i });
    }
    return `${state.products.length} ta mahsulot`;
  });

  await check("boshlang'ich qoldiq: har mahsulotdan turlicha", async () => {
    for (const [index, product] of state.products.entries()) {
      await call("owner", "POST", "/api/inventory/stock/movements", {
        type: "receive",
        productId: product.id,
        warehouseId: state.warehouses.main,
        quantity: String(100 + index * 50),
        costPrice: String(500 * (index + 1)),
      });
    }
    return `qoldiqlar kiritildi (${state.products.length} mahsulot)`;
  });
}


export { section, record, check, expect, assert, call, raw, loginAs, jar, state, results, OUT, ROOT, RUN, PASSWORD, phoneFor, money, today, sectionCompany, sectionEmployees, sectionInfrastructure, sectionCatalog };

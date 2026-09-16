/**
 * REAL QABUL TESTI uchun to'liq demo kompaniya yaratadi.
 *
 *   pnpm --filter @bum/api db:seed-demo
 *   pnpm --filter @bum/api db:seed-demo -- --name="BUM Demo 2"
 *
 * Nima yaratadi: kompaniya va egasi, har rol uchun xodim, dostavka agenti, ikkinchi ombor,
 * ikkita bank hisobi, UZCARD va HUMO terminallari (har biri o'z bankiga bog'langan),
 * mahsulotlar va qoldiq, koordinatali mijozlar, ta'minotchi, non retsepti (ishlab chiqarish uchun).
 *
 * Xavfsizlik va qaytariluvchanlik:
 *  - hamma narsa HTTP qatlami orqali (`app.inject`) — real klient kabi, barcha guard va tekshiruvlar ishlaydi
 *  - MAVJUD ma'lumot o'chirilmaydi va o'zgartirilmaydi; qayta ishga tushirilsa yetishmagan qismini to'ldiradi
 *  - masofaviy bazaga (production) ishlamaydi: `--allow-remote` bayrog'isiz faqat localhost
 *  - parollar faqat shu demo uchun; production paroli ishlatilmaydi va so'ralmaydi
 */
import { closeDb } from "../db/client.js";
import { env } from "../env.js";
import { buildServer } from "../server.js";

const COMPANY_NAME = process.argv.find((arg) => arg.startsWith("--name="))?.slice(7) ?? "BUM Demo";
const ALLOW_REMOTE = process.argv.includes("--allow-remote");
/** Demo hisoblar paroli — faqat `.env` dan (kodda saqlanmaydi). */
const PASSWORD = process.env.DEMO_PASSWORD ?? "";
const LICENSES = 10;

const phones = {
  owner: "+998900000101",
  direktor: "+998900000102",
  buxgalter: "+998900000103",
  kassir: "+998900000104",
  ombor: "+998900000105",
  agent: "+998900000106",
  dostavchi: "+998900000107",
};

const app = await buildServer();
await app.ready();

type Res = Awaited<ReturnType<typeof app.inject>>;

const ok = (res: Res, what: string) => {
  if (res.statusCode !== 200 && res.statusCode !== 201) throw new Error(`${what}: ${res.statusCode} ${res.body}`);
  return res.json();
};
/** Mavjud bo'lsa xato emas — takroriy ishga tushirishda o'tib ketiladi. */
const soft = (res: Res, what: string) => {
  if ([200, 201, 409].includes(res.statusCode)) return res.statusCode === 409 ? null : res.json();
  if (res.statusCode === 400 && /band|mavjud|takror/i.test(res.body)) return null;
  throw new Error(`${what}: ${res.statusCode} ${res.body}`);
};

function caller(cookie: string) {
  return (method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
}
const cookieOf = (res: Res) => res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

try {
  const host = new URL(env.DATABASE_URL).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host) && !ALLOW_REMOTE) {
    throw new Error(`Baza lokal emas (${host}). Demo ma'lumot production'ga yozilmasin — kerak bo'lsa --allow-remote bering.`);
  }
  console.log(`Baza: ${host} — demo kompaniya: "${COMPANY_NAME}"\n`);

  if (!PASSWORD) throw new Error("DEMO_PASSWORD .env da bo'lishi kerak (demo hisoblar paroli)");
  if (!env.BOOTSTRAP_ADMIN_PHONE || !env.BOOTSTRAP_ADMIN_PASSWORD) {
    throw new Error("BOOTSTRAP_ADMIN_PHONE va BOOTSTRAP_ADMIN_PASSWORD .env da bo'lishi kerak (avval db:seed)");
  }
  const adminLogin = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { phone: env.BOOTSTRAP_ADMIN_PHONE, password: env.BOOTSTRAP_ADMIN_PASSWORD },
  });
  if (adminLogin.statusCode !== 200) throw new Error(`Platforma admini kira olmadi: ${adminLogin.statusCode}`);
  const admin = caller(cookieOf(adminLogin));

  // ── Kompaniya: bor bo'lsa davom etadi ─────────────────────────────────────
  const all = ok(await admin("GET", "/api/platform/companies?limit=200"), "kompaniyalar").companies as { id: string; name: string }[];
  let companyId = all.find((row) => row.name === COMPANY_NAME)?.id;
  if (companyId) {
    console.log(`"${COMPANY_NAME}" mavjud (${companyId}) — yetishmagan qismlari to'ldiriladi.`);
  } else {
    companyId = ok(
      await admin("POST", "/api/platform/companies", { name: COMPANY_NAME, owner: { phone: phones.owner, password: PASSWORD, name: "Demo Egasi" } }),
      "kompaniya yaratish",
    ).company.id as string;
    console.log(`Kompaniya yaratildi: ${companyId}`);
  }

  // Trial'da 3 ta included litsenziya — demo uchun barcha rollar sig'ishi kerak
  ok(await admin("PUT", `/api/platform/companies/${companyId}/subscription`, { includedLicenses: LICENSES }), "litsenziya limiti");
  console.log(`Litsenziya limiti: ${LICENSES}`);

  const ownerLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { phone: phones.owner, password: PASSWORD } });
  if (ownerLogin.statusCode !== 200) throw new Error(`Egasi kira olmadi: ${ownerLogin.statusCode} ${ownerLogin.body}`);
  const api = caller(cookieOf(ownerLogin));

  // ── Xodimlar ──────────────────────────────────────────────────────────────
  const staff = [
    { role: "Direktor", phone: phones.direktor, name: "Demo Direktor" },
    { role: "Buxgalter", phone: phones.buxgalter, name: "Demo Buxgalter" },
    { role: "Kassir", phone: phones.kassir, name: "Demo Kassir" },
    { role: "Ombor menejeri", phone: phones.ombor, name: "Demo Omborchi" },
    { role: "Sotuv agenti", phone: phones.agent, name: "Demo Sotuv agenti" },
  ];
  for (const person of staff) soft(await api("POST", "/api/company/employees", { ...person, password: PASSWORD }), `xodim ${person.role}`);
  soft(await api("POST", "/api/delivery/agents", { name: "Demo Dostavchi", phone: phones.dostavchi, password: PASSWORD }), "dostavka agenti");
  console.log(`Xodimlar: ${staff.length} ta + dostavka agenti`);

  // ── Moliya ────────────────────────────────────────────────────────────────
  const findOrCreate = async (listUrl: string, key: string, name: string, createUrl: string, payload: object, field: string) => {
    const list = ok(await api("GET", listUrl), `ro'yxat ${listUrl}`)[key] as Record<string, unknown>[];
    const found = list.find((row) => row[field] === name);
    if (found) return found.id as string;
    const created = soft(await api("POST", createUrl, payload), `yaratish ${name}`);
    if (created) return (Object.values(created)[0] as { id: string }).id;
    const again = ok(await api("GET", listUrl), `ro'yxat ${listUrl}`)[key] as Record<string, unknown>[];
    return (again.find((row) => row[field] === name)!.id as string);
  };

  const accounts = ok(await api("GET", "/api/finance/cash-accounts"), "hisoblar").cashAccounts as { id: string; type: string }[];
  const mainBank = accounts.find((row) => row.type === "bank")!.id;
  const secondBank = await findOrCreate(
    "/api/finance/cash-accounts",
    "cashAccounts",
    "Hamkorbank hisobi",
    "/api/finance/cash-accounts",
    { name: "Hamkorbank hisobi", type: "bank", bankName: "Hamkorbank" },
    "name",
  );
  await findOrCreate(
    "/api/finance/terminals",
    "terminals",
    "UZCARD terminal #01",
    "/api/finance/terminals",
    { name: "UZCARD terminal #01", network: "uzcard", cashAccountId: mainBank },
    "name",
  );
  await findOrCreate(
    "/api/finance/terminals",
    "terminals",
    "HUMO terminal #01",
    "/api/finance/terminals",
    { name: "HUMO terminal #01", network: "humo", cashAccountId: secondBank },
    "name",
  );
  console.log("Moliya: 2 bank hisobi, UZCARD va HUMO terminallari (har biri o'z bankiga bog'langan)");

  // ── Ombor va katalog ──────────────────────────────────────────────────────
  const warehouses = ok(await api("GET", "/api/inventory/warehouses"), "omborlar").warehouses as { id: string; name: string }[];
  const mainWarehouse = warehouses[0]!.id;
  soft(await api("POST", "/api/inventory/warehouses", { name: "Ikkinchi ombor", code: "WH2" }), "ikkinchi ombor");

  const units = ok(await api("GET", "/api/catalog/units"), "birliklar").units as { id: string; shortName: string }[];
  const piece = units.find((row) => row.shortName === "d")?.id ?? units[0]!.id;

  const catalog = [
    { name: "Coca Cola 1L", sku: "COLA-1L", salesPrice: "12000", cost: "9000", qty: "200" },
    { name: "Nestle suv 0.5L", sku: "SUV-05", salesPrice: "4000", cost: "2500", qty: "300" },
    { name: "Shokolad", sku: "SHOK", salesPrice: "18000", cost: "12000", qty: "100" },
    { name: "Un (xomashyo)", sku: "UN", salesPrice: "0", cost: "8000", qty: "500" },
    { name: "Shakar (xomashyo)", sku: "SHAKAR", salesPrice: "0", cost: "11000", qty: "200" },
    { name: "Non", sku: "NON", salesPrice: "3000", cost: "0", qty: "0" },
  ];
  const existingProducts = ok(await api("GET", "/api/catalog/products?limit=200"), "mahsulotlar").products as { id: string; sku: string }[];
  const bySku = new Map(existingProducts.map((row) => [row.sku, row.id]));
  let addedProducts = 0;
  for (const item of catalog) {
    if (bySku.has(item.sku)) continue;
    const product = ok(
      await api("POST", "/api/catalog/products", { name: item.name, sku: item.sku, baseUnitId: piece, salesPrice: item.salesPrice, taxRate: "0" }),
      `mahsulot ${item.sku}`,
    ).product as { id: string };
    bySku.set(item.sku, product.id);
    addedProducts += 1;
    if (item.qty !== "0") {
      ok(
        await api("POST", "/api/inventory/stock/movements", {
          type: "receive",
          productId: product.id,
          warehouseId: mainWarehouse,
          quantity: item.qty,
          costPrice: item.cost,
        }),
        `qoldiq ${item.sku}`,
      );
    }
  }
  console.log(`Katalog: ${catalog.length} mahsulot (${addedProducts} tasi yangi), qoldiq bilan`);

  // ── Ishlab chiqarish retsepti ─────────────────────────────────────────────
  const boms = ok(await api("GET", "/api/manufacturing/boms"), "retseptlar").boms as { id: string; name: string }[];
  if (!boms.some((row) => row.name === "Non retsepti")) {
    const bom = ok(
      await api("POST", "/api/manufacturing/boms", { productId: bySku.get("NON"), name: "Non retsepti", quantity: "10" }),
      "retsept",
    ).bom.id as string;
    soft(await api("POST", `/api/manufacturing/boms/${bom}/items`, { productId: bySku.get("UN"), quantity: "5" }), "retsept: un");
    soft(await api("POST", `/api/manufacturing/boms/${bom}/items`, { productId: bySku.get("SHAKAR"), quantity: "1" }), "retsept: shakar");
  }
  console.log("Ishlab chiqarish: non retsepti (10 dona uchun 5 un + 1 shakar)");

  // ── Mijozlar va ta'minotchi ───────────────────────────────────────────────
  const customers = [
    { name: "Baraka do'koni", phone: "+998911111101", latitude: 41.311081, longitude: 69.240562 },
    { name: "Mega market", phone: "+998911111102", latitude: 41.315, longitude: 69.245 },
    { name: "Anvar savdo", phone: "+998911111103", latitude: 41.308, longitude: 69.238 },
  ];
  // Mijoz telefoni API darajasida noyob emas — takroriy yuritishda dublikat bo'lmasligi uchun avval tekshiriladi
  const existingCustomers = ok(await api("GET", "/api/sales/customers?limit=200"), "mijozlar").customers as { phone: string | null }[];
  const knownPhones = new Set(existingCustomers.map((row) => row.phone).filter(Boolean));
  for (const customer of customers) {
    if (knownPhones.has(customer.phone)) continue;
    soft(await api("POST", "/api/sales/customers", customer), `mijoz ${customer.name}`);
  }
  soft(await api("POST", "/api/purchase/suppliers", { name: "Oziq-ovqat ta'minoti", code: "SUP-01" }), "ta'minotchi");
  console.log(`Mijozlar: ${customers.length} ta (koordinatali), ta'minotchi: 1 ta`);

  console.log(`\n${"=".repeat(66)}\nKIRISH MA'LUMOTLARI — faqat lokal demo. Parol: .env dagi DEMO_PASSWORD\n${"=".repeat(66)}`);
  const credentials: [string, string][] = [
    ["Egasi (Owner)", phones.owner],
    ["Direktor (Admin)", phones.direktor],
    ["Buxgalter (Accountant)", phones.buxgalter],
    ["Kassir (Cashier)", phones.kassir],
    ["Ombor menejeri (Warehouse)", phones.ombor],
    ["Sotuv agenti (Sales Agent)", phones.agent],
    ["Dostavka agenti (Delivery Agent)", phones.dostavchi],
  ];
  for (const [role, phone] of credentials) console.log(`  ${role.padEnd(34)} ${phone}`);
  console.log(`\nKompaniya: ${COMPANY_NAME} (${companyId})`);
  console.log("Bitta kompaniyada chakana, distribyutsiya, ulgurji va ishlab chiqarish birga sinaladi.\n");
} finally {
  await app.close();
  await closeDb();
}

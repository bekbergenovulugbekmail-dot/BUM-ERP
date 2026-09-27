// BUM ERP — STAGING 0→100 FUNCTIONAL ACCEPTANCE (faqat staging, QA tenant).
// HIMOYA: har bir so'rov faqat STAGING hostiga; production kompaniya ID'lari bilan mutatsiya — darhol to'xtash.
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const STAGING = "https://bum-web-staging.up.railway.app";
const QA_COMPANY = "5c57c9b9-f860-4968-9fae-58fb9737d4a2";
const QA_SLUG = "bum-qa-test";
const QA_WH = "751b2ca4-9e2d-47ca-8e5c-b3e8814cf46a";
const PROD_COMPANY_IDS = ["1b83a193-f3e9-486e-9a9b-ff2793dd5ed1", "9daa54ad-d904-4e98-8869-e90404951043", "5acffa9a-b041-4867-a171-ee447e3abd4c"];
const PROD_HOSTS = ["bum-web-production.up.railway.app", "bum-erp.uz", "www.bum-erp.uz", "app.bum-erp.uz"];
const EMP = { ozoda: "934fa1a2-c4ba-4e78-be55-3796e0a97ca6", diana: "5f513851-ed7c-4855-86b2-a405722da87d", ali: "52cd676c-dd5c-46b3-b690-1d2752f7f85e" };
const secretFile = `${os.homedir()}/Documents/BUM-ERP-staging-admin.txt`;
const secrets = fs.readFileSync(secretFile, "utf8");
const cred = (label) => { const m = new RegExp(`${label}: (\\S+) / (\\S+)`).exec(secrets); if (!m) throw new Error(`cred ${label}`); return { phone: m[1], password: m[2] }; };
const OUT = process.argv[2] || "qa-acceptance-result.json";

async function http(method, path, { cookie, body } = {}) {
  const url = new URL(STAGING + path);
  if (url.origin !== STAGING || PROD_HOSTS.includes(url.hostname)) throw new Error("HIMOYA: faqat staging");
  const text = JSON.stringify(body ?? {}) + path;
  if (method !== "GET" && PROD_COMPANY_IDS.some((id) => text.includes(id))) throw new Error("HIMOYA: production kompaniya ID'si bilan mutatsiya");
  const res = await fetch(url, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), "x-bum-company": QA_SLUG }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: "manual" });
  let json = null;
  try { json = await res.json(); } catch { /* bo'sh */ }
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, json, cookie: setCookie.map((c) => c.split(";")[0]).join("; ") };
}
async function login(label) {
  const c = cred(label);
  const r = await http("POST", "/api/auth/login", { body: { phone: c.phone, password: c.password, company: QA_SLUG } });
  if (r.status !== 200) throw new Error(`login ${label}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return r.cookie;
}
const n = (v) => Number(v ?? 0);
const today = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
const results = [];
const facts = {};
function check(cond, msg, detail) { if (!cond) { const e = new Error(msg); e.detail = detail; throw e; } }
async function test(no, name, fn) {
  try { const info = await fn(); results.push({ no, name, status: "PASS", info: info ?? null }); console.log(`PASS ${no}. ${name}`); }
  catch (e) { results.push({ no, name, status: "FAIL", error: e.message, detail: e.detail ?? null }); console.log(`FAIL ${no}. ${name}: ${e.message} ${e.detail ? JSON.stringify(e.detail).slice(0, 300) : ""}`); }
}

(async () => {
  const owner = await login("QA owner \\(BUM QA Test\\)");
  const ozoda = await login("QA QA Kassir Ozoda");
  const diana = await login("QA QA Kassir Diana");
  const O = (m, p, b) => http(m, p, { cookie: owner, body: b });
  const Z = (m, p, b) => http(m, p, { cookie: ozoda, body: b });
  const D = (m, p, b) => http(m, p, { cookie: diana, body: b });
  const acc = Object.fromEntries((await O("GET", "/api/finance/cash-accounts")).json.cashAccounts.map((a) => [a.code || a.name, a]));
  const MAIN = Object.values(acc).find((a) => a.isDefault).id;
  const products = (await O("GET", "/api/catalog/products?limit=50")).json.products;
  const SUT = products.find((p) => p.sku === "QA-SUT").id;
  const methods = Object.fromEntries((await O("GET", "/api/finance/payment-methods")).json.paymentMethods.map((m) => [m.name, m.id]));
  await test(2, "Kassa assignment (retest)", async () => {
    const onMain = await Z("POST", "/api/sales/pos/shifts", { warehouseId: QA_WH, cashAccountId: MAIN, openingCash: "0" });
    check(onMain.status === 400, `asosiy kassada smena ${onMain.status}`, onMain.json);
    const list = (await Z("GET", `/api/sales/pos/kassas?warehouseId=${QA_WH}`)).json.kassas.map((k) => k.code);
    check(JSON.stringify(list) === JSON.stringify(["QA1", "QA2"]), `kassalar ${list}`);
    return { onMain: onMain.status, message: onMain.json?.message, kassas: list };
  });
  await test(24, "Tenant isolation (retest)", async () => {
    const r = {};
    for (const [label, path] of [["prodWarehouseKassas", "/api/sales/pos/kassas?warehouseId=02ed066f-76c8-4c29-8e04-9019a17c9687"], ["prodCompanyProducts", `/api/catalog/products/${PROD_COMPANY_IDS[0]}`], ["prodCashAccountTx", "/api/finance/cash-accounts/e109bad9-b26b-4968-9529-5817c6ae31d5/transactions"], ["randomOrder", `/api/sales/orders/${crypto.randomUUID()}`], ["randomShift", `/api/sales/pos/shifts/${crypto.randomUUID()}`], ["randomCustomer", `/api/sales/customers/${crypto.randomUUID()}`]]) r[label] = (await O("GET", path)).status;
    const other = await fetch(`${STAGING}/api/sales/orders`, { headers: { cookie: owner, "x-bum-company": "bonnu-market" } });
    r.otherSlug = other.status;
    check(r.otherSlug !== 200, `boshqa kompaniya ${r.otherSlug}`);
    for (const k of Object.keys(r).filter((k) => k !== "otherSlug")) check([403, 404].includes(r[k]), `${k} ${r[k]}`, r);
    return r;
  });
  await test(27, "Audit (retest: yangi sotuv + kassa kodi)", async () => {
    const shifts = (await D("GET", `/api/sales/pos/shifts/open?warehouseId=${QA_WH}`)).json.shift;
    const sale = await D("POST", "/api/sales/pos/sales", { shiftId: shifts.id, items: [{ productId: SUT, quantity: "1" }], paymentMethod: "cash", payments: [{ method: "cash", amount: "25000", paymentMethodId: methods.Naqd }], sellerEmployeeId: EMP.ali });
    check(sale.status === 201, `sotuv ${sale.status}`, sale.json);
    const patch = await O("PATCH", `/api/finance/cash-accounts/${acc.QA2.id}`, { code: "QA2" });
    check(patch.status === 200, `kassa kodi ${patch.status}`, patch.json);
    facts.retestSale = { id: sale.json.order.id, number: sale.json.order.number, kassaQA2: acc.QA2.id };
    return facts.retestSale;
  });
  fs.writeFileSync(OUT, JSON.stringify({ results, facts }, null, 1));
  console.log("SUMMARY", JSON.stringify({ pass: results.filter((r) => r.status === "PASS").length, fail: results.filter((r) => r.status === "FAIL").length }));
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

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
  const ali = await login("QA QA Sotuvchi Ali");
  const O = (m, p, b) => http(m, p, { cookie: owner, body: b });
  const Z = (m, p, b) => http(m, p, { cookie: ozoda, body: b });
  const D = (m, p, b) => http(m, p, { cookie: diana, body: b });
  const A = (m, p, b) => http(m, p, { cookie: ali, body: b });

  // Ma'lumotnoma
  const accounts = async () => Object.fromEntries((await O("GET", "/api/finance/cash-accounts")).json.cashAccounts.map((a) => [a.code || a.name, a]));
  let acc = await accounts();
  const K1 = acc.QA1.id, K2 = acc.QA2.id;
  const MAIN = Object.values(acc).find((a) => a.isDefault).id;
  const BANK = Object.values(acc).find((a) => a.type === "bank").id;
  const products = (await O("GET", "/api/catalog/products?limit=50")).json.products;
  const P = Object.fromEntries(products.filter((p) => p.sku.startsWith("QA-")).map((p) => [p.sku, p.id]));
  const customers = (await O("GET", "/api/sales/customers?limit=50")).json.customers;
  const KARIM = customers.find((c) => c.name === "QA Mijoz Karim").id;
  const methods = Object.fromEntries((await O("GET", "/api/finance/payment-methods")).json.paymentMethods.map((m) => [m.name, m.id]));
  const bal = async (id) => n((await O("GET", "/api/finance/cash-accounts")).json.cashAccounts.find((a) => a.id === id).balance);
  const stock = async (pid) => n(((await O("GET", `/api/inventory/stock/products/${pid}`)).json.stock ?? []).find((r) => r.warehouseId === QA_WH)?.quantity);
  const debt = async () => n((await O("GET", `/api/sales/customers/${KARIM}`)).json.customer.totalDebt);
  const snapshot = async () => ({ k1: await bal(K1), k2: await bal(K2), main: await bal(MAIN), bank: await bal(BANK), non: await stock(P["QA-NON"]), sut: await stock(P["QA-SUT"]), choy: await stock(P["QA-CHOY"]), debt: await debt() });
  const book = await snapshot();
  facts.baseline = { ...book };
  const expectBook = async (label) => { const now = await snapshot(); for (const k of Object.keys(book)) check(now[k] === book[k], `${label}: ${k} kutilgan ${book[k]}, bor ${now[k]}`, { now, book }); return now; };
  const sell = (who, shiftId, items, parts, extra = {}) => who("POST", "/api/sales/pos/sales", { shiftId, items: items.map(([sku, q, d]) => ({ productId: P[sku], quantity: String(q), ...(d ? { discountPercent: d } : {}) })), paymentMethod: "cash", ...(parts ? { payments: parts } : {}), ...extra });
  const cash = (amount) => ({ method: "cash", amount: String(amount), paymentMethodId: methods.Naqd });
  const card = (name, amount) => ({ method: "card", amount: String(amount), paymentMethodId: methods[name] });
  const bank = (amount) => ({ method: "bank", amount: String(amount), paymentMethodId: methods["Bank o'tkazma"] });
  const orders = {};
  let shift1, shift2;

  // Tayyorlov: asosiy kassaga 200 000 (QA float), QA1 ga 100 000 o'tkazma — smena 100 000 bilan ochilishi uchun
  {
    const r1 = await O("POST", `/api/finance/cash-accounts/${MAIN}/set-balance`, { balance: String(book.main + 200000), reason: "QA acceptance: boshlang'ich naqd" });
    check(r1.status === 200, `set-balance ${r1.status}`, r1.json);
    book.main += 200000;
    const r2 = await O("POST", "/api/finance/cash-transfers", { fromCashAccountId: MAIN, toCashAccountId: K1, amount: "100000", description: "QA1 boshlang'ich naqd" });
    check(r2.status === 201 || r2.status === 200, `transfer ${r2.status}`, r2.json);
    book.main -= 100000; book.k1 += 100000;
    await expectBook("tayyorlov");
  }

  await test(2, "Kassa assignment", async () => {
    acc = await accounts();
    check(acc.QA1.warehouseId === QA_WH && acc.QA2.warehouseId === QA_WH, "QA1/QA2 QA omboriga biriktirilgan emas");
    const list = (await Z("GET", `/api/sales/pos/kassas?warehouseId=${QA_WH}`)).json.kassas.map((k) => k.code);
    check(JSON.stringify(list) === JSON.stringify(["QA1", "QA2"]), `kassir ko'radigan kassalar: ${list}`);
    // Kassa tanlanmasa — rad
    const none = await Z("POST", "/api/sales/pos/shifts", { warehouseId: QA_WH, openingCash: "0" });
    check(none.status === 400, `kassasiz smena ${none.status}`);
    // Asosiy (omborga biriktirilmagan) kassada POS smena — rad bo'lishi kerak
    const onMain = await Z("POST", "/api/sales/pos/shifts", { warehouseId: QA_WH, cashAccountId: MAIN, openingCash: "0" });
    if (onMain.status === 201) { await Z("POST", `/api/sales/pos/shifts/${onMain.json.shift.id}/close`, { closingCash: String(book.main) }); }
    check([400, 403].includes(onMain.status), `asosiy kassada POS smena ochildi (${onMain.status}) — omborga biriktirilmagan kassa smena kassasi bo'lmasligi kerak`);
    return { kassas: list };
  });

  await test(3, "Shift", async () => {
    const r = await Z("POST", "/api/sales/pos/shifts", { warehouseId: QA_WH, cashAccountId: K1, openingCash: "100000" });
    check(r.status === 201, `QA1 smena ${r.status}`, r.json);
    shift1 = r.json.shift;
    check(shift1.status === "open" && shift1.cashAccountId === K1 && shift1.warehouseId === QA_WH && n(shift1.openingBalance) === 100000 && n(shift1.openingCash) === 100000, "smena maydonlari", shift1);
    const me = (await Z("GET", "/api/auth/me")).json.user;
    check(shift1.cashierId === me.id, "kassir = Ozoda emas");
    const dup = await D("POST", "/api/sales/pos/shifts", { warehouseId: QA_WH, cashAccountId: K1 });
    check(dup.status === 409, `QA1 ga ikkinchi smena ${dup.status}`);
    const r2 = await D("POST", "/api/sales/pos/shifts", { warehouseId: QA_WH, cashAccountId: K2, openingCash: "0" });
    check(r2.status === 201, `QA2 smena ${r2.status}`, r2.json);
    shift2 = r2.json.shift;
    const aliDup = await A("POST", "/api/sales/pos/shifts", { warehouseId: QA_WH, cashAccountId: K2 });
    check(aliDup.status === 409, `QA2 ga ikkinchi smena ${aliDup.status}`);
    return { shift1: shift1.id, shift2: shift2.id, openingBalance: shift1.openingBalance };
  });

  await test(4, "Salesperson ≠ cashier (sotuv 35 000)", async () => {
    const r = await sell(Z, shift1.id, [["QA-NON", 1], ["QA-SUT", 1]], [cash(35000)], { sellerEmployeeId: EMP.ali });
    check(r.status === 201, `sotuv ${r.status}`, r.json);
    check(n(r.json.order.totalAmount) === 35000, "jami 35 000", r.json.order);
    orders.S1 = r.json.order;
    book.k1 += 35000; book.non -= 1; book.sut -= 1;
    await expectBook("S1");
    return { order: r.json.order.number };
  });

  await test(5, "Cash sale 45 000", async () => {
    const r = await sell(Z, shift1.id, [["QA-NON", 2], ["QA-SUT", 1]], [cash(45000)], { sellerEmployeeId: EMP.ali });
    check(r.status === 201, `sotuv ${r.status}`, r.json);
    check(n(r.json.order.totalAmount) === 45000 && n(r.json.paid) === 45000 && r.json.order.paymentStatus === "paid", "sotuv/to'lov", r.json);
    orders.S2 = r.json.order;
    book.k1 += 45000; book.non -= 2; book.sut -= 1;
    await expectBook("S2");
  });

  await test(6, "UZCARD sale 40 000", async () => {
    const r = await sell(Z, shift1.id, [["QA-CHOY", 1]], [card("UZCARD", 40000)], { sellerEmployeeId: EMP.ali });
    check(r.status === 201, `sotuv ${r.status}`, r.json);
    orders.S3 = r.json.order;
    book.bank += 40000; book.choy -= 1;
    await expectBook("S3 (kassa o'zgarmaydi)");
  });

  await test(7, "HUMO sale 40 000", async () => {
    const r = await sell(Z, shift1.id, [["QA-CHOY", 1]], [card("HUMO", 40000)], { sellerEmployeeId: EMP.ali });
    check(r.status === 201, `sotuv ${r.status}`, r.json);
    orders.S4 = r.json.order;
    book.bank += 40000; book.choy -= 1;
    await expectBook("S4");
  });

  await test(8, "Bank payment 25 000", async () => {
    const r = await sell(Z, shift1.id, [["QA-SUT", 1]], [bank(25000)], { sellerEmployeeId: EMP.ali });
    check(r.status === 201, `sotuv ${r.status}`, r.json);
    orders.S5 = r.json.order;
    book.bank += 25000; book.sut -= 1;
    await expectBook("S5");
  });

  await test(9, "Mixed payment 75 000 + replay", async () => {
    const key = crypto.randomUUID();
    const parts = [cash(25000), card("UZCARD", 25000), bank(25000)];
    const r = await sell(Z, shift1.id, [["QA-NON", 1], ["QA-SUT", 1], ["QA-CHOY", 1]], parts, { sellerEmployeeId: EMP.ali, clientRequestId: key });
    check(r.status === 201, `sotuv ${r.status}`, r.json);
    check(n(r.json.order.totalAmount) === 75000 && n(r.json.paid) === 75000, "75 000", r.json);
    orders.S6 = r.json.order;
    book.k1 += 25000; book.bank += 50000; book.non -= 1; book.sut -= 1; book.choy -= 1;
    const replay = await sell(Z, shift1.id, [["QA-NON", 1], ["QA-SUT", 1], ["QA-CHOY", 1]], parts, { sellerEmployeeId: EMP.ali, clientRequestId: key });
    check(replay.status === 409, `replay ${replay.status}`);
    await expectBook("S6 + replay");
    return { replay: replay.status };
  });

  await test(10, "Credit sale 80 000", async () => {
    const r = await sell(Z, shift1.id, [["QA-CHOY", 2]], null, { customerId: KARIM, onCredit: true, amountPaid: "0", sellerEmployeeId: EMP.ali });
    check(r.status === 201, `sotuv ${r.status}`, r.json);
    check(n(r.json.order.totalAmount) === 80000 && n(r.json.order.paidAmount) === 0, "80 000 / 0", r.json.order);
    orders.S7 = r.json.order;
    book.debt += 80000; book.choy -= 2;
    await expectBook("S7");
  });

  await test(11, "Debt payment 50 000 + replay", async () => {
    const key = crypto.randomUUID();
    const body = { shiftId: shift1.id, purpose: "debt", parts: [cash(50000)], clientRequestId: key };
    const r = await Z("POST", `/api/sales/pos/customers/${KARIM}/payments`, body);
    check(r.status === 201, `to'lov ${r.status}`, r.json);
    book.k1 += 50000; book.debt -= 50000;
    const replay = await Z("POST", `/api/sales/pos/customers/${KARIM}/payments`, body);
    check([200, 201, 409].includes(replay.status), `replay ${replay.status}`, replay.json);
    await expectBook("qarz to'lovi + replay");
    return { debtAfter: book.debt, replay: replay.status };
  });

  await test(12, "Partial payment 20 000 UZCARD + 10 000 Bank", async () => {
    const r = await Z("POST", `/api/sales/pos/customers/${KARIM}/payments`, { shiftId: shift1.id, purpose: "debt", parts: [card("UZCARD", 20000), bank(10000)], clientRequestId: crypto.randomUUID() });
    check(r.status === 201, `to'lov ${r.status}`, r.json);
    book.bank += 30000; book.debt -= 30000;
    await expectBook("qisman to'lov");
    check(book.debt === 0, "qarz 0 emas");
  });

  await test(13, "Forbidden payment method (HUMO faqat QA2)", async () => {
    const p = await O("PATCH", `/api/finance/payment-methods/${methods.HUMO}`, { kassaIds: [K2] });
    check(p.status === 200, `cheklash ${p.status}`, p.json);
    const opts = (await Z("GET", `/api/sales/pos/payment-options?shiftId=${shift1.id}`)).json.paymentMethods.map((m) => m.name);
    check(!opts.includes("HUMO"), `QA1 ekranida HUMO ko'rinyapti: ${opts}`);
    const r = await sell(Z, shift1.id, [["QA-CHOY", 1]], [card("HUMO", 40000)]);
    check(r.status === 403, `HUMO QA1 da ${r.status}`, r.json);
    await expectBook("taqiqlangan usul — ta'sir yo'q");
    return { status: r.status };
  });

  await test(14, "Forbidden kassa", async () => {
    const toK2 = await sell(Z, shift1.id, [["QA-NON", 1]], [{ method: "cash", amount: "10000", cashAccountId: K2 }]);
    check(toK2.status === 403, `naqd QA2 ga ${toK2.status}`, toK2.json);
    const toMain = await sell(Z, shift1.id, [["QA-NON", 1]], [{ method: "cash", amount: "10000", cashAccountId: MAIN }]);
    check(toMain.status === 403, `naqd asosiy kassaga ${toMain.status}`, toMain.json);
    const foreignShift = await sell(Z, shift2.id, [["QA-NON", 1]], [cash(10000)]);
    check(foreignShift.status === 403, `Diana smenasida ${foreignShift.status}`, foreignShift.json);
    const depositOther = await Z("POST", `/api/sales/pos/customers/${KARIM}/payments`, { shiftId: shift1.id, purpose: "deposit", parts: [{ method: "cash", amount: "1000", cashAccountId: K2 }] });
    check(depositOther.status === 403, `balansga naqd QA2 ga ${depositOther.status}`, depositOther.json);
    await expectBook("taqiqlangan kassa — ta'sir yo'q");
    return { toK2: toK2.status, toMain: toMain.status, foreignShift: foreignShift.status, deposit: depositOther.status };
  });

  await test(15, "Concurrency (oversell yo'q)", async () => {
    const R = await stock(P["QA-NON"]);
    const q = Math.floor(R / 2) + 1;
    check(q * 2 > R && q <= R, "sinov sharti");
    const [a, b] = await Promise.all([
      sell(Z, shift1.id, [["QA-NON", q]], [cash(q * 10000)]),
      sell(D, shift2.id, [["QA-NON", q]], [cash(q * 10000)]),
    ]);
    const statuses = [a.status, b.status];
    check(statuses.filter((s) => s === 201).length === 1, `aynan bittasi o'tishi kerak: ${statuses}`, { a: a.json, b: b.json });
    const loser = a.status === 201 ? b : a;
    check(loser.status === 400, `rad etilgan ${loser.status}`, loser.json);
    if (a.status === 201) { book.k1 += q * 10000; orders.C = a.json.order; } else { book.k2 += q * 10000; orders.C = b.json.order; }
    book.non -= q;
    const after = await expectBook("parallel");
    check(after.non >= 0, "manfiy qoldiq");
    return { before: R, each: q, statuses, winner: a.status === 201 ? "QA1" : "QA2", after: after.non };
  });

  await test(16, "Return (1 × QA-NON, S2) + replay", async () => {
    const detail = (await O("GET", `/api/sales/orders/${orders.S2.id}`)).json;
    const item = (detail.order?.items ?? detail.items).find((i) => i.productId === P["QA-NON"]);
    const key = crypto.randomUUID();
    const body = { items: [{ orderItemId: item.id, quantity: "1" }], refundMethod: "cash", shiftId: shift1.id, requestId: key, reason: "QA qaytarish" };
    const r = await O("POST", `/api/sales/orders/${orders.S2.id}/return-items`, body);
    check([200, 201].includes(r.status), `qaytarish ${r.status}`, r.json);
    book.k1 -= 10000; book.non += 1;
    const replay = await O("POST", `/api/sales/orders/${orders.S2.id}/return-items`, body);
    check([200, 201, 409].includes(replay.status), `replay ${replay.status}`, replay.json);
    await expectBook("qaytarish + replay");
    // Kassir qaytara olmaydi (sales.refund yo'q)
    const byCashier = await Z("POST", `/api/sales/orders/${orders.S1.id}/return-items`, { items: [{ orderItemId: item.id, quantity: "1" }], refundMethod: "cash", shiftId: shift1.id });
    check(byCashier.status === 403, `kassir qaytarishi ${byCashier.status}`);
    return { replay: replay.status };
  });

  await test(17, "Discount (10% QA-NON, rahbar, QA2)", async () => {
    const denied = await sell(Z, shift1.id, [["QA-NON", 1, "10"]], [cash(9000)]);
    check(denied.status === 403, `kassir chegirmasi ${denied.status}`);
    const r = await sell(O, shift2.id, [["QA-NON", 1, "10"]], [cash(9000)], { sellerEmployeeId: EMP.ali });
    check(r.status === 201, `chegirmali sotuv ${r.status}`, r.json);
    check(n(r.json.order.totalAmount) === 9000, "net 9 000", r.json.order);
    orders.D = r.json.order;
    book.k2 += 9000; book.non -= 1;
    await expectBook("chegirma");
  });

  await test(26, "Cash movement idempotency (inkassatsiya 50 000 QA1 → asosiy)", async () => {
    const key = crypto.randomUUID();
    const r1 = await Z("POST", `/api/sales/pos/shifts/${shift1.id}/cash-movements`, { kind: "collection", amount: "50000", requestId: key });
    check(r1.status === 201, `inkassatsiya ${r1.status}`, r1.json);
    const r2 = await Z("POST", `/api/sales/pos/shifts/${shift1.id}/cash-movements`, { kind: "collection", amount: "50000", requestId: key });
    check(r2.status === 200, `replay ${r2.status}`);
    book.k1 -= 50000; book.main += 50000;
    await expectBook("inkassatsiya + replay");
  });

  // Yopish (haqiqiy naqd = kutilgan)
  await test(18, "Kassa report (QA1)", async () => {
    const view = (await Z("GET", `/api/sales/pos/shifts/${shift1.id}`)).json.shift;
    check(n(view.expectedCash) === book.k1, `kutilgan ${view.expectedCash} ≠ kassa ${book.k1}`);
    const closed = await Z("POST", `/api/sales/pos/shifts/${shift1.id}/close`, { closingCash: String(book.k1) });
    check(closed.status === 200 && n(closed.json.shift.cashDifference) === 0, `yopish ${closed.status}`, closed.json);
    const rep = (await O("GET", `/api/analytics/reports/kassa?from=${today()}&to=${today()}`)).json.kassas.find((k) => k.code === "QA1");
    const cashSales = 35000 + 45000 + 25000 + 50000 + (facts.concurrencyWinner === "QA1" ? 0 : 0);
    facts.kassaReportQA1 = rep;
    const formula = n(rep.opening) + n(rep.cashSales) + n(rep.otherIn) + n(rep.transfersIn) - n(rep.refunds) - n(rep.expenses) - n(rep.otherOut) - n(rep.transfersOut) - n(rep.supplierPayments) - n(rep.salesReversals) + n(rep.supplierRefunds);
    check(formula === n(rep.expected), `formula ${formula} ≠ kutilgan ${rep.expected}`, rep);
    check(n(rep.closing) === book.k1 && n(rep.balanceNow) === book.k1, "yakuniy = kassa", rep);
    check(n(rep.transfersIn) === 100000 && n(rep.transfersOut) === 50000 && n(rep.refunds) === 10000, "o'tkazma/qaytarish", rep);
    check(n(rep.cashSales) >= cashSales, "naqd tushum", rep);
    return { report: rep };
  });

  await test(19, "KPI (Rule Builder)", async () => {
    for (const [metric, rate] of [["seller_sales_amount", "1"], ["seller_receipt_count", "100"], ["seller_gross_profit", "5"]]) {
      for (const emp of [EMP.ali, EMP.ozoda]) {
        const r = await O("PUT", "/api/hr/kpi/rules", { employeeId: emp, metric, bonusType: "tiered", tiers: [{ fromValue: "0", toValue: null, rate }] });
        check(r.status === 200, `qoida ${metric} ${r.status}`, r.json);
      }
    }
    const month = today().slice(0, 7);
    const aliKpi = (await O("GET", `/api/hr/kpi/preview?month=${month}&employeeId=${EMP.ali}`)).json.employees[0];
    const ozKpi = (await O("GET", `/api/hr/kpi/preview?month=${month}&employeeId=${EMP.ozoda}`)).json.employees[0];
    const line = (k, m) => (k?.lines ?? []).find((l) => l.metric === m);
    // Mustaqil: sotuv 35+45+40+40+25+75+80+9 = 349 000; qaytarish 10 000 → 339 000; chek 8; tannarx 230 000 − 6 000 = 224 000; YF 115 000
    check(n(line(aliKpi, "seller_sales_amount")?.metricValue) === 339000, "Ali sof savdo", aliKpi);
    check(n(line(aliKpi, "seller_receipt_count")?.metricValue) === 8, "Ali chek", aliKpi);
    check(n(line(aliKpi, "seller_gross_profit")?.metricValue) === 115000, "Ali YF", aliKpi);
    check(n(aliKpi.total) === 3390 + 800 + 5750, `Ali bonus ${aliKpi.total}`, aliKpi);
    check(!line(ozKpi, "seller_sales_amount") && !line(ozKpi, "seller_receipt_count"), "Ozoda (kassir) sotuvchi KPI'siga tushdi", ozKpi);
    facts.kpi = { ali: aliKpi, ozoda: ozKpi };
    return { aliTotal: aliKpi.total };
  });

  await test(20, "Salesperson report", async () => {
    const rep = (await O("GET", `/api/analytics/reports/sellers?from=${today()}&to=${today()}`)).json.sellers;
    const aliRow = rep.find((s) => s.employeeId === EMP.ali);
    check(aliRow && aliRow.receipts === 8 && n(aliRow.units) === 14 && n(aliRow.sales) === 349000 && n(aliRow.discount) === 1000 && n(aliRow.returns) === 10000 && n(aliRow.netSales) === 339000 && n(aliRow.cogs) === 224000 && n(aliRow.grossProfit) === 115000 && n(aliRow.bonus) === 9940, "Ali qatori", aliRow);
    check(!rep.some((s) => s.employeeId === EMP.ozoda || s.employeeId === EMP.diana), "kassir sotuvchi hisobotiga tushdi", rep);
    facts.sellerReport = aliRow;
  });

  await test(21, "Payment method report", async () => {
    const rep = (await O("GET", `/api/analytics/reports/payment-methods?from=${today()}&to=${today()}`)).json;
    const by = (label) => rep.methods.filter((m) => m.label === label).reduce((s, m) => s + n(m.amount), 0);
    const conc = orders.C ? n(orders.C.totalAmount) : 0;
    const exp = { Naqd: 35000 + 45000 + 25000 + 50000 + conc + 9000, UZCARD: 40000 + 25000 + 20000, HUMO: 40000, "Bank o'tkazma": 25000 + 25000 + 10000 };
    for (const [k, v] of Object.entries(exp)) check(by(k) === v, `${k}: ${by(k)} ≠ ${v}`, rep.methods);
    const total = Object.values(exp).reduce((a, b) => a + b, 0);
    check(n(rep.total) === total, `jami ${rep.total} ≠ ${total}`);
    facts.paymentReport = rep;
    return { total };
  });

  await test(24, "Tenant isolation (staging)", async () => {
    const r = {};
    r.foreignCompanyHeader = (await http("GET", "/api/sales/orders", { cookie: owner, body: undefined })).status; // o'z kompaniyasi
    const other = await fetch(`${STAGING}/api/sales/orders`, { headers: { cookie: owner, "x-bum-company": "bonnu-market" } });
    r.otherSlug = other.status;
    for (const [label, path] of [["prodCompanyProducts", `/api/catalog/products/${PROD_COMPANY_IDS[0]}`], ["prodWarehouseKassas", `/api/sales/pos/kassas?warehouseId=02ed066f-76c8-4c29-8e04-9019a17c9687`], ["prodCashAccountTx", `/api/finance/cash-accounts/e109bad9-b26b-4968-9529-5817c6ae31d5/transactions`], ["randomOrder", `/api/sales/orders/${crypto.randomUUID()}`], ["randomShift", `/api/sales/pos/shifts/${crypto.randomUUID()}`], ["randomCustomer", `/api/sales/customers/${crypto.randomUUID()}`]]) {
      r[label] = (await O("GET", path)).status;
    }
    check(r.otherSlug !== 200, `boshqa kompaniya sarlavhasi ${r.otherSlug}`);
    for (const k of ["prodCompanyProducts", "prodWarehouseKassas", "prodCashAccountTx", "randomOrder", "randomShift", "randomCustomer"]) check([403, 404, 400].includes(r[k]), `${k} ${r[k]}`, r);
    return r;
  });

  await test(25, "RBAC", async () => {
    const r = {};
    r.cashierCreateKassa = (await Z("POST", "/api/finance/cash-accounts", { name: "X", type: "cash", code: "QX", warehouseId: QA_WH })).status;
    r.cashierPatchMethod = (await Z("PATCH", `/api/finance/payment-methods/${methods.Naqd}`, { isActive: false })).status;
    r.cashierBoard = (await Z("GET", "/api/sales/pos/kassa-board")).status;
    r.cashierKassaReport = (await Z("GET", `/api/analytics/reports/kassa?from=${today()}&to=${today()}`)).status;
    r.sellerKpiRules = (await A("PUT", "/api/hr/kpi/rules", { employeeId: EMP.ali, metric: "seller_sales_amount", bonusType: "tiered", tiers: [{ fromValue: "0", toValue: null, rate: "50" }] })).status;
    r.sellerSellers = (await A("GET", "/api/sales/pos/sellers")).status;
    r.sellerOtherShift = (await sell(A, shift2.id, [["QA-NON", 1]], [cash(10000)])).status;
    r.managerBoard = (await O("GET", "/api/sales/pos/kassa-board")).status;
    r.managerMethods = (await O("GET", "/api/finance/payment-methods")).status;
    r.managerReport = (await O("GET", `/api/analytics/reports/sellers?from=${today()}&to=${today()}`)).status;
    check([r.cashierCreateKassa, r.cashierPatchMethod, r.cashierBoard, r.cashierKassaReport, r.sellerKpiRules, r.sellerOtherShift].every((s) => s === 403), "ruxsatsiz amal o'tdi", r);
    check([r.sellerSellers, r.managerBoard, r.managerMethods, r.managerReport].every((s) => s === 200), "ruxsatli amal rad", r);
    await expectBook("RBAC — ta'sir yo'q");
    return r;
  });

  facts.book = book;
  facts.orders = Object.fromEntries(Object.entries(orders).map(([k, o]) => [k, { id: o.id, number: o.number, total: o.totalAmount }]));
  facts.shifts = { shift1: shift1?.id, shift2: shift2?.id };
  fs.writeFileSync(OUT, JSON.stringify({ results, facts }, null, 1));
  console.log("SUMMARY", JSON.stringify({ pass: results.filter((r) => r.status === "PASS").length, fail: results.filter((r) => r.status === "FAIL").length }));
})().catch((e) => { console.error("ERR", e.message); fs.writeFileSync(OUT, JSON.stringify({ results, facts, fatal: e.message }, null, 1)); process.exit(1); });

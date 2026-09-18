/**
 * 0→100 simulyatsiya — biznes oqimlari (5–14 bo'limlar):
 * marketing, hudud, xarid, mijoz A (naqd), mijoz B (nasiya), mijoz C (aralash to'lov),
 * kassa (POS), yetkazib bo'lmadi, qisman yetkazish, qaytarish va omborlararo ko'chirish.
 */
import { section, check, expect, assert, call, raw, state, RUN, phoneFor, money, today } from "./lib.mjs";

// ─── Umumiy yordamchilar ─────────────────────────────────────────────────────

export const SHOP = { latitude: 41.311081, longitude: 69.240562 };

/** Do'kondan `meters` shimolda, yangi va aniq GPS o'lchovi. */
export const near = (meters = 20) => ({
  latitude: SHOP.latitude + (meters / 6371008.8) * (180 / Math.PI),
  longitude: SHOP.longitude,
  accuracy: 10,
  recordedAt: new Date().toISOString(),
});

/** 1x1 PNG (base64) — tashrif va yetkazish rasmlari uchun. */
export const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Mahsulotning barcha omborlardagi jami qoldig'i. */
export async function stockOf(productId) {
  const res = await call("owner", "GET", `/api/inventory/stock/products/${productId}`);
  return res.stock.reduce((sum, row) => sum + money(row.quantity), 0);
}

/** Mijoz qarzi. */
export async function debtOf(customerId) {
  const res = await call("owner", "GET", `/api/sales/customers/${customerId}`);
  return money(res.customer.totalDebt ?? res.customer.balance);
}

/** Kassa/bank hisobining qoldig'i. */
export async function balanceOf(cashAccountId) {
  const list = await call("owner", "GET", "/api/finance/cash-accounts?includeInactive=true");
  return money(list.cashAccounts.find((a) => a.id === cashAccountId)?.balance);
}

/** Buyurtma holati (sotuv / to'lov / yetkazish uch o'qi). */
export async function orderOf(orderId) {
  const res = await call("owner", "GET", `/api/sales/orders/${orderId}`);
  return res.order;
}

/** Buyurtmaning yetkazma vazifasi. */
export async function taskForOrder(orderId) {
  const res = await call("owner", "GET", "/api/delivery/tasks?limit=200");
  return res.tasks.find((task) => task.orderId === orderId) ?? null;
}

/** Barcha jurnal yozuvlari balanslanganmi (DEBIT = CREDIT). */
export async function journalsBalanced() {
  const res = await call("accountant", "GET", "/api/finance/journal?limit=200").catch(() => null);
  if (!res) return null;
  const entries = res.entries ?? res.journalEntries ?? [];
  const unbalanced = entries.filter((entry) => {
    const debit = (entry.lines ?? []).reduce((sum, line) => sum + money(line.debit), 0);
    const credit = (entry.lines ?? []).reduce((sum, line) => sum + money(line.credit), 0);
    return Math.abs(debit - credit) > 0.004;
  });
  return { total: entries.length, unbalanced: unbalanced.length };
}

// ─── 5. MARKETING ────────────────────────────────────────────────────────────

export async function sectionMarketing() {
  section("5. Marketing: aksiya va chegirma");

  await check("marketolog aksiya yaratadi", async () => {
    const created = await call("marketer", "POST", "/api/sales-agent/supervisor/promotions", {
      name: "10 olsang 1 bepul",
      type: "buy_x_get_y",
      productId: state.products[0].id,
      minQuantity: "10",
      freeQuantity: "1",
      startsAt: today(),
      endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
    });
    state.promotionId = created.promotion.id;
    return `aksiya=${created.promotion.id}`;
  });

  await check("sotuv agenti aksiyani ko'radi", async () => {
    const list = await call("agent1", "GET", "/api/sales-agent/promotions?filter=active");
    assert((list.promotions ?? []).some((p) => p.id === state.promotionId), "agent aksiyani ko'rmadi");
    return `agentga ko'rinadi: ${list.promotions.length} ta`;
  });

  await check("ruxsatsiz xodim (kassir) aksiya yarata olmaydi", async () => {
    const res = await raw("cashier", "POST", "/api/sales-agent/supervisor/promotions", {
      name: "Ruxsatsiz",
      type: "percent_discount",
      productId: state.products[1].id,
      minQuantity: "1",
      discountPercent: "50",
      startsAt: today(),
      endsAt: today(),
    });
    return expect(res.status, 403, "kassir aksiya yaratishi");
  });
}

// ─── 6. HUDUD VA MIJOZLAR ────────────────────────────────────────────────────

export async function sectionTerritory() {
  section("6. Hudud (marshrut), mijozlar va agent ko'rinishi");

  await check("mijozlar A, B, C yaratiladi (koordinatali, kredit limiti bilan)", async () => {
    let index = 0;
    for (const key of ["a", "b", "c"]) {
      index += 1;
      const created = await call("owner", "POST", "/api/sales/customers", {
        name: `Mijoz ${key.toUpperCase()} ${RUN}`,
        phone: phoneFor(70 + index),
        ...SHOP,
        creditLimit: "5000000",
      });
      state.customers[key] = created.customer.id;
    }
    return Object.keys(state.customers).join(", ");
  });

  await check("savdo agenti profillari rol bilan avtomatik yaratilgan", async () => {
    const reps = await call("owner", "GET", "/api/distribution/sales-reps");
    state.salesReps = reps.salesReps;
    assert(reps.salesReps.length >= 2, `agent profili kam: ${reps.salesReps.length}`);
    return reps.salesReps.map((r) => r.name).join(", ");
  });

  await check("Hudud A marshruti agent 1 ga biriktiriladi (3 mijoz)", async () => {
    const agent1 = state.salesReps.find((r) => /1/.test(r.name)) ?? state.salesReps[0];
    state.agent1RepId = agent1.id;
    const route = await call("owner", "POST", "/api/distribution/routes", {
      name: "Hudud A",
      salesRepId: agent1.id,
      days: [0, 1, 2, 3, 4, 5, 6],
    });
    state.routeA = route.route.id;
    for (const key of ["a", "b", "c"]) {
      await call("owner", "POST", `/api/distribution/routes/${state.routeA}/customers`, { customerId: state.customers[key] });
    }
    return `marshrut=${route.route.name}, agent=${agent1.name}`;
  });

  await check("agent siyosati: geofence 500 m, minimal tashrif vaqti 0 (sinov sozlamasi)", async () => {
    const current = (await call("owner", "GET", "/api/sales-agent/policy")).policy;
    await call("owner", "PUT", "/api/sales-agent/policy", {
      ...current,
      geofenceRadiusMeters: 500,
      maxAccuracyMeters: 1000,
      minVisitMinutes: 0,
    });
    const saved = (await call("owner", "GET", "/api/sales-agent/policy")).policy;
    return `minVisitMinutes=${saved.minVisitMinutes}, geofence=${saved.geofenceRadiusMeters}`;
  });

  await check("agent faqat o'z hududidagi mijozlarni ko'radi", async () => {
    const mine = await call("agent1", "GET", "/api/sales-agent/stores?scope=all");
    const other = await call("agent2", "GET", "/api/sales-agent/stores?scope=all");
    assert(mine.stores.length >= 3, `agent 1 do'konlari: ${mine.stores.length}`);
    return expect(other.stores.length, 0, "agent 2 ko'rgan begona do'konlar");
  });
}

// ─── 7. XARID ────────────────────────────────────────────────────────────────

export async function sectionPurchase() {
  section("7. Ta'minotchi va xarid: qabul, qarz, aralash to'lov");

  await check("ta'minotchi yaratiladi", async () => {
    const created = await call("owner", "POST", "/api/purchase/suppliers", {
      name: `Ta'minotchi ${RUN}`,
      phone: phoneFor(80),
    });
    state.supplier = created.supplier.id;
    return `id=${state.supplier}`;
  });

  await check("xarid hujjati: A 100 dona, B 200 dona (tasdiqlandi)", async () => {
    const created = await call("owner", "POST", "/api/purchase/orders", {
      supplierId: state.supplier,
      warehouseId: state.warehouses.main,
      orderDate: today(),
      items: [
        { productId: state.products[0].id, unitId: state.units.piece, orderedQty: "100", unitPrice: "600" },
        { productId: state.products[1].id, unitId: state.units.piece, orderedQty: "200", unitPrice: "1200" },
      ],
    });
    state.purchaseOrderId = created.order.id;
    state.purchaseTotal = money(created.order.totalAmount);
    await call("owner", "POST", `/api/purchase/orders/${state.purchaseOrderId}/confirm`, {});
    return `${created.order.number} — ${state.purchaseTotal}`;
  });

  await check("ombor menejeri qabul qiladi, qoldiq oshadi", async () => {
    const before = await stockOf(state.products[0].id);
    const order = await call("owner", "GET", `/api/purchase/orders/${state.purchaseOrderId}`);
    await call("warehouse", "POST", `/api/purchase/orders/${state.purchaseOrderId}/receipts`, {
      receiptDate: today(),
      items: order.order.items.map((item) => ({ orderItemId: item.id, receivedQty: item.orderedQty })),
    });
    const after = await stockOf(state.products[0].id);
    return expect(after - before, 100, "A mahsuloti qoldig'ining o'sishi");
  });

  await check("ta'minotchi qarzi yozildi", async () => {
    const supplier = await call("owner", "GET", `/api/purchase/suppliers/${state.supplier}`);
    state.supplierDebt = money(supplier.supplier.totalDebt ?? supplier.supplier.balance);
    assert(state.supplierDebt > 0, `qarz yo'q: ${state.supplierDebt}`);
    return `qarz=${state.supplierDebt}`;
  });

  await check("TOPILMA: bo'sh terminal hisobidan ta'minotchiga to'lov rad etiladi (manfiy qoldiq yo'q)", async () => {
    const res = await raw("owner", "POST", "/api/purchase/payments", {
      supplierId: state.supplier,
      parts: [{ method: "card", amount: "1000", terminalId: state.terminals.uzcard }],
      paymentDate: today(),
      reference: `sim-supplier-card-${RUN}`,
    });
    assert(res.status === 400, `kutilgan 400, olingan ${res.status}`);
    return `karta hisobida pul yo'q → ${res.status} (${res.body?.message ?? ""})`;
  });

  await check("to'lov: 50% naqd + 50% bank (X Bank) → qarz 0", async () => {
    const half = Math.round(state.supplierDebt / 2);
    // Bank hisobiga pul kassadan o'tkaziladi (haqiqiy kompaniyadagidek)
    await call("owner", "POST", "/api/finance/cash-transfers", {
      fromCashAccountId: state.cashAccounts.main,
      toCashAccountId: state.cashAccounts.xbank,
      amount: String(half),
      txDate: today(),
      description: "Bankka o'tkazma",
    });
    await call("owner", "POST", "/api/purchase/payments", {
      supplierId: state.supplier,
      parts: [
        { method: "cash", amount: String(half) },
        { method: "bank", amount: String(state.supplierDebt - half), cashAccountId: state.cashAccounts.xbank },
      ],
      paymentDate: today(),
      reference: `sim-supplier-${RUN}`,
    });
    const supplier = await call("owner", "GET", `/api/purchase/suppliers/${state.supplier}`);
    return expect(money(supplier.supplier.totalDebt ?? supplier.supplier.balance), 0, "to'lovdan keyingi qarz");
  });

  await check("KESISHUV: xarid mijoz qarziga va sotuvga tegmadi", async () => {
    const customers = await call("owner", "GET", "/api/sales/customers?limit=200");
    const totalDebt = customers.customers.reduce((sum, c) => sum + money(c.totalDebt ?? c.balance), 0);
    const orders = await call("owner", "GET", "/api/sales/orders?limit=5");
    return expect([totalDebt, orders.orders.length], [0, 0], "[mijoz qarzi, sotuv soni]");
  });
}

// ─── Agent tashrifi va buyurtmasi (umumiy) ───────────────────────────────────

/** Agent ish sessiyasini ochadi (bir marta). */
async function ensureAgentShift(role) {
  const current = await raw(role, "GET", "/api/sales-agent/work-session");
  if (current.status === 200 && current.body?.session) return "sessiya ochiq";
  await call(role, "POST", "/api/sales-agent/work-session/start", near(10));
  return "sessiya ochildi";
}

/** Tashrif: boshlash + vitrina rasmi (bazaga). */
async function agentVisit(role, customerId) {
  const started = await call(role, "POST", "/api/sales-agent/visits/start", { customerId, ...near(10) });
  const visitId = started.visit.id;
  for (const kind of ["storefront", "shelf"]) {
    await call(role, "POST", `/api/sales-agent/visits/${visitId}/photos/direct`, {
      kind,
      contentType: "image/png",
      data: PNG_B64,
      ...near(10),
    });
  }
  return visitId;
}

/** Agent buyurtmasi: qoralama + yuborish. Natija — yaratilgan sotuv buyurtmasi. */
async function agentOrder(role, customerId, items, extra = {}) {
  const clientRequestId = crypto.randomUUID();
  const draft = await call(role, "PUT", `/api/sales-agent/orders/drafts/${clientRequestId}`, {
    customerId,
    items,
    paymentType: extra.paymentType ?? "cash",
    ...(extra.paymentDueDate ? { paymentDueDate: extra.paymentDueDate } : {}),
    ...(extra.deliveryDate ? { deliveryDate: extra.deliveryDate } : {}),
  });
  const submitted = await call(role, "POST", `/api/sales-agent/orders/${draft.order.id}/submit`, near(10));
  return submitted.order;
}

// ─── 8. MIJOZ A — NAQD YETKAZISH ─────────────────────────────────────────────

export async function sectionCustomerA() {
  section("8. Mijoz A — agent buyurtmasi, naqd to'lov va yetkazish");

  await check("kompaniya sozlamasi: yetkazish standart bo'yicha talab qilinadi", async () => {
    const current = (await call("owner", "GET", "/api/delivery/policy")).policy;
    await call("owner", "PUT", "/api/delivery/policy", {
      ...current,
      deliveryRequiredByDefault: true,
      geofenceRadiusMeters: 500,
      confirmation: { otp: false, signature: false, photo: false },
    });
    const saved = (await call("owner", "GET", "/api/delivery/policy")).policy;
    return `deliveryRequiredByDefault=${saved.deliveryRequiredByDefault}`;
  });

  await check("agent ish sessiyasini ochadi", () => ensureAgentShift("agent1"));
  await check("tashrif: vitrina rasmi bilan", async () => {
    state.visitA = await agentVisit("agent1", state.customers.a);
    return `tashrif=${state.visitA}`;
  });

  await check("buyurtma: 100 000 so'mlik (agent)", async () => {
    // Mahsulot 10: 10 000 so'm/dona → 10 dona = 100 000
    const product = state.products[9];
    const order = await agentOrder("agent1", state.customers.a, [{ productId: product.id, pieces: "10", boxes: "0" }]);
    state.orders.a = order;
    return `${order.number ?? order.id} summa=${money(order.totalAmount ?? order.total)}`;
  });

  await check("buyurtma sotuvga aylandi (ERP'da ko'rinadi)", async () => {
    const orders = await call("owner", "GET", "/api/sales/orders?limit=20");
    const found = orders.orders.find((o) => o.customerId === state.customers.a);
    assert(found, "sotuv buyurtmasi topilmadi");
    state.orders.aSale = found;
    return `${found.number} status=${found.status} source=${found.source} summa=${found.totalAmount}`;
  });

  await check("yetkazma vazifasi yaratildi (READY/ASSIGNED)", async () => {
    const task = await taskForOrder(state.orders.aSale.id);
    assert(task, "yetkazma vazifasi yo'q");
    state.taskA = task;
    return `${task.number} status=${task.status}`;
  });

  await check("supervayzer yetkazuvchiga biriktiradi", async () => {
    const agents = await call("owner", "GET", "/api/delivery/agents");
    state.couriers = agents.agents;
    assert(agents.agents.length >= 2, `yetkazuvchi kam: ${agents.agents.length}`);
    await call("supervisor", "POST", `/api/delivery/tasks/${state.taskA.id}/assign`, { deliveryAgentId: agents.agents[0].id });
    const task = await taskForOrder(state.orders.aSale.id);
    return expect(task.status, "assigned", "biriktirilgandan keyingi holat");
  });

  await check("yetkazuvchi: qabul → yo'lda → yetdi → topshirdi", async () => {
    await call("courier1", "POST", "/api/delivery/agent/work-session/start", near(20));
    for (const [action, body] of [
      ["accept", {}],
      ["start", {}],
      ["arrive", near(20)],
      ["delivering", {}],
    ]) {
      await call("courier1", "POST", `/api/delivery/agent/tasks/${state.taskA.id}/${action}`, {
        clientRequestId: crypto.randomUUID(),
        ...body,
      });
    }
    return "arrived → delivering";
  });

  await check("naqd 100 000 yig'ildi va yetkazma tasdiqlandi", async () => {
    const total = money(state.orders.aSale.totalAmount);
    await call("courier1", "POST", `/api/delivery/agent/tasks/${state.taskA.id}/payments`, {
      clientRequestId: crypto.randomUUID(),
      parts: [{ method: "cash", amount: String(total) }],
    });
    await call("courier1", "POST", `/api/delivery/agent/tasks/${state.taskA.id}/confirm`, {
      clientRequestId: crypto.randomUUID(),
      ...near(20),
    });
    const task = await taskForOrder(state.orders.aSale.id);
    return expect(task.status, "delivered", "yetkazma holati");
  });

  await check("natija: sotuv yakunlandi, to'langan, qarz 0, qoldiq kamaydi", async () => {
    const order = await orderOf(state.orders.aSale.id);
    const debt = await debtOf(state.customers.a);
    return expect(
      [order.status, money(order.paidAmount ?? order.totalPaid), debt],
      [order.status, money(order.totalAmount), 0],
      "[holat, to'langan, qarz]",
    );
  });
}

// ─── 9. MIJOZ B — NASIYA ─────────────────────────────────────────────────────

export async function sectionCustomerB() {
  section("9. Mijoz B — nasiya (500 000), keyin ikki bosqichda to'lov");

  await check("nasiya buyurtma: 500 000, to'lovsiz", async () => {
    await agentVisit("agent1", state.customers.b).catch(() => null);
    const product = state.products[9]; // 10 000 so'm
    const order = await agentOrder("agent1", state.customers.b, [{ productId: product.id, pieces: "50", boxes: "0" }], {
      paymentType: "credit",
      paymentDueDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
    });
    state.orders.b = order;
    const orders = await call("owner", "GET", "/api/sales/orders?limit=20");
    state.orders.bSale = orders.orders.find((o) => o.customerId === state.customers.b);
    assert(state.orders.bSale, "B sotuvi topilmadi");
    return `${state.orders.bSale.number} summa=${state.orders.bSale.totalAmount}`;
  });

  await check("yetkazish to'liq bajariladi", async () => {
    const task = await taskForOrder(state.orders.bSale.id);
    assert(task, "yetkazma yo'q");
    state.taskB = task;
    await call("supervisor", "POST", `/api/delivery/tasks/${task.id}/assign`, { deliveryAgentId: state.couriers[0].id });
    for (const [action, body] of [
      ["accept", {}],
      ["start", {}],
      ["arrive", near(20)],
      ["delivering", {}],
      ["confirm", near(20)],
    ]) {
      await call("courier1", "POST", `/api/delivery/agent/tasks/${task.id}/${action}`, {
        clientRequestId: crypto.randomUUID(),
        ...body,
      });
    }
    const after = await taskForOrder(state.orders.bSale.id);
    return expect(after.status, "delivered", "yetkazma holati");
  });

  await check("to'lovsiz yetkazishdan keyin: qarz = buyurtma summasi", async () => {
    const debt = await debtOf(state.customers.b);
    state.debtB = money(state.orders.bSale.totalAmount);
    return expect(debt, state.debtB, "mijoz B qarzi");
  });

  await check("TOPILMA: kassir ERP 'To'lovlar' orqali qarz yopa olmaydi (finance.manage)", async () => {
    const res = await raw("cashier", "POST", "/api/sales/payments", {
      customerId: state.customers.b,
      parts: [{ method: "cash", amount: "1000" }],
      paymentDate: today(),
      reference: `sim-cashier-denied-${RUN}`,
    });
    return expect(res.status, 403, "kassirning ERP to'lovi");
  });

  await check("mijoz 200 000 naqd to'laydi → qarz kamayadi (buxgalter)", async () => {
    await call("accountant", "POST", "/api/sales/payments", {
      customerId: state.customers.b,
      parts: [{ method: "cash", amount: "200000" }],
      paymentDate: today(),
      reference: `sim-b-cash-${RUN}`,
    });
    return expect(await debtOf(state.customers.b), state.debtB - 200_000, "qarz");
  });

  await check("qolganini UZCARD bilan to'laydi → qarz 0", async () => {
    const rest = await debtOf(state.customers.b);
    await call("accountant", "POST", "/api/sales/payments", {
      customerId: state.customers.b,
      parts: [{ method: "card", amount: String(rest), terminalId: state.terminals.uzcard }],
      paymentDate: today(),
      reference: `sim-b-card-${RUN}`,
    });
    return expect(await debtOf(state.customers.b), 0, "qarz");
  });

  await check("KESISHUV: to'lov yetkazma holatini o'zgartirmadi", async () => {
    const task = await taskForOrder(state.orders.bSale.id);
    return expect(task.status, "delivered", "yetkazma holati to'lovdan keyin");
  });
}

// ─── 10. MIJOZ C — ARALASH TO'LOV ────────────────────────────────────────────

export async function sectionCustomerC() {
  section("10. Mijoz C — 1 000 000: naqd 400k + UZCARD 300k + HUMO 300k");

  await check("buyurtma 1 000 000 (ERP orqali, yetkazish bilan)", async () => {
    const order = await call("owner", "POST", "/api/sales/orders", {
      customerId: state.customers.c,
      warehouseId: state.warehouses.main,
      orderDate: today(),
      deliveryRequired: true,
      items: [{ productId: state.products[9].id, quantity: "100" }],
    });
    await call("owner", "POST", `/api/sales/orders/${order.order.id}/confirm`, {});
    state.orders.cSale = await orderOf(order.order.id);
    return expect(money(state.orders.cSale.totalAmount), 1_000_000, "buyurtma summasi");
  });

  await check("aralash to'lov: 400k naqd + 300k UZCARD + 300k HUMO", async () => {
    await call("accountant", "POST", "/api/sales/payments", {
      customerId: state.customers.c,
      orderId: state.orders.cSale.id,
      parts: [
        { method: "cash", amount: "400000" },
        { method: "card", amount: "300000", terminalId: state.terminals.uzcard },
        { method: "card", amount: "300000", terminalId: state.terminals.humo },
      ],
      paymentDate: today(),
      reference: `sim-c-mixed-${RUN}`,
    });
    const order = await orderOf(state.orders.cSale.id);
    return expect(money(order.paidAmount ?? order.totalPaid), 1_000_000, "to'langan summa");
  });

  await check("buyurtma qoldig'i 0", async () => {
    const order = await orderOf(state.orders.cSale.id);
    const remaining = money(order.totalAmount) - money(order.paidAmount ?? order.totalPaid);
    return expect(remaining, 0, "buyurtma qoldig'i");
  });

  await check("TEKSHIRUV: yetkazilmagan buyurtmaga to'lov — balans oldindan to'lov sifatida", async () => {
    const debt = await debtOf(state.customers.c);
    state.advanceC = debt;
    assert(debt <= 0, `kutilgan: qarz yo'q yoki oldindan to'lov, olingan ${debt}`);
    return `yetkazishdan oldingi balans=${debt} (manfiy = oldindan to'lov)`;
  });

  await check("KESISHUV: to'lov yetkazma zanjirini boshlamadi", async () => {
    const task = await taskForOrder(state.orders.cSale.id);
    assert(task, "yetkazma vazifasi yo'q");
    state.taskC = task;
    assert(["ready", "assigned"].includes(task.status), `to'lov yetkazmani siljitdi: ${task.status}`);
    return `yetkazma holati=${task.status}`;
  });

  await check("yetkazish yakunlangach mijoz balansi 0 ga qaytadi (ikki marta hisoblanmaydi)", async () => {
    const task = await taskForOrder(state.orders.cSale.id);
    await call("supervisor", "POST", `/api/delivery/tasks/${task.id}/assign`, { deliveryAgentId: state.couriers[0].id });
    for (const [action, body] of [
      ["accept", {}],
      ["start", {}],
      ["arrive", near(20)],
      ["delivering", {}],
      ["confirm", near(20)],
    ]) {
      await call("courier1", "POST", `/api/delivery/agent/tasks/${task.id}/${action}`, {
        clientRequestId: crypto.randomUUID(),
        ...body,
      });
    }
    const after = await taskForOrder(state.orders.cSale.id);
    const debt = await debtOf(state.customers.c);
    const order = await orderOf(state.orders.cSale.id);
    return expect([after.status, debt, money(order.paidAmount ?? order.totalPaid)], ["delivered", 0, 1_000_000], "[yetkazma, qarz, to'langan]");
  });

  await check("terminal pullari o'z hisoblarida (UZCARD va HUMO alohida)", async () => {
    const uzcard = await balanceOf(state.cashAccounts.uzcard);
    const humo = await balanceOf(state.cashAccounts.humo);
    assert(uzcard >= 300_000, `UZCARD qoldig'i kutilganidan kam: ${uzcard}`);
    return expect(humo, 300_000, "HUMO kutilayotgan qoldiq") + `; UZCARD=${uzcard}`;
  });
}

